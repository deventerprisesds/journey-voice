

# Add Batch Status Change to Priorities Toolbar

## What's Missing

The batch action bar on the Priorities page currently has "Move to..." (category) and "Group..." (topic group) dropdowns, but no way to change the status of multiple selected tasks at once (e.g., mark several as DONE, BLOCKED, etc.).

## Changes

### 1. Add `batchChangeStatus` function in `src/pages/Priorities.tsx`

A new callback (modeled after `batchMoveToCategory`) that:
- Takes a target status string
- Calls `supabase.from('tasks').update({ status: targetStatus }).in('id', ids)`
- Shows a success/error toast
- Clears selection and refreshes data

### 2. Add "Status..." dropdown to the batch action bar

Insert a third dropdown button between "Group..." and the close button (lines 610-611). It will list the workflow-relevant statuses:

| Status | Label |
|--------|-------|
| TODO | To Do |
| READY | Ready |
| UP_NEXT | Up Next |
| DOING | Doing |
| DONE | Done |
| BLOCKED | Blocked |
| BACKLOG | Backlog |

Uses a `CircleDot` (or similar) icon from lucide-react to distinguish it from the other two dropdowns.

### Files Changed

| File | Change |
|------|-------|
| `src/pages/Priorities.tsx` | Add `batchChangeStatus` callback; add "Status..." dropdown in batch action bar |

