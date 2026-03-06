# Voice System Documentation

**Last Updated**: 2026-03-06

---

## Overview

The voice system supports three distinct audio paths, all sharing the same AI persona ("Iris") and conversation memory:

1. **WebRTC (browser)** — Direct browser ↔ OpenAI Realtime API via RTCPeerConnection
2. **Twilio Media Streams (phone)** — Twilio ↔ Bridge ↔ OpenAI Realtime API via WebSocket
3. **Twilio ConversationRelay (phone)** — Twilio-managed STT/TTS pipeline with Chat Completions

---

## Path 1: WebRTC (Browser Voice)

### Connection Flow

```
1. User clicks VoiceOrb → connectToAssistant()
2. VoiceAssistantContext creates RealtimeVoiceAssistant instance
3. Instance tracking: globalInstanceCounter++, activeInstances.set()
4. Generate session ID: WR{timestamp36}{random}
5. Get user from supabase.auth.getUser()
6. Invoke generate-realtime-token edge function
   → Returns: ephemeral key, TTS config (provider + voice ID), userName
7. Determine TTS mode:
   - OpenAI: audioEl.muted = false, use WebRTC audio track
   - ElevenLabs: audioEl.muted = true, track.enabled = false
8. Initialize/find unified thread (useUnifiedThread or create standalone)
9. Create AudioContext at 24kHz, initialize AudioQueue
10. RTCPeerConnection setup:
    - ontrack: attach remote audio (muted if ElevenLabs)
    - getUserMedia: echo cancellation + noise suppression + auto gain
    - createDataChannel("oai-events")
11. SDP offer → POST to api.openai.com/v1/realtime?model=gpt-4o-realtime-preview
12. Set remote SDP answer
13. Data channel opens → send greeting after 100ms
```

### TTS Pipeline (Dual Mode)

**OpenAI Native TTS:**
- Audio arrives via WebRTC audio track (e.streams[0])
- Played through HTMLAudioElement directly
- Speaking state tracked via `response.audio.delta` / `response.audio.done` events

**ElevenLabs TTS:**
- WebRTC audio track muted at both HTMLAudioElement and RTCTrack level
- Text arrives via `response.text.delta` data channel events
- Accumulated in `accumulatedAssistantText`
- Sent to `elevenlabs-tts` edge function (returns MP3)
- Queued in unified `AudioQueue` for sequential playback
- Queue supports both PCM (OpenAI) and MP3 (ElevenLabs) items

### Barge-In Handling (WebRTC)

WebRTC barge-in is simpler than phone:
1. User speech detected → `input_audio_buffer.speech_started` event
2. `AudioQueue.clearAndStop()` — stops current playback immediately
3. AI generates new response naturally via VAD

### Greeting System

```
Data channel opens
  → 100ms delay (audio context already resumed)
  → sendGreeting()
    → Check hasGreeted flag (prevents duplicates)
    → If agenda loaded and paused: send resume hint
    → Otherwise: inject system message with time-based greeting + userName
    → Create response (OpenAI generates audio/text greeting)
```

### Transcript Persistence

- User speech: captured via `conversation.item.input_audio_transcription.completed`
- Uses `userSpeechStartTime` (captured at `speech_started`) for correct chronological ordering
- Assistant speech: accumulated from `response.text.delta` or `response.audio_transcript.delta`
- Both saved to `conversation_messages` via Supabase with source='voice'

### Disconnect Flow

```
disconnect() called
  → Set isDisconnecting = true (prevents new audio queuing)
  → Stop AudioRecorder (release microphone)
  → Close AudioContext
  → Close RTCDataChannel
  → Close RTCPeerConnection
  → Remove from activeInstances map
  → Log activity 'completed' with duration and message count
  → Call onConnectionChange(false)
```

---

## Path 2: Twilio Media Streams (Phone)

### Call Initiation (Outbound)

```
1. notification-delivery cron fires
2. Invokes twilio-voice-handler with action='trigger-call-with-session'
3. Pre-connect phase:
   a. Fetch user profile, TTS prefs, RAG context, default assistant
   b. Find/create unified thread (ai_threads)
   c. Generate time-based greeting text
   d. If ElevenLabs: pre-synthesize greeting → μ-law audio (cached)
   e. Store all data in pre_connect_sessions table
4. Generate TwiML:
   <Response>
     <Connect>
       <Stream url="wss://bridge-endpoint">
         <Parameter name="userId" value="..." />
         <Parameter name="sessionId" value="..." />
         <Parameter name="direction" value="outbound" />
         <Parameter name="timezone" value="..." />
         <Parameter name="context" value="..." />
       </Stream>
     </Connect>
   </Response>
5. Twilio calls user's phone
6. WebSocket connects to bridge (Supabase or Cloudflare)
```

