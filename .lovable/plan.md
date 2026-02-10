

# Fix: Bridge Crash — `await` Inside Non-Async Handler

## What Happened

The last call received at 16:32 UTC hung up after **4 seconds** with no greeting because the `twilio-realtime-bridge` crashed on boot:

```
ERROR worker boot error: Uncaught SyntaxError: Unexpected reserved word
    at twilio-realtime-bridge/index.ts:565:32
```

Twilio connected, got no TwiML/WebSocket response from the dead function, and dropped the call.

## Root Cause

Our `saveCallMessage` changes added `await` calls inside `openaiWs.onmessage`, which is a **non-async** arrow function (line 397):

```typescript
openaiWs.onmessage = (event) => {   // <-- NOT async
  ...
  messageIndex = await saveCallMessage(...);  // ILLEGAL — await in non-async
```

`await` is a reserved word only valid inside `async` functions. Deno rejects this at parse time before the function even runs.

## Fix

**One-character fix** — add `async` to the `onmessage` handler:

```
File: supabase/functions/twilio-realtime-bridge/index.ts
Line 397

Before: openaiWs.onmessage = (event) => {
After:  openaiWs.onmessage = async (event) => {
```

This is safe because:
- WebSocket `onmessage` handlers can be async (the return value is ignored by the WebSocket API)
- `handleFunctionCall` on line 560 is already `async` — so the tool persistence `await` there was fine
- The user transcript and AI response persistence `await`s (lines 466, 536) are the ones that need the handler to be async

## Also Fix: Duplicate Chat Messages (from prior approved plan)

While we're deploying, apply the deduplication fix in `CommsConsoleContext.tsx` to prevent double messages in the chat UI. The Realtime handler should replace temporary local messages (IDs starting with `assistant-` or `user-`) with the database version instead of appending duplicates.

```
File: src/contexts/CommsConsoleContext.tsx
Lines: ~396-413 (Realtime setMessages callback)

Add logic before the existing duplicate check:
1. If incoming message matches an existing message by role + content
   AND the existing message has a temporary ID (starts with 'assistant-' or 'user-')
2. REPLACE the temp message with the DB version (real UUID)
3. Otherwise fall through to existing append logic
```

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/twilio-realtime-bridge/index.ts` (line 397) | Add `async` to `onmessage` handler |
| `src/contexts/CommsConsoleContext.tsx` (~line 396-413) | Replace temp messages instead of duplicating |

## Deploy

Redeploy `twilio-realtime-bridge` immediately after the fix so the next call works.

