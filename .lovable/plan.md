
# Plan: Enhanced Tracing, Status Logic Fix, and Notification Flow Debugging

## Summary of Issues Identified

### Issue 1: Tasks Going to BACKLOG Instead of UP_NEXT
**Root Cause Found**: The `ai-task-parser/index.ts` (lines 327-346) has logic to set `status: 'UP_NEXT'` for today's tasks, BUT this gets overwritten in `execute-tool/index.ts` at line 1320:

```typescript
// execute-tool/index.ts line 1313-1321
const { error: updateError } = await supabase
  .from('tasks')
  .update({
    start_time: slot.start_time,
    end_time: slot.end_time,
    due_date: syncedDueDate,
    is_scheduled: true,
    status: 'TODO'  // <-- OVERWRITES the UP_NEXT status!
  })
  .eq('id', task.id);
```

The batch scheduler update sets `status: 'TODO'` regardless of what the parser returned.

### Issue 2: Duplicate Outlook Events
**Observation**: You saw "Test Task" twice in Outlook at 10:42 PM. The data shows:
- `external_calendar_events` table is empty (no events logged!)
- The 24-hour idempotency check in `send-unified-notification` relies on this table
- Since events aren't being written to this table, the deduplication fails

**Root Cause**: The `send-unified-notification` function creates Outlook events via Graph API but doesn't record them in `external_calendar_events` after successful creation.

### Issue 3: Reminder Not Received (Outlook Event Created Too Late)
**Timeline Analysis**:
- Task created at ~10:42 PM with 15-minute reminder
- Slack notification sent immediately (via cron within 1-2 minutes)
- Outlook event creation depends on:
  1. Task gets scheduled (creates `scheduled_notifications` with `task_start_reminder` type)
  2. `notification-delivery` cron claims and processes it
  3. `send-unified-notification` creates the Outlook event

If the Outlook event was created AFTER the task start time (10:42 PM), the 15-minute reminder window already passed.

### Issue 4: Insufficient Tracing for Debugging
Current state:
- `error_log` table exists but only captures boot traces and errors
- Edge function logs are ephemeral and disappear quickly
- No persistent trace of notification delivery or calendar event creation
- Cannot correlate task creation → notification creation → delivery → calendar event

---

## Technical Changes

### Part 1: Fix Status Logic for Today's Tasks

**File: `supabase/functions/execute-tool/index.ts`**

At line 1313-1322, update the status logic to check if task is for today:

```typescript
// Around line 1300, add helper to check if date is today
const isToday = (dateString: string, timezone: string): boolean => {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  const targetDay = dateString.split('T')[0];
  return today === targetDay;
};

// Then at line 1313-1322, modify the update:
const scheduledDate = slot.start_time.split('T')[0];
const syncedDueDate = normalizeDueDate(scheduledDate, tz);
const taskStatus = isToday(slot.start_time, tz) ? 'UP_NEXT' : 'TODO';

console.log(`[PARSE_AND_CREATE] Applying schedule: task="${task.title}", start=${slot.start_time}, status=${taskStatus}`);

const { error: updateError } = await supabase
  .from('tasks')
  .update({
    start_time: slot.start_time,
    end_time: slot.end_time,
    due_date: syncedDueDate,
    is_scheduled: true,
    status: taskStatus  // Dynamic: UP_NEXT for today, TODO for future
  })
  .eq('id', task.id);
```

### Part 2: Record Outlook Events in external_calendar_events

**File: `supabase/functions/send-unified-notification/index.ts`**

After successful Outlook event creation (around line 500-513), add recording logic:

```typescript
result.channelResults.outlook = outlookResult;

// Record the event in external_calendar_events for deduplication and sync
if (outlookResult.success && outlookResult.details?.eventId && taskData?.taskId) {
  try {
    const connection = await getOutlookConnectionForUser(supabaseClient, userId);
    await supabaseClient.from('external_calendar_events').insert({
      user_id: userId,
      connection_id: connection?.id || null,
      external_event_id: outlookResult.details.eventId,
      source_task_id: taskData.taskId,
      title: eventTitle,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      last_synced_at: new Date().toISOString()
    });
    console.log('[Notification] Recorded Outlook event in external_calendar_events');
  } catch (recordError) {
    console.error('[Notification] Failed to record event:', recordError);
    // Don't fail the notification - event was created successfully
  }
}
```

