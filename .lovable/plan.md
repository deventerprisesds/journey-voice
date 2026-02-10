

# Add Greeting Trace Logging Only

## What

Add `[GREETING-TRACE]` log lines at both greeting injection points so we can see exactly which path fires and whether both fire on the same call. No behavioral changes.

## Changes

**File:** `supabase/functions/twilio-realtime-bridge/index.ts`

### Log 1: Inside `triggerPendingGreeting()` (after line 231)

After `injectAssistantMessage(preConnectedGreetingText)`, add:

```typescript
console.log(`[GREETING-TRACE] triggerPendingGreeting(${source}): injected greeting context. greetingSent=${greetingSent}`);
```

### Log 2: Inside `session.updated` handler (before line 424)

Before the `if (preConnectedSession && greetingSent)` block, add:

```typescript
console.log(`[GREETING-TRACE] session.updated: preConnectedSession=${!!preConnectedSession}, greetingSent=${greetingSent}, waitingForUserHello=${waitingForUserHello}`);
```

And inside the block (after line 426), add:

```typescript
console.log(`[GREETING-TRACE] session.updated: injected greeting context (second path)`);
```

This will make it obvious in the logs whether both paths fire on the same call, confirming or disproving the race condition theory.

