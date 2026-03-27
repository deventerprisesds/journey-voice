

# Complete Fix Plan — All Outstanding Issues

## Current State Summary

After investigating the database, code, and activity logs, here are ALL the outstanding problems:

### Problem 1: Assignment sync completely broken
The `nightly-assignment-sync` function queries `tasks.assignment_id` — **this column does not exist** on the `tasks` table. The function silently crashes every night, which means:
- Past-due assignments are never archived
- New assignment tasks are never created from EMBA/MIT sources
- Zero `nightly_assignment_sync` entries exist in `activity_log`

**Fix**: Add `assignment_id` column to `tasks` table via migration. Then redeploy `nightly-assignment-sync`.

### Problem 2: Nightly builder only fills today, not the week
The builder runs Steps 2-5 once for `todayISO`. Saturday has 1 task, Sunday has 0. The user wants the full week (today through Sunday) populated.

**Fix**: Wrap Steps 2-5 in a loop from today through Sunday. Track `scheduledTaskIds` across iterations to prevent duplicates. Fetch external calendar events per day. Compute window capacities per day using the correct day-of-week.

### Problem 3: Response shape mismatch (toast always says "Up Next")
`execute-tool` line 1324 returns `scheduled: scheduledResults.length` (a number). `QuickTaskInput` reads `.scheduled?.length` and `.[0]?.start_time` expecting an array.

**Fix**:
- In `execute-tool`: capture `start_time` in `scheduledResults.push()` and return `scheduled: scheduledResults` (array)
- `QuickTaskInput` already handles the array format correctly

### Problem 4: Duplicate tasks in schedule ("Go to gym" x2)
The nightly builder doesn't check for duplicate titles when selecting candidates. Rolled-over tasks can also create duplicates if the same task was manually added.

**Fix**: In the candidate selection loop (Step 4), track selected titles and skip duplicates. Also add a dedup check before calling batch-scheduler.

### Problem 5: Overlapping time slots
"Meet with entrepreneurial partner" (9-10 AM) overlaps with another task at the same time. The batch-scheduler has a post-processing guard, but it only shifts tasks — it doesn't prevent the nightly builder from sending tasks that exceed window capacity.

**Fix**: Already partially addressed by the capacity system. The real fix is the week loop (Problem 2) which distributes load, plus passing already-scheduled tasks as busy slots to the batch-scheduler.

### Problem 6: User config potentially ignored by batch-scheduler
The `resolveConfig` function looks correct in code, but logs showed defaults being used. Need tracing to confirm.

**Fix**: Add `[CONFIG-TRACE]` logging in `batch-calendar-scheduler` after `resolveConfig` call to log actual `categoryMappings` keys and values. This will confirm whether the user config is loaded or if there's a runtime issue.

### Problem 7: Calendar token refresh (from prior plan)
Calendar "Connect" button forces full OAuth redirect instead of using stored refresh token.

**Fix**: Add `refresh` action to `calendar-token-manager` edge function. Update UI to try silent refresh before falling back to full OAuth.

---

## Implementation Plan

### Step 1: Database migration — add `assignment_id` column
```sql
ALTER TABLE tasks ADD COLUMN assignment_id text;
CREATE INDEX idx_tasks_assignment_id ON tasks (assignment_id);
```

### Step 2: Fix `execute-tool` response shape
**File**: `supabase/functions/execute-tool/index.ts`
- Line 1272: Add `start_time: slot.start_time` to `scheduledResults.push()`
- Line 1324: Change `scheduled: scheduledResults.length` → `scheduled: scheduledResults`

### Step 3: Add config tracing to `batch-calendar-scheduler`
**File**: `supabase/functions/batch-calendar-scheduler/index.ts`
- After line 160 (`resolveConfig` call): Add 4 `console.log` lines tracing raw userConfig keys, categoryMappings keys, and whether defaults are used

### Step 4: Extend nightly builder to fill full week + dedup
**File**: `supabase/functions/nightly-schedule-builder/index.ts`
- Wrap Steps 2-5 in a `for` loop from today through Sunday
- Track `scheduledTaskIds: Set<string>` across iterations
- Track `scheduledTitles: Set<string>` to prevent title duplicates
- For each day: compute day-of-week → get active windows → fetch that day's busy slots → compute capacity → select candidates (excluding already-scheduled) → call batch-scheduler → record results
- Pass accumulated scheduled tasks as additional busy slots to each subsequent day's batch-scheduler call

### Step 5: Redeploy `nightly-assignment-sync`
After the migration adds `assignment_id`, redeploy so the function can query it. Also fix the status filter — current code filters `NOT status = 'completed'` but assignments table has `status = 'past due'` and `status = 'active'`, not just `completed/graded`.

### Step 6: Calendar token refresh
**File**: `supabase/functions/calendar-token-manager/index.ts`
- Add `refresh` action that uses stored `refresh_token` to get new `access_token` without redirect

**File**: `src/components/CalendarOAuthManager.tsx`
- Try silent refresh before showing OAuth redirect button

### Step 7: Test & verify
- Trigger nightly builder manually and check logs for week-filling
- Test QuickTaskInput "go to the bank" — verify toast shows actual time
- Check assignment sync logs for archival of past-due items
- Verify no duplicate tasks or overlapping slots across the week

---

## Files Changed

| File | Change |
|------|--------|
| Migration SQL | Add `assignment_id` column to `tasks` |
| `supabase/functions/execute-tool/index.ts` | Return `scheduled` as array with `start_time` |
| `supabase/functions/batch-calendar-scheduler/index.ts` | Add config tracing logs |
| `supabase/functions/nightly-schedule-builder/index.ts` | Week loop + dedup + busy slot accumulation |
| `supabase/functions/nightly-assignment-sync/index.ts` | Fix status filter for assignment table values |
| `supabase/functions/calendar-token-manager/index.ts` | Add `refresh` action |
| `src/components/CalendarOAuthManager.tsx` | Try refresh before OAuth redirect |

## Execution Order
1. Migration (unblocks assignment sync)
2. execute-tool response fix (quick win, enables toast fix)
3. Nightly builder week loop + dedup (biggest schedule quality impact)
4. Assignment sync status filter fix + redeploy
5. Batch-scheduler config tracing + redeploy
6. Calendar token refresh (server + client)
7. Manual test run of nightly builder

