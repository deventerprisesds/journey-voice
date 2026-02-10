
# Fix Missing Window Transition Calls for Authenticated Accounts

## Problem

The 5 window transition calls (Morning Kickstart, Business Hours Start, Daily Wrap-up, Evening Start, Weekend Morning) exist in `DEFAULT_SCHEDULED_CALLS` in the code, but they were never synced to your real account (`3e9306b8...`). The load logic at line 292 does:

```typescript
setScheduledCalls(config.scheduled_calls && config.scheduled_calls.length > 0 
  ? config.scheduled_calls    // <-- your account hits this branch
  : DEFAULT_SCHEDULED_CALLS); // <-- never reached
```

Since your account already had 7 saved calls, the defaults (which include the window calls) are ignored entirely.

## Solution

Modify the `loadConfig` function to **merge** any missing default calls into the user's saved calls. This ensures that when new default calls are added to the codebase, they automatically appear for existing users who already have saved configs.

## Changes

**File:** `src/components/VoiceAssistantSettings.tsx`

### Update `loadConfig` merge logic (lines 292-294)

Replace the simple either/or with a merge that checks for missing default call IDs:

```typescript
// Merge: use saved calls but add any missing defaults
const savedCalls = config.scheduled_calls || [];
if (savedCalls.length > 0) {
  const savedIds = new Set(savedCalls.map((c: ScheduledCall) => c.id));
  const missingDefaults = DEFAULT_SCHEDULED_CALLS.filter(d => !savedIds.has(d.id));
  setScheduledCalls([...savedCalls, ...missingDefaults]);
} else {
  setScheduledCalls(DEFAULT_SCHEDULED_CALLS);
}
```

This way:
- Existing saved calls are preserved as-is (times, enabled state, context edits)
- Any new default calls not yet in the user's config are appended
- The window transition calls will appear for all accounts on next load

### Also update `handleReset` (line 359)

No change needed -- reset already sets `DEFAULT_SCHEDULED_CALLS` which includes the window calls.

## Result

After this change, your authenticated account will immediately see all 5 window transition calls appended below your existing 7 calls in the Recurring Calls tab. Once you save, they'll persist to the database and the cron job will start firing them.
