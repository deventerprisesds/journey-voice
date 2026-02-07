
# Plan: Fix Up Next Queue Overflow and Auto-Scheduling Bug

## Problem Summary

Two critical bugs have been identified:

### Issue 1: Up Next Queue Shows Too Many Items
The `isRolledOver()` function in `FocusView.tsx` catches too many tasks because it doesn't validate that tasks have valid workflow statuses. 60+ tasks have corrupted category values (`PROF_EDUCATION`, `LIFE`, `VENTURES`, `CAREER`) stored in the `status` field.

### Issue 2: Tasks Not Auto-Scheduling
Tasks created via the Focus View QuickTaskInput are not being auto-scheduled despite `auto_schedule: true` being passed. The root cause is a **JavaScript ReferenceError** in `batch-calendar-scheduler/index.ts`:

```
"error": "targetDateObj is not defined"
```

**Evidence from testing:**
```json
{
  "message": "Created 1 task (scheduling was requested but no optimal slots found)",
  "scheduled": 0,
  "start_time": null
}
```

The variable `targetDateObj` is referenced on lines 179, 224, and 229 but is never declared. The code creates `targetAsDate` on line 103 but never assigns it to `targetDateObj`.

---

## Technical Analysis

### Root Cause 1: FocusView Filter Logic

In `src/components/FocusView.tsx` lines 135-141:
```typescript
const isRolledOver = (t: Task): boolean => {
  if (t.status === 'DONE' || t.status === 'DOING') return false;
  if (!t.start_time) return false;
  const startDate = parseISO(t.start_time);
  return isPast(startDate) && !isToday(startDate);
};
```

This only excludes `DONE` and `DOING`, allowing tasks with corrupted statuses like `PROF_EDUCATION`, `LIFE`, etc. to slip through if they have a past `start_time`.

### Root Cause 2: Undefined Variable in Batch Scheduler

In `supabase/functions/batch-calendar-scheduler/index.ts`:

Line 103 creates `targetAsDate`:
```typescript
const targetAsDate = new Date(year, month - 1, day, 23, 59, 59, 999);
```

But line 179 references `targetDateObj` which doesn't exist:
```typescript
const targetDateStr = targetDateObj 
  ? targetDateObj.toLocaleDateString('en-US', { timeZone: timezone, dateStyle: 'full' })
  : 'today or tomorrow based on current time';
```

---

## Solution

### Part 1: Fix FocusView isRolledOver Function

Update `isRolledOver()` to only include tasks with valid workflow statuses that should roll over:

```typescript
const isRolledOver = (t: Task): boolean => {
  // Only valid workflow statuses can roll over
  const rolloverStatuses = ['UP_NEXT', 'TODO', 'READY', 'BACKLOG'];
  if (!rolloverStatuses.includes(t.status)) return false;
  if (!t.start_time) return false;
  
  const startDate = parseISO(t.start_time);
  // Past scheduled time AND not scheduled for today = rolled over
  return isPast(startDate) && !isToday(startDate);
};
```

### Part 2: Fix Batch Calendar Scheduler

Declare `targetDateObj` and assign it properly:

```typescript
// After line 99, add:
let targetDateObj: Date | null = null;

// Inside the if (targetDate && allowOverflow) block, after line 103:
targetDateObj = targetAsDate;

// Inside the else if (targetDate) block, after line 111:
targetDateObj = busySlotsEndDate;
```

### Part 3: Database Cleanup (Optional)

Clean up tasks with corrupted status values:
```sql
UPDATE tasks 
SET status = 'BACKLOG', updated_at = NOW()
WHERE status IN ('PROF_EDUCATION', 'LIFE', 'VENTURES', 'CAREER', 'EDUCATION')
AND status NOT IN ('BLOCKED', 'READY', 'UP_NEXT', 'DOING', 'DONE', 'BACKLOG', 'TODO');
```

---

## Files to Modify

| File | Change | Lines |
|------|--------|-------|
| `src/components/FocusView.tsx` | Update `isRolledOver()` to validate workflow status | 135-141 |
| `supabase/functions/batch-calendar-scheduler/index.ts` | Declare and assign `targetDateObj` | ~99-115 |

---

## Implementation Steps

1. **Fix batch-calendar-scheduler** - Declare `targetDateObj` variable and assign it properly in both conditional branches
2. **Fix FocusView** - Update `isRolledOver()` to only include valid workflow statuses
3. **Deploy and test** - Redeploy the batch scheduler and verify auto-scheduling works
4. **Optional cleanup** - Run SQL to fix corrupted task statuses

---

## Expected Results After Fix

1. QuickTaskInput tasks will be auto-scheduled with proper start_time/end_time
2. Up Next queue will only show 9-15 tasks (valid UP_NEXT status + legitimate rolled-over tasks)
3. Tasks with corrupted statuses will be excluded from the Up Next view

---

## Testing Plan

1. Create a task via QuickTaskInput - verify it gets scheduled with a time slot
2. Refresh Focus View - verify Up Next shows reasonable number of tasks
3. Check batch-calendar-scheduler logs - verify no "targetDateObj is not defined" error
