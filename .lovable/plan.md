

# Plan: Fix Task Status, Auto-Calculate End Time, Immediate Outlook Event, and Logging

## Summary

Implementing all approved fixes plus the missing logging corrections:

1. **Calculate end_time automatically** when start_time exists - makes `is_scheduled=true`, skips batch scheduler
2. **Status logic**: Scheduled tasks (today OR future) → `UP_NEXT`, unscheduled/undated → `BACKLOG`
3. **Create Outlook event immediately** at task creation time
4. **Skip calendar channels in notification-delivery** to prevent duplicates
5. **Fix broken `.catch()` logging** in notification-delivery and send-unified-notification

---

## Technical Changes

### File 1: `supabase/functions/execute-tool/index.ts`

**Lines 1226-1227** - Calculate end_time when missing:

```typescript
// Current:
const normalizedStartTime = task.start_time ? normalizeDateTime(task.start_time, tz) : null;
const normalizedEndTime = task.end_time ? normalizeDateTime(task.end_time, tz) : null;

// Replace with:
const normalizedStartTime = task.start_time ? normalizeDateTime(task.start_time, tz) : null;
let normalizedEndTime = task.end_time ? normalizeDateTime(task.end_time, tz) : null;

// Calculate end_time from start_time + estimate if missing
if (normalizedStartTime && !normalizedEndTime) {
  const durationMinutes = task.estimate_minutes || task.estimatedDuration || 60;
  const endDate = new Date(new Date(normalizedStartTime).getTime() + durationMinutes * 60000);
  normalizedEndTime = endDate.toISOString();
  console.log(`[PARSE_AND_CREATE] Calculated end_time for "${task.title}": ${normalizedEndTime} (${durationMinutes} min)`);
}
```

**Line 1236** - Fix status logic (scheduled = UP_NEXT, unscheduled = BACKLOG):

```typescript
// Current:
status: task.status || 'BACKLOG',

// Replace with:
status: task.status || (normalizedStartTime ? 'UP_NEXT' : 'BACKLOG'),
```

**After line 1268** - Add immediate Outlook event creation:

```typescript
// Create Outlook calendar event IMMEDIATELY if task has scheduled time
if (data.start_time) {
  console.log(`[PARSE_AND_CREATE] Creating immediate Outlook event for "${data.title}" at ${data.start_time}`);
  
  supabase.functions.invoke('send-unified-notification', {
    body: {
      userId: userId,
      title: `Task: ${data.title}`,
      body: data.description || 'Scheduled task',
      channels: ['OUTLOOK_EVENT'],  // Only Outlook - Slack/Email via reminders
      data: {
        type: 'task_calendar_event',
        taskId: data.id,
        taskTitle: data.title,
        startTime: data.start_time,
        endTime: data.end_time,
        estimateMinutes: data.estimate_minutes
      }
    }
  }).then(response => {
    console.log(`[PARSE_AND_CREATE] Outlook event result:`, response.data?.channelResults?.outlook);
  }).catch(err => {
    console.error(`[PARSE_AND_CREATE] Outlook event failed:`, err);
  });
}
```

---

### File 2: `supabase/functions/notification-delivery/index.ts`

**Lines 604-616** - Fix broken logging pattern:

```typescript
// Current (BROKEN):
await supabaseClient.from('activity_log').insert({
  ...
}).catch(() => {}); // Best effort

// Replace with:
supabaseClient.from('activity_log').insert({
  user_id: userId,
  activity_type: 'notification_delivered',
  session_id: notif.id,
  status: 'completed',
  stage: notif.notification_type,
  metadata: { 
    task_id: notif.task_id,
    channels: enabledChannels,
    title: notif.title,
    notification_type: notif.notification_type
  }
}).then(() => {
  console.log(`[DELIVERY] Activity logged: notification_delivered for ${notif.notification_type}`);
}).catch(() => {
  // Silently ignore logging failures
});
```

**Around line 543** - Skip calendar channels (event created at task time):

```typescript
// Filter channels - Outlook/Google events are created at task creation, not reminder delivery
const channelsForDelivery = enabledChannels.filter((channel: string) => {
  if (['OUTLOOK_EVENT', 'GOOGLE_EVENT'].includes(channel)) {
    console.log(`📅 Skipping ${channel} - event created at task creation time`);
    return false;
  }
  return ['SLACK', 'EMAIL'].includes(channel);
});
```

---

### File 3: `supabase/functions/send-unified-notification/index.ts`

**Lines 535-547** - Fix broken logging pattern:

```typescript
// Current (BROKEN):
await supabaseClient.from('activity_log').insert({
  ...
}).catch(() => {});

// Replace with:
supabaseClient.from('activity_log').insert({
  user_id: userId,
  activity_type: 'calendar_event_created',
  session_id: outlookResult.details?.eventId || 'unknown',
  status: 'completed',
  stage: 'outlook_event',
  metadata: { 
    task_id: taskData?.taskId,
    start_time: startTime.toISOString(),
    event_id: outlookResult.details?.eventId,
    account: outlookResult.details?.account
  }
}).then(() => {
  console.log(`[Notification] Activity logged: calendar_event_created`);
}).catch(() => {
  // Silently ignore logging failures
});
```

**Lines 553-561** - Same fix for failure logging:

```typescript
supabaseClient.from('activity_log').insert({
  user_id: userId,
  activity_type: 'calendar_event_failed',
  session_id: taskData?.taskId || 'unknown',
  status: 'error',
  stage: 'outlook_event',
  error_message: outlookResult.error,
  metadata: { task_id: taskData?.taskId }
}).then(() => {
  console.log(`[Notification] Activity logged: calendar_event_failed`);
}).catch(() => {
  // Silently ignore logging failures
});
```

---

### File 4: `supabase/functions/_shared/config.ts`

**Line 6**:
```typescript
export const GLOBAL_VERSION = "2026-02-03-v19";
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/execute-tool/index.ts` | Calculate end_time, fix status logic, add immediate Outlook event |
| `supabase/functions/notification-delivery/index.ts` | Fix logging, skip calendar channels |
| `supabase/functions/send-unified-notification/index.ts` | Fix logging pattern (2 locations) |
| `supabase/functions/_shared/config.ts` | Bump version to v19 |

---

## Status Logic Summary

| Condition | Status |
|-----------|--------|
| Has `start_time` (today) | `UP_NEXT` |
| Has `start_time` (future) | `UP_NEXT` |
| No `start_time` (unscheduled) | `BACKLOG` |

---

## Expected Flow After Fix

```text
User: "task for 3:00 AM tomorrow"

1. parse_and_create_tasks:
   - Parses start_time → 08:00 UTC
   - Calculates end_time → 09:00 UTC (+60 min)
   - is_scheduled: true ✓
   - status: UP_NEXT ✓
   - Inserts task
   - IMMEDIATELY creates Outlook event ← Appears on calendar now!
   - Activity logged: task_created ✓
   
2. Batch scheduler: SKIPPED (is_scheduled=true)

3. DB trigger: Creates notifications
   - task_start_reminder at 07:45 UTC
   - task_start_now at 08:00 UTC

4. notification-delivery (at 07:45):
   - Sends Slack notification ✓
   - SKIPS Outlook (already exists)
   - Activity logged: notification_delivered ✓
```