### Bridge Architecture

Both Supabase (`twilio-realtime-bridge`) and Cloudflare (`TwilioCallSession`) implement the same pattern:

```
Twilio WebSocket ←→ Bridge ←→ OpenAI Realtime API WebSocket

Twilio sends: { event: "media", media: { payload: base64_mulaw_8khz } }
  → Bridge: decode μ-law → upsample 8kHz→24kHz → PCM16 → base64
  → OpenAI: { type: "input_audio_buffer.append", audio: base64_pcm16_24khz }

OpenAI sends: { type: "response.audio.delta", delta: base64_pcm16_24khz }
  → Bridge: decode PCM16 → downsample 24kHz→8kHz → encode μ-law → base64
  → Twilio: { event: "media", streamSid, media: { payload: base64_mulaw_8khz } }
```

### Audio Codec Pipeline

```
INBOUND (user → AI):
  Twilio μ-law 8kHz → decodeMulaw() → Int16Array → upsample8to24() → Int16Array → int16ToBase64() → OpenAI

OUTBOUND (AI → user):
  OpenAI PCM16 24kHz → base64ToInt16() → Int16Array → downsample24to8() → Int16Array → encodeMulaw() → Uint8Array → chunkMulawForTwilio() → Twilio

Chunking: μ-law audio split into 160-byte (20ms) frames for Twilio's real-time playback requirement
```

### Echo Fingerprinting (Smart Barge-In)

The most complex subsystem. Problem: Twilio's VAD picks up the assistant's own speech played through the phone speaker, causing false barge-in interruptions.

**Three-layer echo suppression:**

1. **TTS state tracking**: `isSendingTtsAudio` flag + `ttsAudioEndTime` timestamp
2. **Amplitude check**: `calculateRMSAmplitude()` on incoming Twilio frames — only process if above threshold
3. **Echo fingerprinting** (the key innovation):

```
VAD fires speech_started during AI speech
  → Clear Twilio audio buffer (immediate silence)
  → Set pendingBargeInCheck = true
  → If ElevenLabs: set bargeInActive = true (stop new TTS chunks)
  → Wait for user transcript...

Transcript arrives (conversation.item.input_audio_transcription.completed):
  if pendingBargeInCheck:
    transcriptLower = transcript.toLowerCase()
    aiOutputLower = lastAiOutputText.toLowerCase()  // last 300 chars of AI speech
    
    isEcho = aiOutputLower.includes(transcriptLower)
    isNoise = ECHO_NOISE_PATTERNS.test(transcriptLower)  // "hello", "hmm", "uh", etc.
             AND (isSendingTtsAudio OR within 500ms of TTS end)
    isPostTtsEcho = within 500ms of TTS end AND isEcho
    
    if isEcho OR isNoise OR isPostTtsEcho:
      → DISCARD: clear input_audio_buffer, resume AI speech
      → bargeInActive = false
    else:
      → REAL BARGE-IN: response.cancel, truncate, clear buffers
      → Pause agenda for tangent
      → bargeInRecoveryPending = true
```

**ECHO_NOISE_PATTERNS**: `/^(hello|hi|hey|hmm|hm|mm|uh|um|ah|oh|yeah|okay|ok)\.?$/i`

### Hello-Wait Logic (Outbound Calls)

Outbound calls need to wait for the user to answer before playing the greeting:

```
Call starts → waitingForUserHello = true
  → Start fallback timer (OUTBOUND_HELLO_WAIT_MS = 2000ms)
  → If VAD detects speech_started → triggerPendingGreeting('vad')
  → If timer fires → triggerPendingGreeting('timeout')

triggerPendingGreeting():
  → If cached audio exists: play via playCachedAudio(), inject context
  → If no cached audio: sendOutboundGreeting() via OpenAI
  → Mark greeting agenda item as complete
  → Persist greeting to call_messages
```

### ElevenLabs TTS on Phone

When `ttsProvider === 'elevenlabs'`, OpenAI Realtime API is configured with `modalities: ["text"]` only:

```
OpenAI response.text.delta arrives
  → Accumulate in sentenceBuffer
  → When SENTENCE_ENDERS regex matches (/[.!?]+[\s"')\]]*$/):
    → Send complete sentence to elevenlabs-tts edge function
    → Returns base64 μ-law audio
    → Split into 160-byte chunks via chunkMulawForTwilio()
    → Send each chunk as Twilio media frame
    → Track ttsAudioEndTime for echo suppression
```

