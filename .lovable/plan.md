

# Implementation: Fix Assistant Transcript Saving for Voice Sessions

## Change Summary

Add `saveTranscript('assistant', event.text)` to the `response.text.done` event handler so that assistant responses are persisted to the database when using ElevenLabs TTS mode.

## File to Modify

**`src/utils/RealtimeVoiceAssistant.ts`** - Line 726-731

## Current Code

```typescript
case 'response.text.done':
  // ElevenLabs mode: send text to TTS and play MP3
  if (this.ttsProvider === 'elevenlabs' && event.text) {
    this.playElevenLabsAudio(event.text);
  }
  break;
```

## Updated Code

```typescript
case 'response.text.done':
  // ElevenLabs mode: send text to TTS and play MP3
  if (this.ttsProvider === 'elevenlabs' && event.text) {
    this.playElevenLabsAudio(event.text);
    // CRITICAL FIX: Save assistant transcript to database
    // In text-only mode (ElevenLabs), this event contains the full response
    console.log('📝 Saving assistant transcript (text mode):', event.text.substring(0, 100) + '...');
    saveTranscript('assistant', event.text);
  }
  break;
```

## Why This Works

| Mode | Event | Transcript Saved |
|------|-------|-----------------|
| Audio mode | `response.audio_transcript.done` | Already works |
| Text mode (ElevenLabs) | `response.text.done` | Now fixed |

## Expected Outcome

After this fix, the `conversation_messages` table will contain both user AND assistant messages for WebRTC voice sessions, matching the behavior of Phone and Chat modes.

