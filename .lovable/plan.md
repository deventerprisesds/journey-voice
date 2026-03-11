

## Plan: Replace "Re-run" with "Auto-fill" — Direct Client-Side Slot Filling

### Problem
The current "Re-run" button invokes `nightly-schedule-builder`, which is a multi-tenant batch job with rollover logic. When called mid-day after clearing tasks, it may produce 0 results because of rollover interference and multi-tenant processing. The user wants an **"Auto-fill"** button that directly fills open time slots with priority candidates.

### Solution
Replace `handleRerunSchedule` with `handleAutoFill` that:
1. Fetches candidates client-side (priority board + READY/UP_NEXT, `is_scheduled = false`, not DONE/BLOCKED)
2. Scores and sorts them (same priority/pushed/due-soon logic as nightly builder)
3. Calls `batch-calendar-scheduler` directly via `useBatchScheduling.scheduleBatch()` with today as target
4. Updates each scheduled task with `is_scheduled: true`, `scheduling_context: { pre_schedule_status }`, and `status: 'TODO'`

### Changes — `src/components/FocusView.tsx`

**Replace `handleRerunSchedule` (lines 442-457) with `handleAutoFill`:**

```typescript
const handleAutoFill = async () => {
  setIsRerunning(true);
  try {
    // 1. Fetch priority board task IDs
    const { data: mappedTasks } = await supabase
      .from('task_topic_mappings')
      .select('task_id')
      .eq('user_id', user?.id);
    const mappedIds = (mappedTasks || []).map(t => t.task_id);

    // 2. Fetch READY/UP_NEXT tasks
    const { data: readyTasks } = await supabase
      .from('tasks')
      .select('id')
      .eq('user_id', user?.id)
      .in('status', ['READY', 'UP_NEXT'])
      .is('is_scheduled', false)
      .is('completed_at', null);
    const readyIds = (readyTasks || []).map(t => t.id);

    // 3. Merge, dedupe, fetch full candidate data
    const allIds = [...new Set([...mappedIds, ...readyIds])];
    // Fetch candidates, score, sort, take top 25
    // 4. Call scheduleBatch() with candidates + today
    // 5. Update tasks with pre_schedule_status preservation
  }
};
```

**Scoring logic** (replicated from nightly builder lines 171-206): priority weight + pushed_count boost + due-soon boost + priority keyword boost + UP_NEXT boost. Sort descending by score, then ascending by due_date. Take top 25.

**After `scheduleBatch` returns**, loop through `result.scheduled` and update each task:
```typescript
await supabase.from('tasks').update({
  start_time: slot.start_time,
  end_time: slot.end_time,
  is_scheduled: true,
  scheduling_context: { pre_schedule_status: candidate.status },
  status: 'TODO',
}).eq('id', slot.taskId);
```

**UI change** (lines 518-527): Rename button label from "Re-run" to "Auto-fill", swap `RefreshCw` icon to `CalendarPlus`.

### What This Fixes
- Bypasses nightly rollover logic entirely — no side effects
- Single-user, on-demand — fills only the current user's open slots
- Uses the same scoring heuristics as the nightly builder for consistency
- Preserves `pre_schedule_status` for proper restoration on removal
- `batch-calendar-scheduler` already respects existing busy slots (calendar events + already-scheduled tasks), so it naturally fills only open windows

### Files Modified
- `src/components/FocusView.tsx` — replace `handleRerunSchedule` with `handleAutoFill`, update button UI

