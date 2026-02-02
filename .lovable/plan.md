

# Fix: Minimal Change for Today → UP_NEXT, Remove "To Do" Column

## Changes Required

### 1. Remove "To Do" Column from KanbanBoard

**File**: `src/components/KanbanBoard.tsx` (lines 85-93)

Remove the added "To Do" column and restore original positions:

```typescript
const STANDARD_COLUMNS: Column[] = [
  { id: 'std-backlog', name: 'Backlog', status: 'BACKLOG', position: 0, board_id: 'std' },
  { id: 'std-blocked', name: 'Blocked', status: 'BLOCKED', position: 1, board_id: 'std' },
  { id: 'std-ready', name: 'Ready', status: 'READY', position: 2, board_id: 'std' },
  { id: 'std-upnext', name: 'Up Next', status: 'UP_NEXT', position: 3, board_id: 'std' },
  { id: 'std-doing', name: 'Doing', status: 'DOING', position: 4, board_id: 'std' },
  { id: 'std-done', name: 'Done', status: 'DONE', position: 5, board_id: 'std' },
];
```

### 2. Add Post-Parse Status Logic in AI Task Parser

**File**: `supabase/functions/ai-task-parser/index.ts`

After tasks are parsed (around line 325 where `tasks` array is created), add logic to override status:

- If task has a `due_date` that matches **today** (the `targetDate`) → set `status: 'UP_NEXT'`
- Otherwise → keep the existing category-based status (no change to current behavior)

```typescript
// After line 325: const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];

// Determine if task is for today - if so, set status to UP_NEXT
const todayStr = targetDate ? new Date(targetDate).toDateString() : new Date().toDateString();

const tasksWithCorrectStatus = tasks.map((task: any) => {
  // Check if task's due_date is today
  const taskDueDate = task.due_date ? new Date(task.due_date).toDateString() : null;
  const isForToday = taskDueDate === todayStr;
  
  return {
    ...task,
    status: isForToday ? 'UP_NEXT' : task.status  // Only override if today
  };
});

// Use tasksWithCorrectStatus instead of tasks in the rest of the function
```

This change is applied at the end of parsing, so all existing category-based status logic remains untouched - we only override to `UP_NEXT` when the task is for today.

### 3. Fix Existing TODO Tasks in Database

One-time SQL to convert any existing `TODO` tasks to `BACKLOG`:

```sql
UPDATE tasks 
SET status = 'BACKLOG', updated_at = NOW() 
WHERE status = 'TODO';
```

## Summary of Changes

| What | Change |
|------|--------|
| KanbanBoard | Remove "To Do" column, restore original positions |
| AI Parser | Add post-parse check: if `due_date = today` → `status = UP_NEXT` |
| Database | Convert existing `TODO` → `BACKLOG` |

## Expected Behavior

- Tasks created for **today** → appear in **Up Next** column
- Tasks created for **future dates** → appear in their **category column** (LIFE, CAREER, etc.)
- Tasks with **no date** → appear in their **category column**
- **No "To Do" column** exists