### Smart Filler Phrases

During tool execution (which can take 2-5 seconds), the bridge plays conversational fillers:

```
Tool call starts → fillerManager.startTool(toolName)
  → Schedule filler phrases at FILLER_CONFIG.INTERVALS_MS: [1500, 3500, 6000]ms
  → Phrases: "One moment...", "Let me check...", "Checking that...", etc.
  → Delivered via ElevenLabs TTS or OpenAI audio depending on provider

Tool call completes → fillerManager.endTool()
  → Cancel pending filler timers
```

### Agenda Manager

Tracks conversation progress through scheduled call agendas:

```
SharedAgendaManager (edge function):
  → initialize(context, agenda, source)
  → startItem(index)
  → completeCurrentItem()
  → pauseForQuery(transcript)  // tangent detection
  → getResumeHint()            // "We were discussing X..."
  → resume()

Data stored in conversation_agenda table:
  ├─ thread_id, user_id
  ├─ item_index, item_text
  ├─ status: 'pending' | 'in_progress' | 'paused' | 'completed'
  ├─ paused_at, paused_for (tangent text)
  └─ started_at, completed_at
```

After barge-in is classified as real, agenda is paused. After AI responds to the tangent, `bargeInRecoveryPending` triggers agenda resume with a hint injection.

### Transcript Persistence (Phone)

Both bridges persist transcripts to two tables:
1. **`call_messages`** — Full audit trail with message_index, latency_ms, tool_input/output
2. **`conversation_messages`** — Unified thread for cross-mode history (source: 'phone' or 'cloudflare_phone')

---

## Path 3: ConversationRelay

Alternative phone mode using Twilio's managed STT/TTS pipeline:

```
Twilio handles STT (Deepgram Nova-2) and TTS (Google Journey voices)
  → Sends text transcripts to conversation-relay-handler
  → Handler uses Chat Completions API (not Realtime)
  → Sends text responses back
  → Twilio handles TTS playback

Advantages: Simpler, no audio codec management, Twilio handles echo cancellation
Disadvantages: Higher latency, less control over audio pipeline, no streaming
```

---

## Shared Configuration

Voice timing constants synchronized across three files:

| Constant | Value | Purpose |
|----------|-------|---------|
| `OUTBOUND_HELLO_WAIT_MS` | 2000 | Max wait for user audio on outbound calls |
| `FAREWELL_DELAY_MS` | 5000 | Wait for farewell audio before disconnect |
| `SPEECH_DEBOUNCE_MS` | 300 | Debounce rapid VAD speech events |
| `SAMPLE_RATE_OPENAI` | 24000 | OpenAI Realtime API audio rate |
| `SAMPLE_RATE_TWILIO` | 8000 | Twilio Media Streams audio rate |
| `ECHO_THRESHOLD` | 1500 | RMS amplitude threshold for echo filtering |
| `BARGE_IN_THRESHOLD` | 3000 | RMS amplitude threshold for barge-in classification |
| `TTS_ECHO_GRACE_PERIOD_MS` | 500 | Post-TTS echo window |

---

## Observability

### Activity Logging

Every voice/phone session logs structured entries to `activity_log`:

| Stage | Status | When |
|-------|--------|------|
| `token_fetch` | started | WebRTC session begins |
| `token_fetch` | error | API key issues |
| `webrtc_ready` | connected | Data channel opens |
| `cf_ws_start` | started | Cloudflare WebSocket opens |
| `cf_preconnect_fetch` | connected | Pre-connect data loaded |
| `cf_disconnect` | completed | Call ends |

### Error Logging

Structured errors in `error_log` with:
- `source`: 'webrtc', 'edge_function', 'cloudflare_worker'
- `component`: specific class/function name
- `session_id`: for correlation
- `context`: JSON with stage, stack trace, metadata

### Attempt Logging (Cloudflare)

Cloudflare worker uses structured attempt tracking:
```
logAttempt('greeting', 'attempted', { ... })
logAttempt('greeting', 'success', { latency_ms: 450 })
logAttempt('tts', 'failed', { error: 'quota_exceeded' })
```

---

## Known Issues

See `docs/DEBUG_TRACKER.md` for active issues. Key voice-related:

- **VOICE-03**: Phone lookup can match demo user (fix: two-step lookup excluding demo)
- **VOICE-04**: ElevenLabs failures produce silence (fix: announce via OpenAI audio)
- **VOICE-05**: Semantic VAD with `modalities: ["text"]` may not reliably trigger responses
