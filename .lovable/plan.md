# Fix: Outlook Calendar Events Use Task's Actual Start Time

## Problem

When automated task reminders trigger (via `notification-delivery`), Outlook calendar events are created at the **wrong time** because:

1. `notification-delivery` calls `send-unified-notification` with only `taskId`
2. `send-unified-notification` fetches task data but the response may not include `start_time`
3. Falls back to "1 hour from now" instead of the task's actual scheduled time

**Result**: A task scheduled for 11:30 AM creates an Outlook event at ~11:30 AM (when notification fires) + 1 hour = 12:30 PM ❌

## Solution

### 1. Update `notification-delivery` to Pass Task Times

**File**: `supabase/functions/notification-delivery/index.ts`

After fetching the task data for the notification, explicitly pass `startTime` and `endTime` to `send-unified-notification`:

```typescript
// When calling send-unified-notification for OUTLOOK channel
const payload = {
  userId: notification.user_id,
  taskId: notification.task_id,
  channel: 'OUTLOOK',
  title: notification.title,
  body: notification.body,
  // ADD THESE - use task's actual times
  startTime: task.start_time,  
  endTime: task.end_time || calculateEndTime(task.start_time, task.estimate_minutes)
};
```

### 2. Verify `send-unified-notification` Uses Passed Times

**File**: `supabase/functions/send-unified-notification/index.ts`

Ensure it prioritizes the passed `startTime` over fetched/default values:

```typescript
// Current (problematic):
const startTime = taskData.startTime || new Date(Date.now() + 3600000).toISOString();

// Fixed:
const startTime = requestBody.startTime || taskData?.start_time || new Date(Date.now() + 3600000).toISOString();
```

### 3. Handle Edge Cases

- **Task with `due_date` but no `start_time`**: Use `due_date` as the event time
- **Task with neither**: Fall back to current behavior (1 hour from now) with warning log

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/notification-delivery/index.ts` | Pass `startTime`/`endTime` from task to `send-unified-notification` |
| `supabase/functions/send-unified-notification/index.ts` | Prioritize passed times over defaults |

## Expected Behavior After Fix

1. Task created for 11:30 AM → Reminder scheduled for 11:15 AM
2. At 11:15 AM, `notification-delivery` triggers
3. Slack message sent: "Task starts in 15 minutes" ✅
4. Outlook event created for **11:30 AM** (not 12:15 PM) ✅
5. Outlook native reminder triggers at 11:15 AM ✅

## Testing

1. Create a task with `start_time` 20 minutes from now
2. Wait for the 15-minute reminder to trigger
3. Check Outlook calendar - event should be at the task's actual time
