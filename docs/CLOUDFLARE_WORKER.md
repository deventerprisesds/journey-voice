# Cloudflare Worker — Twilio ↔ OpenAI Bridge

> **Last updated:** 2026-03-08  
> **Worker version:** `2026-02-10-cf-v8`  
> **Runtime:** Cloudflare Workers + Durable Objects  
> **Endpoint:** `wss://twilio-openai-bridge.purple-bush-495e.workers.dev/call`

---

## Why Cloudflare?

Supabase Edge Functions have a **~150s execution limit**, making them unsuitable for phone calls that can last 10+ minutes. Cloudflare Durable Objects have **no timeout**, providing unlimited call duration. See Decision Log D-010.

---

## Architecture

```
Twilio (8kHz μ-law) ←WebSocket→ Cloudflare DO ←WebSocket→ OpenAI Realtime API (24kHz PCM16)
                                      ↕
                              Supabase REST API
                           (logging, tools, TTS, profiles)
```

### Files

| File | Purpose |
|------|---------|
| `cloudflare/src/index.ts` | Worker entry point. Routes `/health` and `/call` (WebSocket upgrade). Creates unique Durable Object per call. |
| `cloudflare/src/TwilioCallSession.ts` | **2032-line Durable Object class.** Full call lifecycle: Twilio WS ↔ OpenAI WS, audio transcoding, TTS routing, tool execution, echo suppression, barge-in, agenda management. |
| `cloudflare/src/audio.ts` | G.711 μ-law codec, 8kHz↔24kHz resampling, RMS amplitude calculation. |
| `cloudflare/src/config.ts` | Copy of voice config from `supabase/functions/_shared/config.ts`. Must be kept in sync manually. |
| `cloudflare/wrangler.toml` | Worker config. Durable Object binding `CALL_SESSIONS`. |

### Environment Secrets

| Secret | Source |
|--------|--------|
| `SUPABASE_URL` | In `wrangler.toml` vars |
| `SUPABASE_SERVICE_KEY` | Cloudflare secret |
| `OPENAI_API_KEY` | Cloudflare secret |

---

## Call Lifecycle

### 1. Connection (`handleStart`)
- Twilio sends `start` event with `streamSid`, `callSid`, `customParameters`
- Custom params: `userId`, `timezone`, `direction`, `sessionId`
- If `sessionId` provided → fetch **pre-connect session** from Supabase (one-time use, deleted after retrieval)
- Pre-connect session contains: TTS provider, voice ID, cached greeting audio, instructions, RAG context, thread ID
- Fallback: load user voice prefs + profile + tool definitions fresh

### 2. OpenAI Session Configuration (`configureSession`)
- **ElevenLabs mode:** modalities = `['text']` (text-only, TTS handled externally)
- **OpenAI TTS mode:** modalities = `['text', 'audio']`
- VAD: `semantic_vad` with `eagerness: 'low'`, `create_response: true`
- Transcription model: `gpt-4o-mini-transcribe`
- Tools loaded from `execute-tool/definitions` endpoint

### 3. Greeting
Three paths, in priority order:
1. **Cached audio** → Play pre-synthesized μ-law directly to Twilio (lowest latency)
2. **ElevenLabs live** → Synthesize greeting text via `elevenlabs-tts` edge function
3. **OpenAI TTS** → Use `response.create` with audio modality

After greeting, injects system context telling OpenAI to skip step 1 (greeting already done) and continue from step 2 of the agenda.

### 4. Audio Pipeline (`handleMedia`)
```
Twilio μ-law → decodeMulaw → pcm8k → upsample8to24 → pcm24k → base64 → OpenAI input_audio_buffer.append
OpenAI audio.delta → base64ToInt16 → pcm24k → downsample24to8 → pcm8k → encodeMulaw → Twilio media event
```

### 5. ElevenLabs TTS Pipeline (`handleTextDelta` → `sendToElevenLabs`)
- OpenAI generates text deltas (text-only modality)
- Buffer text until sentence boundary detected (`SENTENCE_ENDERS` regex)
- Send sentence to `elevenlabs-tts` edge function → returns base64 μ-law
- Stream μ-law chunks to Twilio in 640-byte (80ms) chunks
- Set echo suppression window for duration of playback

### 6. Tool Execution (`handleFunctionCall`)
- Parse function call arguments
- `hang_up` handled locally (close connections after farewell delay)
- All other tools → `execute-tool` edge function via REST
- Result sent back to OpenAI as `function_call_output`

### 7. Cleanup
- Logs call summary with telemetry (duration, echo stats, agenda progress)
- Closes both WebSockets
- Resets all state

---

## Echo Suppression

Three-layer system:

| Layer | Mechanism | Threshold |
|-------|-----------|-----------|
| **RMS amplitude** | Discard low-amplitude frames during playback | `ECHO_THRESHOLD = 1500` |
| **Time window** | `isSendingTtsAudio` flag + `ttsAudioEndTime` with 500ms grace period | `TTS_ECHO_GRACE_PERIOD_MS = 500` |
| **Barge-in detection** | High amplitude during playback triggers interrupt | `BARGE_IN_THRESHOLD = 3000` |

---

## Barge-In Handling

### OpenAI TTS Mode
Uses `conversation.item.truncate` (preserves VAD state) with fallback to `response.cancel`.

### ElevenLabs Mode (v8)
Six-step interrupt sequence:
1. Clear Twilio audio buffer (`event: 'clear'`)
2. Send `response.cancel` to OpenAI (stop text generation)
3. Set `bargeInActive = true` (discard late-arriving TTS chunks)
4. Clear text buffers and speaking flags
5. Pause agenda for tangent tracking
6. Delayed second Twilio clear + flag reset (300ms catches late audio chunks)

---

## Agenda Manager (Phase 7-8)

Parses numbered agenda items from call context. Tracks state per item:
- `pending` → `in_progress` → `completed`
- `paused` (when user barges in with tangent)

On `response.done`, if agenda was paused for tangent → injects `[RESUME]` system message to guide OpenAI back to the agenda.

---

## Outbound Hello-Wait (Phase 6)

For outbound calls, waits for user speech before greeting:
- Sets `waitingForUserHello = true`
- Fallback timer: `OUTBOUND_HELLO_WAIT_MS` (2000ms)
- Triggered by either VAD `speech_started` event or RMS amplitude detection

---

## ElevenLabs Fallback

If ElevenLabs TTS fails (HTTP error or missing audio field):
1. Switch to OpenAI audio modality
2. Notify user: "I'm having trouble with my premium voice, switching to backup"
3. Set `elevenlabsFallbackActive = true` so `audio.delta` events are processed
4. Re-send original text through OpenAI TTS

---

## Logging & Telemetry

All activity logged to Supabase via REST:
- `activity_log` — stage-by-stage call progression
- `error_log` — structured errors with context
- `conversation_messages` — user/assistant transcripts with `source: 'cloudflare_phone'`
- Structured attempt tracking for greeting, TTS, tool calls, session config

Call summary includes: duration, echo filtered count, media frame counts, agenda progress.

---

## Deployment

```bash
cd cloudflare
npx wrangler deploy
npx wrangler secret put SUPABASE_SERVICE_KEY
npx wrangler secret put OPENAI_API_KEY
```

CI/CD: `.github/workflows/deploy-cloudflare.yml`

Pre-flight checklist: `cloudflare/PREFLIGHT_CHECKLIST.md`
