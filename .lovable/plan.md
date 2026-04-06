

# Fix: Sort Course Groups by Most Recent Due Date

## Problem

Current proposal uses `Math.min` (earliest due date per course), which lets old assignments from months ago determine a course's sort position. The correct behavior: use the **most recent** due date in each group (closest to today) as the sort key.

## Change

**File: `src/pages/Assignments.tsx`** — in the `groupByCourse` callback, replace `Math.min` with `Math.max` for non-overdue tabs:

```typescript
// Current (wrong):
const earliestA = Math.min(...a[1].map(...));

// Fix:
const latestA = Math.max(...a[1].map(r => r.due_date ? new Date(r.due_date).getTime() : 0));
const latestB = Math.max(...b[1].map(r => r.due_date ? new Date(r.due_date).getTime() : 0));
return latestA - latestB; // ascending — closest to today first
```

This ensures a course with a due date next week sorts above one whose next assignment isn't until next month, regardless of how old other assignments in either course are.

| File | Change |
|------|--------|
| `src/pages/Assignments.tsx` | Change sort key from `Math.min` (earliest) to `Math.max` (most recent) per course group on non-overdue tabs |

