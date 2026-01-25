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

// Sentence detection for ElevenLabs streaming
const SENTENCE_ENDERS = /[.!?]+[\s"')\]]*$/;

export class TwilioCallSession {
  private state: DurableObjectState;
  private env: Env;
  private twilioWs: WebSocket | null = null;
  private openaiWs: WebSocket | null = null;
  private streamSid: string | null = null;
  private callSid: string | null = null;
  private userId: string | null = null;
  private timezone: string = 'America/New_York';
  private isPlaying: boolean = false;
  private toolDefinitions: any[] = [];

  // Voice preferences
  private ttsProvider: 'openai' | 'elevenlabs' = 'openai';
  private openaiVoice: string = 'alloy';
  private elevenlabsVoiceId: string = 'JBFqnCBsd6RMkjVDRZzb'; // George

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
      this.cleanup();
    });

    return new Response(null, { status: 101, webSocket: client });
  }

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
          this.cleanup();
          break;
      }
    } catch (error) {
      console.error('[CF] Error handling Twilio message:', error);
    }
  }

  private async handleStart(message: TwilioMessage) {
    console.log('[CF] Call started');
    
    this.streamSid = message.start?.streamSid || null;
    this.callSid = message.start?.callSid || null;
    
    const params = message.start?.customParameters || {};
    this.userId = params.userId || null;
    this.timezone = params.timezone || 'America/New_York';

    console.log(`[CF] Stream: ${this.streamSid}, User: ${this.userId}, TZ: ${this.timezone}`);

    // Load user voice preferences and tool definitions in parallel
    await Promise.all([
      this.loadUserVoicePrefs(),
      this.fetchToolDefinitions()
    ]);

    console.log(`[CF] TTS Provider: ${this.ttsProvider}, Voice: ${this.ttsProvider === 'elevenlabs' ? this.elevenlabsVoiceId : this.openaiVoice}`);

    // Connect to OpenAI
    await this.connectToOpenAI();
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
    try {
      const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';
      
      this.openaiWs = new WebSocket(url, [
        'realtime',
        `openai-insecure-api-key.${this.env.OPENAI_API_KEY}`,
        'openai-beta.realtime-v1'
      ]);

      this.openaiWs.addEventListener('open', () => {
        console.log('[CF] Connected to OpenAI');
      });

      this.openaiWs.addEventListener('message', (event) => {
        this.handleOpenAIMessage(event);
      });

      this.openaiWs.addEventListener('close', () => {
        console.log('[CF] OpenAI connection closed');
        this.cleanup();
      });

      this.openaiWs.addEventListener('error', (e) => {
        console.error('[CF] OpenAI WebSocket error:', e);
      });

    } catch (error) {
      console.error('[CF] Failed to connect to OpenAI:', error);
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
          // Only handle if using OpenAI TTS
          if (this.ttsProvider === 'openai') {
            this.handleAudioDelta(data);
          }
          break;

        case 'response.audio.done':
          if (this.ttsProvider === 'openai') {
            this.isPlaying = false;
          }
          break;

        case 'response.text.delta':
          // Only handle if using ElevenLabs TTS
          if (this.ttsProvider === 'elevenlabs') {
            await this.handleTextDelta(data);
          }
          break;

        case 'response.text.done':
          // Flush remaining text buffer for ElevenLabs
          if (this.ttsProvider === 'elevenlabs' && this.textBuffer.trim()) {
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
          break;
      }
    } catch (error) {
      console.error('[CF] Error handling OpenAI message:', error);
    }
  }

  private async configureSession() {
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

    // Send initial greeting
    this.sendGreeting();
  }

  private buildSystemPrompt(): string {
    const now = new Date().toLocaleString('en-US', { timeZone: this.timezone });
    
    return `You are Iris, a voice assistant helping users manage their tasks and schedule.

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
  }

  private sendGreeting() {
    const greeting = {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'assistant',
        content: [{
          type: 'input_text',
          text: 'Hi! This is Iris. How can I help you today?'
        }]
      }
    };

    this.openaiWs?.send(JSON.stringify(greeting));
    this.openaiWs?.send(JSON.stringify({ type: 'response.create' }));
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
            outputFormat: 'ulaw_8000' // Twilio format
          })
        }
      );

      if (!response.ok) {
        console.error(`[CF] ElevenLabs error: ${response.status}`);
        // Fallback to OpenAI TTS
        await this.fallbackToOpenAI(text);
        return;
      }

      // Get μ-law audio and send to Twilio
      const audioBuffer = await response.arrayBuffer();
      const mulawBytes = new Uint8Array(audioBuffer);

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

      console.log(`[CF] ElevenLabs audio sent: ${mulawBytes.length} bytes`);

    } catch (error) {
      console.error('[CF] ElevenLabs TTS failed:', error);
      await this.fallbackToOpenAI(text);
    }
  }

  private async fallbackToOpenAI(text: string) {
    console.log('[CF] Falling back to OpenAI TTS');
    
    // Temporarily switch to OpenAI mode and request audio response
    this.openaiWs?.send(JSON.stringify({
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        voice: this.openaiVoice
      }
    }));

    // Inject the text as a system message and request response
    this.openaiWs?.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'system',
        content: [{
          type: 'input_text',
          text: `Please say this exact text to the user: "${text}"`
        }]
      }
    }));

    this.openaiWs?.send(JSON.stringify({ type: 'response.create' }));
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
            timezone: this.timezone
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
  }
}
