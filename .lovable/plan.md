
# Fix Plan: Unified Audio Queue and Barge-In (Matching Twilio Patterns)

## Twilio Implementation Analysis

The Twilio bridge has these key patterns we should reuse:

### 1. ElevenLabs TTS Queuing (lines 1549-1698)
```typescript
// Twilio uses a flag + buffer approach:
if (isProcessingElevenLabsTTS) {
  console.log('[ELEVENLABS] Already processing TTS, queueing text');
  pendingTextBuffer += ' ' + text;
  return;
}
// ... after TTS completes:
if (pendingTextBuffer.trim()) {
  const queuedText = pendingTextBuffer;
  pendingTextBuffer = '';
  setTimeout(() => sendElevenLabsTTS(queuedText), 50);
}
```

### 2. Barge-In Detection (lines 2488-2553)
```typescript
case "input_audio_buffer.speech_started":
  // Debounce rapid speech events
  const now = Date.now();
  if (now - lastSpeechStartTime < SPEECH_DEBOUNCE_MS) break;
  
  // ElevenLabs mode: Clear Twilio buffer + sentence buffer
  if (ttsProvider === 'elevenlabs') {
    twilioWs.send(JSON.stringify({ event: "clear", streamSid }));
    sentenceBuffer = '';
    isAiSpeaking = false;
    break;
  }
  
  // OpenAI mode: Truncate response
  if (isAiSpeaking && currentResponseItemId) {
    openaiWs.send(JSON.stringify({
      type: "conversation.item.truncate",
      item_id: currentResponseItemId,
      content_index: 0,
      audio_end_ms: Math.floor(audioSamplesPlayed / 24)
    }));
  }
```

### 3. SharedAgendaManager (lines 798-920)
- Wrapper class that calls centralized `agenda-manager` edge function
- Methods: `pauseForQuery(userQuery)`, `resume()`, `getResumeHint()`
- Used for cross-interface agenda persistence

---

## Implementation Plan for WebRTC

### File: `src/utils/RealtimeVoiceAssistant.ts`

**1. Extend AudioQueue to Support Both PCM and MP3 (around line 97)**

Current queue only handles PCM. Extend it:

```typescript
type QueueItem = 
  | { type: 'pcm'; data: Uint8Array }
  | { type: 'mp3'; blob: Blob; text: string };

class AudioQueue {
  private queue: QueueItem[] = [];
  private isPlaying = false;
  private audioContext: AudioContext;
  private currentAudio: HTMLAudioElement | null = null;
  private onSpeakingChange: (speaking: boolean) => void;

  constructor(audioContext: AudioContext, onSpeakingChange: (s: boolean) => void) {
    this.audioContext = audioContext;
    this.onSpeakingChange = onSpeakingChange;
  }

  async addPCM(audioData: Uint8Array) {
    this.queue.push({ type: 'pcm', data: audioData });
    if (!this.isPlaying) await this.playNext();
  }

  async addMP3(blob: Blob, text: string) {
    console.log('[AUDIO_QUEUE] Adding MP3 to queue:', text.substring(0, 30) + '...');
    this.queue.push({ type: 'mp3', blob, text });
    if (!this.isPlaying) await this.playNext();
  }

  // CRITICAL: Called on barge-in - stop everything immediately
  clearAndStop() {
    console.log('[AUDIO_QUEUE] clearAndStop called - clearing queue and stopping playback');
    this.queue = [];
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.src = '';
      this.currentAudio = null;
    }
    this.isPlaying = false;
    this.onSpeakingChange(false);
  }

  private async playNext() {
    if (this.queue.length === 0) {
      this.isPlaying = false;
      this.onSpeakingChange(false);
      return;
    }

    this.isPlaying = true;
    this.onSpeakingChange(true);
    const item = this.queue.shift()!;

    if (item.type === 'pcm') {
      await this.playPCM(item.data);
    } else {
      await this.playMP3(item.blob);
    }
  }

  private async playMP3(blob: Blob): Promise<void> {
    const audioUrl = URL.createObjectURL(blob);
    const audio = new Audio(audioUrl);
    this.currentAudio = audio;

    return new Promise((resolve) => {
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        this.currentAudio = null;
        this.playNext();
        resolve();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        this.currentAudio = null;
        this.playNext();
        resolve();
      };
      audio.play().catch(() => {
        this.currentAudio = null;
        this.playNext();
        resolve();
      });
    });
  }

  // ... existing playPCM with createWavFromPCM (unchanged)
}
```

**2. Add Class Properties for Agenda and Debounce (around line 228)**

```typescript
// Speech debounce (matches Twilio's 300ms)
private lastSpeechStartTime: number = 0;
private readonly SPEECH_DEBOUNCE_MS = 300;

// Unified AudioQueue with speaking callback
private audioQueue: AudioQueue | null = null;
```

**3. Initialize AudioQueue with Speaking Callback (in connect method, around line 510)**

