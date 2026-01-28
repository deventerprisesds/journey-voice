import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '@/integrations/supabase/client';

// Global instance tracking for debugging visibility
let globalInstanceCounter = 0;
const activeInstances = new Map<number, RealtimeVoiceAssistant>();

export const getActiveVoiceInstanceCount = () => activeInstances.size;
export const logActiveInstances = () => {
  console.log(`[VOICE_INSTANCES] Active count: ${activeInstances.size}`);
  activeInstances.forEach((instance, id) => {
    console.log(`  - Instance #${id}, sessionId: ${instance.getSessionId()}`);
  });
};

export class AudioRecorder {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  constructor(private onAudioData: (audioData: Float32Array) => void) {}

  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      
      this.audioContext = new AudioContext({
        sampleRate: 24000,
      });
      
      this.source = this.audioContext.createMediaStreamSource(this.stream);
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      
      this.processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        this.onAudioData(new Float32Array(inputData));
      };
      
      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);
    } catch (error) {
      console.error('Error accessing microphone:', error);
      throw error;
    }
  }

  stop() {
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}

// Audio encoding utility
export const encodeAudioForAPI = (float32Array: Float32Array): string => {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  
  const uint8Array = new Uint8Array(int16Array.buffer);
  let binary = '';
  const chunkSize = 0x8000;
  
  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  
  return btoa(binary);
};

// Audio queue for sequential playback

class AudioQueue {
  private queue: Uint8Array[] = [];
  private isPlaying = false;
  private audioContext: AudioContext;

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext;
  }

  async addToQueue(audioData: Uint8Array) {
    this.queue.push(audioData);
    if (!this.isPlaying) {
      await this.playNext();
    }
  }

  private async playNext() {
    if (this.queue.length === 0) {
      this.isPlaying = false;
      return;
    }

    this.isPlaying = true;
    const audioData = this.queue.shift()!;

    try {
      const wavData = this.createWavFromPCM(audioData);
      const audioBuffer = await this.audioContext.decodeAudioData(wavData.buffer as ArrayBuffer);
      
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);
      
      source.onended = () => this.playNext();
      source.start(0);
    } catch (error) {
      console.error('Error playing audio:', error);
      this.playNext(); // Continue with next segment even if current fails
    }
  }

  private createWavFromPCM(pcmData: Uint8Array): Uint8Array {
    // Convert bytes to 16-bit samples
    const int16Data = new Int16Array(pcmData.length / 2);
    for (let i = 0; i < pcmData.length; i += 2) {
      int16Data[i / 2] = (pcmData[i + 1] << 8) | pcmData[i];
    }
    
    // Create WAV header
    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);
    
    const writeString = (view: DataView, offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    // WAV header parameters
    const sampleRate = 24000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const byteRate = sampleRate * blockAlign;

    // Write WAV header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + int16Data.byteLength, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(view, 36, 'data');
    view.setUint32(40, int16Data.byteLength, true);

    // Combine header and data
    const wavArray = new Uint8Array(wavHeader.byteLength + int16Data.byteLength);
    wavArray.set(new Uint8Array(wavHeader), 0);
    wavArray.set(new Uint8Array(int16Data.buffer), wavHeader.byteLength);
    
    return wavArray;
  }
}

let audioQueueInstance: AudioQueue | null = null;

export const playAudioData = async (audioContext: AudioContext, audioData: Uint8Array) => {
  if (!audioQueueInstance) {
    audioQueueInstance = new AudioQueue(audioContext);
  }
  await audioQueueInstance.addToQueue(audioData);
};

export class RealtimeVoiceAssistant {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private audioEl: HTMLAudioElement;
  private recorder: AudioRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private isListening = false;
  private ttsProvider: 'openai' | 'elevenlabs' = 'openai';
  private elevenlabsVoiceId: string = '';
  
  // Session tracking for transcript persistence
  private sessionId: string | null = null;
  private threadId: string | null = null;
  private userId: string | null = null;
  
  // Activity tracking for unified timeline
  private connectionStartTime: number = 0;
  private messageCount: number = 0;
  
  // Instance tracking for debugging visibility
  private instanceId: number = 0;
  
  // Agenda tracking for cross-interface conversation continuity
  private agendaStatus: {
    items: any[];
    completed: number;
    total: number;
    currentItem: any | null;
    isPaused: boolean;
  } | null = null;
  
  // Track active ElevenLabs audio elements for cleanup on disconnect
  private activeElevenLabsAudio: HTMLAudioElement[] = [];

  constructor(
    private onMessage: (message: any) => void,
    private onConnectionChange: (connected: boolean) => void,
    private onListeningChange: (listening: boolean) => void,
    private onSpeakingChange: (speaking: boolean) => void
  ) {
    this.instanceId = ++globalInstanceCounter;
    activeInstances.set(this.instanceId, this);
    console.log(`[VOICE_INSTANCE] Created #${this.instanceId}, total active: ${activeInstances.size}`);
    
    this.audioEl = document.createElement("audio");
    this.audioEl.autoplay = true;
  }
  
  getSessionId(): string | null {
    return this.sessionId;
  }

  // Activity logging helper for unified timeline
  private async logActivity(
    status: 'started' | 'connected' | 'completed' | 'failed' | 'error',
    stage?: string,
    extra: Record<string, any> = {}
  ): Promise<void> {
    if (!this.userId || !this.sessionId) return;
    
    try {
      const { error } = await supabase.from('activity_log').upsert({
        user_id: this.userId,
        activity_type: 'voice_webrtc',
        session_id: this.sessionId,
        status,
        stage,
        error_message: extra.error_message || null,
        error_code: extra.error_code || null,
        duration_seconds: extra.duration_seconds,
        message_count: extra.message_count,
        metadata: {
          tts_provider: this.ttsProvider,
          connection_time_ms: this.connectionStartTime ? Date.now() - this.connectionStartTime : 0,
          instance_id: this.instanceId,
          active_instances: activeInstances.size,
          ...extra.metadata
        },
        started_at: new Date(this.connectionStartTime || Date.now()).toISOString(),
        ended_at: extra.ended_at
      }, {
        onConflict: 'session_id'
      });
      
      if (error) {
        console.error('[ACTIVITY_LOG] Failed to log activity:', error);
      } else {
        console.log(`[ACTIVITY_LOG] ✅ voice_webrtc ${status} ${stage || ''} (${this.sessionId})`);
      }
    } catch (err) {
      console.error('[ACTIVITY_LOG] Exception logging activity:', err);
    }
  }

