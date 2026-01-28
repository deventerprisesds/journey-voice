
Goal
- Fix “same problem” on Twilio calls when phone_call_mode=cloudflare + tts_provider=elevenlabs by correcting ElevenLabs audio handling and ensuring the pre-connect greeting audio is actually used.
- Confirm ElevenLabs TTS support exists (it does) and make it work end-to-end for Cloudflare mode.
- Add comprehensive, end-to-end error/activity logging for Cloudflare calls (currently missing), matching the existing WebRTC + Supabase-bridge logging approach.

What I found (root causes)
1) Cloudflare Worker is reading the wrong pre_connect_sessions field names
- pre_connect_sessions schema (confirmed): audio_base64, voice_id, tts_provider, instructions, rag_context, thread_id, etc.
- Cloudflare worker expects: cached_audio_base64 and elevenlabs_voice_id.
- Result: cached greeting audio never plays (because audio_base64 isn’t mapped), and ElevenLabs voice ID isn’t applied (voice_id isn’t mapped).

2) Cloudflare Worker’s ElevenLabs TTS integration is incompatible with our elevenlabs-tts edge function
- Cloudflare worker currently calls:
  - POST /functions/v1/elevenlabs-tts with { text, voiceId, outputFormat: 'ulaw_8000' }
  - then treats the HTTP response as raw μ-law bytes (arrayBuffer) and streams it to Twilio.
- But our Supabase edge function elevenlabs-tts (current code you pasted) returns:
  - For ulaw: JSON { audio: "<base64>", format: "ulaw_8000", ... } (NOT raw bytes)
  - For mp3: raw binary audio/mpeg
- Result: when tts_provider=elevenlabs (your current prefs), Cloudflare is effectively streaming JSON bytes as audio → silence/garbled audio and “call feels broken.”

3) Logging gap: Cloudflare mode has no comprehensive DB logging
- WebRTC mode logs to activity_log + error_log (confirmed in src/utils/RealtimeVoiceAssistant.ts).
- Supabase Media Streams bridge logs to activity_log + error_log (confirmed in supabase/functions/twilio-realtime-bridge/index.ts).
- Cloudflare worker logs only to Cloudflare console; nothing lands in Supabase activity_log/error_log → you get “same problem” without enough telemetry to pinpoint where it fails.

Plan (implementation)
A) Fix pre-connect session field mapping in Cloudflare worker
Files: cloudflare/src/TwilioCallSession.ts
- When a pre-connect session is retrieved, map both “new” and “old” names defensively:
  - cachedAudioBase64 should be set from:
    - session.audio_base64 (primary, matches DB)
    - OR session.cached_audio_base64 (fallback if ever present)
  - elevenlabsVoiceId should be set from:
    - session.voice_id (primary, matches DB)
    - OR session.elevenlabs_voice_id (fallback)
- Keep existing behavior for:
  - instructions, greeting_text, rag_context, thread_id (these already match DB and should work)

Expected outcome:
- Calls can immediately play the pre-generated ElevenLabs greeting audio stored in pre_connect_sessions.audio_base64 (no OpenAI round-trip required for the greeting).

B) Fix ElevenLabs TTS streaming in Cloudflare worker to match elevenlabs-tts edge function output
Files: cloudflare/src/TwilioCallSession.ts
- Update sendToElevenLabs() to:
  1) Call elevenlabs-tts with the correct parameter name:
     - send { text, voiceId: this.elevenlabsVoiceId, format: "ulaw" }
     - remove outputFormat (not used by the function)
  2) Parse the JSON response:
     - const { audio } = await response.json()
     - base64-decode “audio” into Uint8Array of μ-law bytes
  3) Stream μ-law bytes to Twilio in 640-byte chunks (existing chunk logic is fine)
- Add strict validation:
  - If JSON is missing audio, treat as failure and trigger fallback.

Expected outcome:
- ElevenLabs speech during the call is now valid μ-law audio and plays correctly.

C) Make fallback behavior explicit (per your “no silent fallback” requirement)
Files: cloudflare/src/TwilioCallSession.ts
- Today: on ElevenLabs failure, we silently fall back to OpenAI TTS.
- Update fallback path to explicitly inform the user before switching voices:
  - Example: “I’m having trouble with my premium voice right now, switching to a backup voice.”
