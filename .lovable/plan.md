

## Implementation Plan: Priority Board Filtering + Remove "Other Times"

### Change 1: `supabase/functions/nightly-schedule-builder/index.ts`

**Lines 109-120** — Replace status-based candidate query with priority board membership filter:

```typescript
// STEP 2: GATHER CANDIDATES from priority board
const { data: mappedTasks, error: mappedError } = await supabase
  .from('task_topic_mappings')
  .select('task_id')
  .eq('user_id', userId);

if (mappedError) {
  console.error(`❌ Error fetching topic mappings for ${userId}:`, mappedError);
  continue;
}

const mappedIds = (mappedTasks || []).map(t => t.task_id);

if (mappedIds.length === 0) {
  console.log(`  ℹ️ No priority board tasks for ${userId}`);
  results[userId] = { rolledOver: rolledOverCount, scheduled: 0 };
  continue;
}

const { data: candidates, error: candidatesError } = await supabase
  .from('tasks')
  .select('id, title, category, priority, estimate_minutes, due_date, pushed_count, status')
  .in('id', mappedIds)
  .not('status', 'in', '("DONE","BLOCKED")')
  .is('is_scheduled', false)
  .is('completed_at', null)
  .order('created_at', { ascending: true })
  .limit(30);
```

**Line 173-174** — Increase candidate cap from 10 to 20:
```typescript
const topCandidates = scoredCandidates.slice(0, 20);
```

### Change 2: `src/components/FocusView.tsx`

**Lines 84-91** — Remove the `other` entry from `timeWindowStyles`.

**Line 206-226** — Update `getTimeWindowForTask` to return the nearest window instead of `null`:
```typescript
const getTimeWindowForTask = (task: Task): string => {
  if (!task.start_time) return 'business_hours'; // default fallback
  
  const { hour: taskHour } = getTimePartsInTimezone(task.start_time, userTimezone);
  const dayOfWeek = today.getDay();
  const windows = config.timeWindows;
  
  // Exact match first
  if (windows.morning.days.includes(dayOfWeek) && taskHour >= windows.morning.start && taskHour < windows.morning.end) return 'morning';
  if (windows.business_hours.days.includes(dayOfWeek) && taskHour >= windows.business_hours.start && taskHour < windows.business_hours.end) return 'business_hours';
  if (windows.after_work.days.includes(dayOfWeek) && taskHour >= windows.after_work.start && taskHour < windows.after_work.end) return 'after_work';
  if (windows.evening.days.includes(dayOfWeek) && taskHour >= windows.evening.start && taskHour < windows.evening.end) return 'evening';
  
  // Nearest window fallback
  if (taskHour < windows.morning.start) return 'morning';
  if (taskHour >= windows.evening.end) return 'evening';
  return 'after_work';
};
```

**Lines 229-244** — Remove `other: []` from `tasksByWindow` and simplify the assignment (no more null check needed since function always returns a valid window).

**Line 473** — Remove the `windowName !== 'other'` guard (no longer needed).

### What This Achieves
- Only tasks triaged to the Priorities board are scheduled — any status except DONE/BLOCKED
- More tasks sent to the AI scheduler (20 vs 10) to fill windows properly
- No more "Other Times" bucket cluttering the Focus board

