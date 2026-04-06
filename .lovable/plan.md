

# Safeguard: Only Delete App-Originated Calendar Events

## How It Works

The `external_calendar_events` table already has a `source_task_id` column:

- **App → Calendar** (task scheduled, event pushed): `source_task_id` is set to the task's ID
- **Calendar → App** (external event synced in): `source_task_id` is NULL

## The Rule

Before calling the provider DELETE API, check `source_task_id IS NOT NULL` for the event. If it's NULL, the event originated externally — skip the delete.

## Changes

### `supabase/functions/calendar-integration-manager/index.ts`

In the new `delete_event` action handler:

1. Look up the event in `external_calendar_events` by `source_task_id = task_id`
2. If no row found → the event wasn't app-created → return success (no-op)
3. If found → proceed with provider DELETE API call + DB cleanup

```text
deleteCalendarEvent(task_id):
  row = SELECT * FROM external_calendar_events WHERE source_task_id = task_id
  if (!row) → return { success: true, skipped: true }  // not app-originated
  → call provider DELETE
  → DELETE from external_calendar_events
  → clear tasks.external_event_id
```

### `supabase/functions/nightly-schedule-builder/index.ts`

During schedule clear, only delete events for tasks where a matching `external_calendar_events` row exists with `source_task_id = task.id`. Tasks that only have calendar-synced events (no `source_task_id`) are left untouched.

## Summary

| Origin | `source_task_id` | Delete on complete/reschedule? |
|--------|-------------------|-------------------------------|
| App pushed to calendar | task UUID | Yes |
| Synced from external calendar | NULL | No |

No schema changes needed — the column already exists and is already populated correctly by both sync paths.

