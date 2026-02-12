

# Unify Call Context Pipeline + Fix Greeting Transcript + Fix Double Greeting

## What Gets Preserved (Nothing Lost)

The shared module will contain ALL of the following from `twilio-scheduled-call`:

| Feature | Source | Kept? |
|---------|--------|-------|
| `CATEGORY_WINDOW_MAPPING` (6 categories x windows) | twilio-scheduled-call L34-41 | Yes |
| `WINDOW_RANGES` (morning/biz/after/evening/weekends) | twilio-scheduled-call L44-50 | Yes |
| `AGENDA_HEADER` (anti-hallucination, natural flow) | twilio-scheduled-call L279-294 | Yes |
| `getTasksForWindow()` (excludes test/blocked, filters by category) | twilio-scheduled-call L88-138 | Yes |
| `getTopicGroupsFromWindowTasks()` (tier 1 window-aligned topics) | twilio-scheduled-call L141-168 | Yes |
| `getTopicGroupsFromAllTasks()` (tier 2 fallback across all tasks) | twilio-scheduled-call L171-176 | Yes |
| `getTopicGroupsManual()` (3-step join: tasks -> mappings -> topics, ranked) | twilio-scheduled-call L179-251 | Yes |
| `formatTopicGroups()` + `formatTaskList()` | twilio-scheduled-call L255-276 | Yes |
| `buildWindowContext()` (5 per-window scripts with task/topic/tier logic) | twilio-scheduled-call L335-538 | Yes |
| `buildWindowTransitionContext()` (queries DB, builds context) | twilio-scheduled-call L297-332 | Yes |
| `buildCallContext()` (window detection + legacy mapping + custom fallback) | twilio-scheduled-call L542-572 | Yes |

The `notification-delivery` version (lines 9-98) is **discarded entirely** -- it has nothing the strong version lacks.

## What Gets Discarded from notification-delivery

- Static "CALL TYPE: Morning Stand-up / [CALL AGENDA - MUST COVER ALL] / 1. Greet warmly..." scripts (lines 42-85) -- replaced by window-aware scripts with actual task lists
- The generic `briefing` string ("X tasks scheduled for today") -- replaced by `formatTaskList()` which shows individual task names and times
- The `switch(callId)` pattern -- replaced by window detection with legacy callType-to-window mapping

## Changes

### 1. Create shared module: `_shared/call-context-builder.ts`

Extract from `twilio-scheduled-call/index.ts`:
- All constants: `CATEGORY_WINDOW_MAPPING`, `WINDOW_RANGES`, `AGENDA_HEADER`
- All functions: `getTasksForWindow`, `getTopicGroupsFromWindowTasks`, `getTopicGroupsFromAllTasks`, `getTopicGroupsManual`, `formatTopicGroups`, `formatTaskList`, `buildWindowContext`, `buildWindowTransitionContext`
- The main `buildCallContext` function

The function signature will accept a generic call descriptor:

```text
interface CallDescriptor {
  callType?: string;   // 'morning_standup' | 'midday_checkin' | 'eod_wrapup' | 'custom'
  context?: string;    // User-configured context (may contain [WINDOW:xxx])
  name?: string;       // Call name for logging
}

async function buildCallContext(
  call: CallDescriptor,
  userId: string,
  supabaseUrl: string,
  supabaseServiceKey: string,
  preferredGreeting?: string
): Promise<string>
```

This accepts both `ScheduledCall` objects (from twilio-scheduled-call) and `callConfig` objects (from notification-delivery) since both have `callType` and `context` fields.

### 2. Update `notification-delivery/index.ts`

- Remove the local `buildCallContext` function (lines 9-98)
- Import `buildCallContext` from `../_shared/call-context-builder.ts`
- At line 267 and 329, adapt the call site:

```text
// BEFORE (line 329):
const context = await buildCallContext(callConfig, userId, supabaseClient);

// AFTER:
const context = await buildCallContext(
  { callType: callConfig.call_id, context: callConfig.context, name: callConfig.call_name },
  userId,
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  profile?.preferred_greeting || 'Sir'
);
```

This means the notification-delivery pipeline now gets full window-aware context with task lists, topic groups, and anti-hallucination guardrails.

### 3. Update `twilio-scheduled-call/index.ts`

- Remove all the extracted functions (lines 33-572, roughly 540 lines)
- Import from `../_shared/call-context-builder.ts`
- Keep: `getTodaysBriefing`, `isTimeMatch`, `getTimeInTimezone`, `processRecurringCalls`, and the `serve` handler
- Update the `buildCallContext` call at line 746 to use the shared import

### 4. Persist cached greeting to call_messages (transcript visibility)

**File:** `twilio-realtime-bridge/index.ts`

Currently, the cached ElevenLabs greeting is played as raw audio but never saved to `call_messages`. This is why you can't see it in transcripts.

In `triggerPendingGreeting` (around line 236-241), after playing cached audio:

```text
// NEW: Persist the cached greeting so it appears in transcripts
if (callSessionId && userId) {
  saveCallMessage(supabase, {
    callSessionId, userId, threadId, streamSid,
    role: 'assistant', content: preConnectedGreetingText,
    messageIndex, latencyMs: 0
  }).then(idx => { if (idx !== undefined) messageIndex = idx; })
    .catch(e => console.error('[PERSIST] cached greeting save failed:', e));
}
```

Same for the inbound cached audio path at lines 695-703.

### 5. Fix double greeting definitively

**File:** `twilio-realtime-bridge/index.ts`

The `session.updated` handler (line 435) currently checks:
```text
if (preConnectedSession && greetingSent && !greetingContextInjected && !waitingForUserHello)
```

Add `!cachedAudioBase64` guard:
```text
if (preConnectedSession && greetingSent && !greetingContextInjected && !waitingForUserHello && !cachedAudioBase64)
```

When cached audio exists (all pre-connected ElevenLabs calls), the greeting context is ONLY injected by:
- `triggerPendingGreeting` (outbound calls, line 238-241)
- The stream `start` handler (inbound calls, lines 695-703 -- which also needs context injection added)

The `session.updated` path becomes a fallback only for pre-connected sessions WITHOUT cached audio (OpenAI-voice calls).

For the inbound path at lines 695-703, add context injection after playing cached audio (currently missing):

```text
// After line 702 (greetingSent = true):
injectAssistantMessage(preConnectedGreetingText);
injectSystemMessage(`[System: PRE-CONNECTED CALL - greeting already sent: "${preConnectedGreetingText}". SKIP step 1. ${callContext || ''}. Continue from step 2.]`);
greetingContextInjected = true;
```

## Summary of File Changes

| File | Action | Lines Affected |
|------|--------|----------------|
| `_shared/call-context-builder.ts` | NEW | ~300 lines (extracted from twilio-scheduled-call) |
| `twilio-scheduled-call/index.ts` | SHRINK | Remove ~540 lines (33-572), add 1 import |
| `notification-delivery/index.ts` | REPLACE | Remove lines 9-98 (weak buildCallContext), add import + adapt 2 call sites |
| `twilio-realtime-bridge/index.ts` | EDIT | Add greeting persistence (2 locations), add `!cachedAudioBase64` guard, add inbound context injection |

## Risk Mitigation

- The shared module is a direct copy-paste of the proven `twilio-scheduled-call` functions -- no logic changes
- `notification-delivery` gets strictly upgraded (weak to strong) -- no feature regression
- The `CallDescriptor` interface is a subset of `ScheduledCall`, so existing callers work without changes
- Both pipelines will produce identical context for the same call configuration
- If the shared import fails to resolve, both functions will fail to deploy, making it immediately visible (not a silent regression)

