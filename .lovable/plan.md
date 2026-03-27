

# Fix: Stale DONE Tasks Consuming Schedule Capacity + Missing Assignment Scheduling

## Problems Found (Verified via Database)

1. **13 DONE tasks are scheduled for today** — they have `is_scheduled = true` and `start_time` set to today. The nightly builder counts them as "already occupied" capacity (line 391-397), leaving less room for real tasks. The rollover step skips DONE tasks intentionally, so they never get cleared.

2. **3 new assignment tasks (Draft Client Presentation, Project Management Tracker, Draft Report) have `start_time = null`** — the schedule builder hasn't run since they were created.

3. **No external calendar events** in the `external_calendar_events` table for today.

## Fix 1: Clear scheduling flags on DONE tasks during rollover

**File**: `supabase/functions/nightly-schedule-builder/index.ts`

After the existing rollover step (lines 215-250), add a new pass that clears `is_scheduled`, `start_time`, and `end_time` on all DONE/completed tasks that still have scheduling data. This prevents them from consuming capacity:

```ts
// Clear scheduling data from completed tasks so they don't block capacity
const { data: doneTasks } = await supabase
  .from('tasks')
  .select('id, title')
  .eq('user_id', userId)
  .eq('status', 'DONE')
  .eq('is_scheduled', true);

if (doneTasks && doneTasks.length > 0) {
  for (const dt of doneTasks) {
    await supabase.from('tasks').update({
      start_time: null, end_time: null, is_scheduled: false
    }).eq('id', dt.id);
  }
  console.log(`  🧹 Cleared scheduling from ${doneTasks.length} completed tasks`);
}
```

## Fix 2: One-time data cleanup

Run a direct query to clear the 13 DONE tasks currently blocking today's schedule. This is immediate relief while Fix 1 prevents recurrence.

## Fix 3: Trigger schedule builder after fixes

After deploying Fix 1 and running the cleanup:
1. Invoke `nightly-schedule-builder` for user `a3378f93-...`
2. Verify the 3 new assignment tasks get `start_time` values for today/upcoming days
3. Verify no DONE tasks appear in today's schedule
4. Check FocusView shows the assignments

## Files to Change

| File | Change |
|------|--------|
| `supabase/functions/nightly-schedule-builder/index.ts` | Add DONE task cleanup pass after rollover (after line 250) |

## Verification (will be done before reporting success)

1. Query `tasks` table: confirm zero DONE tasks with today's `start_time`
2. Query `tasks` table: confirm assignment tasks have `start_time` set
3. Check FocusView renders the new assignments in the schedule

