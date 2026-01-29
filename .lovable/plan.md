
# Root Cause Analysis: Call Silence After Greeting

## Problem Identified

The user reported that Twilio calls work for the greeting but then go silent - the AI doesn't respond after the user speaks.

## Investigation Findings

### Timeline Analysis (Call CAe156a725ca523ace5eabae5a9d17bc16)
```text
15:08:59.073  cf_ws_start - WebSocket connected
15:09:00.444  cf_greeting_success - ElevenLabs greeting played (15233 bytes)
15:09:05.401  cf_user_speech_started - User started speaking
15:09:16.973  cf_disconnect - Call ended (18 seconds total)
```

**Missing Events:**
- No `cf_response_started` (OpenAI never started responding)
- No `cf_text_delta_first` (no text generation occurred)
- No `cf_transcription` (user speech wasn't transcribed)

### Key Metrics from Call Summary
| Metric | Value | Problem |
|--------|-------|---------|
| `twilio_frames_in` | 880 | Audio came in from phone |
| `echo_filtered_count` | 807 | 92% was filtered as "echo"! |
| `openai_appends` | 47 | Only 5% reached OpenAI |
| `twilio_frames_out` | 0 | No response audio sent |

### Root Cause: `isPlaying` Flag Never Cleared

In `cloudflare/src/TwilioCallSession.ts`:

1. **Line 1195**: `sendToElevenLabs()` sets `this.isPlaying = true`

2. **Line 1266-1272**: The setTimeout only clears `isSendingTtsAudio` and `isAiSpeaking`:
   ```typescript
   setTimeout(() => {
     this.isSendingTtsAudio = false;
     this.isAiSpeaking = false;
     // BUG: isPlaying is NOT cleared here!
   }, estimatedDurationMs + this.TTS_ECHO_GRACE_PERIOD_MS);
   ```

3. **Line 1380**: Echo suppression filter uses `isPlaying`:
   ```typescript
   if ((this.isPlaying || inEchoWindow) && rms < this.ECHO_THRESHOLD) {
     this.echoFilteredCount++;  // Filters out user audio!
     return;
   }
   ```

4. **Result**: Since `isPlaying` stays `true` forever, 92% of user audio is filtered as "echo" and never reaches OpenAI, so no response is generated.

---

## Solution

Add `this.isPlaying = false` to the setTimeout cleanup in `sendToElevenLabs()`:

```typescript
// v7: Clear ALL echo suppression flags after audio duration
setTimeout(() => {
  if (this.isSendingTtsAudio && Date.now() >= this.ttsAudioEndTime - 50) {
    this.isSendingTtsAudio = false;
    this.isAiSpeaking = false;
    this.isPlaying = false;  // CRITICAL: Clear this too!
    console.log('[CF] Echo suppression cleared after ElevenLabs playback');
  }
}, estimatedDurationMs + this.TTS_ECHO_GRACE_PERIOD_MS);
```

Also need to add the same fix to the cached greeting path (line 1048-1053).

---

## Files to Modify

| File | Change |
|------|--------|
| `cloudflare/src/TwilioCallSession.ts` | Add `this.isPlaying = false` in both setTimeout callbacks for ElevenLabs audio cleanup |
| `cloudflare/src/index.ts` | Version bump to v7e |
| `.github/workflows/deploy-cloudflare.yml` | Update EXPECTED_VERSION to v7e |

---

## Additional Fix: Track `twilioMediaFramesOut`

While investigating, I noticed `twilio_frames_out` is always 0 because the counter is never incremented. This is a telemetry bug that should also be fixed for debugging visibility.

---

## Expected Result After Fix

1. ElevenLabs greeting plays normally
2. `isPlaying` clears after greeting audio duration + 500ms grace period
3. User audio is no longer filtered as echo
4. OpenAI receives the full audio, generates transcription, and responds
5. ElevenLabs synthesizes and streams the response back to Twilio

---

## Technical Details

### Echo Suppression Flow (Current - Broken)
```text
sendToElevenLabs() → isPlaying = true
setTimeout() → clears isSendingTtsAudio, isAiSpeaking (NOT isPlaying)
handleMedia() → (isPlaying=true) && (rms < 1500) → FILTER as echo forever
```

### Echo Suppression Flow (Fixed)
```text
sendToElevenLabs() → isPlaying = true
setTimeout() → clears isSendingTtsAudio, isAiSpeaking, AND isPlaying
handleMedia() → (isPlaying=false) → audio passes through to OpenAI
```
