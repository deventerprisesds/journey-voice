# Technical Decision Log

**Last Updated**: 2026-03-06

Captures the "why" behind key architectural and implementation decisions. Organized chronologically with most recent first.

---

## Active Decisions

### D-012: Event-Driven Disconnect over Timeout-Based

**Date**: 2026-03 | **Area**: WebRTC Voice

**Decision**: Use WebRTC `hang_up` tool call and data channel close events to trigger disconnect, rather than inactivity timeouts.

**Context**: Early implementation used a timeout (30s of silence) to auto-disconnect voice sessions. This caused premature disconnections during long tool executions or when the user was thinking.

**Alternative considered**: Extending timeout to 60-120s. Rejected because it just moved the problem and wasted resources on abandoned sessions.

**Outcome**: `end_call` / `hang_up` tool defined in OpenAI session. When user says "goodbye" or similar, AI calls the tool → frontend receives the event → triggers graceful disconnect with farewell delay (`FAREWELL_DELAY_MS = 5000`). Data channel close event serves as backup.

---

### D-011: Echo Fingerprinting over Word-Count Thresholds

**Date**: 2026-02 | **Area**: Phone Voice (Barge-In)

**Decision**: Compare user transcript text against recent AI output to classify as echo vs. real interruption, instead of using word count or duration heuristics.

**Context**: Phone calls suffer from acoustic echo — the assistant's speech played through the phone speaker is picked up by the microphone and transcribed by Twilio's STT. Early approaches used:
1. **Word-count threshold**: Ignore transcripts < 3 words during AI speech. Failed because real one-word interruptions ("stop", "wait") were also discarded.
2. **Amplitude threshold only**: Check RMS energy of incoming audio. Failed because echo amplitude varies wildly by phone hardware and volume.
3. **Time-based suppression**: Ignore all speech during AI output + grace period. Failed because it made barge-in impossible.

**Solution**: Three-layer classification:
1. Text comparison: `aiOutputLower.includes(transcriptLower)` — is the transcript a substring of what the AI just said?
2. Noise pattern matching: Known filler words ("hmm", "uh", "hello") during active TTS → likely echo
3. Post-TTS grace window: Echos arriving within 500ms of TTS completion

**Tradeoff**: Requires accumulating the last ~300 chars of AI output (`lastAiOutputText`). Small memory cost, dramatic accuracy improvement.

---

### D-010: Cloudflare Durable Objects for Phone Calls

**Date**: 2026-01 | **Area**: Infrastructure

**Decision**: Run long-duration phone calls on Cloudflare Workers with Durable Objects instead of Supabase Edge Functions.

**Context**: Supabase Edge Functions (Deno Deploy) have a ~150 second execution timeout. Phone calls routinely exceed this, causing mid-call disconnections.

**Alternatives considered**:
1. **Supabase only**: Accept 150s limit, tell users to call back. Rejected — terrible UX for a voice-first product.
2. **Self-hosted server**: Run a Node.js server on Fly.io/Railway. Rejected — operational overhead, scaling concerns, added infrastructure.
3. **Cloudflare Durable Objects**: WebSocket-aware, no timeout, per-request billing, simple deployment.

**Outcome**: `TwilioCallSession` as a Durable Object handles the Twilio ↔ OpenAI bridge with identical logic to the Supabase bridge. User selects mode via `user_scheduling_prefs.phone_call_mode`.

**Tradeoff**: Three copies of voice config must be synchronized (`_shared/config.ts`, `src/config/voiceConfig.ts`, `cloudflare/src/config.ts`). Accepted as manageable with documented sync requirements.

---

### D-009: Dual TTS Pipeline (OpenAI Native + ElevenLabs)

**Date**: 2026-01 | **Area**: Voice Quality

**Decision**: Support both OpenAI's built-in TTS (via WebRTC/Realtime API audio track) and ElevenLabs TTS as a premium alternative.

**Context**: OpenAI Realtime API includes built-in TTS with several voices. ElevenLabs offers higher-quality, more natural voices but adds latency and complexity.

