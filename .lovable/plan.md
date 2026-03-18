

## Analysis: What's on the Board vs What We Expected

### What the Screenshots Show (Current Agenda - 9 Items)
All 9 items are **EDUCATION** tasks: MIT modules, assignments, forums, cases, PLJ sessions. These are from the **March 17 manual test run** (old code, no capacity awareness, no priority board boost).

### Why This Doesn't Match Our Discussion

**The capacity-aware nightly cron NEVER successfully ran for your user.** The March 18 05:00 UTC cron processed a different user (the demo/test user `00000000`) but silently failed or skipped your user (`a3378f93`). There is no `activity_log` entry for your user after March 17.

So the 9 education tasks you see are stale leftovers from the old code -- they were never replaced by the new capacity-aware, priority-board-boosted scheduler.

### What's Actually Waiting (Unscheduled, On Priority Board)

Your database has **97 unscheduled active tasks** across all categories, many on the priority board:

| Category | Total | Unscheduled | Examples |
|----------|-------|-------------|----------|
| LIFE | 41 | 41 | Cancel Amex, Pay off credit cards, Book San Antonio, Gym, Triston chain |
| EDUCATION | 36 | 20 | (16 still marked scheduled from old run) |
| VENTURES | 19 | 18 | (mostly unscheduled) |
| CAREER | 6 | 6 | (all unscheduled) |
| PROF_EDUCATION | 4 | 4 | (all unscheduled) |

Priority board items like "Cancel Amex charges", "Pay off credit cards (HIGH)", "Book hotel for San Antonio", "Message about Triston chain" are all sitting as UP_NEXT/BACKLOG, unscheduled, waiting for a scheduler run that never happened.

### Plan: Three Actions

#### A. Fix why the cron skipped your user

The nightly cron ran for user `00000000` but not `a3378f93`. Likely cause: the function errored during processing your user (106 tasks is a much larger dataset). Need to add better error logging and ensure the loop doesn't silently skip users. Also investigate whether the `BACKLOG` and `LIFE` statuses in some tasks cause issues with the candidate query filters.

**Code change in `nightly-schedule-builder/index.ts`:**
- Add explicit `console.error` with full stack trace in the per-user catch block
- Ensure candidates include `BACKLOG` and category-as-status tasks (current query at line 300 only looks for `READY`, `UP_NEXT`, `TODO` -- but the priority board join at line 282 covers this for mapped tasks)

#### B. Filter out test tasks

Add `.not('title', 'ilike', '%Test Task%')` to candidate queries to prevent 🧪 items from consuming capacity.

#### C. Clear stale schedule + manually trigger for your user

1. Unschedule the 16 stale EDUCATION tasks from the old March 17 run (reset `is_scheduled = false`, clear `start_time`/`end_time`)
2. Trigger `nightly-schedule-builder` manually -- this time it will use the capacity-aware code with priority board boost, filling windows with the right mix of LIFE/EDUCATION/VENTURES/CAREER tasks

#### D. Delete junk test tasks

Remove the 5 "🧪 Test Task" items from the database entirely.

### Files Modified
- `supabase/functions/nightly-schedule-builder/index.ts` -- test task filter, better error logging
- Data operations via Supabase tools (cleanup + re-trigger)

