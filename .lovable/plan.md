

# Revised Plan: Smart Barge-In That Handles "That's Incorrect"

## Why the Word-Count Approach Fails

"That's incorrect" is 2 words. "No." is 1 word. "Stop" is 1 word. All are clearly real barge-ins. A word-count threshold would suppress them — unacceptable.

## How ChatGPT Handles This

ChatGPT uses WebRTC with built-in **Acoustic Echo Cancellation (AEC)** in the browser. The browser's audio pipeline subtracts the AI's output from the mic input before it reaches VAD. Echo simply never reaches the model. That's why it "just works."

The Twilio phone bridge has **no AEC** — the phone speaker plays audio, the mic picks it up, and OpenAI's VAD sees it as speech. That's the fundamental difference.

## Better Approach: Echo Fingerprinting (Not Word Count)

Instead of counting words, we compare the transcript against what the AI **just said**. Echo transcripts are fragments of the AI's own recent output. Real barge-ins are novel content.

### Classification Logic

When a transcript arrives during or within 500ms after TTS playback:

1. **Check if it's an echo:** Compare the transcript (lowercased, stripped) against the last ~200 chars of AI output text. If the transcript is a substring of recent AI output → **discard as echo**
2. **Check if it's filler noise:** If transcript matches a known noise pattern (just "Hello", "Hmm", empty string, or single repeated phoneme) AND it arrived during active TTS → **discard**
3. **Otherwise → real barge-in:** "That's incorrect", "Wait", "No", "Stop", "What about tomorrow" — all pass through and trigger full barge-in

This means:
- "That's incorrect" → not in AI's recent output → **real barge-in** ✓
- "No" → not in AI's recent output → **real barge-in** ✓  
- "...schedule, calendar" (echo of AI) → substring match → **discarded** ✓
- "Hello" during TTS → filler noise pattern → **discarded** ✓

### Implementation Flow

```text
speech_started (VAD fires)
  │
  ├─ If waitingForUserHello → trigger greeting (existing)
  │
  ├─ If isAiSpeaking OR isSendingTtsAudio:
  │     • DON'T cancel response yet
  │     • Set pendingBargeInCheck = true
  │     • Clear Twilio audio buffer (stops playback immediately for responsiveness)
  │     • Wait for transcript...
  │
  └─ Otherwise: normal user turn (existing)

transcript arrives (conversation.item.input_audio_transcription.completed)
  │
  ├─ If pendingBargeInCheck:
  │     • Run echo fingerprint check against lastAiOutputText
  │     • If echo/noise → clear input_audio_buffer, DON'T cancel response,
  │       send response.create to resume AI speech
  │     • If real → execute full barge-in (response.cancel, agenda pause, etc.)
  │     • Reset pendingBargeInCheck = false
  │
  └─ Otherwise: normal transcript handling (existing)
```

### Key Detail: Immediate Audio Stop, Deferred Cancel

When VAD fires during AI speech, we **immediately clear the Twilio playback buffer** so you don't keep hearing the AI while you're talking. But we **defer `response.cancel`** until we classify the transcript. If it turns out to be echo, we resume AI output seamlessly. If it's real, we cancel. This gives you the snappy interrupt feel without false triggers.

## Changes

### Change 1: `supabase/functions/twilio-realtime-bridge/index.ts`

**New state variables:**
- `pendingBargeInCheck: boolean = false`
- `lastAiOutputText: string = ''` (accumulate from `response.audio_transcript.delta`)
- `ttsEndedAt: number = 0`

**Modify `speech_started` handler (line 545):** When `isAiSpeaking || isSendingTtsAudio`, set `pendingBargeInCheck = true` and clear Twilio buffer, but do NOT send `response.cancel` yet.

**Modify transcript handler (line 593):** When `pendingBargeInCheck` is true, run echo classification before processing. Echo fingerprint: `lastAiOutputText.toLowerCase().includes(transcript.toLowerCase())`. If echo → discard + resume. If real → full barge-in.

**Track AI output text:** In `response.audio_transcript.delta`, append to `lastAiOutputText`. On `response.done`, keep last 300 chars. On new `response.created`, reset.

**Post-TTS echo window:** When `isSendingTtsAudio` flips to false, set `ttsEndedAt = Date.now()`. In transcript handler, also apply echo check if within 500ms of `ttsEndedAt`.

**Mark greeting agenda complete:** After `greetingContextInjected = true`, call `sharedAgendaManager.completeItem(0)`.

### Change 2: `src/utils/RealtimeVoiceAssistant.ts`

**Handle `hang_up` tool:** Add `|| functionName === 'hang_up'` to the disconnect check (~line 1200).

**Event-driven disconnect:** Replace `setTimeout(2000)` with listening for `response.done` / audio completion before calling `disconnect()`. Safety timeout of 8s.

### Deployment
- Deploy `twilio-realtime-bridge`
- Frontend auto-deploys