**Implementation**:
- **WebRTC**: When ElevenLabs is selected, mute the WebRTC audio track entirely (`audioEl.muted = true`, `track.enabled = false`). Text arrives via data channel `response.text.delta` events. Accumulated text is sent to `elevenlabs-tts` edge function which returns MP3. Played through unified `AudioQueue`.
- **Phone**: When ElevenLabs is selected, configure OpenAI with `modalities: ["text"]` only. Text streamed via `response.text.delta`, accumulated until sentence boundary (`SENTENCE_ENDERS` regex), then sent to `elevenlabs-tts` which returns μ-law audio for Twilio.

**Tradeoff**: ElevenLabs adds 200-500ms latency per sentence. Sentence buffering partially mitigates this. The `SENTENCE_ENDERS` regex (`/[.!?]+[\s"')\]]*$/`) detects natural speech boundaries to avoid mid-sentence TTS calls.

---

### D-008: Unified Thread Architecture

**Date**: 2026-01 | **Area**: Conversation Memory

**Decision**: One `ai_threads` row per user+assistant combination, shared across all communication modes (chat, voice, phone).

**Context**: Initially, each voice session and each chat session created their own thread. This meant:
- Voice conversations had no memory of chat discussions
- Phone call context was lost after the call
- Users had to repeat themselves across modes

**Implementation**: `useUnifiedThread` hook finds or creates a single thread per user+assistant. This `dbThreadId` is passed to:
- `hybrid-assistant-api` for chat (as `threadId` parameter)
- `RealtimeVoiceAssistant.connect()` for WebRTC voice
- `pre_connect_sessions` for phone calls

All modes write `conversation_messages` with the same `thread_id`, tagged with `source` ('chat', 'voice', 'phone', 'cloudflare_phone').

**Tradeoff**: Chat uses OpenAI Assistants API threads; voice/phone use Realtime API sessions. The OpenAI thread state (for Assistants API) is separate from the Realtime API session. Conversation continuity works through RAG context injection, not native thread sharing.

---

### D-007: Pre-Connect Session Architecture

**Date**: 2026-01 | **Area**: Phone Call Latency

**Decision**: Pre-compute user preferences, generate greeting audio, and cache everything in `pre_connect_sessions` table before Twilio connects.

**Context**: Without pre-connect, the first 3-5 seconds of a phone call were silent while the bridge:
1. Fetched user preferences from multiple tables
2. Loaded RAG context
3. Generated greeting text
4. Synthesized ElevenLabs audio
5. Connected to OpenAI

**Implementation**: `handlePreConnect()` runs before `Twilio.Call.create()`:
1. Parallel fetch: profile, TTS prefs, RAG context, default assistant, thread
2. Generate greeting text with time-based salutation
3. If ElevenLabs: pre-synthesize greeting audio (μ-law format)
4. Store everything in `pre_connect_sessions` with a `sessionId`
5. Pass `sessionId` as Twilio custom parameter
6. Bridge reads pre-connect data on WebSocket open — instant greeting playback

**Outcome**: Greeting plays within 500ms of user answering (vs. 3-5s without pre-connect).

---

### D-006: Centralized Tool Dispatch (execute-tool)

**Date**: 2026-01 | **Area**: Tool Architecture

**Decision**: All tool calls from all interfaces route through a single `execute-tool` edge function.

**Context**: Tools were initially duplicated across `twilio-voice-handler`, `twilio-realtime-bridge`, and `hybrid-assistant-api`. This caused feature drift — new tools added to chat wouldn't work on phone calls.

**Implementation**: `execute-tool` exposes:
- `GET /definitions` — returns tool schemas (cached by consumers)
- `POST /` — executes a named tool with args, userId, and context

All consumers (bridges, hybrid-assistant-api, conversation-relay-handler) fetch definitions from this endpoint and route tool calls through it.

**Tradeoff**: Adds one network hop per tool call. Acceptable because tool execution time (DB queries, API calls) dwarfs the HTTP overhead.

---

### D-005: SSE Streaming for Chat

**Date**: 2026-01 | **Area**: Chat UX

**Decision**: Use Server-Sent Events (SSE) for real-time token streaming from `hybrid-assistant-api`, with Supabase Realtime as a delivery backup.

**Context**: Initial chat implementation was request-response: user sends message, waits 3-8 seconds for full response. Poor UX.

