
# Complete Fix: Duplicate Outlook Events and Timing Issues

## Root Cause Analysis (Confirmed)

After tracing the entire flow, I found **MULTIPLE issues** creating duplicates:

### Issue 1: Missing `notificationId` Passed from notification-delivery

**Location:** `supabase/functions/notification-delivery/index.ts` (lines 565-573)

```typescript
const { data: unifiedResult, error: unifiedError } = await supabaseClient.functions.invoke('send-unified-notification', {
  body: {
    userId: userId,
    title: title,
    body: body,
    channels: enabledChannels.filter((channel: string) => ['SLACK', 'EMAIL', 'OUTLOOK_EVENT', 'GOOGLE_EVENT'].includes(channel)),
    data: notificationData
    // MISSING: notificationId is NOT passed!
  }
});
```

**Evidence from logs:**
```
notificationId: undefined
```

### Issue 2: Triple INSERT Points in send-unified-notification

**Location:** `supabase/functions/send-unified-notification/index.ts`

The function has **THREE separate places** that INSERT into `scheduled_notifications`:

1. **Lines 514-537**: When `!notificationId` and all channels handled directly (Outlook)
2. **Lines 662-684**: In `callUnifiedWebhook` when `UNIFIED_WEBHOOK_URL` not configured
3. **Lines 802-826**: In `callUnifiedWebhook` at the end of processing

Each of these can create duplicate notification records, which then get picked up by the next cron run.

### Issue 3: Missing Task Data on Some Calls

**Evidence from logs:**

**Call 1 (18:14:01):**
```json
data: {
  type: "task_start_now",
  taskId: "92c8c050...",
  notificationIds: ["aff91b2f..."],
  batchSize: 1
  // NO startTime, endTime, estimateMinutes, taskTitle
}
```
Result: Used fallback (1 hour from now = 19:14:01)

**Call 2 (18:14:03):**
```json
data: {
  type: "task_start_now",
  taskId: "92c8c050...",
  notificationIds: ["aff91b2f..."],
  batchSize: 1,
  startTime: "2026-02-02T18:14:00+00:00",  // Correct
  endTime: "2026-02-02T18:29:00+00:00",
  estimateMinutes: 15,
  taskTitle: "Test Task"
}
```
Result: Used correct task time (18:14:00)

This shows the same notification was processed TWICE with different data.

---

## Complete Fix

### Fix 1: Pass `notificationId` to prevent duplicate record creation

**File:** `supabase/functions/notification-delivery/index.ts`

Update lines 565-573 to include `notificationId`:

```typescript
const { data: unifiedResult, error: unifiedError } = await supabaseClient.functions.invoke('send-unified-notification', {
  body: {
    userId: userId,
    title: title,
    body: body,
    channels: enabledChannels.filter((channel: string) => ['SLACK', 'EMAIL', 'OUTLOOK_EVENT', 'GOOGLE_EVENT'].includes(channel)),
    data: notificationData,
    notificationId: notificationIds[0]  // Pass the original notification ID
  }
});
```

### Fix 2: Remove ALL duplicate INSERT logic from send-unified-notification

**File:** `supabase/functions/send-unified-notification/index.ts`

**Change 1:** Remove lines 514-538 (the block that creates a record when `!notificationId`)

Replace:
```typescript
} else if (!notificationId) {
  // If we handled all channels directly, create a notification record
  const notificationRecord = { ... };
  try {
    const { data: savedNotification } = await supabaseClient
      .from('scheduled_notifications')
      .insert(notificationRecord)
      ...
  }
}
```

With:
```typescript
} else if (!notificationId) {
  // Don't create duplicate notification records
  // notification-delivery already created the record and will mark it delivered
  console.log('[Notification] No notificationId provided - skipping record creation (notification-delivery handles status)');
}
```

**Change 2:** In `callUnifiedWebhook` function, remove lines 662-688 and 802-828 (both INSERT blocks)

Replace the INSERT logic at the end of `callUnifiedWebhook` with:
```typescript
// Don't insert new notification records here - notification-delivery owns the lifecycle
// Just update existing if notificationId was provided
if (existingNotificationId) {
  result.notificationId = existingNotificationId;
} else {
  console.log('[Webhook] No notificationId provided - skipping record creation');
}
```

### Fix 3: Add database constraint to prevent future duplicates

**Migration SQL:**

```sql
-- Prevent duplicate notifications for the same task/type within a 1-minute window
-- This is a safety net in case code creates duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_notifications_dedup
ON scheduled_notifications (task_id, notification_type, date_trunc('minute', scheduled_for))
WHERE task_id IS NOT NULL 
  AND delivered_at IS NULL 
  AND failed_at IS NULL;
```

---

## Summary of All Changes

| File | Line(s) | Change |
|------|---------|--------|
| `notification-delivery/index.ts` | 565-573 | Add `notificationId: notificationIds[0]` to invoke body |
| `send-unified-notification/index.ts` | 514-538 | Remove INSERT block, add skip log |
| `send-unified-notification/index.ts` | 662-688 | Remove INSERT block in callUnifiedWebhook (webhook not configured case) |
| `send-unified-notification/index.ts` | 802-828 | Remove INSERT block at end of callUnifiedWebhook |
| New migration | - | Add unique partial index on (task_id, notification_type, minute) |

---

## Why This is the Complete Fix

The notification lifecycle should be:

1. **Database trigger** (`schedule_task_reminders`) creates the ONLY notification record
2. **Cron job** runs `notification-delivery` every minute
3. `notification-delivery` claims due notifications and processes them
4. `notification-delivery` calls `send-unified-notification` WITH the notificationId
5. `send-unified-notification` creates Outlook/Google events and updates the EXISTING record
6. `notification-delivery` marks the original record as delivered

Currently, step 4 doesn't pass the ID, and step 5 creates NEW records instead of updating, causing the cron to pick up duplicates on subsequent runs.

---

## Expected Outcome

After this fix:
- Each task will have exactly 4 notification records (from the database trigger): task_start_reminder, task_start_now, due_soon, due_now
- Each record will be processed exactly ONCE
- Only ONE Outlook calendar event will be created per task
- The event will use the task's actual `start_time`, not a fallback
- No more duplicate Slack messages, emails, or calendar events
