

# Fix Assignments Page: Add "Upcoming" Tab + Fix Overdue Detection

## Problems

1. **Missing "Upcoming" tab**: "Due Next" shows the nearest assignments to work on now, but there's no separate tab for assignments further out (the next period). Need to add an "Upcoming" tab after "Due Next".

2. **False "completed" status for past-due assignments**: `getTaskStatus` checks `task.status === 'DONE' || task.completed_at` first. But the screenshot shows an Apr 5 assignment crossed out as done when it was never completed — it just passed its due date. The issue is likely that the task's `status` field is still at its default (not DONE) but the current logic falls through to 'overdue' correctly. However, looking more carefully: the task may have been auto-archived or had its status changed by the scheduler. The real fix is ensuring `completed_at` is the authoritative check — if `completed_at` is null, the task is NOT done regardless of status field. For assignments specifically, we should require `completed_at` to be set before marking as completed.

## Changes

### `src/pages/Assignments.tsx`

**1. Split "upcoming" into "due_next" and "upcoming"**

Update `getTaskStatus` to return 5 possible statuses:
- `completed`: `completed_at` is set (not just `status === 'DONE'` — require `completed_at` for assignments)
- `active`: status is DOING or UP_NEXT
- `overdue`: due_date is in the past and NOT completed
- `due_next`: due within the next 7 days and not overdue/completed
- `upcoming`: due more than 7 days out

**2. Fix overdue detection priority**

Current order checks DONE/completed first, which is correct. But the bug is that tasks with `status === 'DONE'` but no `completed_at` are being treated as completed. Fix: only treat as completed if `completed_at` is set. If status is DONE but `completed_at` is null, treat based on due date (likely overdue).

**3. Add "Upcoming" tab to the tab bar**

Insert after "Due Next": `Upcoming` with its own count badge.

**4. Update tab counts and filter logic**

Add the `upcoming` count and filter case.

## Status logic (updated)

```text
getTaskStatus(task):
  if (task.completed_at)          → 'completed'
  if (task.status DOING/UP_NEXT)  → 'active'  
  if (due_date past)              → 'overdue'
  if (due_date within 7 days)     → 'due_next'
  else                            → 'upcoming'
```

## Files changed

| File | Change |
|------|--------|
| `src/pages/Assignments.tsx` | Add "Upcoming" tab, fix completed detection to require `completed_at`, split due_next vs upcoming by 7-day threshold |

