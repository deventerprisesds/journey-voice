

## Three Questions, Three Answers

### 1. How to use `.lovable/rules.md`

The `.lovable/rules.md` file is automatically read by me at the start of every conversation. It acts as persistent instructions I always follow. Right now it only contains debug tracker rules. We should expand it to reference the 10 documentation files we just created, so I always have context about the system architecture, voice pipeline, decision history, etc.

**What to add:** References to all docs, key architectural constraints, and reminders to check specific docs before touching specific subsystems.

### 2. Why you got a Saturday 6am call

**Root cause found:** The `schedule_next_call` SQL function **does not accept or use `days_of_week` at all**. The latest version (migration `20260204`) only takes 7 parameters: `user_id, call_id, call_name, call_time, call_context, timezone, comms_mode`. It simply schedules for "tomorrow if today's time has passed" — with zero day-of-week filtering.

The `notification-delivery` edge function has a day-of-week guard (line 155-173) that checks `callConfig.days_of_week`, but this data is never stored in the notification body because the `sync_scheduled_calls` trigger doesn't extract or pass `daysOfWeek` from the JSON either.

So: **Morning Kickstart (6am) has `daysOfWeek: [1,2,3,4,5]` in the UI, but the scheduled notification row has no `days_of_week` field** → the guard in `notification-delivery` sees no array → skips the check → delivers on Saturday.

### 3. Why no weekday/weekend day selection in settings

**It's actually there!** Each recurring call card has M/T/W/T/F/S/S day-of-week chip buttons (lines 954-980 in `VoiceAssistantSettings.tsx`). They toggle individual days. However, the bug above means these selections aren't persisted into the notification body, so they have no actual effect on delivery.

---

## Fix Plan

### Step 1: Update `schedule_next_call` SQL function
- Add `p_days_of_week INTEGER[] DEFAULT NULL` parameter
- Store it in the notification body JSON
- When calculating `v_next_datetime`, advance to the next day that's in `p_days_of_week`

### Step 2: Update `sync_scheduled_calls` trigger
- Extract `daysOfWeek` from each call's JSON
- Pass it as `p_days_of_week` to `schedule_next_call`

### Step 3: Update `notification-delivery` edge function
- When calling `scheduleNextOccurrence`, ensure `days_of_week` from the notification body is forwarded correctly (this already works if the data is present)

### Step 4: Update `.lovable/rules.md`
- Add references to all 10 documentation files
- Add key rules like "always check VOICE_SYSTEM.md before touching audio pipeline" and "check DECISION_LOG.md before proposing architectural changes"