  // Load agenda status from shared service for cross-interface continuity
  private async loadAgendaStatus(): Promise<void> {
    if (!this.threadId || !this.userId) return;
    
    try {
      const { data, error } = await supabase.functions.invoke('agenda-manager', {
        body: { 
          operation: 'get_status', 
          threadId: this.threadId, 
          userId: this.userId 
        }
      });
      
      if (error) {
        console.warn('[AGENDA] Failed to load agenda status:', error);
        return;
      }
      
      if (data?.items?.length > 0) {
        this.agendaStatus = data;
        console.log(`[AGENDA] Loaded ${data.total} items, ${data.completed} completed, paused=${data.isPaused}`);
        
        // Emit event for UI awareness
        this.onMessage({
          type: 'agenda.loaded',
          status: this.agendaStatus
        });
      }
    } catch (err) {
      console.warn('[AGENDA] Error loading agenda:', err);
    }
  }

  // Pause agenda for tangent (e.g., when user asks about something off-topic)
  async pauseAgendaForTangent(userQuery: string): Promise<void> {
    if (!this.threadId || !this.userId || !this.agendaStatus) return;
    
    try {
      await supabase.functions.invoke('agenda-manager', {
        body: { 
          operation: 'pause_for_tangent', 
          threadId: this.threadId, 
          userId: this.userId,
          userQuery 
        }
      });
      
      if (this.agendaStatus) {
        this.agendaStatus.isPaused = true;
      }
      console.log('[AGENDA] Paused for tangent:', userQuery.substring(0, 40) + '...');
    } catch (err) {
      console.warn('[AGENDA] Error pausing for tangent:', err);
    }
  }

  // Get resume hint if agenda is paused
  async getAgendaResumeHint(): Promise<string | null> {
    if (!this.threadId || !this.userId) return null;
    
    try {
      const { data } = await supabase.functions.invoke('agenda-manager', {
        body: { 
          operation: 'get_resume_hint', 
          threadId: this.threadId, 
          userId: this.userId 
        }
      });
      
      return data?.hint || null;
    } catch (err) {
      console.warn('[AGENDA] Error getting resume hint:', err);
      return null;
    }
  }

