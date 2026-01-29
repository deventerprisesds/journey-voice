

## Fix: UUID Error in Demo Mode Task Creation

### Problem
When creating tasks via the AI modal in demo mode on the tabbed Kanban view, an "invalid input syntax for type uuid" error appears. This happens because:

1. `TabbedKanbanBoard` uses `useStandardColumns={true}` which skips board loading
2. `board` stays `null`, so `boardId=""` gets passed to `TaskCreationModal`
3. The modal tries to query Supabase with an empty string as a UUID

### Solution
Add demo mode handling directly in `TaskCreationModal` to use a fallback demo board ID when no valid `boardId` is provided. This is consistent with the existing demo mode pattern already used in the file.

---

### File Changes

#### 1. TaskCreationModal.tsx - Add demo fallback constant and helper

**Near the top of the file (after imports, around line 36):**
```tsx
const DEMO_BOARD_ID = 'demo-board-1';
```

#### 2. TaskCreationModal.tsx - Fix `handleAIParseTask` function

**Around line 505-509** - Change the existing tasks query to handle demo mode:

Current code:
```tsx
const { data: existingTasks } = await supabase
  .from('tasks')
  .select('*')
  .eq('user_id', userId)
  .eq('board_id', boardId);
```

Updated code:
```tsx
// In demo mode, skip Supabase query and use localStorage
const isDemoContext = !boardId || boardId.startsWith('demo-');
let existingTasks: any[] = [];

if (isDemoContext) {
  // Load existing demo tasks from localStorage
  const demoTasks = localStorage.getItem('kanban-demo-tasks');
  existingTasks = demoTasks ? JSON.parse(demoTasks) : [];
} else {
  const { data } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .eq('board_id', boardId);
  existingTasks = data || [];
}
```

#### 3. TaskCreationModal.tsx - Fix `handleCreateTasks` function

**Around line 647** - Update the demo mode check to handle empty boardId:

Current code:
```tsx
const isDemoMode = boardId.startsWith('demo-');
```

Updated code:
```tsx
const isDemoMode = !boardId || boardId.startsWith('demo-');
const effectiveBoardId = isDemoMode ? DEMO_BOARD_ID : boardId;
```

Then update lines that reference `boardId` in the task creation to use `effectiveBoardId` instead.

---

### Summary

| File | Change |
|------|--------|
| `TaskCreationModal.tsx` | Add `DEMO_BOARD_ID` constant |
| `TaskCreationModal.tsx` | Update `handleAIParseTask` to skip Supabase query in demo mode |
| `TaskCreationModal.tsx` | Update `handleCreateTasks` to use fallback board ID |

### Result
- No more UUID errors when creating tasks in demo mode
- Tasks are properly stored in localStorage with consistent `demo-board-1` ID
- Existing non-demo mode behavior remains unchanged

