
# Fix Plan: Transcription Display, Duplicate Saves, and Audio Routing

## Issues Identified

### 1. Duplicate Assistant Transcripts (Repeated Answers)
**Root Cause:** Two separate events both call `saveTranscript('assistant', ...)`:
- `response.text.done` (line 799-810) - used for ElevenLabs text-only mode
- `response.audio_transcript.done` (line 890-898) - used for OpenAI native audio mode

When using OpenAI native audio (non-ElevenLabs), BOTH events fire, causing duplicate DB saves and repeated answers in UI.

### 2. Out of Order Responses
**Root Cause:** Same as above - duplicate saves arrive at different times, causing interleaving.

### 3. User Speech Not Showing in Live Transcript Panel
**Root Cause:** The `conversation.item.input_audio_transcription.completed` event (line 871-877) saves to database but does NOT emit a `transcript.interim` event for the UI. The LiveTranscriptPanel only receives an empty `content: ''` when speech starts.

### 4. Ear Mode (Earpiece) Not Working
**Root Cause:** Browser limitation - HTML5 Audio API and AudioContext cannot route audio to earpiece vs speaker. Mobile browsers don't support `setSinkId()`. The only way to get earpiece routing is through:
- Native phone call (Twilio mode) - OS handles routing
- WebRTC audio track connected directly to `<audio>` element (not via AudioContext)

---

## Technical Fixes

### File: `src/utils/RealtimeVoiceAssistant.ts`

**Fix 1: Prevent Duplicate Assistant Transcript Saves**

Update `response.text.done` handler to ONLY save when using ElevenLabs:
```typescript
case 'response.text.done':
  // ElevenLabs mode: text.done contains the response - save and play TTS
  if (this.ttsProvider === 'elevenlabs' && event.text) {
    console.log('📝 Saving assistant transcript (ElevenLabs text.done):', event.text.substring(0, 100) + '...');
    this.saveTranscript('assistant', event.text);
    this.playElevenLabsAudio(event.text);
  }
  // OpenAI native mode: DO NOT save here - audio_transcript.done handles it
  break;
```

The `response.audio_transcript.done` handler (line 890-898) already correctly saves for OpenAI native mode - leave it unchanged.

**Fix 2: Show User Speech in Live Transcript Panel**

Update `conversation.item.input_audio_transcription.completed` handler to emit interim transcript:
```typescript
case 'conversation.item.input_audio_transcription.completed':
  // User speech transcript from Whisper
  console.log('📝 User transcript:', event.transcript);
  if (event.transcript?.trim()) {
    // CRITICAL: Emit interim for live transcript display BEFORE saving
    this.onMessage({
      type: 'transcript.interim',
      role: 'user',
      content: event.transcript,
      isListening: false  // Speech is done, show the text
    });
    
    // Save to database
    this.saveTranscript('user', event.transcript);
  }
  break;
```

**Fix 3: Audio Routing for Earpiece Mode**

The WebRTC audio arrives on a `MediaStreamTrack`. Currently we're using AudioContext for OpenAI native audio and HTMLAudioElement for ElevenLabs. To enable earpiece routing on mobile:

Option A (Recommended): Use the existing `audioEl` (`<audio>` element) that's already connected to the WebRTC track:
```typescript
// In connect method, around line 620
// The audio element already receives WebRTC track - just ensure it's not muted
if (this.audioEl && !this.ttsProvider !== 'elevenlabs') {
  this.audioEl.muted = false; // Use WebRTC native audio path
}
```

Option B: For ElevenLabs MP3 playback, attempt `setSinkId` if available:
```typescript
private async playMP3(blob: Blob): Promise<void> {
  const audioUrl = URL.createObjectURL(blob);
  const audio = new Audio(audioUrl);
  this.currentAudio = audio;
  
  // Attempt earpiece routing if browser supports it (most mobile don't)
  if ('setSinkId' in audio && this.preferredAudioOutput) {
    try {
      await (audio as any).setSinkId(this.preferredAudioOutput);
    } catch (e) {
      console.log('setSinkId not supported on this device');
    }
  }
  // ... rest unchanged
}
```

**Note:** True earpiece-only routing on mobile requires using the Twilio phone mode, which goes through the OS phone stack.

---

## Summary of Changes

| Issue | Fix | Location |
|-------|-----|----------|
| Duplicate transcripts | Only save in `text.done` for ElevenLabs mode | Line 799-810 |
| Out of order | Same fix - prevents duplicate race conditions | Line 799-810 |
| User speech not shown | Emit `transcript.interim` in `input_audio_transcription.completed` | Line 871-877 |
| Earpiece audio | Document limitation; ensure `audioEl` not muted for WebRTC track | Line 620, Line 175-200 |

---

## Testing Plan

1. **Duplicate transcript test**: Ask a question, verify only ONE entry appears in `conversation_messages` for the assistant response
2. **User transcript display**: Speak and verify your words appear in the Live Transcription panel
3. **Order test**: Ask multiple questions rapidly, verify responses are in correct sequence
4. **Audio output**: Test with speakerphone toggle - note that earpiece may not work due to browser limitations (suggest using Twilio phone mode for earpiece)
