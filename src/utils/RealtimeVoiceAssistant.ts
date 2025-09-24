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
      const audioBuffer = await this.audioContext.decodeAudioData(wavData.buffer);
      
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
  private ws: WebSocket | null = null;
  private audioRecorder: AudioRecorder | null = null;
  private audioContext: AudioContext;
  private isConnected = false;
  private isListening = false;
  
  constructor(
    private onMessage: (message: any) => void,
    private onConnectionChange: (connected: boolean) => void,
    private onListeningChange: (listening: boolean) => void,
    private onSpeaking: (speaking: boolean) => void
  ) {
    this.audioContext = new AudioContext();
  }

  async connect() {
    try {
      console.log('Connecting to voice assistant...');
      
      // Connect to our Supabase edge function via WebSocket
      this.ws = new WebSocket(`wss://wwxgajrtmslzklnyplah.supabase.co/functions/v1/realtime-voice-assistant`);
      
      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.isConnected = true;
        this.onConnectionChange(true);
      };

      this.ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        console.log('Received message:', data.type);
        
        this.onMessage(data);
        
        if (data.type === 'response.audio.delta') {
          // Convert base64 to Uint8Array and play
          const binaryString = atob(data.delta);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          await playAudioData(this.audioContext, bytes);
          this.onSpeaking(true);
        } else if (data.type === 'response.audio.done') {
          this.onSpeaking(false);
        } else if (data.type === 'session.created') {
          // Send session update after connection is established
          this.sendSessionUpdate();
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.isConnected = false;
        this.onConnectionChange(false);
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.isConnected = false;
        this.onConnectionChange(false);
      };

    } catch (error) {
      console.error('Error connecting to voice assistant:', error);
      throw error;
    }
  }

  private sendSessionUpdate() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    const sessionUpdate = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: `You are a helpful task management assistant specializing in personal productivity. Help users organize and manage their tasks across different areas of life. You can:
        
        1. Create new tasks with appropriate priority, category, and timing
        2. Update existing tasks (change status, priority, descriptions, due dates)
        3. Suggest task organization and productivity strategies
        4. Help users break down complex projects into manageable tasks
        5. Provide time management advice and task prioritization guidance
        
        Categories available: LIFE, CAREER, VENTURES, EDUCATION
        Priorities available: LOW, MEDIUM, HIGH, URGENT
        Statuses available: BACKLOG, TODO, DOING, DONE
        
        Be conversational, encouraging, and focus on helping users achieve their goals. Always confirm actions before making changes to their tasks.`,
        voice: 'alloy',
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: {
          model: 'whisper-1'
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 1000
        },
        tools: [
          {
            type: 'function',
            name: 'create_task',
            description: 'Create a new task in the user\'s task board',
            parameters: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Title of the task' },
                description: { type: 'string', description: 'Detailed description of the task' },
                priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'], description: 'Task priority level' },
                category: { type: 'string', enum: ['LIFE', 'CAREER', 'VENTURES', 'EDUCATION'], description: 'Task category' },
                due_date: { type: 'string', description: 'Due date in ISO format (optional)' },
                estimate_minutes: { type: 'number', description: 'Estimated time to complete in minutes (optional)' }
              },
              required: ['title', 'category']
            }
          },
          {
            type: 'function',
            name: 'update_task',
            description: 'Update an existing task',
            parameters: {
              type: 'object',
              properties: {
                task_id: { type: 'string', description: 'ID of the task to update' },
                title: { type: 'string' },
                description: { type: 'string' },
                priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
                status: { type: 'string', enum: ['BACKLOG', 'TODO', 'DOING', 'DONE'] },
                due_date: { type: 'string' },
                estimate_minutes: { type: 'number' }
              },
              required: ['task_id']
            }
          },
          {
            type: 'function',
            name: 'get_tasks',
            description: 'Get current tasks to reference for updates',
            parameters: {
              type: 'object',
              properties: {
                status_filter: { type: 'string', enum: ['BACKLOG', 'TODO', 'DOING', 'DONE'], description: 'Optional status filter' }
              }
            }
          }
        ],
        tool_choice: 'auto',
        temperature: 0.8,
        max_response_output_tokens: 'inf'
      }
    };
    
    console.log('Sending session update');
    this.ws.send(JSON.stringify(sessionUpdate));
  }

  async startListening() {
    if (!this.isConnected || this.isListening) return;
    
    try {
      this.audioRecorder = new AudioRecorder((audioData) => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          const encodedAudio = encodeAudioForAPI(audioData);
          this.ws.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: encodedAudio
          }));
        }
      });
      
      await this.audioRecorder.start();
      this.isListening = true;
      this.onListeningChange(true);
      console.log('Started listening...');
    } catch (error) {
      console.error('Error starting audio recording:', error);
      throw error;
    }
  }

  stopListening() {
    if (this.audioRecorder) {
      this.audioRecorder.stop();
      this.audioRecorder = null;
    }
    this.isListening = false;
    this.onListeningChange(false);
    console.log('Stopped listening');
  }

  sendTextMessage(text: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
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
    
    this.ws.send(JSON.stringify(event));
    this.ws.send(JSON.stringify({type: 'response.create'}));
  }

  disconnect() {
    this.stopListening();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.onConnectionChange(false);
  }
}