

# Fix: Remove Duplicate send-unified-notification Calls

## Root Cause Confirmed

The duplicate Outlook events are caused by **TWO separate calls** to `send-unified-notification` for every notification:

```text
notification-delivery
    │
    ├── calls send-push-notification (line 524)
    │       │
    │       └── calls send-unified-notification ❌ (NO notificationId, NO task times)
    │                  → Creates Outlook event with 1-hour fallback time
    │
    └── calls send-unified-notification directly (line 565)
               → Creates Outlook event with CORRECT task times
```

### Evidence from Logs

**Call 1 (20:37:01)** - via send-push-notification:
```json
{
  "notificationId": undefined,
  "data": {
    "batchSize": 1,
    // NO startTime, endTime, taskTitle
  }
}
```
Result: Event created at 21:37 (1 hour from now fallback)

**Call 2 (20:37:03)** - direct from notification-delivery:
```json
{
  "notificationId": "09593b56...",
  "data": {
    "batchSize": 1,
    "startTime": "2026-02-02T20:37:00+00:00",
    "endTime": "2026-02-02T20:52:00+00:00"
  }
}
```
Result: Event created at 20:37 (correct time)

## Why Slack Doesn't Have This Issue

Slack notifications are stateless webhook calls - receiving two messages with the same content is just annoying, not persistent. Outlook calendar events are persistent objects, so duplicates accumulate and display incorrect times.

## Solution

### Option A: Remove `send-unified-notification` from `send-push-notification` (Recommended)

The `send-push-notification` function should ONLY handle actual push notifications (browser/mobile), not be a general dispatcher.

**File:** `supabase/functions/send-push-notification/index.ts`

Remove lines 51-66 that call `send-unified-notification`. The function should only:
1. Check if push notifications are enabled
2. Send to browser push subscriptions (if any)
3. Return success

This is the cleanest fix because:
- `notification-delivery` already calls `send-unified-notification` directly with full task data
- `send-push-notification` shouldn't be responsible for Outlook/Slack/Email
- Eliminates the duplicate call entirely

### Option B: Skip Calendar Channels in send-push-notification

If we need to keep the call for backward compatibility, we could filter out `OUTLOOK_EVENT` and `GOOGLE_EVENT`:

**File:** `supabase/functions/send-push-notification/index.ts`

```typescript
const userChannels = prefs?.channels || ['EMAIL'];
// Filter out calendar channels - notification-delivery handles those with proper task times
const nonCalendarChannels = userChannels.filter(
  (c: string) => !['OUTLOOK_EVENT', 'GOOGLE_EVENT'].includes(c)
);
```

This is a partial fix that still creates duplicate Slack/Email but at least stops duplicate calendar events.

### Option C: Add Idempotency Key to Outlook Event Creation (Defense in Depth)

Add a check in `send-unified-notification` to skip Outlook event creation if one was already created for this task today:

**File:** `supabase/functions/send-unified-notification/index.ts`

Before creating Outlook event:
```typescript
// Check for existing event today with same task
if (taskData?.taskId) {
  const { data: existing } = await supabaseClient
    .from('external_calendar_events')
    .select('id')
    .eq('source_task_id', taskData.taskId)
    .gte('created_at', new Date(Date.now() - 24*60*60*1000).toISOString())
    .maybeSingle();
  
  if (existing) {
    console.log('[Outlook] Event already exists for this task today, skipping');
    return { success: true, details: 'Skipped - event exists' };
  }
}
```

## Recommended Approach

**Apply all three fixes:**

1. **Option A** - Stop `send-push-notification` from calling `send-unified-notification` for calendar channels
2. **Option B** - As an immediate quick fix, filter out calendar channels
3. **Option C** - Add idempotency as defense in depth

## Summary of Changes

| File | Change |
|------|--------|
| `send-push-notification/index.ts` | Filter out `OUTLOOK_EVENT` and `GOOGLE_EVENT` from channels before calling `send-unified-notification` |
| `send-unified-notification/index.ts` | Add idempotency check to skip Outlook event if one exists for this task today |

## About the Delay in Calendar Appearance

Your screenshot shows the event DID appear with the correct time (3:37 PM - 3:52 PM). The delay you noticed is likely:

1. **Microsoft Graph API propagation** - Can take 10-30 seconds for events to sync to mobile devices
2. **Outlook mobile app sync interval** - The app syncs periodically, not instantly
3. **Both Outlook events being created** - The first (wrong) one appears, then the second (correct) one appears later

After this fix, there will only be ONE event created at the correct time, and it should appear within ~30 seconds of the notification trigger.

