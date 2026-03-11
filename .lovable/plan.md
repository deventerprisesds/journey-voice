

## Plan: Fix Nightly Scheduler Date Logic + Reschedule Demo Tasks

### Problem
The nightly scheduler runs at midnight (05:00 UTC) but schedules tasks for **tomorrow** (`now + 1 day`). Since it runs at the start of the day, it should schedule for **today** instead.

### Changes

**1. Reschedule demo tasks to today (March 11)**
Run a SQL migration to shift the 9 demo tasks from March 12 back to March 11:
```sql
UPDATE tasks 
SET start_time = start_time - interval '1 day', 
    end_time = end_time - interval '1 day', 
    due_date = '2026-03-11' 
WHERE user_id = '00000000-0000-0000-0000-000000000001' 
  AND start_time::date = '2026-03-12';
```

**2. Fix `nightly-schedule-builder` date logic**  
In `supabase/functions/nightly-schedule-builder/index.ts` (~line 184-187), change from "tomorrow" to "today":

```typescript
// Before:
const tomorrow = new Date(now);
tomorrow.setDate(tomorrow.getDate() + 1);
const tomorrowISO = tomorrow.toISOString().split('T')[0];

// After:
// Schedule for today (the scheduler runs at midnight, filling today's slots)
const todayDate = new Date(now);
const todayISO = todayDate.toISOString().split('T')[0];
```

Update all references from `tomorrowISO` → `todayISO` and `tomorrow` → `today` in the payload, logs, and summary (~lines 200, 204, 261).

**3. Redeploy** the updated edge function.

