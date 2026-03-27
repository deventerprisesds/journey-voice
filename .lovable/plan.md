

# Fix Plan: Priority Logic, Stale Assignments, and Weekend Window Enforcement

## Problems Confirmed by Data

### Problem 1: Old/stale assignments dominating the schedule
Saturday's schedule is filled with tasks due in **October 2025** and **February 2026** (e.g., "PLJ CTC Session 2 Assignment 1" due 2025-10-17, "Forum 3.3" due 2025-10-20). Meanwhile, the **actually upcoming** EMBA assignments (due March 30: "Project Management Tracker", "Draft Client Presentation") have no tasks created for them — `assignment_id` is `nil` on all scheduled tasks. The assignment sync is either not matching these or the old tasks were never archived.

**Root cause**: The `nightly-assignment-sync` function filters assignments by `NOT status IN ('completed','graded','past due')`. The EMBA assignments table shows status = `upcoming` for the real due items — those should be synced. But the **old tasks** (due Oct 2025) were created long before the `assignment_id` column existed, so they have `assignment_id = NULL`. The sync function's dedup check (`eq('assignment_id', assignment.id)`) never finds them, so it doesn't archive them. They keep rolling over nightly with incrementing `pushed_count`.

### Problem 2: Priority board boost not visible in scheduling order
The score boost for priority board items (`+10` for `mappedIds`) is implemented in the nightly builder (line 380). However, looking at Saturday's actual schedule, old Forum posts (score ~1+3 pushed = 4) are placed before financial tasks like "Pay off credit cards" and people tasks like "Reply to career coach". The priority keyword boost (`+2`) exists but is too weak relative to pushed_count bonuses on ancient tasks.

**Root cause**: Tasks pushed 8-9 times get `+3` from pushed_count (capped at 3) plus their base priority. Old EDUCATION tasks with `pushed_count: 8` get score ~6-7, while a fresh LIFE task "Pay off credit cards" (financial keyword +2, priority LOW = +1) gets only ~3. The scoring doesn't sufficiently penalize staleness or boost intent-based priority.

### Problem 3: Weekend window not enforced for Saturday/Sunday
Saturday March 28 shows tasks at 7:45 AM ET and 8:00 PM ET — both **outside** the weekends window (10 AM – 8 PM). The "After Work" header appears on Saturday in the screenshot. The batch-scheduler's day-of-week filtering correctly removes weekday windows from category mappings, but the **nightly builder's `getActiveWindows`** function checks `win.days.includes(targetDayOfWeek)`. Looking at the user config: `weekends: { start: 10, end: 20, days: [0, 6] }` — Saturday is day 6, Sunday is day 0. But `after_work` has `days: [1,2,3,4,5,6]` — **Saturday is included in after_work**! This means Saturday gets both `weekends` AND `after_work` windows active, breaking the weekend-only intent.

## Fixes

### Fix 1: Archive stale tasks and prevent recycling (nightly-schedule-builder)
Add a staleness filter: tasks with `pushed_count >= 5` AND `due_date` more than 30 days in the past should be auto-archived (marked DONE with metadata). This prevents ancient assignments from consuming schedule capacity indefinitely.

**File**: `supabase/functions/nightly-schedule-builder/index.ts`
- After rollover step (line ~240), add a staleness archival pass
- Query tasks where `pushed_count >= 5` AND `due_date < 30 days ago` AND `status != 'DONE'`
- Update them to `status: 'DONE'`, `completed_at: now`, `metadata: { archived_reason: 'stale_rollover' }`
- Log count

### Fix 2: Fix scoring to properly prioritize intent and recency (nightly-schedule-builder)
Adjust the scoring formula:
- **Financial/comms keyword**: boost from `+2` to `+5`
- **Staleness penalty**: if `pushed_count > 3`, subtract `(pushed_count - 3)` from score (net effect: diminishing returns after 3 pushes)
- **Due date relevance**: if `due_date` is more than 14 days in the past, apply `-3` penalty
- Keep priority board boost at `+10`

**File**: `supabase/functions/nightly-schedule-builder/index.ts` (scoring section ~lines 376-388)

### Fix 3: Enforce weekend-only windows on Saturday and Sunday (scheduling-defaults +