### Part 3: Add Comprehensive Activity Logging

Create a new logging helper and add structured logs at key points.

**File: `supabase/functions/_shared/activityLogger.ts`** (new file)

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface ActivityLogEntry {
  event_type: 'task_created' | 'task_scheduled' | 'notification_created' | 'notification_delivered' | 'calendar_event_created' | 'calendar_event_failed' | 'tool_executed';
  user_id: string;
  entity_type: 'task' | 'notification' | 'calendar_event' | 'tool';
  entity_id: string;
  details: Record<string, any>;
  source_function: string;
}

export async function logActivity(supabase: any, entry: ActivityLogEntry): Promise<void> {
  try {
    await supabase.from('activity_log').insert({
      user_id: entry.user_id,
      source: entry.source_function,
      event_type: entry.event_type,
      session_id: entry.entity_id,
      phone_number: null,
      direction: null,
      status: 'completed',
      stage: entry.event_type,
      error_message: null,
      metadata: entry.details
    });
  } catch (e) {
    console.error('[ActivityLogger] Failed to log:', e);
  }
}
```

**File: `supabase/functions/execute-tool/index.ts`**

Add logging after task creation (around line 1253):

```typescript
if (data) {
  createdTasks.push(data);
  console.log(`[PARSE_AND_CREATE] Created task: ${data.title} (${data.id})`);
  
  // Log to activity_log for tracing
  await supabase.from('activity_log').insert({
    user_id: userId,
    source: 'execute-tool',
    event_type: 'task_created',
    session_id: data.id,
    status: 'completed',
    stage: 'parse_and_create',
    metadata: { title: data.title, category: data.category, status: data.status }
  }).catch(() => {}); // Best effort
}
```

**File: `supabase/functions/notification-delivery/index.ts`**

Add logging after successful notification processing (around line 599):

```typescript
if (updateError) {
  console.error('Error updating notification status:', updateError);
  failed += batchNotifications.length;
} else {
  console.log(`Successfully delivered batch for user ${userId} (${batchNotifications.length} notifications)`);
  delivered += batchNotifications.length;
  
  // Log each notification for tracing
  for (const notif of batchNotifications) {
    await supabaseClient.from('activity_log').insert({
      user_id: userId,
      source: 'notification-delivery',
      event_type: 'notification_delivered',
      session_id: notif.id,
      status: 'completed',
      stage: notif.notification_type,
      metadata: { 
        task_id: notif.task_id,
        channels: enabledChannels,
        title: notif.title 
      }
    }).catch(() => {}); // Best effort
  }
}
```

**File: `supabase/functions/send-unified-notification/index.ts`**

Add logging after Outlook event creation (around line 508):

```typescript
if (outlookResult.success) {
  console.log('[Notification] Outlook event created successfully');
  
  // Log for tracing
  await supabaseClient.from('activity_log').insert({
    user_id: userId,
    source: 'send-unified-notification',
    event_type: 'calendar_event_created',
    session_id: outlookResult.details?.eventId || 'unknown',
    status: 'completed',
    stage: 'outlook_event',
    metadata: { 
      task_id: taskData?.taskId,
      start_time: startTime.toISOString(),
      event_id: outlookResult.details?.eventId
    }
  }).catch(() => {});
} else {
  console.error('[Notification] Outlook event creation failed:', outlookResult.error);
  
  // Log failure for tracing
  await supabaseClient.from('activity_log').insert({
    user_id: userId,
    source: 'send-unified-notification',
    event_type: 'calendar_event_failed',
    session_id: taskData?.taskId || 'unknown',
    status: 'error',
    stage: 'outlook_event',
    error_message: outlookResult.error,
    metadata: { task_id: taskData?.taskId }
  }).catch(() => {});
  
  result.errors.push(`Outlook: ${outlookResult.error}`);
}
```

### Part 4: Add Deployment Version Verification Endpoint

**File: `supabase/functions/ping/index.ts`**

Update to return comprehensive deployment info:

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GLOBAL_VERSION, FUNCTION_IDS, corsHeaders } from "../_shared/config.ts";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const deploymentInfo = {
    global_version: GLOBAL_VERSION,
    function_versions: Object.fromEntries(
      Object.entries(FUNCTION_IDS).map(([key, id]) => [key, `${GLOBAL_VERSION}-${id}`])
    ),
    deployed_at: new Date().toISOString(),
    environment: Deno.env.get('SUPABASE_URL')?.includes('supabase.co') ? 'production' : 'local',
    status: 'healthy'
  };

  return new Response(JSON.stringify(deploymentInfo), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
});
```

