

# Complete Fix Plan: Date Utility Enforcement + Notification Trigger + Multi-Channel Comms

## Overview

This plan addresses **6 issues** in order of priority:

1. **Date parsing uses UTC instead of centralized timezone utility** in batch-calendar-scheduler and ai-task-parser
2. **OpenAI assistant calls `schedule_task` after batch scheduler** overwrites correct dates with stale ones
3. **Database trigger deletes ALL notifications** including `task_created` on task UPDATE
4. **Missing past-date validation** in schedule_task
5. **Version bump** for tracing
6. **Multi-channel comms mode** for recurring jobs (Phase 2)

---

## Phase 1: Critical Scheduling Fixes

### Fix 1: batch-calendar-scheduler - Use Centralized Timezone Utility

**File**: `supabase/functions/batch-calendar-scheduler/index.ts`

**Problem**: Lines 77 and 86-91 use UTC-based parsing which causes dates to shift to "yesterday" near midnight.

**Changes**:
- Line 4: Add `getTodayInTimezone` to import from `_shared/timezone.ts`
- Lines 77-91: Replace UTC logic with timezone-aware parsing:
  - Use `getTodayInTimezone(timezone)` instead of `now.toISOString().split('T')[0]`
  - Parse `targetDate` by splitting the YYYY-MM-DD string and setting hours to noon local time
  - Avoid `new Date(targetDate)` which interprets as UTC midnight

---

### Fix 2: ai-task-parser - Use User's Timezone for Date Context

**File**: `supabase/functions/ai-task-parser/index.ts`

**Problem**: Lines 101-110 and 116-122 format dates without timezone parameter, causing inconsistent date context sent to the AI.

**Changes**:
- Lines 101-110: Add `timeZone: userTz` parameter to `toLocaleDateString()` and `toLocaleTimeString()`
- Lines 116-122: Parse `targetDate` by splitting the string instead of using `new Date()`, then format with timezone

---

### Fix 3: schedule_task - Skip Already-Scheduled Tasks + Past Date Validation

**File**: `supabase/functions/execute-tool/index.ts`

**Problem**: `schedule_task` can overwrite already-scheduled tasks with stale dates from the OpenAI assistant.

**Changes** to `scheduleTask()` function (lines 1041-1095):

1. **Add skip-if-scheduled check**: Query the task first, if `is_scheduled === true` and `start_time` exists, return early with a message suggesting `reschedule_task` instead

2. **Add past-date validation**: Compare `args.date` against `getTodayInTimezone(tz)`, if date is in the past, auto-correct to today with a warning log

---

### Fix 4: Database Trigger - Preserve task_created Notifications

**SQL Migration**: Modify `schedule_task_reminders` function

**Problem**: The DELETE statement removes ALL notifications including `task_created` when a task is updated.

**Change**: Modify the DELETE statement to exclude `task_created`:

```sql
DELETE FROM scheduled_notifications 
WHERE task_id = NEW.id 
  AND notification_type NOT IN ('task_created')
  AND delivered_at IS NULL 
  AND failed_at IS NULL;
```

This ensures `task_created` notifications survive task updates and get delivered to Slack.

---

### Fix 5: Version Bump

**File**: `supabase/functions/_shared/config.ts`

**Change**: Update `GLOBAL_VERSION` to `"2026-02-04-v23"`

---

## Phase 1 Summary

| File | Changes |
|------|---------|
| `supabase/functions/batch-calendar-scheduler/index.ts` | Import and use `getTodayInTimezone()`, parse targetDate without UTC shift |
| `supabase/functions/ai-task-parser/index.ts` | Add `timeZone` parameter to date formatting |
| `supabase/functions/execute-tool/index.ts` | Add skip-if-scheduled + past-date validation to scheduleTask |
| `supabase/functions/_shared/config.ts` | Bump version to v23 |
| **Database**: `schedule_task_reminders` trigger | Exclude `task_created` from DELETE on UPDATE |

---

## Phase 2: Multi-Channel Comms Mode (Follow-up)

### Overview

Enable recurring jobs (morning stand-up, midday check-in, EOD wrap-up) to use different communication channels:

- **Phone Call** (Twilio) - existing behavior
- **In-App Message** (Comms Console with push notification)
- **Slack Message**
- **Email**

### Schema Enhancement

Add `commsMode` field to scheduled calls JSONB:

```typescript
interface ScheduledCall {
  id: string;
  name: string;
  time: string;
  enabled: boolean;
  callType: string;
  context: string;
  commsMode: 'phone' | 'app_message' | 'slack' | 'email';  // NEW
}
```

### UI Changes

**File**: `src/components/VoiceAssistantSettings.tsx`

Add "Delivery Method" dropdown to each scheduled call card with options for Phone, In-App Message, Slack, and Email.

**File**: `src/services/schedulingService.ts`

Update `ScheduledCall` type to include `commsMode`.

### Backend Changes

**File**: `supabase/functions/twilio-scheduled-call/index.ts`

Modify `processRecurringCalls()` to branch by `commsMode`:
- `phone` → existing Twilio call logic
- `app_message` → hybrid-assistant-api + send-push-notification
- `slack` → send-unified-notification (Slack channel)
- `email` → send-unified-notification (Email channel)

### Push Notification Enhancement

**File**: `public/sw.js`

Handle notification clicks to open Comms Console to the relevant thread.

---

## Phase 2 Summary

| File | Changes |
|------|---------|
| `src/services/schedulingService.ts` | Add `commsMode` to `ScheduledCall` type |
| `src/components/VoiceAssistantSettings.tsx` | Add "Delivery Method" dropdown per call |
| `supabase/functions/twilio-scheduled-call/index.ts` | Branch by `commsMode`, add handler functions |
| `public/sw.js` | Handle notification click to open Comms Console |

---

## Expected Outcomes

### After Phase 1
- `getTodayInTimezone('America/New_York')` returns correct date regardless of server UTC time
- AI prompts show correct dates like "Tuesday, February 4, 2026"
- If OpenAI calls `schedule_task` after batch scheduler, it's skipped with "already scheduled" message
- Past dates are auto-corrected to today with warning logs
- `task_created` notifications survive task updates and get delivered to Slack

### After Phase 2
- Each recurring job can be configured to contact you via phone, in-app message, Slack, or email
- In-app messages include push notifications that feel like SMS
- All existing phone calls continue working (backward compatible)

