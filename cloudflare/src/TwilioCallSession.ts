import {
  decodeMulaw,
  encodeMulaw,
  upsample8to24,
  downsample24to8,
  int16ToBase64,
  base64ToInt16,
  calculateRMSAmplitude
} from './audio';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  OPENAI_API_KEY: string;
}

interface TwilioMessage {
  event: string;
  streamSid?: string;
  start?: {
    streamSid: string;
    callSid: string;
    customParameters?: Record<string, string>;
  };
  media?: {
    payload: string;
  };
}

interface OpenAIEvent {
  type: string;
  session?: any;
  delta?: string;
  response_id?: string;
  item_id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  text?: string;
}

interface UserVoicePrefs {
  tts_provider: 'openai' | 'elevenlabs';
  openai_voice: string;
  elevenlabs_voice_id: string;
}

interface PreConnectSession {
  session_id: string;
  user_id: string;
  tts_provider?: 'openai' | 'elevenlabs';
  openai_voice?: string;
  // Support both DB schema names and legacy names
  voice_id?: string;
  elevenlabs_voice_id?: string;
  audio_base64?: string;
  cached_audio_base64?: string;
  instructions?: string;
  greeting_text?: string;
  rag_context?: string;
  thread_id?: string;
}

// ElevenLabs TTS response format
interface ElevenLabsTTSResponse {
  audio: string; // base64-encoded μ-law audio
  format: string;
  bytes: number;
  latencyMs: number;
}

