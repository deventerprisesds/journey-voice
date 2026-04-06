

# Separate "Recent Overdue" Section on the Overdue Tab

## Change

When viewing the Overdue tab, split the list into two visual sections:

1. **"Last 2 Weeks"** — assignments with `due_date` within the past 14 days, shown at the top with a section header
2. **"Older"** — everything overdue beyond 14 days, shown below with its own header

Both sections keep the existing descending sort (most recent first). Course accordions remain within each section.

## Implementation

**File: `src/pages/Assignments.tsx`**

- In the `grouped` memo, when `statusTab === 'overdue'`, partition `filteredAssignments` into two lists: `recentOverdue` (due within last 14 days) and `olderOverdue` (the rest), then group each by course separately
- In the render section, when `statusTab === 'overdue'`, render two labeled sections ("Last 2 Weeks" and "Older") each with their own course accordion groups, instead of one flat list
- Both sections use descending sort (already in place)

| File | Change |
|------|--------|
| `src/pages/Assignments.tsx` | Partition overdue into recent (≤14 days) and older sections with labeled headers |

