
# Plan: Fix "New Task" Button on Agenda Page

## Problem Identified

The "New Task" button on the Agenda page (`/agenda`) opens the `TaskCreationModal`, but task creation fails because:

1. `DailyScheduleView` fetches `defaultBoardId` asynchronously (lines 56-85)
2. Before the fetch completes, `defaultBoardId` is `null`
3. After my previous fix, the modal renders with `boardId={defaultBoardId || ''}` (empty string)
4. When the user tries to create a task, line 663 in `TaskCreationModal` inserts `board_id: boardId` (empty string)
5. This causes a Supabase error because an empty string is not a valid UUID

The modal opens fine, but task creation silently fails.

---

## Solution

Prevent opening the modal until `defaultBoardId` is available, and disable the button with visual feedback while loading.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/DailyScheduleView.tsx` | Disable "New Task" button until `defaultBoardId` is loaded |

---

## Implementation Details

### DailyScheduleView.tsx

**Change 1: Add loading state for board ID (around line 35)**

Track whether the board fetch is still in progress:
```typescript
const [isBoardLoading, setIsBoardLoading] = useState(true);
```

**Change 2: Update fetchDefaultBoard to manage loading state (lines 56-85)**

```typescript
const fetchDefaultBoard = async () => {
  if (!user) {
    setIsBoardLoading(false);
    return;
  }
  
  setIsBoardLoading(true);
  
  const { data, error } = await supabase
    .from('boards')
    .select('id')
    .eq('user_id', user.id)
    .eq('is_default', true)
    .single();

  if (data) {
    setDefaultBoardId(data.id);
  } else if (error) {
    // If no default board, get the first board
    const { data: firstBoard } = await supabase
      .from('boards')
      .select('id')
      .eq('user_id', user.id)
      .limit(1)
      .single();
    
    if (firstBoard) {
      setDefaultBoardId(firstBoard.id);
    }
  }
  
  setIsBoardLoading(false);
};
```

**Change 3: Disable button while loading (lines 276-285)**

```tsx
<Button 
  size="sm"
  disabled={isBoardLoading || !defaultBoardId}
  onClick={() => {
    setCreateAtTime(null);
    setIsCreating(true);
  }}
>
  <Plus className="w-4 h-4 mr-2" />
  {isBoardLoading ? 'Loading...' : 'New Task'}
</Button>
```

**Change 4: Only render modal with valid boardId (lines 439-449)**

Revert to the safer conditional that requires `defaultBoardId`:
```tsx
{defaultBoardId && user && (
  <TaskCreationModal
    isOpen={isCreating}
    onClose={() => setIsCreating(false)}
    onTasksCreated={onTaskUpdate}
    boardId={defaultBoardId}
    userId={user.id}
    targetDate={selectedDate}
  />
)}
```

---

## Why This Works

1. The button is disabled until `defaultBoardId` is available
2. Users get visual feedback ("Loading..." text) while waiting
3. The modal only renders when there's a valid board ID
4. No silent failures - the button simply won't work until ready
5. No new functions needed - uses existing state patterns

---

## Edge Case: No Boards Exist

If a user has no boards at all, `defaultBoardId` will remain null and the button stays disabled. This is a rare edge case (boards are typically created on signup), but we could add a toast message if needed:

```typescript
if (!data && !firstBoard) {
  toast.error('No task boards found. Please create one in Settings.');
}
```

---

## Expected Result

After this change:
- "New Task" button shows "Loading..." briefly on page load
- Button becomes clickable once board is fetched
- Task creation works correctly with valid board ID
- No silent failures or console errors
