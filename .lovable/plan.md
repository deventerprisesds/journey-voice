
## Fix Task Filters Not Affecting Kanban Board

### Problem

When searching for "Travis" in the Kanban board's filter panel, the task "Respond to Travis Wagner" (which exists in the database with `category: CAREER`, `status: UP_NEXT`) is not being filtered/displayed correctly. The filter shows "1 filter applied" but the board doesn't respond to the filter.

### Root Cause

In `KanbanBoard.tsx` at line 580:
```tsx
const tasksToFilter = filteredTasks.length > 0 ? filteredTasks : tasks;
```

This logic incorrectly determines whether filtering is active by checking if `filteredTasks` has items. This fails in two scenarios:

1. **Filter matches zero tasks**: Falls back to showing all tasks (wrong - should show empty)
2. **Filter matches all tasks**: The `filteredTasks` array equals all tasks, which is correct behavior

The current implementation doesn't track whether a filter is **actively set** - only whether the filtered result has items.

### Solution

Add a boolean state `isFiltering` that tracks whether any filter criteria are actively set (regardless of how many tasks match). Update both `TaskFilters` and `KanbanBoard` to properly communicate and use this state.

---

### Technical Changes

#### File 1: `src/components/TaskFilters.tsx`

**Change the callback signature** to include an `isActive` boolean:

| Location | Change |
|----------|--------|
| Line 39 | Update callback type to include `isActive` parameter |
| Lines 91-93 | Calculate `isActive` from `getActiveFiltersCount() > 0` and pass to callback |

```tsx
// Line 39: Update interface
onFilteredTasksChange: (filteredTasks: Task[], isActive: boolean) => void;

// Lines 91-93: Update effect
useEffect(() => {
  const isActive = getActiveFiltersCount() > 0;
  const filteredTasks = applyFilters(tasks, filters);
  onFilteredTasksChange(filteredTasks, isActive);
}, [tasks, filters, onFilteredTasksChange]);
```

#### File 2: `src/components/KanbanBoard.tsx`

**Add `isFiltering` state** and update the logic:

| Location | Change |
|----------|--------|
| Line 114 | Add `isFiltering` state variable |
| Line 580 | Use `isFiltering` flag instead of checking array length |
| Lines 646-648 | Update handler to accept and set the `isFiltering` flag |

```tsx
// Line 114: Add state
const [filteredTasks, setFilteredTasks] = useState<Task[]>([]);
const [isFiltering, setIsFiltering] = useState(false);

// Lines 646-648: Update handler
const handleFilteredTasksChange = (filtered: Task[], isActive: boolean) => {
  setFilteredTasks(filtered);
  setIsFiltering(isActive);
};

// Line 580: Fix the filtering logic
const getTasksByStatus = (status: Task['status']) => {
  // Use filtered tasks if filtering is active, otherwise use all tasks
  const tasksToFilter = isFiltering ? filteredTasks : tasks;
  // ... rest of function unchanged
};
```

---

### Why This Fixes the Issue

| Scenario | Before | After |
|----------|--------|-------|
| Search "Travis" (matches 1 task) | `filteredTasks.length > 0` = true, uses filtered | `isFiltering` = true, uses filtered |
| Search "xyz123" (matches 0 tasks) | `filteredTasks.length > 0` = false, shows ALL tasks | `isFiltering` = true, shows 0 tasks |
| No filters set | `filteredTasks.length > 0` = false (empty), shows all | `isFiltering` = false, shows all |

The key change is that `isFiltering` is based on whether any filter criteria are set (search text, status, priority, etc.), NOT on whether the filter produced results.

---

### Files Changed

| File | Changes |
|------|---------|
| `src/components/TaskFilters.tsx` | Update callback to pass `isActive` boolean indicating if any filter is set |
| `src/components/KanbanBoard.tsx` | Add `isFiltering` state; update handler and `getTasksByStatus` to use flag instead of array length check |
