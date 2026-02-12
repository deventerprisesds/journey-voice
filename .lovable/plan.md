

# Fix: Route Recurring Calls Through Pre-Connect Session + Fix Double Greeting + Weekend Guard

## Summary

You're right on all three points, and your suggestion about pre-computing at delivery time is exactly the solution. The `pre-connect` path already exists and does this -- it queries tasks, topics, RAG context, and pre-generates the greeting audio. But recurring calls aren't using it. They use the old `trigger-call` path which passes context as a URL parameter (line 1006 of `twilio-voice-handler`), which truncates your task lists and topic groups.

## Three Fixes

### Fix 1: Route Recurring Calls Through Pre-Connect Session

**File:** `supabase/functions/twilio-scheduled-call/index.ts` (lines 730-756)

Replace the `trigger-call` path with a two-step flow:

1. Call `twilio-realtime-bridge` with `mode: 'pre-connect'` -- this pre-queries tasks, topics, RAG context, generates greeting audio, and stores everything in the `pre_connect_sessions` table (no size limit)
2. Call `twilio-voice-handler` with `action: 'trigger-call-with-session'` and the session ID

This is the same path already used for user-initiated calls from the app. The dynamic context (AGENDA_HEADER, task lists, topic groups) will be fully preserved because it's stored in a database row, not a URL parameter.

```text
// BEFORE (line 734):
fetch('twilio-voice-handler', { action: 'trigger-call', context })
// context gets URL-encoded and truncated

// AFTER:
1. fetch('twilio-realtime-bridge', { mode: 'pre-connect', userId, context, agenda, timezone })
   -> returns { sessionId, greetingText, audioBase64 }
2. fetch('twilio-voice-handler', { action: 'trigger-call-with-session', sessionId, ... })
   -> full context preserved in DB
```

If pre-connect fails, fall back to `trigger-call` so calls still go through.

### Fix 2: Weekend Day-of-Week Guard

**File:** `supabase/functions/twilio-scheduled-call/index.ts` (inside the for-loop at line 667)

Add a check: if the call's context contains `[WINDOW:weekends]` and today is not Saturday or Sunday, skip it. This prevents the weekend call from firing on a Tuesday.

```text
const isWeekendCall = call.context?.includes('[WINDOW:weekends]');
if (isWeekendCall) {
  const dayOfWeek = new Date().toLocaleDateString('en-US', { 
    weekday: 'long', timeZone: timezone 
  });
  if (dayOfWeek !== 'Saturday' && dayOfWeek !== 'Sunday') {
    console.log(`[RECURRING] Skipping weekend call on ${dayOfWeek}`);
    continue;
  }
}
```

### Fix 3: Eliminate Double Greeting

**File:** `supabase/functions/twilio-realtime-bridge/index.ts` (lines 435-443)

The race condition: `session.updated` fires and sees `greetingSent=true` but `greetingContextInjected=false`, so it injects a greeting context. Then `triggerPendingGreeting` fires and injects another one.

Fix: In the `session.updated` handler, also check `waitingForUserHello`. If the session has a pre-connected greeting with cached audio, the greeting will be handled by the stream `start` event and `triggerPendingGreeting`. The `session.updated` path should not inject a second greeting.

```text
// BEFORE (line 435):
if (preConnectedSession && greetingSent && !greetingContextInjected)

// AFTER:
if (preConnectedSession && greetingSent && !greetingContextInjected && !waitingForUserHello)
```

This ensures only ONE code path injects the greeting context.

## What Does NOT Change

- `persona.ts`, `tool-definitions.ts`, `call-session.ts` -- unchanged
- `twilio-voice-handler` `trigger-call-with-session` handler -- already works correctly
- Frontend code -- no changes
- Chat flows -- unaffected
- The `buildCallContext` / `buildWindowTransitionContext` functions -- still generate the same rich context, it just won't be truncated anymore

## Risk Assessment

Low risk. The `trigger-call-with-session` path is already production-tested for user-initiated calls. The only new behavior is that recurring calls use the same path. Fallback to `trigger-call` ensures no call is lost if pre-connect fails.