- Ensure the message is played even if ElevenLabs is down:
  - Use OpenAI audio mode for that sentence and then continue.

Expected outcome:
- Users hear a clear explanation whenever the voice changes; debugging is easier and behavior matches your preference.

D) Add comprehensive “initialization through teardown” logging for Cloudflare mode
Files: cloudflare/src/TwilioCallSession.ts (and possibly cloudflare/src/index.ts for versioning)
Add two helper methods in the worker:
- logActivityToSupabase(status, stage, metadata)
- logErrorToSupabase(error_type, error_message, context)

Implementation approach:
- Use Supabase REST with the service role key the worker already has:
  - POST/patch to /rest/v1/activity_log
  - POST to /rest/v1/error_log
- Key identifiers:
  - session_id: use callSid (from start.callSid) as the stable call identifier
  - user_id: use params.userId when available (it is already passed via TwiML <Parameter>)
  - activity_type: “phone_outbound” or “phone_inbound” (use params.direction)
- Stages to log (minimum viable):
  - cf_ws_start (on Twilio “start”)
  - cf_preconnect_fetch (success/failure + http status)
  - cf_openai_connect (ws open / ws error)
  - cf_session_configured (after session.update)
  - cf_greeting_sent (cached audio vs OpenAI-generated)
  - cf_elevenlabs_tts (per sentence: bytes, latency if available)
  - cf_disconnect (on stop/close)
- On any caught exception:
  - write to error_log with version + stack + stage + callSid/userId
  - update activity_log status=error and set error_message/error_code

Expected outcome:
- You can query activity_log/error_log and see exactly where Cloudflare calls fail, matching the visibility you already have for WebRTC and Supabase bridge.

E) Make Cloudflare deployment verifiable (to prevent “health shows old version” confusion)
Files: cloudflare/src/index.ts and .github/workflows/deploy-cloudflare.yml
- Update /health response version string to a new version (e.g., 2026-01-28-cf-v2).
- Strengthen the GitHub Actions health check step to assert the expected version is present in the /health output (not just status ok).

Expected outcome:
- If GitHub Actions says “deployed,” we can confirm the running worker actually updated.

How we’ll verify (end-to-end)
1) Trigger a test call (scheduled-call or manual) while phone_call_mode=cloudflare and tts_provider=elevenlabs.
2) On call start, confirm:
   - You immediately hear the pre-cached greeting (no initial silence).
   - Subsequent assistant speech sounds correct (not garbled).
3) Confirm DB telemetry:
   - activity_log has a new record for the callSid with stages progressing through initialization and completion.
   - error_log remains empty for that session (or contains precise failures if something still breaks).
4) If ElevenLabs is intentionally broken (e.g., invalid key) or rate-limited:
   - You hear an explicit “premium voice failed” message before switching to OpenAI voice.

Files to change
- cloudflare/src/TwilioCallSession.ts
  - Fix pre_connect_sessions field mapping (audio_base64/voice_id)
  - Fix ElevenLabs response parsing (JSON → base64 decode → μ-law bytes)
  - Add explicit fallback announcement
  - Add Supabase activity_log/error_log writes for cloudflare mode
- cloudflare/src/index.ts
  - Bump /health version string
- .github/workflows/deploy-cloudflare.yml
  - Verify /health includes expected version (optional but strongly recommended)

Notes on ElevenLabs TTS support (direct answer)
- Yes, ElevenLabs TTS support exists:
  - Supabase edge function: supabase/functions/elevenlabs-tts/index.ts (implemented)
  - Cloudflare worker: has ElevenLabs mode + sentence buffering, but it is currently wired incorrectly (expects raw bytes, but function returns JSON base64). This is why it behaves like “same problem.”

Notes on comprehensive logging (direct answer)
- WebRTC: yes (activity_log + error_log are implemented and used).
- Supabase Media Streams bridge: yes (activity_log + error_log are implemented and used).
- Cloudflare call path: not currently comprehensive; we will add it as part of this fix so “initialization through end” is visible in Supabase.

Risks / edge cases we will handle
- Pre-connect session missing or expired:
  - Log stage and fall back to “load prefs fresh” path, but still log everything.
- ElevenLabs response format changes or partial failures:
  - Validate JSON shape and fall back safely with explicit user notification.
- Large audio payloads:
  - Continue chunked streaming (640 bytes) and avoid buffering massive payloads in memory longer than needed.