// Sentence detection for ElevenLabs streaming
const SENTENCE_ENDERS = /[.!?]+[\s"')\]]*$/;

// Worker version for deployment verification
const WORKER_VERSION = '2026-01-28-cf-v3';

export class TwilioCallSession {
  private state: DurableObjectState;
  private env: Env;
  private twilioWs: WebSocket | null = null;
  private openaiWs: WebSocket | null = null;
  private streamSid: string | null = null;
  private callSid: string | null = null;
  private userId: string | null = null;
  private direction: 'inbound' | 'outbound' = 'outbound';
  private timezone: string = 'America/New_York';
  private isPlaying: boolean = false;
  private toolDefinitions: any[] = [];
  private activityLogId: string | null = null;
  private currentStage: string = 'init';

  // Voice preferences
  private ttsProvider: 'openai' | 'elevenlabs' = 'openai';
  private openaiVoice: string = 'alloy';
  private elevenlabsVoiceId: string = 'JBFqnCBsd6RMkjVDRZzb'; // George
  private elevenlabsFallbackActive: boolean = false;

  // Pre-connect session data
  private cachedAudioBase64: string | null = null;
  private preConnectedInstructions: string | null = null;
  private greetingText: string | null = null;
  private ragContext: string | null = null;
  private threadId: string | null = null;

  // ElevenLabs text buffering
  private textBuffer: string = '';
  private audioSentDuringResponse: boolean = false;

  // Echo suppression thresholds
  private readonly ECHO_THRESHOLD = 1500;
  private readonly BARGE_IN_THRESHOLD = 3000;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    this.twilioWs = server;
    server.accept();

    server.addEventListener('message', (event) => this.handleTwilioMessage(event));
    server.addEventListener('close', () => this.cleanup());
    server.addEventListener('error', (e) => {
      console.error('[CF] Twilio WebSocket error:', e);
      this.logErrorToSupabase('websocket_error', 'Twilio WebSocket error', { error: String(e) });
      this.cleanup();
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  // ==================== Supabase Logging ====================

  private async logActivityToSupabase(
    status: 'started' | 'connected' | 'completed' | 'error',
    stage: string,
    metadata: Record<string, any> = {}
  ) {
    if (!this.callSid) return;

    try {
      const activity = {
        user_id: this.userId || '00000000-0000-0000-0000-000000000001',
        activity_type: this.direction === 'inbound' ? 'phone_inbound' : 'phone_outbound',
        session_id: this.callSid,
        status,
        stage,
        metadata: {
          ...metadata,
          worker_version: WORKER_VERSION,
          tts_provider: this.ttsProvider,
          stream_sid: this.streamSid
        },
        started_at: status === 'started' ? new Date().toISOString() : undefined,
        ended_at: status === 'completed' || status === 'error' ? new Date().toISOString() : undefined
      };

      if (this.activityLogId) {
        // Update existing record
        await fetch(
          `${this.env.SUPABASE_URL}/rest/v1/activity_log?id=eq.${this.activityLogId}`,
          {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${this.env.SUPABASE_SERVICE_KEY}`,
              'apikey': this.env.SUPABASE_SERVICE_KEY,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
              status,
              stage,
              metadata: activity.metadata,
              ended_at: activity.ended_at
            })
          }
        );
      } else {
        // Create new record
        const response = await fetch(
          `${this.env.SUPABASE_URL}/rest/v1/activity_log`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.env.SUPABASE_SERVICE_KEY}`,
              'apikey': this.env.SUPABASE_SERVICE_KEY,
              'Content-Type': 'application/json',
              'Prefer': 'return=representation'
            },
            body: JSON.stringify(activity)
          }
        );

        if (response.ok) {
          const data = await response.json();
          if (data && data.length > 0) {
            this.activityLogId = data[0].id;
          }
        }
      }

      console.log(`[CF] Activity logged: ${stage} (${status})`);
    } catch (error) {
      console.error('[CF] Failed to log activity:', error);
    }
  }

  private async logErrorToSupabase(
    errorType: string,
    errorMessage: string,
    context: Record<string, any> = {}
  ) {
    try {
      await fetch(
        `${this.env.SUPABASE_URL}/rest/v1/error_log`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.env.SUPABASE_SERVICE_KEY}`,
            'apikey': this.env.SUPABASE_SERVICE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            user_id: this.userId || '00000000-0000-0000-0000-000000000001',
            source: 'cloudflare_worker',
            error_type: errorType,
            error_message: errorMessage,
            session_id: this.callSid,
            component: 'TwilioCallSession',
            context: {
              ...context,
              worker_version: WORKER_VERSION,
              stage: this.currentStage,
              tts_provider: this.ttsProvider,
              stream_sid: this.streamSid
            }
          })
        }
      );
      console.log(`[CF] Error logged: ${errorType} - ${errorMessage}`);
    } catch (error) {
      console.error('[CF] Failed to log error:', error);
    }
  }

  // ==================== Structured Attempt Logging ====================
  // Tracks greeting/tts/tool_call attempts with explicit success/fail status
  // to enable systematic debugging and prevent repeat issues

  private async logAttempt(
    attemptType: 'greeting' | 'tts' | 'tool_call' | 'session_config',
    status: 'attempted' | 'success' | 'failed',
    context: Record<string, any> = {}
  ) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      attempt_type: attemptType,
      status,
      timestamp,
      latency_ms: context.latency_ms,
      ...context
    };

    // Always log to console for debugging visibility
    console.log(`[ATTEMPT] ${attemptType}: ${status}`, JSON.stringify(logEntry));

    // Persist to database for historical analysis
    try {
      if (status === 'failed') {
        await this.logErrorToSupabase(
          `${attemptType}_failed`,
          context.error || 'Unknown error',
          logEntry
        );
      } else {
        await this.logActivityToSupabase(
          status === 'attempted' ? 'started' : 'connected',
          `cf_${attemptType}_${status}`,
          logEntry
        );
      }
    } catch (e) {
      console.error(`[ATTEMPT] Failed to persist ${attemptType} ${status}:`, e);
    }
  }

  // ==================== Message Handling ====================

  private async handleTwilioMessage(event: MessageEvent) {
    try {
      const message: TwilioMessage = JSON.parse(event.data as string);

      switch (message.event) {
        case 'start':
          await this.handleStart(message);
          break;
        case 'media':
          await this.handleMedia(message);
          break;
        case 'stop':
          await this.logActivityToSupabase('completed', 'cf_disconnect', { reason: 'stop_event' });
          this.cleanup();
          break;
      }
    } catch (error) {
      console.error('[CF] Error handling Twilio message:', error);
      await this.logErrorToSupabase('message_handling_error', String(error), { event: 'twilio_message' });
    }
  }

  private async handleStart(message: TwilioMessage) {
    console.log('[CF] WORKER VERSION:', WORKER_VERSION);
    this.currentStage = 'cf_ws_start';
    console.log('[CF] Call started');
    
    this.streamSid = message.start?.streamSid || null;
    this.callSid = message.start?.callSid || null;
    
    const params = message.start?.customParameters || {};
    this.userId = params.userId || null;
    this.timezone = params.timezone || 'America/New_York';
    this.direction = (params.direction as 'inbound' | 'outbound') || 'outbound';
    const sessionId = params.sessionId || null;

    console.log(`[CF] Stream: ${this.streamSid}, User: ${this.userId}, TZ: ${this.timezone}, SessionId: ${sessionId}, Direction: ${this.direction}`);

    // Log initial activity
    await this.logActivityToSupabase('started', 'cf_ws_start', {
      session_id_param: sessionId,
      has_session: !!sessionId
    });

    // If we have a pre-connected session, fetch it and use its data
    if (sessionId) {
      this.currentStage = 'cf_preconnect_fetch';
      const session = await this.fetchPreConnectSession(sessionId);
      if (session) {
        console.log('[CF] Using pre-connect session data');
        
        // Apply session preferences with defensive field mapping
        // Support both DB schema names (audio_base64, voice_id) and legacy names
        this.ttsProvider = (session.tts_provider as 'openai' | 'elevenlabs') || 'openai';
        this.elevenlabsVoiceId = session.voice_id || session.elevenlabs_voice_id || this.elevenlabsVoiceId;
        this.openaiVoice = session.openai_voice || 'alloy';
        this.cachedAudioBase64 = session.audio_base64 || session.cached_audio_base64 || null;
        this.preConnectedInstructions = session.instructions || null;
        this.greetingText = session.greeting_text || null;
        this.ragContext = session.rag_context || null;
        this.threadId = session.thread_id || null;

        console.log(`[CF] Pre-connect: TTS=${this.ttsProvider}, Voice=${this.elevenlabsVoiceId}, Cached audio=${this.cachedAudioBase64 ? `${this.cachedAudioBase64.length} chars` : 'no'}, Instructions=${this.preConnectedInstructions ? 'custom' : 'default'}`);

        await this.logActivityToSupabase('connected', 'cf_preconnect_fetch', {
          success: true,
          tts_provider: this.ttsProvider,
          has_cached_audio: !!this.cachedAudioBase64,
          has_instructions: !!this.preConnectedInstructions,
          has_rag_context: !!this.ragContext
        });

        // Fetch tool definitions (still needed)
        await this.fetchToolDefinitions();
        
        // Connect to OpenAI with pre-loaded data
        await this.connectToOpenAI();
        return;
      } else {
        await this.logActivityToSupabase('connected', 'cf_preconnect_fetch', {
          success: false,
          reason: 'session_not_found'
        });
      }
    }

    // Fallback: Load user preferences fresh (no pre-connect session)
    console.log('[CF] No pre-connect session, loading preferences fresh');
    await Promise.all([
      this.loadUserVoicePrefs(),
      this.fetchToolDefinitions()
    ]);

    console.log(`[CF] TTS Provider: ${this.ttsProvider}, Voice: ${this.ttsProvider === 'elevenlabs' ? this.elevenlabsVoiceId : this.openaiVoice}`);

    // Connect to OpenAI
    await this.connectToOpenAI();
  }

  private async fetchPreConnectSession(sessionId: string): Promise<PreConnectSession | null> {
    try {
      console.log(`[CF] Fetching pre-connect session: ${sessionId}`);
      
      const response = await fetch(
        `${this.env.SUPABASE_URL}/rest/v1/pre_connect_sessions?session_id=eq.${sessionId}&select=*`,
        {
          headers: {
            'Authorization': `Bearer ${this.env.SUPABASE_SERVICE_KEY}`,
            'apikey': this.env.SUPABASE_SERVICE_KEY,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        console.error(`[CF] Pre-connect fetch failed: ${response.status}`);
        await this.logErrorToSupabase('preconnect_fetch_error', `HTTP ${response.status}`, { sessionId });
        return null;
      }

      const data = await response.json();
      
      if (data && data.length > 0) {
        console.log('[CF] Pre-connect session found, deleting after retrieval');
        
        // Delete after retrieval (one-time use)
        await fetch(
          `${this.env.SUPABASE_URL}/rest/v1/pre_connect_sessions?session_id=eq.${sessionId}`,
          {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${this.env.SUPABASE_SERVICE_KEY}`,
              'apikey': this.env.SUPABASE_SERVICE_KEY
            }
          }
        );

        return data[0] as PreConnectSession;
      }

      console.log('[CF] No pre-connect session found for id:', sessionId);
      return null;
    } catch (error) {
      console.error('[CF] Failed to fetch pre-connect session:', error);
      await this.logErrorToSupabase('preconnect_fetch_exception', String(error), { sessionId });
      return null;
    }
  }

  private async loadUserVoicePrefs() {
    if (!this.userId) return;

    try {
      const response = await fetch(
        `${this.env.SUPABASE_URL}/rest/v1/user_scheduling_prefs?user_id=eq.${this.userId}&select=tts_provider,openai_voice,elevenlabs_voice_id`,
        {
          headers: {
            'Authorization': `Bearer ${this.env.SUPABASE_SERVICE_KEY}`,
            'apikey': this.env.SUPABASE_SERVICE_KEY,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        if (data && data.length > 0) {
          const prefs = data[0];
          this.ttsProvider = prefs.tts_provider || 'openai';
          this.openaiVoice = prefs.openai_voice || 'alloy';
          this.elevenlabsVoiceId = prefs.elevenlabs_voice_id || 'JBFqnCBsd6RMkjVDRZzb';
        }
      }
    } catch (error) {
      console.error('[CF] Failed to load voice preferences:', error);
    }
  }

  private async fetchToolDefinitions() {
    try {
      const response = await fetch(
        `${this.env.SUPABASE_URL}/functions/v1/execute-tool/definitions`,
        {
          headers: {
            'Authorization': `Bearer ${this.env.SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        this.toolDefinitions = (data.definitions || []).map((def: any) => ({
          type: 'function',
          name: def.name,
          description: def.description,
          parameters: def.parameters
        }));
        console.log(`[CF] Loaded ${this.toolDefinitions.length} tool definitions`);
      }
    } catch (error) {
      console.error('[CF] Failed to fetch tool definitions:', error);
    }
  }

  private async connectToOpenAI() {
    this.currentStage = 'cf_openai_connect';
    
    try {
      const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';
      
      this.openaiWs = new WebSocket(url, [
        'realtime',
        `openai-insecure-api-key.${this.env.OPENAI_API_KEY}`,
        'openai-beta.realtime-v1'
      ]);

      this.openaiWs.addEventListener('open', async () => {
        console.log('[CF] Connected to OpenAI');
        await this.logActivityToSupabase('connected', 'cf_openai_connect', { success: true });
      });

      this.openaiWs.addEventListener('message', (event) => {
        this.handleOpenAIMessage(event);
      });

      this.openaiWs.addEventListener('close', async () => {
        console.log('[CF] OpenAI connection closed');
        await this.logActivityToSupabase('completed', 'cf_openai_disconnect', {});
        this.cleanup();
      });

      this.openaiWs.addEventListener('error', async (e) => {
        console.error('[CF] OpenAI WebSocket error:', e);
        await this.logErrorToSupabase('openai_websocket_error', 'WebSocket connection error', { error: String(e) });
      });

    } catch (error) {
      console.error('[CF] Failed to connect to OpenAI:', error);
      await this.logErrorToSupabase('openai_connect_error', String(error), {});
    }
  }

  private async handleOpenAIMessage(event: MessageEvent) {
    try {
      const data: OpenAIEvent = JSON.parse(event.data as string);

      switch (data.type) {
        case 'session.created':
          await this.configureSession();
          break;

        case 'response.audio.delta':
          // Only handle if using OpenAI TTS (or fallback is active)
          if (this.ttsProvider === 'openai' || this.elevenlabsFallbackActive) {
            this.handleAudioDelta(data);
          }
          break;

        case 'response.audio.done':
          if (this.ttsProvider === 'openai' || this.elevenlabsFallbackActive) {
            this.isPlaying = false;
            this.elevenlabsFallbackActive = false;
          }
          break;

        case 'response.text.delta':
          // Only handle if using ElevenLabs TTS and not in fallback mode
          if (this.ttsProvider === 'elevenlabs' && !this.elevenlabsFallbackActive) {
            await this.handleTextDelta(data);
          }
          break;

        case 'response.text.done':
          // Flush remaining text buffer for ElevenLabs
          if (this.ttsProvider === 'elevenlabs' && !this.elevenlabsFallbackActive && this.textBuffer.trim()) {
            await this.sendToElevenLabs(this.textBuffer);
            this.textBuffer = '';
          }
          this.audioSentDuringResponse = false;
          break;

        case 'response.done':
          this.isPlaying = false;
          break;

        case 'input_audio_buffer.speech_started':
          this.handleBargeIn();
          break;

        case 'response.function_call_arguments.done':
          await this.handleFunctionCall(data);
          break;

        case 'error':
          console.error('[CF] OpenAI error:', data);
          await this.logErrorToSupabase('openai_api_error', JSON.stringify(data), {});
          break;
      }
    } catch (error) {
      console.error('[CF] Error handling OpenAI message:', error);
    }
  }

  private async configureSession() {
    this.currentStage = 'cf_session_configured';
    
    // Use text-only modality for ElevenLabs, text+audio for OpenAI TTS
    const modalities = this.ttsProvider === 'elevenlabs' 
      ? ['text'] 
      : ['text', 'audio'];

    const sessionConfig: any = {
      type: 'session.update',
      session: {
        modalities,
        instructions: this.buildSystemPrompt(),
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: {
          model: 'gpt-4o-mini-transcribe'
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 500,
          silence_duration_ms: 1500
        },
        tools: this.toolDefinitions,
        tool_choice: 'auto',
        temperature: 0.8
      }
    };

    // Only set voice for OpenAI TTS mode
    if (this.ttsProvider === 'openai') {
      sessionConfig.session.voice = this.openaiVoice;
    }

    this.openaiWs?.send(JSON.stringify(sessionConfig));
    console.log(`[CF] Session configured: ${this.ttsProvider} mode, ${this.toolDefinitions.length} tools`);

    await this.logActivityToSupabase('connected', 'cf_session_configured', {
      modalities,
      tools_count: this.toolDefinitions.length
    });

    // Send initial greeting
    await this.sendGreeting();
  }

  private buildSystemPrompt(): string {
    // If we have pre-connected instructions, use them (includes RAG context, agenda, etc.)
    if (this.preConnectedInstructions) {
      console.log('[CF] Using pre-connected instructions');
      return this.preConnectedInstructions;
    }

    // Fallback to basic prompt
    const now = new Date().toLocaleString('en-US', { timeZone: this.timezone });
    
    let prompt = `You are Iris, a voice assistant helping users manage their tasks and schedule.

Current time: ${now} (${this.timezone})
User ID: ${this.userId || 'unknown'}

## Guidelines
- Be concise and conversational - this is a phone call
- Confirm actions after completing them
- If a tool fails, explain the issue briefly
- Use natural language, not technical jargon
- When asked about tasks, use the appropriate tool to fetch real data
- Never make up or assume task information

## Available Actions
You can help with:
- Creating, updating, and completing tasks
- Scheduling tasks to specific times
- Searching the web for information
- Sending emails, Slack messages, and calendar events
- Ending the call when the user is done

When the user says goodbye or wants to end the call, use the hang_up tool.`;

    // Include RAG context if available
    if (this.ragContext) {
      prompt += `\n\n## Knowledge Base Context\n${this.ragContext}`;
    }

    return prompt;
  }

  private async sendGreeting() {
    this.currentStage = 'cf_greeting_sent';
    const greetingStartTime = Date.now();
    
    // Log attempt for debugging visibility
    await this.logAttempt('greeting', 'attempted', {
      has_cached_audio: !!this.cachedAudioBase64,
      tts_provider: this.ttsProvider
    });
    
    // If we have cached ElevenLabs audio, play it immediately (lowest latency)
    if (this.cachedAudioBase64 && this.twilioWs && this.streamSid) {
      console.log(`[CF] Playing cached greeting audio (${this.cachedAudioBase64.length} chars base64)`);
      this.isPlaying = true;
      
      try {
        // Decode base64 to bytes
        const audioBytes = Uint8Array.from(atob(this.cachedAudioBase64), c => c.charCodeAt(0));
        
        // Send in chunks to Twilio (80ms chunks for μ-law at 8kHz)
        const chunkSize = 640;
        for (let i = 0; i < audioBytes.length; i += chunkSize) {
          const chunk = audioBytes.slice(i, i + chunkSize);
          this.twilioWs.send(JSON.stringify({
            event: 'media',
            streamSid: this.streamSid,
            media: {
              payload: btoa(String.fromCharCode(...chunk))
            }
          }));
        }
        
        console.log(`[CF] Cached greeting sent: ${audioBytes.length} bytes`);
        await this.logAttempt('greeting', 'success', {
          source: 'cached_audio',
          bytes: audioBytes.length,
          latency_ms: Date.now() - greetingStartTime
        });
        this.isPlaying = false;
        return;
      } catch (error) {
        console.error('[CF] Failed to play cached audio, falling back:', error);
        await this.logAttempt('greeting', 'failed', {
          source: 'cached_audio',
          error: String(error),
          latency_ms: Date.now() - greetingStartTime
        });
      }
    }

    // Fallback: Use OpenAI to generate greeting
    const greeting = this.greetingText || 'Hi! This is Iris. How can I help you today?';
    
    try {
      // FIXED: Use 'text' type for assistant role (not 'input_text' which is only for user role)
      // This matches the working Supabase bridge implementation
      this.openaiWs?.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: greeting }]  // CORRECT: 'text' for assistant role
        }
      }));

      // Inject context for AI to continue the conversation naturally
      this.openaiWs?.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',  // 'input_text' is correct for user role
            text: `[System: You just greeted the user with "${greeting}". Wait for them to respond.]`
          }]
        }
      }));

      // Trigger response with explicit modalities (text for ElevenLabs, text+audio for OpenAI TTS)
      const modalities = this.ttsProvider === 'elevenlabs' ? ['text'] : ['text', 'audio'];
      this.openaiWs?.send(JSON.stringify({
        type: 'response.create',
        response: { modalities }
      }));
      
      console.log(`[CF] Greeting injected with modalities=${modalities.join(',')}`);
      await this.logAttempt('greeting', 'success', {
        source: 'openai_generated',
        greeting_text: greeting.substring(0, 50),
        modalities,
        latency_ms: Date.now() - greetingStartTime
      });
    } catch (error) {
      await this.logAttempt('greeting', 'failed', {
        source: 'openai_generated',
        error: String(error),
        latency_ms: Date.now() - greetingStartTime
      });
    }
  }

  // ==================== OpenAI TTS Handling ====================

  private handleAudioDelta(data: OpenAIEvent) {
    if (!data.delta || !this.twilioWs || !this.streamSid) return;

    this.isPlaying = true;

    try {
      // Decode base64 PCM16 from OpenAI (24kHz)
      const pcm24k = base64ToInt16(data.delta);
      
      // Downsample to 8kHz for Twilio
      const pcm8k = downsample24to8(pcm24k);
      
      // Encode to μ-law
      const mulaw = encodeMulaw(pcm8k);
      
      // Send to Twilio
      const mediaMessage = {
        event: 'media',
        streamSid: this.streamSid,
        media: {
          payload: btoa(String.fromCharCode(...mulaw))
        }
      };

      this.twilioWs.send(JSON.stringify(mediaMessage));
    } catch (error) {
      console.error('[CF] Error sending audio to Twilio:', error);
    }
  }

  // ==================== ElevenLabs TTS Handling ====================

  private async handleTextDelta(data: OpenAIEvent) {
    if (!data.delta) return;

    this.textBuffer += data.delta;

    // Check if we have a complete sentence
    if (SENTENCE_ENDERS.test(this.textBuffer)) {
      const textToSpeak = this.textBuffer.trim();
      this.textBuffer = '';
      
      if (textToSpeak) {
        await this.sendToElevenLabs(textToSpeak);
      }
    }
  }

  private async sendToElevenLabs(text: string) {
    if (!this.twilioWs || !this.streamSid) return;

    const startTime = Date.now();
    console.log(`[CF] ElevenLabs TTS: "${text.substring(0, 50)}..."`);
    this.isPlaying = true;
    this.audioSentDuringResponse = true;

    try {
      const response = await fetch(
        `${this.env.SUPABASE_URL}/functions/v1/elevenlabs-tts`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.env.SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            text,
            voiceId: this.elevenlabsVoiceId,
            format: 'ulaw' // Correct parameter name for our edge function
          })
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[CF] ElevenLabs error: ${response.status} - ${errorText}`);
        await this.logErrorToSupabase('elevenlabs_api_error', `HTTP ${response.status}`, { 
          errorText,
          text_length: text.length 
        });
        // Fallback to OpenAI TTS with explicit notification
        await this.fallbackToOpenAIWithNotification(text, `ElevenLabs returned ${response.status}`);
        return;
      }

      // Parse JSON response (our edge function returns JSON with base64 audio)
      const jsonResponse = await response.json() as ElevenLabsTTSResponse;
      
      if (!jsonResponse.audio) {
        console.error('[CF] ElevenLabs response missing audio field');
        await this.logErrorToSupabase('elevenlabs_response_error', 'Missing audio field in response', { 
          response_keys: Object.keys(jsonResponse) 
        });
        await this.fallbackToOpenAIWithNotification(text, 'Invalid response from voice service');
        return;
      }

      // Decode base64 audio to μ-law bytes
      const mulawBytes = Uint8Array.from(atob(jsonResponse.audio), c => c.charCodeAt(0));

      // Send in chunks to Twilio
      const chunkSize = 640; // 80ms of audio at 8kHz
      for (let i = 0; i < mulawBytes.length; i += chunkSize) {
        const chunk = mulawBytes.slice(i, i + chunkSize);
        const mediaMessage = {
          event: 'media',
          streamSid: this.streamSid,
          media: {
            payload: btoa(String.fromCharCode(...chunk))
          }
        };
        this.twilioWs?.send(JSON.stringify(mediaMessage));
      }

      const latency = Date.now() - startTime;
      console.log(`[CF] ElevenLabs audio sent: ${mulawBytes.length} bytes in ${latency}ms`);

      await this.logActivityToSupabase('connected', 'cf_elevenlabs_tts', {
        text_length: text.length,
        audio_bytes: mulawBytes.length,
        latency_ms: latency,
        voice_id: this.elevenlabsVoiceId
      });

    } catch (error) {
      console.error('[CF] ElevenLabs TTS failed:', error);
      await this.logErrorToSupabase('elevenlabs_tts_exception', String(error), { text_length: text.length });
      await this.fallbackToOpenAIWithNotification(text, 'Voice service connection failed');
    }
  }

  private async fallbackToOpenAIWithNotification(originalText: string, reason: string) {
    console.log(`[CF] Falling back to OpenAI TTS: ${reason}`);
    
    // Mark that we're in fallback mode so audio.delta events are processed
    this.elevenlabsFallbackActive = true;
    
    // Switch to OpenAI audio mode
    this.openaiWs?.send(JSON.stringify({
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        voice: this.openaiVoice
      }
    }));

    // First, notify the user about the voice change (explicit error notification per user preference)
    const notificationText = "I'm having trouble with my premium voice right now, switching to a backup voice.";
    
    this.openaiWs?.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'assistant',
        content: [{
          type: 'input_text',
          text: notificationText
        }]
      }
    }));

    // Request the notification to be spoken
    this.openaiWs?.send(JSON.stringify({ type: 'response.create' }));

    // Log the fallback event
    await this.logActivityToSupabase('connected', 'cf_elevenlabs_fallback', {
      reason,
      original_text_length: originalText.length,
      notification_sent: true
    });

    // After a short delay, send the original text
    setTimeout(() => {
      this.openaiWs?.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'assistant',
          content: [{
            type: 'input_text',
            text: originalText
          }]
        }
      }));
      this.openaiWs?.send(JSON.stringify({ type: 'response.create' }));
    }, 500);
  }

  // ==================== Audio Input Handling ====================

  private async handleMedia(message: TwilioMessage) {
    if (!message.media?.payload || !this.openaiWs) return;

    try {
      // Decode μ-law from Twilio
      const mulawBytes = Uint8Array.from(atob(message.media.payload), c => c.charCodeAt(0));
      
      // Echo suppression: check amplitude
      const pcm8k = decodeMulaw(mulawBytes);
      const rms = calculateRMSAmplitude(pcm8k);

      // Skip if echo (low amplitude during playback)
      if (this.isPlaying && rms < this.ECHO_THRESHOLD) {
        return;
      }

      // Barge-in detection: high amplitude during playback
      if (this.isPlaying && rms > this.BARGE_IN_THRESHOLD) {
        this.handleBargeIn();
      }

      // Upsample to 24kHz for OpenAI
      const pcm24k = upsample8to24(pcm8k);
      
      // Send to OpenAI
      const audioEvent = {
        type: 'input_audio_buffer.append',
        audio: int16ToBase64(pcm24k)
      };

      this.openaiWs.send(JSON.stringify(audioEvent));
    } catch (error) {
      console.error('[CF] Error processing Twilio audio:', error);
    }
  }

  private handleBargeIn() {
    console.log('[CF] Barge-in detected');
    this.isPlaying = false;
    this.textBuffer = ''; // Clear pending text

    // Clear Twilio audio buffer
    if (this.twilioWs && this.streamSid) {
      this.twilioWs.send(JSON.stringify({
        event: 'clear',
        streamSid: this.streamSid
      }));
    }

    // Cancel OpenAI response
    this.openaiWs?.send(JSON.stringify({ type: 'response.cancel' }));
  }

  // ==================== Tool Handling ====================

  private async handleFunctionCall(data: OpenAIEvent) {
    const { name, arguments: args, call_id } = data;
    if (!name || !call_id) return;

    console.log(`[CF] Tool call: ${name}`, args);

    try {
      const parsedArgs = JSON.parse(args || '{}');

      // Handle hang_up locally
      if (name === 'hang_up') {
        await this.handleHangUp(call_id);
        return;
      }

      // Execute tool via Supabase
      const result = await this.executeTool(name, parsedArgs);

      // Send result back to OpenAI
      this.openaiWs?.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: call_id,
          output: JSON.stringify(result)
        }
      }));

      // Trigger response
      this.openaiWs?.send(JSON.stringify({ type: 'response.create' }));

    } catch (error) {
      console.error(`[CF] Tool execution error:`, error);
      await this.logErrorToSupabase('tool_execution_error', String(error), { tool_name: name });
      
      this.openaiWs?.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: call_id,
          output: JSON.stringify({ error: 'Tool execution failed' })
        }
      }));

      this.openaiWs?.send(JSON.stringify({ type: 'response.create' }));
    }
  }

  private async executeTool(name: string, args: Record<string, any>): Promise<any> {
    const response = await fetch(
      `${this.env.SUPABASE_URL}/functions/v1/execute-tool`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          toolName: name,
          args: args,
          userId: this.userId,
          context: {
            interface: 'phone',
            timezone: this.timezone,
            threadId: this.threadId
          }
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Tool execution failed: ${response.status}`);
    }

    return response.json();
  }

  private async handleHangUp(callId: string) {
    console.log('[CF] Hanging up call');

    // Send goodbye to OpenAI
    this.openaiWs?.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify({ status: 'call_ended' })
      }
    }));

    // Give time for final audio
    await new Promise(resolve => setTimeout(resolve, 2000));

    await this.logActivityToSupabase('completed', 'cf_hang_up', { initiated_by: 'user' });

    // Close connections
    this.cleanup();
  }

  private cleanup() {
    console.log('[CF] Cleaning up call session');
    
    if (this.openaiWs) {
      this.openaiWs.close();
      this.openaiWs = null;
    }

    if (this.twilioWs) {
      this.twilioWs.close();
      this.twilioWs = null;
    }

    this.streamSid = null;
    this.callSid = null;
    this.textBuffer = '';
    this.cachedAudioBase64 = null;
    this.preConnectedInstructions = null;
    this.greetingText = null;
    this.ragContext = null;
    this.threadId = null;
    this.activityLogId = null;
    this.elevenlabsFallbackActive = false;
  }
}
