import {
  decodeMulaw,
  encodeMulaw,
  upsample8to24,
  downsample24to8,
  int16ToBase64,
  base64ToInt16,
  calculateRMSAmplitude
} from './audio';
import { VOICE_CONFIG, FILLER_CONFIG, SENTENCE_ENDERS } from './config';

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
  transcript?: string;
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

// NOTE: VOICE_CONFIG, FILLER_CONFIG, SENTENCE_ENDERS imported from ./config.ts

// Worker version for deployment verification
const WORKER_VERSION = '2026-02-10-cf-v8';

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

  // Phase 2: Enhanced echo suppression (parity with Supabase bridge)
  private isSendingTtsAudio: boolean = false;
  private ttsAudioEndTime: number = 0;
  private readonly TTS_ECHO_GRACE_PERIOD_MS = 500;

  // Message index for transcript persistence
  private messageIndex: number = 0;

  // Phase 2: First-event tracking for audio pipeline visibility
  private firstMediaLogged: boolean = false;
  private firstTextDeltaLogged: boolean = false;
  private firstAudioDeltaLogged: boolean = false;
  private callStartTime: number = Date.now();

  // Phase 3: Echo suppression statistics
  private echoFilteredCount: number = 0;

  // Phase 5: Smart filler manager state
  private fillerTimers: ReturnType<typeof setTimeout>[] = [];
  private fillerIndex: number = 0;
  private lastFillerPhrase: string = '';

  // Phase 6: Hello-wait logic for outbound calls (from centralized config)
  private waitingForUserHello: boolean = false;
  private helloFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly HELLO_FALLBACK_MS = VOICE_CONFIG.OUTBOUND_HELLO_WAIT_MS;
  private pendingGreetingTriggered: boolean = false;

  // Phase 8: VAD barge-in guards (from centralized config)
  private lastSpeechStartTime: number = 0;
  private readonly SPEECH_DEBOUNCE_MS = VOICE_CONFIG.SPEECH_DEBOUNCE_MS;
  private isAiSpeaking: boolean = false;

  // v7: User profile for personalization (parity with Supabase)
  private userProfile: { first_name?: string; full_name?: string; preferred_greeting?: string } = {};

  // v7b: State tracking for proper truncation (parity with Supabase)
  private currentResponseItemId: string | null = null;
  private audioSamplesPlayed: number = 0;

  // Audio pipeline telemetry
  private twilioMediaFramesIn: number = 0;
  private openaiAppendCount: number = 0;
  private twilioMediaFramesOut: number = 0;

  // Phase 7: Agenda Manager state
  private agendaItems: Array<{ index: number; text: string; status: 'pending' | 'in_progress' | 'paused' | 'completed' }> = [];
  private currentAgendaIndex: number = 0;
  private agendaPaused: boolean = false;
  private pausedForQuery: string | null = null;

  // v8: Barge-in + agenda recovery + greeting guard (parity with Supabase bridge)
  private bargeInActive: boolean = false;
  private bargeInRecoveryPending: boolean = false;
  private greetingContextInjected: boolean = false;
  private lastUserTranscript: string = '';

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
          stream_sid: this.streamSid,
          sequence: Date.now() // For ordering multiple entries
        },
        started_at: new Date().toISOString(),
        ended_at: status === 'completed' || status === 'error' ? new Date().toISOString() : undefined
      };

      // Always INSERT - each stage gets its own record for full debugging visibility
      await fetch(
        `${this.env.SUPABASE_URL}/rest/v1/activity_log`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.env.SUPABASE_SERVICE_KEY}`,
            'apikey': this.env.SUPABASE_SERVICE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify(activity)
        }
      );

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

  // ==================== Phase 3: Transcript Persistence ====================

  private async saveConversationMessage(role: 'user' | 'assistant', content: string) {
    if (!this.callSid || !content.trim()) return;

    try {
      this.messageIndex++;
      
      const response = await fetch(`${this.env.SUPABASE_URL}/rest/v1/conversation_messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.env.SUPABASE_SERVICE_KEY}`,
          'apikey': this.env.SUPABASE_SERVICE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          user_id: this.userId || '00000000-0000-0000-0000-000000000001',
          role,
          content,
          source: 'cloudflare_phone',
          metadata: {
            call_sid: this.callSid,
            message_index: this.messageIndex,
            tts_provider: this.ttsProvider,
            worker_version: WORKER_VERSION
          }
        })
      });
      
      console.log(`[CF] Saved ${role} message: "${content.substring(0, 50)}..."`);
      
      // Phase 4: Log message persistence for visibility
      if (response.ok) {
        await this.logActivityToSupabase('connected', 'cf_message_persisted', {
          role,
          message_index: this.messageIndex,
          content_length: content.length
        });
      }
    } catch (error) {
      console.error('[CF] Failed to save conversation message:', error);
      await this.logErrorToSupabase('message_persistence_error', String(error), {
        role,
        message_index: this.messageIndex
      });
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
          await this.cleanup();
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
      this.loadUserProfile().then(p => this.userProfile = p),
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

  // ==================== v7: Core Functions for Personalization (parity with Supabase) ====================

  // Copy from Supabase lines 122-143
  private getTimeBasedGreeting(): string {
    try {
      const now = new Date();
      const timeStr = now.toLocaleString('en-US', { 
        timeZone: this.timezone, 
        hour: 'numeric', 
        hour12: false 
      });
      const hour = parseInt(timeStr, 10);
      
      if (hour < 12) return "Good morning";
      if (hour < 17) return "Good afternoon";
      return "Good evening";
    } catch {
      const hour = new Date().getUTCHours();
      if (hour < 12) return "Good morning";
      if (hour < 17) return "Good afternoon";
      return "Good evening";
    }
  }

  // Copy from Supabase lines 192-205
  private async loadUserProfile(): Promise<{ first_name?: string; full_name?: string; preferred_greeting?: string }> {
    if (!this.userId) return {};
    
    try {
      const response = await fetch(
        `${this.env.SUPABASE_URL}/rest/v1/profiles?user_id=eq.${this.userId}&select=first_name,full_name,preferred_greeting`,
        {
          headers: {
            'Authorization': `Bearer ${this.env.SUPABASE_SERVICE_KEY}`,
            'apikey': this.env.SUPABASE_SERVICE_KEY
          }
        }
      );
      
      if (response.ok) {
        const data = await response.json();
        return data?.[0] || {};
      }
    } catch (error) {
      console.warn('[CF] Failed to load user profile:', error);
    }
    return {};
  }

  // Copy from Supabase lines 1063-1077
  private generateGreetingForCallType(context: string, timeGreeting: string, userName: string): string {
    if (context.includes('Morning Stand-up')) {
      return `${timeGreeting}, ${userName}. This is your morning check-in.`;
    } else if (context.includes('Midday Check-in')) {
      return `${timeGreeting}, ${userName}. Just checking in on how your day is going.`;
    } else if (context.includes('End of Day Wrap-up')) {
      return `${timeGreeting}, ${userName}. Let's wrap up the day.`;
    } else if (context.includes('Task reminder')) {
      return `${timeGreeting}, ${userName}. Quick reminder about an upcoming task.`;
    }
    return `${timeGreeting}, ${userName}. This is Iris.`;
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
        // Fixed: endpoint returns { tools, count }, not { definitions }
        this.toolDefinitions = (data.tools || []).map((def: any) => ({
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
            // Phase 2: Track first audio delta for pipeline visibility
            if (!this.firstAudioDeltaLogged) {
              this.firstAudioDeltaLogged = true;
              console.log('[CF] First audio delta received from OpenAI');
              this.logActivityToSupabase('connected', 'cf_first_audio_delta', {
                timestamp: Date.now(),
                call_duration_ms: Date.now() - this.callStartTime
              });
            }
            // v7b: Track audio samples for truncation calculation (parity with Supabase)
            if (data.delta) {
              try {
                const pcm24k = base64ToInt16(data.delta);
                this.audioSamplesPlayed += pcm24k.length;
              } catch (e) {
                // Ignore decode errors for sample counting
              }
            }
            this.handleAudioDelta(data);
          }
          break;

        // v7b: Track response item ID for proper truncation (parity with Supabase)
        case 'response.output_item.added':
          if (data.item?.type === 'message') {
            this.currentResponseItemId = data.item.id;
            this.audioSamplesPlayed = 0;
            console.log('[CF] Tracking response item:', this.currentResponseItemId);
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
            // Phase 2: Track first text delta for pipeline visibility
            if (!this.firstTextDeltaLogged) {
              this.firstTextDeltaLogged = true;
              console.log('[CF] First text delta received from OpenAI');
              this.logActivityToSupabase('connected', 'cf_text_delta_first', {
                timestamp: Date.now(),
                preview: (data.delta || '').substring(0, 50)
              });
            }
            // v8: NO await - fire-and-forget (parity with Supabase line 510)
            // Awaiting blocks the WebSocket loop, preventing barge-in signals from being processed
            console.log('[CF-TTS] handleTextDelta fire-and-forget, bargeInActive:', this.bargeInActive);
            this.handleTextDelta(data);
          }
          break;

        case 'response.text.done':
          // Flush remaining text buffer for ElevenLabs and save transcript
          if (this.ttsProvider === 'elevenlabs' && !this.elevenlabsFallbackActive) {
            if (this.textBuffer.trim()) {
              await this.sendToElevenLabs(this.textBuffer);
            }
            // Save full AI response (text.done gives us complete text)
            if (data.text) {
              await this.saveConversationMessage('assistant', data.text);
            }
            this.textBuffer = '';
          }
          this.audioSentDuringResponse = false;
          // Phase 8: Clear isAiSpeaking after text generation done (ElevenLabs mode)
          this.isAiSpeaking = false;
          break;

        case 'response.done':
          this.isPlaying = false;
          // Phase 8: Clear isAiSpeaking flag
          this.isAiSpeaking = false;
          // v7b: Reset truncation tracking state (parity with Supabase)
          this.currentResponseItemId = null;
          this.audioSamplesPlayed = 0;

          // v8: Agenda tangent recovery (parity with Supabase lines 480-492)
          if (this.agendaPaused && this.bargeInRecoveryPending) {
            const hint = this.getAgendaResumeHint();
            console.log(`[CF-AGENDA] response.done: agendaPaused=${this.agendaPaused}, bargeInRecoveryPending=${this.bargeInRecoveryPending}, hint=${hint}`);
            if (hint) {
              console.log(`[CF-AGENDA] RESUME: Injecting hint: ${hint}`);
              this.openaiWs?.send(JSON.stringify({
                type: 'conversation.item.create',
                item: {
                  type: 'message',
                  role: 'system',
                  content: [{ type: 'input_text',
                    text: `[RESUME] ${hint}. Continue with this agenda item naturally. Cover ALL remaining agenda items.` }]
                }
              }));
              this.openaiWs?.send(JSON.stringify({ type: 'response.create' }));
            }
            this.resumeAgenda();
            this.bargeInRecoveryPending = false;
          }
          break;

        // Phase 1B + Phase 8: Speech started with VAD barge-in guards (parity with Supabase bridge)
        case 'input_audio_buffer.speech_started':
          {
            // 1. Debounce rapid speech events
            const now = Date.now();
            if (now - this.lastSpeechStartTime < this.SPEECH_DEBOUNCE_MS) {
              console.log('[CF] Debounced rapid speech event');
              break;
            }
            this.lastSpeechStartTime = now;
            
            console.log('[CF] User started speaking');
            await this.logActivityToSupabase('connected', 'cf_user_speech_started', {});
            
            // 2. Hello-wait: Trigger greeting, don't barge-in
            if (this.waitingForUserHello && !this.pendingGreetingTriggered) {
              console.log('[CF] User speech detected - triggering pending greeting');
              await this.triggerPendingGreeting('vad');
              break; // Don't treat as barge-in
            }
            
            // 3. ElevenLabs mode: Always clear buffer and break (match Supabase lines 2508-2520)
            // v7: Removed isAiSpeaking guard - Supabase doesn't have it
            if (this.ttsProvider === 'elevenlabs' && !this.elevenlabsFallbackActive) {
              console.log('[CF] BARGE-IN: ElevenLabs mode - clearing Twilio buffer only');
              if (this.streamSid && this.twilioWs?.readyState === WebSocket.OPEN) {
                this.twilioWs.send(JSON.stringify({
                  event: 'clear',
                  streamSid: this.streamSid
                }));
              }
              this.textBuffer = '';
              this.isAiSpeaking = false;
              break; // NO response.cancel for ElevenLabs - preserves OpenAI VAD state
            }
            
            // 4. OpenAI TTS mode: Cancel only if AI is speaking
            if (this.isAiSpeaking) {
              console.log('[CF] BARGE-IN: OpenAI mode - cancelling response');
              this.handleBargeIn();
            }
          }
          break;

        case 'input_audio_buffer.speech_stopped':
          console.log('[CF] User stopped speaking - committing buffer');
          // v7f: Explicitly commit the buffer to trigger transcription/response
          this.openaiWs?.send(JSON.stringify({
            type: 'input_audio_buffer.commit'
          }));
          await this.logActivityToSupabase('connected', 'cf_user_speech_stopped', {
            buffer_committed: true
          });
          break;

        // v7f: Track buffer commit acknowledgment for diagnostic visibility
        case 'input_audio_buffer.committed':
          console.log('[CF] Audio buffer committed - transcription should follow');
          await this.logActivityToSupabase('connected', 'cf_buffer_committed', {});
          break;

        case 'conversation.item.input_audio_transcription.completed':
          const transcript = data.transcript || '';
          console.log(`[CF] User said: "${transcript}"`);
          await this.logActivityToSupabase('connected', 'cf_transcription', {
            transcript: transcript.substring(0, 200)
          });
          // Phase 3: Save user transcript
          await this.saveConversationMessage('user', transcript);
          break;

        case 'response.created':
          console.log('[CF] AI response started');
          // Phase 8: Set isAiSpeaking flag for barge-in guards
          this.isAiSpeaking = true;
          // Phase 5: Clear any pending filler timers when response starts
          this.clearFillerTimers();
          await this.logActivityToSupabase('connected', 'cf_response_started', {});
          break;

        case 'response.audio_transcript.done':
          // Save AI transcript for OpenAI TTS mode
          if (this.ttsProvider === 'openai' || this.elevenlabsFallbackActive) {
            const aiTranscript = data.transcript || '';
            console.log(`[CF] AI said (OpenAI TTS): "${aiTranscript.substring(0, 50)}..."`);
            await this.saveConversationMessage('assistant', aiTranscript);
          }
          break;

        case 'response.function_call_arguments.done':
          // Phase 5: Start filler timers for tool execution
          this.startFillerTimers();
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
        // Phase 1A: Use semantic_vad with create_response: true (parity with Supabase bridge)
        turn_detection: {
          type: 'semantic_vad',
          eagerness: 'low',
          create_response: true,
          interrupt_response: true,
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
    console.log(`[CF] Session configured: ${this.ttsProvider} mode, semantic_vad, create_response:true, ${this.toolDefinitions.length} tools`);

    await this.logActivityToSupabase('connected', 'cf_session_configured', {
      modalities,
      vad_type: 'semantic_vad',
      create_response: true,
      tools_count: this.toolDefinitions.length
    });

    // Phase 7: Initialize agenda manager if we have pre-connected instructions with agenda
    if (this.preConnectedInstructions) {
      await this.initializeAgenda(this.preConnectedInstructions);
    }

    // Phase 6: For outbound calls, wait for user pickup confirmation before greeting
    if (this.direction === 'outbound' && !this.cachedAudioBase64) {
      this.setupHelloWait();
    } else {
      // Send initial greeting immediately for inbound or cached audio
      await this.sendGreeting();
    }
  }

  private buildSystemPrompt(): string {
    // If we have pre-connected instructions, use them (includes RAG context, agenda, etc.)
    if (this.preConnectedInstructions) {
      console.log('[CF] Using pre-connected instructions');
      // Append agenda context and conversational responsiveness to pre-connected instructions
      return this.preConnectedInstructions + this.getAgendaContextForPrompt() + '\n\n' + this.getConversationalResponsivenessPrompt();
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

    // Phase 4: Add conversational responsiveness instructions
    prompt += '\n\n' + this.getConversationalResponsivenessPrompt();

    return prompt;
  }

  // Phase 4: Conversational responsiveness instructions (parity with Supabase bridge)
  private getConversationalResponsivenessPrompt(): string {
    return `## CONVERSATIONAL RESPONSIVENESS (CRITICAL)
You are having a real-time voice conversation. Silence feels awkward and breaks trust.

### 1. BEFORE ANY TOOL CALL - Speak a brief acknowledgment:
- Task queries: "Let me check...", "One moment...", "Checking that now..."
- Web searches: "Let me look that up...", "Searching for that..."
- Creating/updating: "Got it, on it...", "Sure, creating that now..."
- Calendar: "Let me check your calendar...", "Looking at your schedule..."
- Email/Slack: "I'll send that now...", "Sending that message..."

### 2. TIME-AWARE FEEDBACK - If processing feels slow:
- After ~2 seconds of silence: "Still looking..."
- After ~3 more seconds: "Almost there...", "Just a moment longer..."
- After a tool returns: Summarize what you found or did

### 3. NATURAL VARIATION:
- Never repeat the same filler phrase twice in a row
- Keep acknowledgments SHORT (2-4 words)
- Match your energy to the user's energy
- If they sound rushed, be more concise

### 4. CRITICAL RULES:
- NEVER stay silent while processing a request
- NEVER start a tool call without first speaking
- If you're about to use a tool, SAY something first
- Always acknowledge what the user asked before executing

### 5. EXAMPLES:
User: "What tasks do I have today?"
You: "Let me check..." [then call get_tasks tool]

User: "Send an email to John about the meeting"
You: "Got it, sending that now..." [then call send_email tool]

User: "Search for the latest news on AI"
You: "Looking that up..." [then call web_search tool]`;
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
        
        // Set echo suppression window for cached audio
        this.isSendingTtsAudio = true;
        const estimatedDurationMs = Math.ceil(audioBytes.length / 160) * 20; // 160 bytes per 20ms at 8kHz μ-law
        this.ttsAudioEndTime = Date.now() + estimatedDurationMs + this.TTS_ECHO_GRACE_PERIOD_MS;
        
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
        
        // v7e: Clear ALL echo suppression flags after audio duration (critical fix)
        setTimeout(() => {
          if (this.isSendingTtsAudio && Date.now() >= this.ttsAudioEndTime - 50) {
            this.isSendingTtsAudio = false;
            this.isAiSpeaking = false;
            this.isPlaying = false;  // CRITICAL: Clear isPlaying to allow user audio through
            console.log('[CF] Echo suppression cleared after cached greeting playback');
          }
        }, estimatedDurationMs + this.TTS_ECHO_GRACE_PERIOD_MS);
        
        console.log(`[CF] Cached greeting sent: ${audioBytes.length} bytes`);
        await this.logAttempt('greeting', 'success', {
          source: 'cached_audio',
          bytes: audioBytes.length,
          latency_ms: Date.now() - greetingStartTime
        });
        
        // FIX: Inject context into OpenAI after playing cached audio (was missing!)
        const greeting = this.greetingText || 'Hello';
        
        // Inject assistant message with what was just spoken
        this.openaiWs?.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: greeting }]
          }
        }));
        
        // Inject system context for OpenAI to understand the state
        const now = new Date().toLocaleString('en-US', { timeZone: this.timezone });
        const contextMsg = `[System: You just spoke the greeting: "${greeting}"
The user is now listening and may respond. Current time: ${now}.
Wait for the user's response, then continue the conversation naturally.
${this.ragContext ? `Context: ${this.ragContext}` : ''}]`;
        
        this.openaiWs?.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'system',
            content: [{ type: 'input_text', text: contextMsg }]
          }
        }));
        
        console.log('[CF] Injected post-greeting context for cached audio path');
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

    // v7: Generate dynamic personalized greeting (parity with Supabase)
    const timeGreeting = this.getTimeBasedGreeting();
    // preferred_greeting takes priority over first_name
    const userName = this.userProfile?.preferred_greeting || this.userProfile?.first_name || 'sir';
    const callContext = this.ragContext || '';
    const greeting = this.greetingText || this.generateGreetingForCallType(callContext, timeGreeting, userName);
    
    try {
      if (this.ttsProvider === 'elevenlabs') {
        // ElevenLabs mode: Synthesize and stream greeting directly
        console.log('[CF] Synthesizing greeting via ElevenLabs');
        await this.sendToElevenLabs(greeting);
        
        // v7f: Inject assistant message into OpenAI's conversation history
        this.openaiWs?.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: greeting }]
          }
        }));

        // v7f: Inject system context explaining the state (critical for OpenAI to respond)
        const now = new Date().toLocaleString('en-US', { timeZone: this.timezone });
        const contextMsg = `[System: You just spoke the greeting: "${greeting}"
The user is now listening and may respond. Current time: ${now}.
Wait for the user's response, then continue the conversation naturally.
${this.ragContext ? `Context: ${this.ragContext}` : ''}]`;

        this.openaiWs?.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'system',
            content: [{ type: 'input_text', text: contextMsg }]
          }
        }));

        console.log('[CF] Injected post-greeting system context for OpenAI');
        
        await this.logAttempt('greeting', 'success', {
          source: 'elevenlabs_direct',
          greeting_text: greeting.substring(0, 50),
          system_context_injected: true,
          latency_ms: Date.now() - greetingStartTime
        });
      } else {
        // OpenAI TTS mode: Use response.create to generate audio
        this.openaiWs?.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: greeting }]
          }
        }));
        
        this.openaiWs?.send(JSON.stringify({
          type: 'response.create',
          response: { modalities: ['text', 'audio'] }
        }));
        
        console.log('[CF] Greeting via OpenAI TTS');
        await this.logAttempt('greeting', 'success', {
          source: 'openai_tts',
          greeting_text: greeting.substring(0, 50),
          latency_ms: Date.now() - greetingStartTime
        });
      }
    } catch (error) {
      await this.logAttempt('greeting', 'failed', {
        source: this.ttsProvider === 'elevenlabs' ? 'elevenlabs_direct' : 'openai_tts',
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
    
    // Log attempt for debugging visibility
    await this.logAttempt('tts', 'attempted', {
      text_preview: text.substring(0, 50),
      text_length: text.length,
      voice_id: this.elevenlabsVoiceId
    });
    
    this.isPlaying = true;
    this.audioSentDuringResponse = true;

    try {
      const response = await fetch(
        `${this.env.SUPABASE_URL}/functions/v1/elevenlabs-tts`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.env.SUPABASE_SERVICE_KEY}`,
            'apikey': this.env.SUPABASE_SERVICE_KEY,
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
        await this.logAttempt('tts', 'failed', {
          error: `HTTP ${response.status}: ${errorText}`,
          text_length: text.length,
          latency_ms: Date.now() - startTime
        });
        // Fallback to OpenAI TTS with explicit notification
        await this.fallbackToOpenAIWithNotification(text, `ElevenLabs returned ${response.status}`);
        return;
      }

      // Parse JSON response (our edge function returns JSON with base64 audio)
      const jsonResponse = await response.json() as ElevenLabsTTSResponse;
      
      if (!jsonResponse.audio) {
        console.error('[CF] ElevenLabs response missing audio field');
        await this.logAttempt('tts', 'failed', {
          error: 'Missing audio field in response',
          response_keys: Object.keys(jsonResponse),
          latency_ms: Date.now() - startTime
        });
        await this.fallbackToOpenAIWithNotification(text, 'Invalid response from voice service');
        return;
      }

      // Decode base64 audio to μ-law bytes
      const mulawBytes = Uint8Array.from(atob(jsonResponse.audio), c => c.charCodeAt(0));

      // Phase 2: Set echo suppression window
      this.isSendingTtsAudio = true;
      const estimatedDurationMs = Math.ceil(mulawBytes.length / 160) * 20; // 160 bytes per 20ms at 8kHz μ-law
      this.ttsAudioEndTime = Date.now() + estimatedDurationMs + this.TTS_ECHO_GRACE_PERIOD_MS;

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
        this.twilioMediaFramesOut++;  // v7e: Track outbound frames for telemetry
      }

      // v7e: Clear ALL echo suppression flags after audio duration (critical fix)
      setTimeout(() => {
        if (this.isSendingTtsAudio && Date.now() >= this.ttsAudioEndTime - 50) {
          this.isSendingTtsAudio = false;
          this.isAiSpeaking = false;
          this.isPlaying = false;  // CRITICAL: Clear isPlaying to allow user audio through
          console.log('[CF] Echo suppression cleared after ElevenLabs playback');
        }
      }, estimatedDurationMs + this.TTS_ECHO_GRACE_PERIOD_MS);

      const latency = Date.now() - startTime;
      console.log(`[CF] ElevenLabs audio sent: ${mulawBytes.length} bytes in ${latency}ms`);

      await this.logAttempt('tts', 'success', {
        text_length: text.length,
        audio_bytes: mulawBytes.length,
        latency_ms: latency,
        voice_id: this.elevenlabsVoiceId
      });

    } catch (error) {
      console.error('[CF] ElevenLabs TTS failed:', error);
      await this.logAttempt('tts', 'failed', {
        error: String(error),
        text_length: text.length,
        latency_ms: Date.now() - startTime
      });
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
          type: 'text',
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
            type: 'text',
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

    // Phase 2: Track first media frame for debugging visibility
    this.twilioMediaFramesIn++;
    if (!this.firstMediaLogged) {
      this.firstMediaLogged = true;
      console.log('[CF] First media frame received from Twilio');
      await this.logActivityToSupabase('connected', 'cf_first_media_in', {
        timestamp: Date.now(),
        call_duration_ms: Date.now() - this.callStartTime
      });
    }

    try {
      // Decode μ-law from Twilio
      const mulawBytes = Uint8Array.from(atob(message.media.payload), c => c.charCodeAt(0));
      
      // Echo suppression: check amplitude
      const pcm8k = decodeMulaw(mulawBytes);
      const rms = calculateRMSAmplitude(pcm8k);

      // Phase 2: Enhanced echo suppression with time-based window
      const inEchoWindow = this.isSendingTtsAudio || Date.now() < this.ttsAudioEndTime;
      
      // Skip if echo (low amplitude during playback or in echo window)
      if ((this.isPlaying || inEchoWindow) && rms < this.ECHO_THRESHOLD) {
        // Phase 3: Track echo filtering stats (log every 50th for visibility)
        this.echoFilteredCount++;
        if (this.echoFilteredCount % 50 === 0) {
          console.log(`[CF] Echo filtered: ${this.echoFilteredCount} frames total`);
        }
        return;
      }

      // Barge-in detection: high amplitude during playback
      if (this.isPlaying && rms > this.BARGE_IN_THRESHOLD) {
        await this.logActivityToSupabase('connected', 'cf_barge_in_detected', {
          rms_amplitude: Math.round(rms),
          echo_filtered_before: this.echoFilteredCount
        });
        this.handleBargeIn();
      }

      // Phase 6: Hello-wait logic - detect user speech on outbound calls
      if (this.waitingForUserHello && rms > this.BARGE_IN_THRESHOLD && !this.pendingGreetingTriggered) {
        console.log('[CF] User speech detected - triggering pending greeting');
        await this.triggerPendingGreeting('user_speech');
      }

      // Upsample to 24kHz for OpenAI
      const pcm24k = upsample8to24(pcm8k);
      
      // Send to OpenAI
      const audioEvent = {
        type: 'input_audio_buffer.append',
        audio: int16ToBase64(pcm24k)
      };

      this.openaiWs.send(JSON.stringify(audioEvent));
      this.openaiAppendCount++;
    } catch (error) {
      console.error('[CF] Error processing Twilio audio:', error);
    }
  }

  private handleBargeIn() {
    console.log('[CF] Barge-in detected');
    this.isPlaying = false;
    this.isSendingTtsAudio = false; // Clear echo suppression
    this.textBuffer = ''; // Clear pending text

    // Clear Twilio audio buffer
    if (this.twilioWs && this.streamSid) {
      this.twilioWs.send(JSON.stringify({
        event: 'clear',
        streamSid: this.streamSid
      }));
    }

    // v7b: Use truncation instead of cancel (preserves VAD state - parity with Supabase)
    if (this.currentResponseItemId && this.openaiWs?.readyState === WebSocket.OPEN) {
      const audioEndMs = Math.floor(this.audioSamplesPlayed / 24); // 24kHz samples to ms
      console.log(`[CF] Truncating response item ${this.currentResponseItemId} at ${audioEndMs}ms`);
      
      this.openaiWs.send(JSON.stringify({
        type: 'conversation.item.truncate',
        item_id: this.currentResponseItemId,
        content_index: 0,
        audio_end_ms: audioEndMs
      }));
    } else {
      // Fallback to cancel if no item ID available
      console.log('[CF] No item ID for truncation, using cancel');
      this.openaiWs?.send(JSON.stringify({ type: 'response.cancel' }));
    }

    // Reset tracking state
    this.isAiSpeaking = false;
    this.currentResponseItemId = null;
    this.audioSamplesPlayed = 0;
  }

  // ==================== Tool Handling ====================

  private async handleFunctionCall(data: OpenAIEvent) {
    const { name, arguments: args, call_id } = data;
    if (!name || !call_id) return;

    console.log(`[CF] Tool call: ${name}`, args);
    
    await this.logActivityToSupabase('connected', 'cf_tool_call', {
      tool_name: name,
      args_preview: (args || '').substring(0, 100)
    });

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
      
      await this.logActivityToSupabase('connected', 'cf_tool_result', {
        tool_name: name,
        success: true
      });

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
        output: JSON.stringify({ status: 'call_ended', message: 'User requested hang up' })
      }
    }));

    // Trigger OpenAI to generate farewell response
    this.openaiWs?.send(JSON.stringify({
      type: 'response.create'
    }));

    // Give time for farewell audio to generate and play completely (from centralized config)
    // Typical farewell is 2-4 seconds of audio, plus TTS latency
    await new Promise(resolve => setTimeout(resolve, VOICE_CONFIG.FAREWELL_DELAY_MS));

    await this.logActivityToSupabase('completed', 'cf_hang_up', { initiated_by: 'user' });

    // Close connections
    this.cleanup();
  }

  private async cleanup() {
    console.log('[CF] Cleaning up call session');
    
    // Phase 5: Clear filler timers
    this.clearFillerTimers();
    
    // Phase 6: Clear hello-wait timer
    if (this.helloFallbackTimer) {
      clearTimeout(this.helloFallbackTimer);
      this.helloFallbackTimer = null;
    }
    
    // Log call summary with telemetry (Phase 2 + Phase 7 agenda metrics)
    const callDurationS = Math.floor((Date.now() - this.callStartTime) / 1000);
    const agendaProgress = this.getAgendaProgress();
    await this.logActivityToSupabase('completed', 'cf_call_summary', {
      duration_s: callDurationS,
      messages_persisted: this.messageIndex,
      tts_provider: this.ttsProvider,
      echo_filtered_count: this.echoFilteredCount,
      twilio_frames_in: this.twilioMediaFramesIn,
      openai_appends: this.openaiAppendCount,
      twilio_frames_out: this.twilioMediaFramesOut,
      first_media_logged: this.firstMediaLogged,
      greeting_triggered: this.pendingGreetingTriggered,
      // Phase 7: Agenda metrics
      agenda_items_total: this.agendaItems.length,
      agenda_items_completed: agendaProgress.completed,
      agenda_complete: this.isAgendaComplete()
    });
    
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
    this.isSendingTtsAudio = false;
    this.ttsAudioEndTime = 0;
    this.messageIndex = 0;
    this.firstMediaLogged = false;
    this.firstTextDeltaLogged = false;
    this.firstAudioDeltaLogged = false;
    this.echoFilteredCount = 0;
    this.twilioMediaFramesIn = 0;
    this.openaiAppendCount = 0;
    this.twilioMediaFramesOut = 0;
    this.waitingForUserHello = false;
    this.pendingGreetingTriggered = false;
    this.fillerIndex = 0;
    this.lastFillerPhrase = '';
    // Phase 7: Reset agenda state
    this.agendaItems = [];
    this.currentAgendaIndex = 0;
    this.agendaPaused = false;
    this.pausedForQuery = null;
  }

  // ==================== Phase 5: Smart Filler Manager ====================

  private startFillerTimers() {
    // Clear any existing timers first
    this.clearFillerTimers();
    
    console.log('[CF] Starting filler timers for tool execution');
    
    // Schedule fillers at increasing intervals (from centralized config)
    FILLER_CONFIG.INTERVALS_MS.forEach((interval, index) => {
      const timer = setTimeout(() => {
        this.speakFiller();
      }, interval);
      this.fillerTimers.push(timer);
    });
  }

  private clearFillerTimers() {
    this.fillerTimers.forEach(timer => clearTimeout(timer));
    this.fillerTimers = [];
  }

  private async speakFiller() {
    // Select a filler phrase that's different from the last one (from centralized config)
    let phrase: string;
    do {
      phrase = FILLER_CONFIG.PHRASES[this.fillerIndex % FILLER_CONFIG.PHRASES.length];
      this.fillerIndex++;
    } while (phrase === this.lastFillerPhrase && FILLER_CONFIG.PHRASES.length > 1);
    
    this.lastFillerPhrase = phrase;
    
    console.log(`[CF] Speaking filler: "${phrase}"`);
    await this.logActivityToSupabase('connected', 'cf_filler_spoken', {
      phrase,
      filler_index: this.fillerIndex
    });
    
    // Synthesize and play the filler
    if (this.ttsProvider === 'elevenlabs' && !this.elevenlabsFallbackActive) {
      await this.sendToElevenLabs(phrase);
    } else {
      // OpenAI TTS path
      this.openaiWs?.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: phrase }]
        }
      }));
      this.openaiWs?.send(JSON.stringify({
        type: 'response.create',
        response: { modalities: ['text', 'audio'] }
      }));
    }
  }

  // ==================== Phase 6: Hello-Wait Logic (Outbound Calls) ====================

  private setupHelloWait() {
    if (this.direction !== 'outbound') return;
    
    console.log('[CF] Setting up hello-wait for outbound call');
    this.waitingForUserHello = true;
    
    // Set fallback timer in case user doesn't speak
    this.helloFallbackTimer = setTimeout(() => {
      if (this.waitingForUserHello && !this.pendingGreetingTriggered) {
        console.log('[CF] Hello-wait fallback timer triggered');
        this.triggerPendingGreeting('fallback_timer');
      }
    }, this.HELLO_FALLBACK_MS);
  }

  private async triggerPendingGreeting(source: string) {
    if (this.pendingGreetingTriggered) return;
    
    this.pendingGreetingTriggered = true;
    this.waitingForUserHello = false;
    
    // Clear the fallback timer
    if (this.helloFallbackTimer) {
      clearTimeout(this.helloFallbackTimer);
      this.helloFallbackTimer = null;
    }
    
    console.log(`[CF] Triggering greeting from: ${source}`);
    await this.logActivityToSupabase('connected', 'cf_hello_trigger', {
      source,
      wait_duration_ms: Date.now() - this.callStartTime
    });
    
    // Now send the greeting
    await this.sendGreeting();
  }

  // ==================== Phase 7: Agenda Manager ====================

  private parseAgendaFromContext(context: string): Array<{ index: number; text: string; status: 'pending' | 'in_progress' | 'paused' | 'completed' }> {
    // Look for AGENDA: or numbered list patterns
    const agendaMatch = context.match(/AGENDA:\n([\s\S]*?)(\n\n|$)/i);
    const numberedListMatch = context.match(/(?:Today['']s agenda|Call agenda|Discussion points):\n([\s\S]*?)(\n\n|$)/i);
    
    const matchedContent = agendaMatch?.[1] || numberedListMatch?.[1];
    if (!matchedContent) return [];
    
    const lines = matchedContent.split('\n');
    return lines
      .filter(line => /^\d+[\.\)]/.test(line.trim()))
      .map((line, index) => ({
        index,
        text: line.replace(/^\d+[\.\)]\s*/, '').trim(),
        status: 'pending' as const
      }));
  }

  private async initializeAgenda(context: string) {
    this.agendaItems = this.parseAgendaFromContext(context);
    if (this.agendaItems.length > 0) {
      console.log(`[CF] Parsed ${this.agendaItems.length} agenda items`);
      await this.logActivityToSupabase('connected', 'cf_agenda_initialized', {
        item_count: this.agendaItems.length,
        items: this.agendaItems.map(i => i.text.substring(0, 50))
      });
      // Start first item
      await this.startAgendaItem(0);
    }
  }

  private async startAgendaItem(index: number) {
    if (this.agendaItems[index]) {
      this.agendaItems[index].status = 'in_progress';
      this.currentAgendaIndex = index;
      console.log(`[CF] Started agenda item ${index}: "${this.agendaItems[index].text.substring(0, 40)}..."`);
      await this.logActivityToSupabase('connected', 'cf_agenda_item_started', {
        index,
        text: this.agendaItems[index].text.substring(0, 100)
      });
    }
  }

  private async completeCurrentAgendaItem() {
    if (this.agendaItems[this.currentAgendaIndex]) {
      this.agendaItems[this.currentAgendaIndex].status = 'completed';
      console.log(`[CF] Completed agenda item ${this.currentAgendaIndex}`);
      await this.logActivityToSupabase('connected', 'cf_agenda_item_completed', {
        index: this.currentAgendaIndex,
        text: this.agendaItems[this.currentAgendaIndex].text.substring(0, 100)
      });
      
      // Find next pending item
      const nextIndex = this.agendaItems.findIndex(
        (item, idx) => idx > this.currentAgendaIndex && item.status === 'pending'
      );
      if (nextIndex !== -1) {
        await this.startAgendaItem(nextIndex);
      }
    }
  }

  private async pauseAgendaForTangent(userQuery: string) {
    if (this.agendaItems[this.currentAgendaIndex]?.status === 'in_progress') {
      this.agendaItems[this.currentAgendaIndex].status = 'paused';
      this.agendaPaused = true;
      this.pausedForQuery = userQuery;
      console.log(`[CF] Paused agenda for tangent: "${userQuery.substring(0, 40)}..."`);
      await this.logActivityToSupabase('connected', 'cf_agenda_paused', {
        paused_item_index: this.currentAgendaIndex,
        tangent_query: userQuery.substring(0, 100)
      });
    }
  }

  private async resumeAgenda() {
    if (this.agendaPaused && this.agendaItems[this.currentAgendaIndex]) {
      this.agendaItems[this.currentAgendaIndex].status = 'in_progress';
      this.agendaPaused = false;
      this.pausedForQuery = null;
      console.log(`[CF] Resumed agenda item ${this.currentAgendaIndex}`);
      await this.logActivityToSupabase('connected', 'cf_agenda_resumed', {
        resumed_item_index: this.currentAgendaIndex
      });
    }
  }

  private getAgendaResumeHint(): string | null {
    if (!this.agendaPaused) return null;
    const item = this.agendaItems[this.currentAgendaIndex];
    return item ? `Getting back to: ${item.text}` : null;
  }

  private getAgendaProgress(): { completed: number; total: number; remaining: string[] } {
    const completed = this.agendaItems.filter(i => i.status === 'completed').length;
    const remaining = this.agendaItems.filter(i => i.status !== 'completed').map(i => i.text);
    return { completed, total: this.agendaItems.length, remaining };
  }

  private isAgendaComplete(): boolean {
    return this.agendaItems.length > 0 && this.agendaItems.every(i => i.status === 'completed');
  }

  private getAgendaContextForPrompt(): string {
    if (this.agendaItems.length === 0) return '';
    
    const progress = this.getAgendaProgress();
    let context = `\n\n## Current Agenda Status
Progress: ${progress.completed}/${progress.total} items completed
Remaining items: ${progress.remaining.map((r, i) => `${i + 1}. ${r}`).join('\n')}

AGENDA GUIDELINES:
- Cover each agenda item naturally in conversation
- If user asks something unrelated, answer briefly then guide back
- After completing an item, naturally transition to the next
- When all items covered, ask if there's anything else before ending`;

    // Add resume hint if paused
    const resumeHint = this.getAgendaResumeHint();
    if (resumeHint) {
      context += `\n\n[SYSTEM: ${resumeHint}]`;
    }

    return context;
  }
}
