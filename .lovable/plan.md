

# Sort Overdue Assignments Descending (Most Recent First)

## Problem

On the Overdue tab, assignments and courses are sorted with the oldest overdue items at the top. The most actionable (recently overdue) items should appear first.

## Change

In `src/pages/Assignments.tsx`, update the `grouped` memo (lines 190-198) to:

1. Sort assignments within each course group by `due_date` descending (most recent first) when the active tab is `overdue`; ascending otherwise
2. Sort the course groups themselves: when on the overdue tab, order courses by their most recent overdue assignment's due date (descending), so courses with the most recently overdue work appear first

## Files changed

| File | Change |
|------|--------|
| `src/pages/Assignments.tsx` | Sort assignments within course groups descending by due_date on overdue tab; sort course entries by most-recent due_date descending on overdue tab |