  async connect() {
    try {
      // STEP 1: Generate session ID IMMEDIATELY - before any async operations
      // This ensures even failed connections are logged in activity_log
      this.sessionId = `WR${Date.now().toString(36)}${Math.random().toString(36).substring(2, 8)}`;
      this.connectionStartTime = Date.now();
      this.messageCount = 0;
      
      console.log('📍 WebRTC Session ID:', this.sessionId);
      
      // STEP 2: Get user ID for logging - needed for activity_log
      const { data: { user } } = await supabase.auth.getUser();
      // Use demo user ID as fallback for unauthenticated sessions
      this.userId = user?.id || '00000000-0000-0000-0000-000000000001';
      console.log(`[VOICE] User ID: ${this.userId} (demo=${!user?.id})`);
      
      // STEP 3: Log activity start BEFORE any async operations that might fail
      await this.logActivity('started', 'token_fetch');
      
      console.log('Getting ephemeral token...');
      
      // Get ephemeral token from our Supabase Edge Function
      const { data, error } = await supabase.functions.invoke('generate-realtime-token');
      
      if (error || !data) {
        // Handle structured errors from edge function
        if (data?.error === 'openai_api_error') {
          const details = data.details;
          let errorMessage = 'OpenAI API Error';
          let errorType = 'api_error';

          switch (details?.type) {
            case 'insufficient_quota':
              errorMessage = 'OpenAI quota exceeded. Please check your billing settings.';
              errorType = 'quota_exceeded';
              break;
            case 'invalid_api_key':
              errorMessage = 'Invalid OpenAI API key. Please check your configuration.';
              errorType = 'invalid_key';
              break;
            case 'rate_limit_exceeded':
              errorMessage = 'OpenAI rate limit exceeded. Please try again later.';
              errorType = 'rate_limit';
              break;
            case 'model_not_found':
              errorMessage = 'Model not available. Please contact support.';
              errorType = 'model_error';
              break;
            default:
              errorMessage = details?.message || 'Failed to connect to OpenAI API';
          }

          // Log error to activity_log
          await this.logActivity('error', 'token_fetch', {
            error_message: errorMessage,
            error_code: errorType,
            metadata: { details }
          });

          const enhancedError = new Error(errorMessage);
          (enhancedError as any).type = errorType;
          (enhancedError as any).details = details;
          throw enhancedError;
        }
        
        // Log generic error
        await this.logActivity('error', 'token_fetch', {
          error_message: error?.message || 'Failed to get ephemeral token'
        });
        
        throw new Error(error?.message || 'Failed to get ephemeral token');
      }

      if (!data?.client_secret?.value) {
        await this.logActivity('error', 'token_fetch', {
          error_message: 'Invalid token response from server'
        });
        throw new Error('Invalid token response from server');
      }

      const EPHEMERAL_KEY = data.client_secret.value;
      
      // Store TTS configuration from token response
      // Store TTS configuration from token response
      if (data.tts_config) {
        this.ttsProvider = data.tts_config.provider || 'openai';
        this.elevenlabsVoiceId = data.tts_config.elevenlabs_voice_id || '';
        console.log(`TTS Config: provider=${this.ttsProvider}, voice=${this.elevenlabsVoiceId}`);
        
        // CRITICAL: Mute WebRTC audio when using ElevenLabs TTS
        // OpenAI still sends audio via RTC track even with modalities: ["text"]
        if (this.ttsProvider === 'elevenlabs') {
          this.audioEl.muted = true;
          console.log('🔇 WebRTC audio muted - using ElevenLabs TTS');
        } else {
          this.audioEl.muted = false;
          console.log('🔊 WebRTC audio enabled - using OpenAI native TTS');
        }
      }
      
      console.log('Ephemeral token received, establishing WebRTC connection...');
      
      // Create thread for this voice session
      if (this.userId) {
        try {
          // Fetch user's default assistant for thread association
          const { data: defaultAssistant } = await supabase
            .from('assistants')
            .select('id')
            .eq('user_id', this.userId)
            .eq('is_default', true)
            .maybeSingle();
          
          const assistantId = defaultAssistant?.id || null;
          
          const { data: thread } = await supabase
            .from('ai_threads')
            .insert({ 
              user_id: this.userId,
              assistant_id: assistantId,
              openai_thread_id: `webrtc_${this.sessionId}`,
              mode: 'voice'
            })
            .select('id')
            .single();
          this.threadId = thread?.id || null;
          console.log('📍 Created voice thread:', this.threadId, 'for assistant:', assistantId);
          
          // Load agenda status for cross-interface continuity
          await this.loadAgendaStatus();
        } catch (err) {
          console.warn('Could not create voice thread:', err);
        }
      }

      // Initialize audio context with user gesture for autoplay policy
      this.audioContext = new AudioContext({ sampleRate: 24000 });
      
      // Resume audio context if suspended (required for autoplay policy)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
        console.log('Audio context resumed');
      }

      // Create peer connection
      this.pc = new RTCPeerConnection();

      // Set up remote audio
      this.pc.ontrack = e => {
        console.log('Received remote audio track');
        const audioTrack = e.track;
        this.audioEl.srcObject = e.streams[0];
        
        // Preserve mute setting and disable track for ElevenLabs mode
        // (srcObject assignment may reset muted state in some browsers)
        if (this.ttsProvider === 'elevenlabs') {
          this.audioEl.muted = true;
          audioTrack.enabled = false; // Disables audio at the WebRTC track level
          console.log('🔇 Remote track attached - muted + track disabled for ElevenLabs');
        }
      };

      // Add local audio track
      const ms = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      this.pc.addTrack(ms.getTracks()[0]);
      console.log('Added local audio track');

      // Set up data channel
      this.dc = this.pc.createDataChannel("oai-events");
      this.dc.addEventListener("message", (e) => {
        const event = JSON.parse(e.data);
        console.log("Received event:", event);
        this.handleMessage(event);
      });

      // Handle data channel state changes
      this.dc.addEventListener("open", async () => {
        console.log("Data channel opened");
        
        // Log successful connection to activity_log
        await this.logActivity('connected', 'webrtc_ready', {
          metadata: {
            connection_time_ms: Date.now() - this.connectionStartTime,
            tts_provider: this.ttsProvider
          }
        });
        
        this.onConnectionChange(true);
      });

      this.dc.addEventListener("close", () => {
        console.log("Data channel closed");
        this.onConnectionChange(false);
      });

      // Create and set local description
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      console.log('Created local offer');

      // Connect to OpenAI's Realtime API
      const baseUrl = "https://api.openai.com/v1/realtime";
      const model = "gpt-4o-realtime-preview-2024-12-17";
      const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${EPHEMERAL_KEY}`,
          "Content-Type": "application/sdp"
        },
      });

      if (!sdpResponse.ok) {
        const errorText = await sdpResponse.text();
        console.error('WebRTC SDP negotiation failed:', sdpResponse.status, errorText);
        
        let errorMessage = `WebRTC connection failed (${sdpResponse.status})`;
        if (sdpResponse.status === 401) {
          errorMessage = 'Authentication failed. Token may be invalid or expired.';
        } else if (sdpResponse.status === 429) {
          errorMessage = 'Rate limit exceeded. Please try again later.';
        } else if (sdpResponse.status >= 500) {
          errorMessage = 'OpenAI service unavailable. Please try again later.';
        }
        
        // Log WebRTC error to activity_log
        await this.logActivity('error', 'webrtc_sdp', {
          error_message: errorMessage,
          error_code: `http_${sdpResponse.status}`
        });
        
        const connectionError = new Error(errorMessage);
        (connectionError as any).type = 'webrtc_error';
        (connectionError as any).status = sdpResponse.status;
        throw connectionError;
      }

      const answer = {
        type: "answer" as RTCSdpType,
        sdp: await sdpResponse.text(),
      };
      
      await this.pc.setRemoteDescription(answer);
      console.log("WebRTC connection established successfully");

    } catch (error) {
      console.error("Error connecting:", error);
      
      // Ensure error is logged if not already
      if (this.userId && this.sessionId) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        await this.logActivity('error', 'connection', {
          error_message: errorMsg
        });
      }
      
      this.onConnectionChange(false);
      throw error;
    }
  }

  private handleMessage(event: any) {
    this.onMessage(event);

    // Enhanced debugging for audio events
    if (event.type === 'response.audio.delta') {
      console.log('🔊 Audio delta received, size:', event.delta?.length || 0);
    } else if (event.type === 'response.audio.done') {
      console.log('🔊 Audio response completed');
    } else if (event.type === 'response.function_call_arguments.done') {
      console.log('🔧 Function call completed:', event.name);
    }

    // Handle different event types
    switch (event.type) {
      case 'response.audio.delta':
        // Skip OpenAI audio when using ElevenLabs TTS
        if (this.ttsProvider === 'elevenlabs') break;
        this.handleAudioDelta(event);
        break;
      case 'response.audio.done':
        console.log('Audio playback finished');
        this.onSpeakingChange(false);
        break;
      case 'response.text.done':
        // ElevenLabs mode: send text to TTS and play MP3
        if (this.ttsProvider === 'elevenlabs' && event.text) {
          this.playElevenLabsAudio(event.text);
        }
        break;
      case 'response.function_call_arguments.done':
        this.handleFunctionCall(event);
        break;
      case 'input_audio_buffer.speech_started':
        console.log('🎤 Speech detected!');
        this.onListeningChange(true);
        this.onMessage({
          type: 'speech.detected',
          detected: true
        });
        break;
      case 'input_audio_buffer.speech_stopped':
        console.log('🤐 Speech stopped');
        this.onListeningChange(false);
        this.onMessage({
          type: 'speech.detected',
          detected: false
        });
        break;
      case 'response.created':
        console.log('🎯 AI response started');
        break;
      case 'response.done':
        console.log('🎯 AI response completed');
        break;
        
      // Transcript capture for persistence
      case 'conversation.item.input_audio_transcription.completed':
        // User speech transcript
        console.log('📝 User transcript:', event.transcript);
        if (event.transcript?.trim()) {
          this.saveTranscript('user', event.transcript);
        }
        break;
        
      case 'response.audio_transcript.done':
        // Assistant speech transcript  
        console.log('📝 Assistant transcript:', event.transcript);
        if (event.transcript?.trim()) {
          this.saveTranscript('assistant', event.transcript);
        }
        break;
    }
  }
  
  // Save transcript to database via generate-embeddings edge function
  private async saveTranscript(role: 'user' | 'assistant', content: string): Promise<void> {
    if (!this.userId || !content?.trim()) return;
    
    // Increment message count for activity tracking
    this.messageCount++;

    try {
      // Call existing generate-embeddings function for unified storage
      const { error } = await supabase.functions.invoke('generate-embeddings', {
        body: {
          action: 'store_conversation',
          userId: this.userId,
          threadId: this.threadId,
          role: role,
          content: content,
          audioTranscript: content,
          voiceSessionId: this.sessionId,
          messageType: role,
          metadata: { 
            source: 'voice',
            session_type: 'webrtc',
            tts_provider: this.ttsProvider
          }
        }
      });

      if (error) {
        // Explicit error notification per user preference
        console.error('TRANSCRIPT_SAVE_ERROR:', {
          role,
          sessionId: this.sessionId,
          error: error.message || error
        });
        
        // Emit error event for visibility
        this.onMessage({
          type: 'transcript.error',
          role,
          error: error.message || 'Failed to save transcript',
          sessionId: this.sessionId
        });
      } else {
        console.log(`💾 Saved ${role} transcript via generate-embeddings`);
        
        // Emit success for UI updates
        this.onMessage({
          type: 'transcript.saved',
          role,
          content,
          sessionId: this.sessionId
        });
      }
    } catch (error) {
      // Explicit error notification for exceptions
      const errorMsg = error instanceof Error ? error.message : 'Unknown error saving transcript';
      console.error('TRANSCRIPT_SAVE_ERROR:', {
        role,
        sessionId: this.sessionId,
        error: errorMsg
      });
      
      // Emit error event for visibility
      this.onMessage({
        type: 'transcript.error',
        role,
        error: errorMsg,
        sessionId: this.sessionId
      });
    }
  }

  private async handleAudioDelta(event: any) {
    if (!this.audioContext || !event.delta) {
      console.warn('Audio delta ignored - no context or data');
      return;
    }

    try {
      // Resume audio context if suspended
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
        console.log('Audio context resumed for playback');
      }

      this.onSpeakingChange(true);
      
      // Convert base64 to Uint8Array
      const binaryString = atob(event.delta);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      console.log(`🔊 Playing audio chunk: ${bytes.length} bytes`);
      await playAudioData(this.audioContext, bytes);
    } catch (error) {
      console.error('Error playing audio delta:', error);
    }
  }

  private async playElevenLabsAudio(text: string): Promise<void> {
    if (!text.trim()) return;
    
    console.log('🎙️ ElevenLabs TTS:', text.substring(0, 50) + '...');
    this.onSpeakingChange(true);
    
    try {
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/elevenlabs-tts`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_PUBLISHABLE_KEY,
            'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            text,
            voiceId: this.elevenlabsVoiceId,
            format: 'mp3'
          })
        }
      );
      
      if (!response.ok) {
        throw new Error(`ElevenLabs TTS error: ${response.status}`);
      }
      
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      
      // Track this audio element for cleanup on disconnect
      this.activeElevenLabsAudio.push(audio);
      
      audio.onended = () => {
        this.onSpeakingChange(false);
        URL.revokeObjectURL(audioUrl);
        // Remove from tracking array
        const idx = this.activeElevenLabsAudio.indexOf(audio);
        if (idx > -1) this.activeElevenLabsAudio.splice(idx, 1);
      };
      
      audio.onerror = () => {
        console.error('Audio playback error');
        this.onSpeakingChange(false);
        URL.revokeObjectURL(audioUrl);
        // Remove from tracking array
        const idx = this.activeElevenLabsAudio.indexOf(audio);
        if (idx > -1) this.activeElevenLabsAudio.splice(idx, 1);
      };
      
      await audio.play();
    } catch (error) {
      console.error('ElevenLabs TTS error:', error);
      this.onSpeakingChange(false);
    }
  }

  private async handleFunctionCall(event: any) {
    console.log('🔧 Function call completed:', event.name, 'with args:', event.arguments);
    
    try {
      const args = JSON.parse(event.arguments);
      const functionName = event.name;

      let result;
      switch (functionName) {
        case 'create_task':
          result = await this.createTask(args);
          break;
        case 'update_task':  
          result = await this.updateTask(args);
          break;
        case 'get_tasks':
          result = await this.getTasks(args);
          break;
        case 'get_today_tasks':
          result = await this.getTodayTasks(args);
          break;
        case 'reschedule_task':
          result = await this.rescheduleTask(args);
          break;
        case 'schedule_task':
          result = await this.scheduleTask(args);
          break;
        case 'unschedule_task':
          result = await this.unscheduleTask(args);
          break;
        case 'disconnect':
          result = await this.handleDisconnectTool(args);
          break;
        case 'initiate_phone_call':
          result = await this.initiatePhoneCall(args);
          break;
        case 'web_search':
          result = await this.webSearch(args);
          break;
        default:
          result = { error: `Unknown function: ${functionName}` };
      }

      console.log('🔧 Function result:', result);

      // Send function result back
      if (this.dc && this.dc.readyState === 'open') {
        // Send the function output
        this.dc.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: event.call_id,
            output: JSON.stringify(result)
          }
        }));

        // CRITICAL: Trigger a response to generate spoken response after function call
        console.log('🎯 Triggering AI response after function completion');
        this.dc.send(JSON.stringify({
          type: 'response.create'
        }));
      }
    } catch (error) {
      console.error('Error handling function call:', error);
    }
  }

  async startListening() {
    if (!this.audioContext || !this.dc || this.isListening) return;

    try {
      this.recorder = new AudioRecorder((audioData) => {
        if (this.dc?.readyState === 'open') {
          this.dc.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: encodeAudioForAPI(audioData)
          }));
        }
      });
      
      await this.recorder.start();
      this.isListening = true;
      this.onListeningChange(true);
      console.log('Started audio recording');
    } catch (error) {
      console.error('Error starting recording:', error);
      throw error;
    }
  }

  stopListening() {
    if (this.recorder) {
      this.recorder.stop();
      this.recorder = null;
      this.isListening = false;
      this.onListeningChange(false);
      console.log('Stopped audio recording');
    }
  }

  async sendTextMessage(text: string) {
    if (!this.dc || this.dc.readyState !== 'open') {
      throw new Error('Data channel not ready');
    }

    const event = {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text
          }
        ]
      }
    };

    this.dc.send(JSON.stringify(event));
    this.dc.send(JSON.stringify({type: 'response.create'}));
  }

  async disconnect() {
    console.log(`[VOICE_INSTANCE] Disconnecting #${this.instanceId}...`);
    
    // Remove from global registry FIRST
    activeInstances.delete(this.instanceId);
    console.log(`[VOICE_INSTANCE] Removed #${this.instanceId}, remaining: ${activeInstances.size}`);
    
    // CRITICAL: Stop all audio IMMEDIATELY before any other cleanup
    // This prevents any audio bleeding through during teardown
    
    // 1. Stop and clear WebRTC audio element
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.muted = true;
      this.audioEl.srcObject = null;
      console.log('🔴 WebRTC audio element stopped and cleared');
    }
    
    // 2. Stop ALL playing ElevenLabs audio
    if (this.activeElevenLabsAudio.length > 0) {
      console.log(`🔴 Stopping ${this.activeElevenLabsAudio.length} active ElevenLabs audio elements`);
      this.activeElevenLabsAudio.forEach(audio => {
        audio.pause();
        audio.src = '';
      });
      this.activeElevenLabsAudio = [];
    }
    
    // Log completion to activity_log with session metrics
    if (this.userId && this.sessionId) {
      const durationSeconds = Math.floor((Date.now() - this.connectionStartTime) / 1000);
      await this.logActivity('completed', 'disconnect', {
        duration_seconds: durationSeconds,
        message_count: this.messageCount,
        ended_at: new Date().toISOString(),
        metadata: {
          tts_provider: this.ttsProvider,
          thread_id: this.threadId,
          agenda_status: this.agendaStatus ? {
            completed: this.agendaStatus.completed,
            total: this.agendaStatus.total
          } : null
        }
      });
    }
    
    this.stopListening();
    
    // CRITICAL: Stop all WebRTC tracks first to release microphone access
    this.stopAllMediaTracks();
    
    if (this.dc) {
      this.dc.close();
      this.dc = null;
    }
    
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    // Clear agenda status
    this.agendaStatus = null;
    
    this.onConnectionChange(false);
    this.onListeningChange(false);
    this.onSpeakingChange(false);
  }

  // Helper method to stop all media tracks and release microphone access
  private stopAllMediaTracks() {
    console.log('🔴 Stopping all media tracks to release microphone...');
    
    if (this.pc) {
      // Stop all senders (outgoing audio tracks)
      const senders = this.pc.getSenders();
      senders.forEach(sender => {
        if (sender.track) {
          console.log('🔴 Stopping sender track:', sender.track.kind);
          sender.track.stop();
        }
      });
      
      // Stop all receivers (incoming audio tracks) 
      const receivers = this.pc.getReceivers();
      receivers.forEach(receiver => {
        if (receiver.track) {
          console.log('🔴 Stopping receiver track:', receiver.track.kind);
          receiver.track.stop();
        }
      });
      
      console.log('🔴 All WebRTC tracks stopped');
    }
  }

  // Task management functions
  // Helper: Normalize priority to database enum
  private normalizePriority(priority?: string): 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' {
    if (!priority) return 'MEDIUM';
    const p = priority.toUpperCase();
    if (['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(p)) {
      return p as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    }
    return 'MEDIUM';
  }

  // Helper: Normalize category to database enum
  private normalizeCategory(category?: string): 'LIFE' | 'CAREER' | 'VENTURES' | 'EDUCATION' {
    if (!category) return 'LIFE';
    const c = category.toLowerCase().replace(/[_\s-]+/g, '');
    
    // Education-related terms
    if (c.includes('education') || c.includes('professional') || 
        c.includes('mit') || c.includes('emba') || c.includes('degree') || 
        c.includes('college') || c.includes('school') || c.includes('class') || 
        c.includes('coursework') || c.includes('learning') || c.includes('study')) {
      return 'EDUCATION';
    }
    
    // Career-related terms
    if (c.includes('career') || c.includes('work') || c.includes('job')) {
      return 'CAREER';
    }
    
    // Ventures-related terms
    if (c.includes('venture') || c.includes('startup') || c.includes('business')) {
      return 'VENTURES';
    }
    
    return 'LIFE';
  }

  private async createTask(args: any) {
    try {
      // UI status: creating task
      this.onMessage?.({ type: 'client.processing', status: 'Creating task...' });

      const userId = (await supabase.auth.getUser()).data.user?.id;
      if (!userId) {
        this.onMessage?.({ 
          type: 'client.error', 
          message: 'Please log in to create tasks' 
        });
        return { 
          success: false, 
          error: 'Please log in to create tasks',
          message: 'You need to be logged in to create tasks'
        };
      }

      // Validate title
      const title = args.title?.trim();
      if (!title) {
        this.onMessage?.({ 
          type: 'client.error', 
          message: 'Task title is required' 
        });
        return { 
          success: false, 
          error: 'Task title is required',
          message: 'Please provide a title for the task'
        };
      }

      console.log('Looking for user boards...');

      // First try to find user's default board
      let { data: defaultBoard, error } = await supabase
        .from('boards')
        .select('id, name')
        .eq('user_id', userId)
        .eq('is_default', true)
        .maybeSingle();

      if (error) {
        console.error('Error finding default board:', error);
        throw new Error(`Database error: ${error.message}`);
      }

      // If no default board, find any user board
      if (!defaultBoard) {
        console.log('No default board found, looking for any user board...');
        
        const { data: anyBoard, error: anyBoardError } = await supabase
          .from('boards')
          .select('id, name')
          .eq('user_id', userId)
          .limit(1)
          .maybeSingle();

        if (anyBoardError) {
          console.error('Error finding any board:', anyBoardError);
          throw new Error(`Database error: ${anyBoardError.message}`);
        }

        if (anyBoard) {
          console.log('Found existing board:', anyBoard.name);
          defaultBoard = anyBoard;
        }
      } else {
        console.log('Found default board:', defaultBoard.name);
      }

      // Only create a new board if user has no boards at all
      if (!defaultBoard) {
        console.log('No boards found for user, creating new default board...');
        
        const { data: newBoard, error: createError } = await supabase
          .from('boards')
          .insert({
            name: 'My Tasks',
            description: 'Default task board',
            is_default: true,
            user_id: userId
          })
          .select('id, name')
          .single();

        if (createError) {
          console.error('Failed to create board:', createError);
          throw new Error(`Failed to create default board: ${createError.message}`);
        }

        defaultBoard = newBoard;
        console.log('Created default board:', defaultBoard.name);

        // Create default columns for the new board
        const defaultColumns = [
          { name: 'Backlog', status: 'BACKLOG' as const, position: 0 },
          { name: 'To Do', status: 'TODO' as const, position: 1 },
          { name: 'Doing', status: 'DOING' as const, position: 2 },
          { name: 'Done', status: 'DONE' as const, position: 3 }
        ];

        const { error: columnsError } = await supabase
          .from('columns')
          .insert(
            defaultColumns.map(col => ({
              ...col,
              board_id: defaultBoard.id
            }))
          );

        if (columnsError) {
          console.warn('Failed to create default columns:', columnsError);
        } else {
          console.log('Created default columns for board');
        }
      }

      // Normalize and prepare task data
      const normalizedPriority = this.normalizePriority(args.priority);
      const normalizedCategory = this.normalizeCategory(args.category);
      
      console.log('📝 Creating task with normalized values:', {
        title,
        priority: `${args.priority} → ${normalizedPriority}`,
        category: `${args.category} → ${normalizedCategory}`
      });

      const taskData: {
        title: string;
        description: string | null;
        priority: 'HIGH' | 'LOW' | 'MEDIUM' | 'URGENT';
        category: 'CAREER' | 'EDUCATION' | 'LIFE' | 'VENTURES';
        status: 'BLOCKED' | 'LIFE' | 'CAREER' | 'PROF_EDUCATION' | 'VENTURES' | 'PLANNING' | 'READY' | 'UP_NEXT' | 'DOING' | 'DONE' | 'BACKLOG' | 'TODO';
        board_id: string;
        user_id: string;
      } = {
        title,
        description: args.description?.trim() || null,
        priority: normalizedPriority,
        category: normalizedCategory,
        status: normalizedCategory === 'EDUCATION' ? 'PROF_EDUCATION' : normalizedCategory, // Map EDUCATION to PROF_EDUCATION status
        board_id: defaultBoard.id,
        user_id: userId
      };

      const { data: task, error: taskError } = await supabase
        .from('tasks')
        .insert([taskData])
        .select()
        .single();

      if (taskError) {
        console.error('❌ Task insert failed:', taskError);
        const errorMessage = taskError.message || 'Failed to create task';
        this.onMessage?.({ 
          type: 'client.error', 
          message: `Failed to create task: ${errorMessage}` 
        });
        return {
          success: false,
          error: errorMessage,
          message: `I couldn't create that task. ${errorMessage}`
        };
      }

      // TESTING: Commented out to test if database trigger handles notifications
      // If duplicates stop, remove this block entirely
      /*
      // Send notifications for the newly created task
      try {
        await supabase.functions.invoke('send-push-notification', {
          body: {
            userId: taskData.user_id,
            taskId: task.id,
            title: 'Voice Task Created',
            body: `Task "${task.title}" created via voice assistant`,
            type: 'task_created'
          }
        });
      } catch (notificationError) {
        console.warn('Failed to send notifications:', notificationError);
      }
      */

      console.log('✅ Task created successfully:', task.title);
      this.onMessage?.({ type: 'client.done', status: 'Task created' });
      
      return { 
        success: true, 
        task,
        message: `Created "${task.title}" in Backlog with ${normalizedPriority} priority`
      };
    } catch (error) {
      console.error('❌ Error creating task:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error creating task';
      this.onMessage?.({ 
        type: 'client.error', 
        message: `Task creation failed: ${errorMessage}` 
      });
      return {
        success: false,
        error: errorMessage,
        message: `I couldn't create that task. ${errorMessage}`
      };
    }
  }

  private async updateTask(args: any) {
    try {
      // UI status: updating task
      this.onMessage?.({ type: 'client.processing', status: 'Updating task...' });

      const updateData: any = {};
      if (args.title) updateData.title = args.title.trim();
      if (args.description !== undefined) updateData.description = args.description?.trim() || null;
      if (args.priority) updateData.priority = this.normalizePriority(args.priority);
      if (args.status) updateData.status = args.status.toUpperCase();
      if (args.category) updateData.category = this.normalizeCategory(args.category);

      console.log('📝 Updating task with normalized values:', updateData);

      const { data, error } = await supabase
        .from('tasks')
        .update(updateData)
        .eq('id', args.task_id)
        .select()
        .single();

      if (error) {
        console.error('❌ Task update failed:', error);
        const errorMessage = error.message || 'Failed to update task';
        this.onMessage?.({ 
          type: 'client.error', 
          message: `Failed to update task: ${errorMessage}` 
        });
        return { 
          success: false, 
          error: errorMessage,
          message: `I couldn't update that task. ${errorMessage}`
        };
      }

      console.log('✅ Task updated successfully');
      this.onMessage?.({ type: 'client.done', status: 'Task updated' });
      return { 
        success: true, 
        task: data,
        message: `Updated "${data.title}" successfully`
      };
    } catch (error) {
      console.error('❌ Error updating task:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.onMessage?.({ 
        type: 'client.error', 
        message: errorMessage 
      });
      return { 
        success: false, 
        error: errorMessage,
        message: `I couldn't update that task. ${errorMessage}`
      };
    }
  }

  private async getTasks(args: any) {
    try {
      this.onMessage?.({ type: 'client.processing', status: 'Loading your tasks...' });
      
      console.log('🔍 Getting tasks with args:', args);
      
      // Query tasks directly from database
      let query = supabase
        .from('tasks')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(args?.limit || 10);

      if (args?.status_filter) {
        query = query.eq('status', args.status_filter);
      }

      const { data: tasks, error } = await query;
      
      if (error) {
        console.error('❌ Tasks query error:', error);
        this.onMessage?.({ 
          type: 'client.error', 
          message: `Failed to load tasks: ${error.message}` 
        });
        throw error;
      }

      console.log('✅ Got tasks from database:', tasks?.length || 0);
      this.onMessage?.({ type: 'client.done', status: `Loaded ${tasks?.length || 0} task(s)` });
      
      return {
        success: true,
        tasks: tasks || []
      };
    } catch (error) {
      console.error('❌ Error getting tasks:', error);
      this.onMessage?.({ 
        type: 'client.error', 
        message: error instanceof Error ? error.message : 'Unknown error loading tasks'
      });
      return {
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async getTodayTasks(args: any) {
    try {
      this.onMessage?.({ type: 'client.processing', status: 'Loading today\'s tasks...' });
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const userId = (await supabase.auth.getUser()).data.user?.id;
      if (!userId) {
        return { success: false, error: 'Not authenticated' };
      }

      // Get scheduled tasks for today
      const { data: scheduledTasks, error: scheduledError } = await supabase
        .from('tasks')
        .select('*')
        .eq('user_id', userId)
        .gte('start_time', today.toISOString())
        .lt('start_time', tomorrow.toISOString())
        .order('start_time', { ascending: true });

      if (scheduledError) throw scheduledError;

      // Get unscheduled tasks
      const { data: unscheduledTasks, error: unscheduledError } = await supabase
        .from('tasks')
        .select('*')
        .eq('user_id', userId)
        .is('start_time', null)
        .neq('status', 'DONE')
        .order('priority', { ascending: false })
        .limit(10);

      if (unscheduledError) throw unscheduledError;

      const totalTasks = (scheduledTasks?.length || 0) + (unscheduledTasks?.length || 0);
      this.onMessage?.({ type: 'client.done', status: `Found ${totalTasks} task(s) for today` });

      return {
        success: true,
        scheduled: scheduledTasks || [],
        unscheduled: unscheduledTasks || [],
        date: today.toISOString(),
        summary: `You have ${scheduledTasks?.length || 0} scheduled tasks and ${unscheduledTasks?.length || 0} unscheduled tasks for today.`
      };
    } catch (error) {
      console.error('❌ Error getting today\'s tasks:', error);
      this.onMessage?.({ type: 'client.error', message: 'Failed to load today\'s tasks' });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  private async rescheduleTask(args: any) {
    try {
      this.onMessage?.({ type: 'client.processing', status: 'Rescheduling task...' });

      if (!args.task_id) {
        return { success: false, error: 'Task ID is required' };
      }

      const userId = (await supabase.auth.getUser()).data.user?.id;
      if (!userId) {
        return { success: false, error: 'Not authenticated' };
      }

      // Parse new date
      const newDate = new Date(args.new_date);
      if (isNaN(newDate.getTime())) {
        return { success: false, error: 'Invalid date format' };
      }

      // If new_start_time provided, parse it
      let newStartTime = new Date(newDate);
      let newEndTime = new Date(newDate);
      
      if (args.new_start_time) {
        const [hours, minutes] = args.new_start_time.split(':').map(Number);
        newStartTime.setHours(hours, minutes, 0, 0);
        
        // Get original task to maintain duration
        const { data: originalTask } = await supabase
          .from('tasks')
          .select('start_time, end_time')
          .eq('id', args.task_id)
          .eq('user_id', userId)
          .single();

        if (originalTask?.start_time && originalTask?.end_time) {
          const originalDuration = new Date(originalTask.end_time).getTime() - new Date(originalTask.start_time).getTime();
          newEndTime = new Date(newStartTime.getTime() + originalDuration);
        } else {
          // Default 1 hour
          newEndTime.setHours(hours + 1, minutes, 0, 0);
        }
      } else {
        // Keep same time, just change date
        const { data: originalTask } = await supabase
          .from('tasks')
          .select('start_time, end_time')
          .eq('id', args.task_id)
          .eq('user_id', userId)
          .single();

        if (originalTask?.start_time) {
          const origStart = new Date(originalTask.start_time);
          newStartTime.setHours(origStart.getHours(), origStart.getMinutes(), 0, 0);
          
          if (originalTask.end_time) {
            const origEnd = new Date(originalTask.end_time);
            newEndTime.setHours(origEnd.getHours(), origEnd.getMinutes(), 0, 0);
          } else {
            newEndTime.setHours(origStart.getHours() + 1, origStart.getMinutes(), 0, 0);
          }
        } else {
          // Default to 9 AM - 10 AM
          newStartTime.setHours(9, 0, 0, 0);
          newEndTime.setHours(10, 0, 0, 0);
        }
      }

      const { data, error } = await supabase
        .from('tasks')
        .update({
          start_time: newStartTime.toISOString(),
          end_time: newEndTime.toISOString(),
          // Don't change status - preserve task's current lane
        })
        .eq('id', args.task_id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      this.onMessage?.({ type: 'client.done', status: 'Task rescheduled successfully' });

      return {
        success: true,
        task: data,
        message: `Task rescheduled to ${newStartTime.toLocaleDateString()} at ${newStartTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      };
    } catch (error) {
      console.error('❌ Error rescheduling task:', error);
      this.onMessage?.({ type: 'client.error', message: 'Failed to reschedule task' });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  private async scheduleTask(args: any) {
    try {
      this.onMessage?.({ type: 'client.processing', status: 'Scheduling task...' });

      if (!args.task_id) {
        return { success: false, error: 'Task ID is required' };
      }

      const userId = (await supabase.auth.getUser()).data.user?.id;
      if (!userId) {
        return { success: false, error: 'Not authenticated' };
      }

      // Get the task to schedule
      const { data: task, error: taskError } = await supabase
        .from('tasks')
        .select('*')
        .eq('id', args.task_id)
        .eq('user_id', userId)
        .single();

      if (taskError) throw taskError;
      if (!task) return { success: false, error: 'Task not found' };

      // Load user scheduling preferences to get timezone
      const { data: prefs } = await supabase
        .from('user_scheduling_prefs')
        .select('config')
        .eq('user_id', userId)
        .single();

      const config = prefs?.config as any;
      const timezone = config?.timezone || 
        Intl.DateTimeFormat().resolvedOptions().timeZone || 
        'UTC';

      console.log('User timezone:', timezone);

      // Fetch existing tasks for context
      const { data: existingTasks } = await supabase
        .from('tasks')
        .select('*')
        .eq('user_id', userId)
        .neq('status', 'DONE')
        .order('start_time', { ascending: true });

      // Calculate targetDate if user specified a date
      let targetDate: string | undefined;
      if (args.date) {
        const requestedDate = new Date(args.date);
        // Format as YYYY-MM-DD in local timezone
        const year = requestedDate.getFullYear();
        const month = String(requestedDate.getMonth() + 1).padStart(2, '0');
        const day = String(requestedDate.getDate()).padStart(2, '0');
        targetDate = `${year}-${month}-${day}`;
        console.log('Target date specified:', targetDate);
      }

      // Build complete scheduler payload
      const schedulerPayload = {
        taskText: `${task.title}${task.description ? ' - ' + task.description : ''}`,
        existingTasks: existingTasks || [],
        dueDate: task.due_date || undefined,
        estimateMinutes: args.duration_minutes || task.estimate_minutes || 60,
        taskCategory: task.category,
        taskPriority: task.priority,
        scheduling_context: [],
        userId: userId,
        userSchedulingConfig: config || {},
        timezone: timezone,
        targetDate: targetDate
      };

      console.log('Calling smart-calendar-scheduler with payload:', schedulerPayload);

      const { data: schedulerResult, error: schedulerError } = await supabase.functions.invoke(
        'smart-calendar-scheduler',
        {
          body: schedulerPayload
        }
      );

      if (schedulerError || !schedulerResult?.success) {
        console.error('Scheduler error:', schedulerError || schedulerResult);
        
        // Fallback only if user explicitly requested a specific date
        if (targetDate && args.date) {
          console.log('Using fallback scheduling for specified date:', targetDate);
          const requestedDate = new Date(args.date);
          const year = requestedDate.getFullYear();
          const month = requestedDate.getMonth();
          const day = requestedDate.getDate();
          
          // Construct local time to avoid UTC shift
          const startTime = new Date(year, month, day, 9, 0, 0);
          const endTime = new Date(year, month, day, 10, 0, 0);
          
          const { data: updatedTask, error: updateError } = await supabase
            .from('tasks')
            .update({
              start_time: startTime.toISOString(),
              end_time: endTime.toISOString(),
              estimate_minutes: args.duration_minutes || task.estimate_minutes || 60,
              is_scheduled: true,
            })
            .eq('id', args.task_id)
            .eq('user_id', userId)
            .select()
            .single();

          if (updateError) {
            console.error('Error updating task with fallback:', updateError);
            throw updateError;
          }

          this.onMessage?.({ type: 'client.done', status: 'Task scheduled with fallback' });

          return {
            success: true,
            task: updatedTask,
            message: `I've scheduled "${task.title}" for 9:00 AM on ${targetDate}.`
          };
        }
        
        throw new Error('Scheduler failed and no fallback available');
      }

      const slot = schedulerResult.slot;
      console.log('Scheduler returned slot:', slot);

      const { data: updatedTask, error: updateError } = await supabase
        .from('tasks')
        .update({
          start_time: slot.start_time,
          end_time: slot.end_time,
          estimate_minutes: slot.duration_minutes,
          is_scheduled: true,
        })
        .eq('id', args.task_id)
        .eq('user_id', userId)
        .select()
        .single();

      if (updateError) {
        console.error('Error updating task:', updateError);
        throw updateError;
      }

      this.onMessage?.({ type: 'client.done', status: 'Task scheduled successfully' });

      const startTime = new Date(slot.start_time).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });

      return {
        success: true,
        task: updatedTask,
        message: `I've scheduled "${task.title}" for ${startTime}.`
      };
    } catch (error) {
      console.error('❌ Error scheduling task:', error);
      this.onMessage?.({ type: 'client.error', message: 'Failed to schedule task' });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  private async unscheduleTask(args: any) {
    try {
      this.onMessage?.({ type: 'client.processing', status: 'Unscheduling task...' });

      if (!args.task_id) {
        return { success: false, error: 'Task ID is required' };
      }

      const userId = (await supabase.auth.getUser()).data.user?.id;
      if (!userId) {
        return { success: false, error: 'Not authenticated' };
      }

      const { data, error } = await supabase
        .from('tasks')
        .update({
          start_time: null,
          end_time: null,
          is_scheduled: false,
          status: 'BACKLOG'
        })
        .eq('id', args.task_id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      this.onMessage?.({ type: 'client.done', status: 'Task unscheduled' });

      return {
        success: true,
        task: data,
        message: 'Task has been removed from the schedule and moved to backlog'
      };
    } catch (error) {
      console.error('❌ Error unscheduling task:', error);
      this.onMessage?.({ type: 'client.error', message: 'Failed to unschedule task' });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  private async handleDisconnectTool(args: any) {
    console.log('🔴 Disconnect tool called with args:', args);
    this.onMessage?.({ 
      type: 'assistant.disconnect', 
      message: args.farewell_message || "Goodbye!" 
    });
    // Give the assistant time to speak the farewell, then disconnect
    setTimeout(() => this.disconnect(), 2000);
    return { success: true, message: "Disconnecting..." };
  }

  private async initiatePhoneCall(args: { delay_minutes?: number; context?: string }) {
    console.log('📞 Initiate phone call with args:', args);
    
    try {
      this.onMessage?.({ type: 'client.processing', status: 'Initiating phone call...' });

      const userId = (await supabase.auth.getUser()).data.user?.id;
      if (!userId) {
        this.onMessage?.({ type: 'client.error', message: 'Not authenticated' });
        return { success: false, error: 'Not authenticated' };
      }

      const { data, error } = await supabase.functions.invoke('twilio-voice-handler', {
        body: {
          action: 'trigger-call',
          userId,
          delay_minutes: args.delay_minutes,
          context: args.context
        }
      });

      if (error) {
        console.error('❌ Error initiating phone call:', error);
        this.onMessage?.({ type: 'client.error', message: 'Failed to initiate phone call' });
        return { 
          success: false, 
          error: error.message || 'Failed to initiate phone call'
        };
      }

      if (!data?.success) {
        this.onMessage?.({ type: 'client.error', message: data?.error || 'Call failed' });
        return { 
          success: false, 
          error: data?.error || 'Failed to initiate phone call'
        };
      }

      const message = args.delay_minutes 
        ? `I'll call you in ${args.delay_minutes} minute${args.delay_minutes > 1 ? 's' : ''}`
        : 'Calling you now';

      this.onMessage?.({ type: 'client.done', status: message });

      return {
        success: true,
        message,
        call_sid: data.call_sid
      };
    } catch (error) {
      console.error('❌ Error initiating phone call:', error);
      this.onMessage?.({ type: 'client.error', message: 'Failed to initiate phone call' });
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  private async webSearch(args: { query: string }) {
    console.log('🔍 Web search with query:', args.query);
    
    try {
      this.onMessage?.({ type: 'client.processing', status: 'Searching the web...' });

      const { data, error } = await supabase.functions.invoke('web-search', {
        body: { query: args.query }
      });

      if (error) {
        console.error('❌ Web search error:', error);
        this.onMessage?.({ type: 'client.error', message: 'Search failed' });
        return { 
          success: false, 
          error: error.message || 'Web search failed',
          answer: "I couldn't search for that information right now."
        };
      }

      this.onMessage?.({ type: 'client.done', status: 'Search complete' });

      return {
        success: data?.success ?? false,
        answer: data?.answer || "No results found.",
        sources: data?.sources || [],
        query: args.query
      };
    } catch (error) {
      console.error('❌ Web search error:', error);
      this.onMessage?.({ type: 'client.error', message: 'Search failed' });
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error',
        answer: "I encountered an error while searching."
      };
    }
  }
}