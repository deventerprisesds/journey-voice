
# Plan: Fix Default View + Add Focus to Nav + Remove Time Period Filter

## Summary

Three changes to complete:
1. **Fix default view** - Add redirect to `?view=focus` when no view param exists
2. **Add "Today's Focus" to sidebar** - Place it above "Kanban Board" in the Tasks submenu
3. **Remove "All Time" filter** - Remove the time period filter from KanbanBoard toolbar

---

## Changes Overview

### 1. Fix Default View (TasksPage.tsx)

Add a `useEffect` that redirects to `/tasks?view=focus` when the page loads without a `view` parameter.

**Current behavior**: If you previously visited `/tasks?view=kanban`, that URL stays in browser history. When refreshing, it reads `kanban` from the URL.

**New behavior**: When visiting `/tasks` with no `view` param, automatically set `?view=focus`.

```typescript
// Add useEffect after the existing view sync effect
useEffect(() => {
  if (!viewParam) {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('view', 'focus');
    navigate(`/tasks?${newParams.toString()}`, { replace: true });
  }
}, [viewParam]);
```

---

### 2. Add "Today's Focus" to Sidebar Navigation (MainLayout.tsx)

Update the `navItems` structure to include Focus view above Kanban Board:

**Current structure:**
```
Tasks
├── Kanban Board
│   ├── Today
│   ├── Career
│   └── ...
└── List View
```

**New structure:**
```
Tasks
├── Today's Focus  ← NEW (links to /tasks?view=focus)
├── Kanban Board
│   ├── Today
│   ├── Career
│   └── ...
└── List View
```

**Changes to MainLayout.tsx:**
- Import `Target` icon from lucide-react (already used in ViewSwitcher)
- Add Focus item to `subItems` array before Kanban Board
- Path: `/tasks?view=focus`

```typescript
subItems: [
  { icon: Target, label: "Today's Focus", path: '/tasks?view=focus' },  // NEW
  { icon: Columns3, label: 'Kanban Board', path: '/tasks?view=kanban', kanbanTabs },
  { icon: List, label: 'List View', path: '/tasks?view=grid' },
],
```

Also update `getTaskViewActive` logic to handle `focus` view.

---

### 3. Remove Time Period Filter (KanbanBoard.tsx)

Remove the "All Time" dropdown filter from the toolbar:

**Remove:**
- Line 96: `type TimePeriod` type definition
- Line 130: `timePeriod` state variable
- Lines 583-617: `filterByTimePeriod` function
- Line 625: Call to `filterByTimePeriod` in `getTasksByStatus`
- Lines 1068-1087: The entire Time Period Filter UI block in the toolbar

**Impact**: The Kanban board will show all tasks without time filtering. This can be added back later as part of the filter panel if needed.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/pages/TasksPage.tsx` | Add redirect useEffect for default focus view |
| `src/components/MainLayout.tsx` | Add "Today's Focus" nav item, import Target icon |
| `src/components/KanbanBoard.tsx` | Remove TimePeriod state, function, and UI |

---

## Detailed Line Changes

### TasksPage.tsx
- Add ~8 lines for the redirect useEffect

### MainLayout.tsx  
- Add `Target` to imports (line 16 area)
- Add Focus subItem in navItems array (line 110-113)
- Update getTaskViewActive to include 'focus' check

### KanbanBoard.tsx
- Remove line 96: `type TimePeriod = ...`
- Remove line 130: `const [timePeriod, setTimePeriod] = ...`
- Remove lines 583-617: `filterByTimePeriod` function (~35 lines)
- Update line 625: Remove `filterByTimePeriod` call
- Remove lines 1068-1087: Time Period Filter UI (~20 lines)

---

## Expected Outcome

1. Visiting `/tasks` (no params) → automatically redirects to `/tasks?view=focus`
2. Refreshing the page on Focus view stays on Focus view
3. Sidebar shows "Today's Focus" as first item under Tasks
4. Kanban Board toolbar no longer has the "All Time" dropdown
5. Cleaner toolbar layout on mobile