### Part 5: Add Debug Query View for Activity Tracing

Create a SQL view that joins activity across the system:

**SQL Migration** (to be run in Cloud View):

```sql
CREATE OR REPLACE VIEW notification_trace AS
SELECT 
  t.id as task_id,
  t.title as task_title,
  t.start_time as task_start_time,
  t.created_at as task_created_at,
  t.status as task_status,
  sn.id as notification_id,
  sn.notification_type,
  sn.scheduled_for,
  sn.delivered_at,
  sn.failed_at,
  sn.failure_reason,
  ece.id as calendar_event_id,
  ece.external_event_id,
  ece.created_at as calendar_created_at,
  al.event_type as activity_event,
  al.created_at as activity_timestamp,
  al.metadata as activity_metadata
FROM tasks t
LEFT JOIN scheduled_notifications sn ON sn.task_id = t.id
LEFT JOIN external_calendar_events ece ON ece.source_task_id = t.id
LEFT JOIN activity_log al ON (
  al.session_id = t.id::text 
  OR al.session_id = sn.id::text
  OR al.metadata->>'task_id' = t.id::text
)
WHERE t.created_at > NOW() - INTERVAL '7 days'
ORDER BY t.created_at DESC, al.created_at ASC;
```

---

## Summary of Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/execute-tool/index.ts` | Fix status logic: UP_NEXT for today, TODO for future; add activity logging |
| `supabase/functions/send-unified-notification/index.ts` | Record Outlook events in external_calendar_events; add activity logging |
| `supabase/functions/notification-delivery/index.ts` | Add activity logging after delivery |
| `supabase/functions/ping/index.ts` | Return comprehensive deployment version info |
| `supabase/functions/_shared/config.ts` | Bump GLOBAL_VERSION to indicate new deployment |

---

## Expected Outcomes

1. **Task Status Fix**: Tasks scheduled for today will show in "Up Next" column instead of "Backlog"

2. **Duplicate Prevention**: Outlook events will be recorded in `external_calendar_events`, enabling the 24-hour idempotency check to work

3. **End-to-End Tracing**: Activity log entries for:
   - Task creation (with title, category, status)
   - Notification delivery (with channels, task_id)
   - Calendar event creation/failure (with event_id, start_time)

4. **Deployment Verification**: `ping` endpoint returns version info to verify published site is using latest code

5. **Debug Query**: `notification_trace` view joins tasks → notifications → calendar events → activity log for complete tracing

---

## Debug Workflow After Implementation

To trace a task creation issue:

```sql
-- Find task and all related activity
SELECT * FROM notification_trace 
WHERE task_title LIKE '%Test Task%'
ORDER BY activity_timestamp ASC;

-- Check if calendar event was created
SELECT * FROM external_calendar_events 
WHERE source_task_id = 'task-uuid-here';

-- Verify deployment version
-- Call: GET /functions/v1/ping
-- Response shows: { global_version: "2026-02-03-v17", ... }
```
