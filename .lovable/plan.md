
# Fix Phone Call Silence: OpenAI Session State After ElevenLabs Greeting

## ✅ IMPLEMENTED (v7f)

### Changes Made

1. **System Context Injection** (`TwilioCallSession.ts:1083-1116`)
   - After ElevenLabs greeting, inject a system message telling OpenAI what was said and to wait for user response
   - Includes timestamp and RAG context if available

2. **Explicit Buffer Commit** (`TwilioCallSession.ts:817-831`)
   - On `input_audio_buffer.speech_stopped`, explicitly send `input_audio_buffer.commit`
   - Ensures transcription triggers even if semantic_vad doesn't auto-trigger

3. **Diagnostic Event** (`TwilioCallSession.ts:833-836`)
   - Added `input_audio_buffer.committed` handler
   - Logs `cf_buffer_committed` for debugging visibility

4. **Version Bump**
   - `cloudflare/src/index.ts`: v7f
   - `cloudflare/src/TwilioCallSession.ts`: v7f
   - `.github/workflows/deploy-cloudflare.yml`: v7f

## Expected Event Flow After Fix

```text
cf_greeting_attempted → cf_greeting_success → cf_user_speech_started → 
cf_user_speech_stopped (buffer_committed: true) → cf_buffer_committed → 
cf_transcription → cf_response_started → cf_text_delta_first → User hears AI
```

## Testing Plan

1. Push to main to trigger GitHub Actions deployment
2. Make a phone call
3. Speak after greeting
4. Check `activity_log` for:
   - `cf_buffer_committed` (confirms audio was committed)
   - `cf_transcription` (confirms OpenAI transcribed user speech)
   - `cf_response_started` (confirms OpenAI is responding)

If `cf_buffer_committed` appears but `cf_transcription` doesn't, the issue is deeper in OpenAI's text-only mode handling.
