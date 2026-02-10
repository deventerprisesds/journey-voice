

# Fix: Double Greeting, Barge-in, and Task Hallucination

## Three bugs, two files.

---

## Bug 1: Double Greeting

**Root cause:** `buildWindowContext` in `twilio-scheduled-call/index.ts` always emits `GREETING: Address user as "..."` and `1. Greet user` as the first agenda item. But for pre-connected calls, the bridge already plays cached audio and injects a "skip step 1" system message. The AI sees conflicting instructions and often follows the agenda's explicit greeting step.

**Fix in `twilio-scheduled-call/index.ts`:**
Add a note to every context that says: "NOTE: If a cached greeting has already been played, step 1 is already complete. A system message will confirm this -- skip it and start from step 2." This aligns the context with what the bridge injects, instead of contradicting it.

Update the `AGENDA_HEADER` constant to include:

```
NOTE: On pre-connected calls, a cached audio greeting plays automatically before
you receive this context. A system message will confirm this happened. When you see
that confirmation, step 1 (greeting) is already done -- skip it entirely and start
from the next item. Do NOT greet the user again.
```

---

## Bug 2: No Barge-in During ElevenLabs TTS

**Root cause:** In `twilio-realtime-bridge/index.ts`, the barge-in logic at `input_audio_buffer.speech_started` (line 534) only checks `isAiSpeaking`. This flag is set on `response.audio.delta` (line 447) which only fires for OpenAI native audio. When using ElevenLabs, audio is sent via `sendElevenLabsTTS` which sets `isSendingTtsAudio` instead. The barge-in gate never opens during ElevenLabs playback.

**Fix in `twilio-realtime-bridge/index.ts`:**
Change the barge-in condition from:

```typescript
if (isAiSpeaking) {
```

to:

```typescript
if (isAiSpeaking || isSendingTtsAudio) {
```

This ensures barge-in triggers whenever audio is being sent to Twilio, regardless of whether it came from OpenAI native audio or ElevenLabs TTS.

---

## Bug 3: Task Hallucination in Topic Jog

**Root cause:** When the "No Tasks -- Topic Jog" branch fires, the context presents topic group names and tells the AI to "use get_tasks to drill into that topic." But there is no explicit prohibition against inventing tasks. The AI sees topic names like "Financial Management" and fabricates specific tasks under them instead of calling the tool.

**Fix in `twilio-scheduled-call/index.ts`:**
Add a strict anti-hallucination rule to the `AGENDA_HEADER`:

```
CRITICAL: NEVER invent, assume, or fabricate task names or details.
Only present tasks that are either:
  (a) explicitly listed in this context as data, OR
  (b) returned by the get_tasks tool at runtime.
If you do not have task data, you MUST call get_tasks before describing any tasks to the user.
Topic group names are for memory jogging only -- do NOT guess what tasks are in them.
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `supabase/functions/twilio-scheduled-call/index.ts` | Update `AGENDA_HEADER` with cached-greeting awareness and anti-hallucination rules |
| `supabase/functions/twilio-realtime-bridge/index.ts` | Change barge-in condition to include `isSendingTtsAudio` |

Two files. Three targeted fixes. No structural changes.

