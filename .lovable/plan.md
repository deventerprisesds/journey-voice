
The mismatch is real. I found 5 separate causes, and they stack together:

## Why tasks are breaking your window rules

1. **Your backend is not actually using saved custom window settings for your user**
   - In `user_scheduling_prefs`, your user record (`a3378f93-...`) currently has `config = null`.
   - That means the schedulers are falling back to built-in defaults instead of enforcing your custom mappings.

2. **The fallback defaults are inconsistent across the app**
   - Frontend default config:
     - `PROF_EDUCATION -> after_work/weekends`
     - `EDUCATION -> flexible`
   - `nightly-schedule-builder` fallback:
     - `PROF_EDUCATION -> business_hours/after_work`
     - `EDUCATION -> after_work/evening`
   - So selection logic and placement logic are already starting from different rules.

3. **`batch-calendar-scheduler` explicitly tells the AI to override category windows**
   - Its prompt says category windows are only a “DEFAULT starting point”.
   - It then forces:
     - financial tasks -> `business_hours`
     - communication tasks -> `business_hours`
     - workouts -> `morning`
   - So the current code is intentionally treating settings as soft preferences, not hard constraints.

4. **There is no hard validator after the AI returns times**
   - The scheduler accepts the AI’s times and writes them to the DB.
   - It does **not** check whether each slot actually falls inside that task’s allowed windows.

5. **The Focus View visually hides violations**
   - `FocusView.tsx` snaps out-of-window tasks into the nearest bucket.
   - Example: a **5:00 AM** task is shown under **Morning** even though Morning starts at **6:00**.
   - So some broken placements are being normalized in the UI instead of surfaced as invalid.

## Evidence from today’s schedule

From the current board/data:
- `PROF_EDUCATION` tasks at **5:00 AM** and **6:15 AM** are outside the configured/default allowed windows.
- An `EDUCATION` task at **7:30 AM** is also outside the default `flexible` window if `flexible` starts at 9:00.
- Several `LIFE` / `VENTURES` tasks during business hours are explained by the current “financial/comms override” logic, not by your settings.

## What to build to fix it

1. **Make one shared source of truth for scheduling config**
   - Use the same defaults + merge behavior everywhere:
     - frontend
     - `nightly-schedule-builder`
     - `batch-calendar-scheduler`

2. **Fix settings persistence**
   - Ensure the Scheduling Settings screen is actually saving `timeWindows` and `categoryMappings` into `user_scheduling_prefs.config` for the logged-in user.
   - Add logging/guards so the scheduler warns when config is empty.

3. **Change window rules from soft preferences to hard constraints**
   - Saved category windows should be the allowed windows.
   - Financial/comms/due-soon heuristics should only affect **priority order inside allowed windows**, not override them.

4. **Add post-AI enforcement**
   - After the AI returns slots:
     - compute allowed windows for each task on that target day
     - reject or mark `OVERFLOW` if the time falls outside allowed windows
     - never persist an invalid slot

5. **Actually use `windowCapacity`**
   - `nightly-schedule-builder` sends it, but `batch-calendar-scheduler` currently ignores it.
   - It should be included in the AI prompt and in server-side validation.

6. **Stop masking violations in the UI**
   - In `FocusView`, show an “Outside allowed window” state instead of snapping invalid tasks into Morning/Evening.
   - That makes broken schedules obvious and debuggable.

7. **Run a one-time cleanup**
   - Audit today’s scheduled tasks
   - unschedule only the tasks that violate the allowed windows
   - rerun scheduling with strict enforcement

## Files involved

- `supabase/functions/nightly-schedule-builder/index.ts`
- `supabase/functions/batch-calendar-scheduler/index.ts`
- shared scheduling config in `supabase/functions/_shared/...`
- `src/config/schedulingRules.ts`
- `src/components/FocusView.tsx`

## Recommended implementation rule

```text
Saved user settings = hard constraint
Heuristics (financial/comms/due soon) = ranking only
AI output outside allowed window = reject/overflow, never save
UI must display violations instead of hiding them
```

This will align the actual scheduler behavior with what you set in Settings, instead of letting the AI quietly “decide better.”
