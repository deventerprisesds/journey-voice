
# Fix Dual-Voice Playback with WebRTC Track Muting

## Summary

Prevent OpenAI's native voice from playing when ElevenLabs is the TTS provider by disabling the WebRTC audio track AND muting the audio element.

---

## Root Cause

OpenAI's Realtime API sends audio via the WebRTC media track regardless of the `modalities` setting. Since the `audioEl` has `autoplay: true`, OpenAI's voice plays immediately while ElevenLabs synthesis is still processing - causing dual voices.

---

## Changes

### File: `src/utils/RealtimeVoiceAssistant.ts`

#### 1. Mute Audio Element After TTS Config Load (Lines 254-258)

Add audio muting immediately after storing the TTS configuration:

```typescript
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
```

#### 2. Disable Track + Preserve Mute in ontrack Handler (Lines 275-278)

Update the `ontrack` handler to disable the track at the WebRTC level and preserve mute state:

```typescript
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
```

---

## Why Both Approaches?

| Mechanism | Purpose |
|-----------|---------|
| `audioEl.muted = true` | Mutes the HTML audio element (browser-level) |
| `audioTrack.enabled = false` | Disables audio at the WebRTC track level (stops processing) |

Using both provides defense-in-depth: if one mechanism fails or is reset by browser behavior, the other still prevents audio playback.

---

## Audio Flow After Fix

```
User speaks → OpenAI processes → Response generated
                                      ↓
              ┌───────────────────────┴───────────────────────┐
              ↓                                               ↓
      [OpenAI Mode]                                  [ElevenLabs Mode]
              ↓                                               ↓
   audioEl plays RTC audio                   track.enabled = false
   (normal behavior)                         audioEl.muted = true
                                                      ↓
                                             NO OpenAI audio heard
                                                      ↓
                                             response.text.done triggers
                                                      ↓
                                             playElevenLabsAudio() → MP3 plays
                                                      ↓
                                             ONLY ElevenLabs voice heard
```

---

## Files to Modify

| File | Lines | Changes |
|------|-------|---------|
| `src/utils/RealtimeVoiceAssistant.ts` | 254-258 | Add audioEl.muted logic after TTS config |
| `src/utils/RealtimeVoiceAssistant.ts` | 275-278 | Add track.enabled = false + preserve mute in ontrack |

---

## Expected Outcome

After this fix:
- Voice Orb: Only ElevenLabs voice heard (correct voice)
- Phone Dialer (in-app): Single voice playback
- Disconnect command: Only one farewell message
- Console logs will show muting status for debugging
