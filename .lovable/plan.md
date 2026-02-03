

# Plan: Fix Batch Scheduler Date Hallucination + Correct Status Logic

## Summary

Fix the batch scheduler returning past dates by using dynamic dates in AI prompt examples, and implement correct status logic where tasks with any date (`start_time` OR `due_date`) get `UP_NEXT`, while only truly dateless tasks get `BACKLOG`.

---

## Status Logic

| Condition | Status |
|-----------|--------|
| Has `start_time` OR `due_date` | `UP_NEXT` |
| No `start_time` AND no `due_date` | `BACKLOG` |

---

## Technical Fixes

### Fix 1: Dynamic Dates in AI Prompt Examples

**File**: `supabase/functions/batch-calendar-scheduler/index.ts`

Replace hardcoded `2026-01-30` with `${targetDateStr}`:

- Line 200: Example format string
- Lines 207-208: JSON example array

### Fix 2: Correct Status Logic in execute-tool

**File**: `supabase/functions/execute-tool/index.ts`

Update status calculation to check for either date field:

```typescript
// Status logic helper (use wherever status is set)
const hasDate = !!(normalizedStartTime || normalizedDueDate);
const status = hasDate ? 'UP_NEXT' : 'BACKLOG';
```

Locations to update:
- Line ~1062: `schedule_task` handler
- Line ~1240-1260: Initial task insert
- Lines ~1362-1373: Batch scheduler result application

### Fix 3: Add Explicit start_time Check to Batch Scheduler Filter

**File**: `supabase/functions/execute-tool/index.ts` (line 1313)

```typescript
const unscheduledTasks = createdTasks.filter(t => {
  if (t.start_time) {
    console.log(`[PARSE_AND_CREATE] Task "${t.title}" has start_time, skipping batch scheduler`);
    return false;
  }
  return !t.is_scheduled;
});
```

### Fix 4: Add Date Validation for Batch Results

**File**: `supabase/functions/execute-tool/index.ts` (lines 1351-1375)

```typescript
for (const slot of batchResult.scheduled || []) {
  const task = unscheduledTasks[slot.taskIndex];
  if (task && slot.start_time && slot.end_time) {
    const scheduledDate = slot.start_time.split('T')[0];
    const todayInTz = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    
    // VALIDATION: Reject past dates - task keeps original status
    if (scheduledDate < todayInTz) {
      console.error(`[PARSE_AND_CREATE] REJECTED past date ${scheduledDate} for "${task.title}"`);
      continue;  // Task remains with original status (BACKLOG if no due_date, UP_NEXT if has due_date)
    }
    
    // Valid date - update to UP_NEXT (now has start_time)
    await supabaseAdmin.from('tasks').update({
      start_time: slot.start_time,
      end_time: slot.end_time,
      is_scheduled: true,
      status: 'UP_NEXT'
    }).eq('id', task.id);
  }
}
```

### Fix 5: Update Initial Insert Status Logic

**File**: `supabase/functions/execute-tool/index.ts` (around line 1240-1260)

```typescript
// In task insert logic
const hasDate = !!(normalizedStartTime || normalizedDueDate);
// ...
status: hasDate ? 'UP_NEXT' : 'BACKLOG',
```

### Fix 6: Bump Version

**File**: `supabase/functions/_shared/config.ts`

```typescript
export const GLOBAL_VERSION = "2026-02-03-v20";
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/functions/batch-calendar-scheduler/index.ts` | Replace hardcoded `2026-01-30` dates with `${targetDateStr}` in examples |
| `supabase/functions/execute-tool/index.ts` | Correct status logic (UP_NEXT if start_time OR due_date), add start_time filter check, add date validation |
| `supabase/functions/_shared/config.ts` | Bump version to v20 |

---

## Expected Flow After Fix

```text
User: "task A for 9:30 AM, task B due tomorrow, take out trash"

1. Parser extracts:
   - Task A: start_time = 9:30 AM, due_date = null
   - Task B: start_time = null, due_date = tomorrow
   - Task C: start_time = null, due_date = null

2. Insert tasks:
   - Task A: status = UP_NEXT (has start_time)
   - Task B: status = UP_NEXT (has due_date)
   - Task C: status = BACKLOG (no date at all)

3. Batch scheduler filter:
   - Task A excluded (has start_time)
   - Task B excluded (has due_date - doesn't need time slot)
   - Task C included (truly dateless, needs scheduling)

4. Batch scheduler returns result for Task C:
   - If valid date → Update to UP_NEXT
   - If past date → REJECTED, stays BACKLOG

Result: Tasks with any date get UP_NEXT, only dateless tasks get BACKLOG
```

