

# Fix: Barge-In, Double Greeting, Wrong Name, and Agenda Wiring

## Summary

Four issues to fix in `twilio-realtime-bridge/index.ts` and one in `twilio-scheduled-call/index.ts`. No database migrations needed. Fully revertible by reverting the message.

---

## Part 1: Fix ElevenLabs Barge-In (Lines 505-521)

**Problem:** The `speech_started` handler has a guard `if (ttsProvider !== 'elevenlabs')` that skips ALL interrupt logic when using ElevenLabs. The user literally cannot interrupt.

**Fix:** Remove the provider guard. On user speech during AI output:
1. Clear Twilio audio buffer (already works)
2. Send `response.cancel` to OpenAI to stop text generation
3. Set `bargeInActive = true` flag -- checked in `sendElevenLabsTTS` to discard late-arriving chunks
4. Clear `sentenceBuffer` and `pendingTextBuffer` to prevent queued sentences
5. Delayed (300ms) second Twilio clear to catch late audio chunks, then reset `bargeInActive`
6. For OpenAI native audio, keep existing `conversation.item.truncate` logic
7. Call `sharedAgendaManager?.pauseForQuery(lastUserTranscript)` to track the tangent

New state variable: `let bargeInActive = false;` (line ~155)

Early exit in `sendElevenLabsTTS` (line 248): `if (bargeInActive) return;`

---

## Part 2: Agenda Tangent Recovery (response.done handler, Line 456)

**Problem:** `SharedAgendaManager` is instantiated (line 631) but never queried for resume hints after tangent responses.

**Fix:** In the `response.done` handler (after persisting the assistant message), add:

```text
if (sharedAgendaManager && bargeInRecoveryPending) {
  const hint = await sharedAgendaManager.getResumeHint();
  if (hint) {
    injectSystemMessage(`[RESUME] ${hint}. Continue with this agenda item naturally.`);
  }
  await sharedAgendaManager.resume();
  bargeInRecoveryPending = false;
}
```

New state variable: `let bargeInRecoveryPending = false;` -- set to `true` in the barge-in handler when `sharedAgendaManager` pauses for a tangent.

This ensures the AI remembers what it was discussing before the interruption and returns to it naturally after addressing the user's tangent question.

---

## Part 3: Fix Double Greeting (Lines 227-243 and 430-433)

**Problem:** Two independent code paths both inject greeting context into OpenAI:
- `triggerPendingGreeting()` at line 235-237
- `session.updated` handler at line 430-432

**Fix:**
1. Add flag: `let greetingContextInjected = false;`
2. In `triggerPendingGreeting()` (line 235): set `greetingContextInjected = true` and change context message to:
   `"[System: PRE-CONNECTED CALL - You already greeted the user with: '...'. SKIP the greeting step (step 1) in the agenda -- it is already done. {callContext}. Continue from step 2 onward. Cover remaining agenda items before ending.]"`
3. In `session.updated` handler (line 430): add guard `if (preConnectedSession && greetingSent && !greetingContextInjected)`

---

## Part 4: Fix Wrong Name (3 locations in bridge + agenda templates)

**Problem:** Bridge uses `profile?.first_name` ("Von") instead of `profile?.preferred_greeting` ("Sir").

**Fix in `twilio-realtime-bridge/index.ts`:**
- Line 69: `const userName = profile?.preferred_greeting || profile?.first_name || 'sir';`
- Line 352: `const userName = userProfile?.preferred_greeting || userProfile?.first_name || 'sir';`
- Line 360: `const userName = userProfile?.preferred_greeting || userProfile?.first_name || 'sir';`

**Fix in `twilio-scheduled-call/index.ts`:**
- In `processRecurringCalls()` (line 482-486): expand profile select to include `preferred_greeting`:
  `select('phone, preferred_greeting')`
- Extract: `const preferredGreeting = profile?.preferred_greeting || 'Sir';`
- Pass `preferredGreeting` into `buildCallContext` -> `buildWindowTransitionContext` -> `buildBranch1Context` / `buildBranch2Context`
- Replace all 4 hardcoded `"Hello Sir."` strings (lines 247, 290, 300, 316) with `"Hello ${preferredGreeting}."`

---

## Files Modified

| File | Changes |
|------|---------|
| `supabase/functions/twilio-realtime-bridge/index.ts` | Barge-in fix, agenda resume hints, double greeting guard, preferred_greeting |
| `supabase/functions/twilio-scheduled-call/index.ts` | Load preferred_greeting from profiles, pass to agenda builders |

## Rollback

Both are edge functions only -- revert the message and they redeploy to previous state. No database changes.

