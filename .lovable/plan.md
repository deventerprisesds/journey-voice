

# Revised Plan: External Calendar Reminders + AI Auto-Scheduling Fix

## Assessment: What We Can Reuse

The existing infrastructure is well-suited for both fixes. Here's the reuse map:

| Existing Component | Reuse For |
|---|---|
| `notification-scheduler` (cron, per-user loop, quiet hours, channel prefs) | Add external event scanning directly here — no new edge function needed |
| `scheduled_notifications` table | Store calendar event reminders the same way as task reminders |
| `notification-delivery` pipeline (push, Slack, email routing) | Delivers calendar reminders with zero changes |
| `notification_prefs` table (channels, quiet hours, timezone) | Add 3 columns for calendar reminder config |
| `NotificationSettings.tsx` UI | Add one new section for calendar event reminder toggles |
| `_shared/tool-definitions.ts` | Update `parse_and_create_tasks` description |
| `hybrid-assistant-api` DATA INTEGRITY RULES | Add one line about auto-scheduling |

**Key decision: No new edge function.** The `notification-scheduler` already runs on a cron, loops through all users, queries their tasks, checks quiet hours, and inserts into `scheduled_notifications`. We add one function call inside that loop to also scan `external_calendar_events` for the same user. The `notification-delivery` function already dispatches to push/Slack/email based on the notification type — it requires zero changes.

---

## Fix 1: External Calendar Event Reminders

### Database migration
Add 3 columns to `notification_prefs`:
- `calendar_reminders_enabled` (boolean, default `true`)
- `calendar_reminder_minutes` (integer, default `15`)
- `calendar_reminder_channels` (text array, default `{'PUSH'}`)

### Backend: `notification-scheduler/index.ts`
Inside `processUserNotifications()`, after the existing task processing, add a new block:
1. Check if `prefs.calendar_reminders_enabled` is true
2. Query `external_calendar_events` for this user where `start_time` is within the next `calendar_reminder_minutes + 5` minutes and in the future
3. For each event, check for an existing `scheduled_notifications` row with matching `notification_type = 'calendar_event_reminder'` and a metadata match on `external_event_id` to avoid duplicates
4. Insert a `scheduled_notifications` row with `scheduled_for` = event start minus `calendar_reminder_minutes`, using `notification_type = 'calendar_event_reminder'`

The existing `notification-delivery` already handles any notification type — it reads title/body and dispatches via `send-push-notification`. No changes needed there.

### Frontend: `NotificationSettings.tsx`
Add a "Calendar Event Reminders" card section with:
- Toggle: Enable/disable calendar event reminders
- Dropdown: Lead time (5, 10, 15, 30, 60 minutes)
- Channel checkboxes: Push, Slack, Email

Reads/writes the 3 new `notification_prefs` columns.

---

## Fix 2: AI Stops Asking for Specific Times

### `_shared/tool-definitions.ts`
Update `parse_and_create_tasks` description to append:
> "IMPORTANT: When the user says 'this week', 'sometime soon', or any vague timeframe, set auto_schedule to true and DO NOT ask for a specific time. The batch scheduler will find the optimal slot."

### `hybrid-assistant-api/index.ts`
Add one line to the DATA INTEGRITY RULES block (line 452):
> "When a user asks to create/add/schedule a task, call parse_and_create_tasks immediately with auto_schedule: true. NEVER ask the user for a specific time or day — the scheduler handles placement."

---

## Files Changed

| File | Change | New? |
|---|---|---|
| `notification_prefs` table (migration) | Add 3 calendar reminder columns | Migration |
| `supabase/functions/notification-scheduler/index.ts` | Add `external_calendar_events` scan inside existing user loop | Edit |
| `src/components/NotificationSettings.tsx` | Add calendar reminder settings section | Edit |
| `supabase/functions/_shared/tool-definitions.ts` | Update `parse_and_create_tasks` description | Edit |
| `supabase/functions/hybrid-assistant-api/index.ts` | Add auto-schedule guardrail to DATA INTEGRITY RULES | Edit |

No new edge functions. No new cron jobs. No new tables. Maximum reuse of existing pipeline.

