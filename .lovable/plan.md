

# Fix: Persist Check-in Context in Chat Thread + Thread Continuity

## Two Changes in One File

**File:** `supabase/functions/send-chat-message/index.ts`

---

## Change 1: Embed Context into the Thread Message (Not Ephemeral)

Currently at line 463-469, the call to `hybrid-assistant-api` sends:

```
userInput: '[SYSTEM INITIATED] Generate your opening message for this check-in.'
contextualInstructions: <the full window context, tasks, topics>
```

The `contextualInstructions` get applied as `additional_instructions` on the OpenAI run, which is ephemeral -- it vanishes after the run completes. When the user replies, the next run has no idea what the check-in was about.

**Fix:** Merge the context into `userInput` so it becomes a permanent message in the OpenAI thread:

```typescript
body: JSON.stringify({
  userInput: `[SYSTEM INITIATED CHECK-IN]\n\n${contextualInstructions}\n\nGenerate your opening message for this check-in based on the context above.`,
  userId,
  threadId: dbThreadId,
  systemInitiated: true
  // contextualInstructions removed -- now embedded in userInput
})
```

This means when the user asks "what is this about?", the AI can scroll back in the thread and see the full window context, task list, and agenda.

## Change 2: Pass the OpenAI Thread ID (if available)

Currently `send-chat-message` passes `threadId: dbThreadId` (the Supabase row ID). The `hybrid-assistant-api` already looks up the `openai_thread_id` from this DB row, so thread continuity is already handled. No additional change needed here -- the existing flow correctly reuses the same OpenAI thread across messages.

---

## What Does NOT Change

- `hybrid-assistant-api` -- no changes needed; it already handles `userInput` with or without `contextualInstructions`
- `buildCallContext` / `buildWindowTransitionContext` -- still generate the same context strings
- Frontend chat hook -- no changes
- Voice flows -- unaffected

## Regarding the Recurring Call Issue

Edge function logs for `twilio-scheduled-call` and `hybrid-assistant-api` returned empty -- no recent invocations were captured. Without logs from the most recent call, the specific failure (tools not being used, context not loaded) cannot be diagnosed from the server side. The fixes deployed in the previous round (anti-hallucination guardrails, barge-in, greeting dedup) are in place but may need a fresh call to validate. After this chat fix is deployed, a test of both a chat check-in and a phone call would confirm both paths.

## Risk Assessment

Low risk. The only behavioral change is that the system-initiated message stored in the OpenAI thread is richer (contains the full check-in context) instead of a bare "[SYSTEM INITIATED]" marker. All other context injection (persona, RAG, time anchor) continues to load via `additional_instructions` on every run as before.