**Implementation**:
- `hybrid-assistant-api` streams SSE events: `delta` (token), `thread_id`, `error`, `done`
- Frontend `CommsConsoleContext.sendMessage()` reads the SSE stream, accumulates tokens into a local message state
- After streaming completes, the full message is persisted to `conversation_messages`
- Supabase Realtime subscription on `conversation_messages` provides backup delivery and cross-tab sync

**Tradeoff**: SSE requires careful error handling for aborted streams. Heartbeat comments (`:keepalive`) prevent timeout disconnections.

---

### D-004: Sentence Buffering for ElevenLabs

**Date**: 2026-01 | **Area**: Phone Audio Quality

**Decision**: Buffer streaming text from OpenAI until a sentence boundary is detected before sending to ElevenLabs.

**Context**: Sending each `response.text.delta` token individually to ElevenLabs would result in fragmented, unnatural speech. Sending the entire response at once would add seconds of latency.

**Implementation**: `sentenceBuffer` accumulates text. When `SENTENCE_ENDERS` regex matches, the buffer is flushed to `sendElevenLabsTTS()`. The regex `/[.!?]+[\s"')\]]*$/` catches periods, exclamation marks, and question marks followed by optional closing punctuation.

**Tradeoff**: Introduces per-sentence latency (200-500ms for ElevenLabs API call + audio encoding). For most sentences this is acceptable. Very long sentences (no punctuation) delay output. The `response.text.done` event flushes any remaining buffer.

---

### D-003: Smart Filler Phrases During Tool Execution

**Date**: 2026-01 | **Area**: Phone UX

**Decision**: Play conversational filler phrases ("One moment...", "Let me check...") at escalating intervals during tool execution.

**Context**: Tool calls (database queries, web searches) take 2-5 seconds. Dead air on a phone call is confusing — users think the call dropped.

**Implementation**: `SmartFillerManager` schedules phrases at `[1500, 3500, 6000]ms` intervals. Each phrase is unique (no repeats of the last phrase). Delivered via the same TTS pipeline as regular speech.

**Tradeoff**: Fillers sometimes overlap with the AI's actual response if the tool returns faster than the first filler interval. Mitigated by `fillerManager.endTool()` which cancels pending timers.

---

### D-002: Presence-Aware Push Notifications

**Date**: 2026-02 | **Area**: Notifications

**Decision**: Only send push notifications when the user's browser tab is not visible (hidden).

**Context**: Users with the app open in a browser tab were receiving redundant push notifications for messages they could already see.

**Implementation**: `usePresenceTracking` hook uses the Visibility API (`document.visibilityState`). Before sending a push notification, the system checks presence state. If the user is actively viewing the app, the push is skipped and the message is delivered via Supabase Realtime instead.

**Tradeoff**: If the user has multiple tabs/devices, presence is only tracked for the current tab. A user could be "present" on their phone but "away" on desktop, resulting in inconsistent behavior. Accepted as good-enough for single-user product.

---

### D-001: React + Supabase + Edge Functions Architecture

**Date**: 2025-12 | **Area**: Platform

**Decision**: Build on Lovable's React + Vite + Supabase stack instead of a custom backend.

**Context**: The product needs real-time features (voice, live transcripts), persistent storage, authentication, and cron jobs. Options:
1. **Full custom backend** (Node.js/Python + database): Maximum control, maximum operational overhead
2. **Supabase**: Auth, Postgres, Realtime, Edge Functions, cron — all managed
3. **Firebase**: Similar feature set but less flexible for complex queries

**Outcome**: Supabase provides everything needed with minimal ops. Edge Functions (Deno) handle AI orchestration. The main limitation (150s timeout) was solved with Cloudflare Durable Objects for phone calls (D-010).

---

## Superseded Decisions

### SD-001: Word-Count Barge-In Classification (Superseded by D-011)

Initially used word count < 3 to filter echoes. Failed on real one-word commands.

### SD-002: Timeout-Based Disconnect (Superseded by D-012)

30s inactivity timeout caused premature disconnections during tool execution.

### SD-003: Per-Session Threads (Superseded by D-008)

Each voice/chat session created its own thread. No cross-mode memory.
