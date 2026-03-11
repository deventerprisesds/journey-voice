

## Plan: Focus Board Controls — Remove, Clear All, Re-run + Status Preservation

### Context
The Focus board spans 4 windows (Morning 6-9, Business Hours 9-17, After Work 17-22, Evening 19-22) totaling ~16 usable hours. At 30-min slots, that's 32 drop slots. The current candidate cap of 20 is sufficient — most tasks are 45-120 min, so 12-16 tasks fill a day. Keeping 25 as the cap provides safe headroom.

### Changes

#### 1. `supabase/functions/nightly-schedule-builder/index.ts`

**Store pre-schedule status** (lines 248-260): Before overwriting status to `TODO`, save the original status in `scheduling_context`:

```typescript
scheduling_context: { pre_schedule_status: task.status },
```

**Include READY/UP_NEXT tasks alongside priority board** (lines 109-148): After fetching `mappedIds` from `task_topic_mappings`, run a second query for tasks with status `READY` or `UP_NEXT` regardless of board membership. Merge and deduplicate by ID.

**Candidate cap**: Change from 20 to 25 (line 192).

#### 2. `src/components/FocusView.tsx`

**Add "Remove from schedule" (X) button** per task (around line 501-513): Next to the Play button, add an X button. Handler:
- Reads `scheduling_context.pre_schedule_status` from the task
- Updates the task: `start_time: null, end_time: null, is_scheduled: false`
- Restores `status` to `pre_schedule_status` if it exists, otherwise leaves status unchanged
- Calls `onTaskUpdate()` to refresh

**Add "Clear All" button** in the header (line 417-431): Next to the scheduled count badge, add a "Clear All" button with confirmation (using `window.confirm` or toast). Handler:
- Fetches all `scheduledToday` task IDs
- For each, reads `scheduling_context.pre_schedule_status`
- Bulk updates: resets `start_time`, `end_time`, `is_scheduled`, restores original `status`
- Calls `onTaskUpdate()`

**Add "Re-run Schedule" button**: Next to Clear All. Handler calls `supabase.functions.invoke('nightly-schedule-builder')`. Shows loading state during execution, then calls `onTaskUpdate()`.

**Add imports**: `X`, `Trash2`, `RefreshCw` from lucide-react. `AlertDialog` components for Clear All confirmation.

### UI Layout
```text
[Calendar] Today's Schedule [3 scheduled]     [Clear All] [↻ Re-run]

Morning (6:00 - 9:00)
  6:30 AM  Workout          [X] [▶]

Business Hours (9:00 - 17:00)
  9:00 AM  Review PR         [X] [▶]
  10:30 AM Meeting prep      [X] [▶]
```

### Files Modified
- `supabase/functions/nightly-schedule-builder/index.ts` — status preservation, additive candidates, cap to 25
- `src/components/FocusView.tsx` — remove button, clear all, re-run trigger

