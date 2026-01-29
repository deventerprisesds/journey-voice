

# Root Cause Analysis: VAD Not Detecting Speech End

## Summary

The logging confirms the exact issue. Comparing Cloudflare v5 with the Supabase bridge reveals a critical bug in the `speech_started` handler.

---

## Evidence from Activity Logs

```
cf_user_speech_started     → Fires 3 times (VAD detects speech)
cf_user_speech_stopped     → NEVER fires (VAD never detects end)
cf_transcription           → NEVER fires
cf_response_started        → NEVER fires
cf_call_summary            → messages_persisted: 0
```

The logs show VAD is detecting speech start but never detecting speech end.

---

## Root Cause: Unconditional `handleBargeIn()` on Speech Start

**Cloudflare v5 (BUGGY):**
```typescript
case 'input_audio_buffer.speech_started':
  console.log('[CF] User started speaking');
  await this.logActivityToSupabase('connected', 'cf_user_speech_started', {});
  this.handleBargeIn();  // ALWAYS sends response.cancel!
  break;
```

**`handleBargeIn()` does:**
```typescript
private handleBargeIn() {
  this.openaiWs?.send(JSON.stringify({ type: 'response.cancel' }));
  // ... clears buffers
}
```

This sends `response.cancel` to OpenAI on **every** `speech_started` event, even when:
- No AI response is playing
- We're waiting for user hello
- The call just started

This corrupts OpenAI's VAD state, preventing `speech_stopped` from ever firing.

---

## Supabase Bridge (CORRECT) - 5 Key Differences

```typescript
case "input_audio_buffer.speech_started":
  // 1. DEBOUNCE: Prevent rapid events
  const now = Date.now();
  if (now - lastSpeechStartTime < SPEECH_DEBOUNCE_MS) {
    break;
  }
  lastSpeechStartTime = now;
  
  // 2. HELLO-WAIT: Don't barge-in when waiting for greeting
  if (waitingForUserHello) {
    triggerPendingGreeting('vad');
    break; // DON'T treat as barge-in
  }
  
  // 3. ELEVENLABS MODE: Only clear buffer, NO response.cancel
  if (ttsProvider === 'elevenlabs') {
    twilioWs.send(JSON.stringify({ event: "clear", streamSid }));
    sentenceBuffer = '';
    isAiSpeaking = false;
    break; // NO response.cancel!
  }
  
  // 4. ONLY CANCEL IF AI IS SPEAKING
  if (isAiSpeaking && openaiWs?.readyState === WebSocket.OPEN) {
    // 5. Use truncate (preserves context) not cancel
    openaiWs.send(JSON.stringify({
      type: "conversation.item.truncate",
      item_id: currentResponseItemId,
      audio_end_ms: audioEndMs
    }));
  }
  break;
```

---

## Why `eagerness: 'low'` Works in Supabase

It's not about the VAD eagerness setting. Both bridges use `eagerness: 'low'`. The Supabase bridge works because it **doesn't corrupt OpenAI's state** with spurious `response.cancel` events.

---

## Fix Required

The `speech_started` handler in Cloudflare needs to match Supabase's logic:

### Step 1: Add Missing State Variables

```typescript
// Speech debounce
private lastSpeechStartTime: number = 0;
private readonly SPEECH_DEBOUNCE_MS = 300;

// Track if AI is speaking (for barge-in guard)
private isAiSpeaking: boolean = false;
```

### Step 2: Rewrite `speech_started` Handler

```typescript
case 'input_audio_buffer.speech_started':
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
  
  // 3. ElevenLabs mode: Only clear Twilio buffer, no response.cancel
  if (this.ttsProvider === 'elevenlabs' && !this.elevenlabsFallbackActive) {
    if (this.isAiSpeaking) {
      console.log('[CF] BARGE-IN: ElevenLabs mode - clearing Twilio buffer only');
      this.twilioWs?.send(JSON.stringify({
        event: 'clear',
        streamSid: this.streamSid
      }));
      this.textBuffer = '';
      this.isAiSpeaking = false;
    }
    break; // NO response.cancel for ElevenLabs!
  }
  
  // 4. OpenAI TTS mode: Cancel only if AI is speaking
  if (this.isAiSpeaking) {
    console.log('[CF] BARGE-IN: OpenAI mode - cancelling response');
    this.handleBargeIn();
  }
  break;
```

### Step 3: Set `isAiSpeaking` Flag Correctly

```typescript
case 'response.created':
  console.log('[CF] AI response started');
  this.isAiSpeaking = true;
  this.clearFillerTimers();
  await this.logActivityToSupabase('connected', 'cf_response_started', {});
  break;

case 'response.done':
  this.isPlaying = false;
  this.isAiSpeaking = false;
  break;

case 'response.text.done':
  // After text is done, AI is no longer speaking
  this.isAiSpeaking = false;
  // ... rest of handler
  break;
```

### Step 4: Version Bump

Update to `2026-01-29-cf-v6` for tracking.

---

## Files to Modify

| File | Changes |
|------|---------|
| `cloudflare/src/TwilioCallSession.ts` | Add state variables, rewrite speech_started handler, add isAiSpeaking guards |
| `cloudflare/src/index.ts` | Version bump to v6 |

---

## Verification After Deployment

Make a test call and check activity_log for the complete sequence:

```
Expected Flow:
cf_ws_start              → Twilio connected
cf_first_media_in        → Audio flowing
cf_openai_connect        → OpenAI ready
cf_session_configured    → semantic_vad, create_response:true
cf_greeting_success      → Greeting played
cf_user_speech_started   → VAD detected start (no spurious cancel)
cf_user_speech_stopped   → ✅ VAD detected end (NOW FIRES)
cf_transcription         → ✅ "Hello" transcribed (NOW FIRES)
cf_response_started      → ✅ AI responding (NOW FIRES)
cf_text_delta_first      → ✅ Text generation (NOW FIRES)
cf_tts_success           → ✅ Response audio (NOW FIRES)
cf_call_summary          → messages_persisted: 2+ (NO LONGER 0)
```

---

## Summary

The root cause is **NOT** the `eagerness: 'low'` setting. Both Supabase and Cloudflare use it successfully.

The issue is the unconditional `handleBargeIn()` call sending `response.cancel` to OpenAI on every `speech_started` event, corrupting the VAD state.

The fix is to match Supabase's logic:
1. Debounce rapid speech events
2. Don't barge-in when waiting for hello
3. For ElevenLabs, only clear Twilio buffer (no `response.cancel`)
4. Only send `response.cancel` if AI is actively speaking