```typescript
// Initialize unified audio queue for both PCM (OpenAI) and MP3 (ElevenLabs)
this.audioQueue = new AudioQueue(this.audioContext, this.onSpeakingChange.bind(this));
```

**4. Update playElevenLabsAudio to Use Queue (line 955)**

Replace immediate playback with queue:

```typescript
private async playElevenLabsAudio(text: string): Promise<void> {
  if (!text.trim()) return;
  
  console.log('🎙️ ElevenLabs TTS (queued):', text.substring(0, 50) + '...');
  
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
    
    // Use unified queue for sequential playback (prevents overlap)
    if (this.audioQueue) {
      await this.audioQueue.addMP3(audioBlob, text);
    }
  } catch (error) {
    console.error('ElevenLabs TTS error:', error);
    this.onSpeakingChange(false);
  }
}
```

**5. Update Barge-In Handling in speech_started (line 739)**

Add Twilio-style barge-in logic:

```typescript
case 'input_audio_buffer.speech_started':
  // Debounce rapid speech events (matches Twilio pattern)
  const now = Date.now();
  if (now - this.lastSpeechStartTime < this.SPEECH_DEBOUNCE_MS) {
    console.log('[BARGE-IN] Debounced rapid speech event');
    break;
  }
  this.lastSpeechStartTime = now;
  
  console.log('🎤 Speech detected!');
  this.onListeningChange(true);
  
  // Clear audio queue and stop playback (unified for both PCM and MP3)
  if (this.audioQueue) {
    this.audioQueue.clearAndStop();
    console.log('[BARGE-IN] Cleared audio queue');
  }
  
  // Cancel any in-flight OpenAI response
  if (this.dc && this.dc.readyState === 'open') {
    this.dc.send(JSON.stringify({ type: 'response.cancel' }));
    console.log('[BARGE-IN] Sent response.cancel to OpenAI');
  }
  
  // Pause agenda for tangent (reuses existing agenda-manager)
  if (this.threadId && this.userId) {
    this.pauseAgendaForTangent('user interrupted');
  }
  
  // Emit events for UI
  this.onMessage({ type: 'speech.detected', detected: true });
  this.onMessage({
    type: 'transcript.interim',
    role: 'user',
    content: '',
    isListening: true
  });
  break;
```

**6. Add Agenda Pause Method (new method around line 880)**

```typescript
private async pauseAgendaForTangent(userQuery: string): Promise<void> {
  if (!this.threadId || !this.userId) return;
  
  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/agenda-manager`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_PUBLISHABLE_KEY,
          'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          operation: 'pause_for_tangent',
          threadId: this.threadId,
          userId: this.userId,
          userQuery
        })
      }
    );
    
    if (response.ok) {
      console.log('[AGENDA] Paused for tangent:', userQuery);
    }
  } catch (error) {
    console.error('[AGENDA] Failed to pause:', error);
  }
}
```

**7. Remove Duplicate Tracking (cleanup)**

Remove `activeElevenLabsAudio[]` array and related cleanup code since the AudioQueue now manages this:
- Remove line 228: `private activeElevenLabsAudio: HTMLAudioElement[] = [];`
- Remove cleanup in disconnect method (lines ~1197-1205)

---

## Summary of Changes

| Component | Before | After |
|-----------|--------|-------|
| AudioQueue | PCM only | PCM + MP3 unified |
| ElevenLabs playback | Immediate (causes overlap) | Sequential via queue |
| Barge-in handling | Logs only | Debounce + clearAndStop + response.cancel + agenda pause |
| Audio tracking | Separate `activeElevenLabsAudio[]` | Unified in AudioQueue |
| Agenda integration | Missing | Uses existing `agenda-manager` edge function |

---

## Key Pattern Reuse

| Pattern | Twilio Source | WebRTC Implementation |
|---------|---------------|----------------------|
| Speech debounce | `SPEECH_DEBOUNCE_MS = 300` | Same constant |
| Queue-based TTS | `isProcessingElevenLabsTTS` + `pendingTextBuffer` | Extended AudioQueue class |
| Barge-in clear | `sentenceBuffer = ''` + Twilio clear | `audioQueue.clearAndStop()` |
| Response cancel | `response.cancel` via WebSocket | Same via data channel |
| Agenda pause | `sharedAgendaManager.pauseForQuery()` | Direct call to `agenda-manager` edge function |

---

## Testing Plan

1. **Sequential playback test**: Ask a question requiring tool call (e.g., "What's on my calendar?")
   - Verify "Let me check" and answer play in sequence, not overlapping
   
2. **Barge-in test**: Start speaking while AI is talking
   - Verify audio stops immediately
   - Verify agenda pauses (check `conversation_agenda` table)
   
3. **Resume hint test**: After barge-in resolves, check if AI references original topic
   - Query `agenda-manager` with `get_resume_hint` operation
