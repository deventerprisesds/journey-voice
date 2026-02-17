

# Fix: Double-Click to Open Tasks + Category Move on Priorities Dashboard

## Problem 1: Can't open tasks
Task rows in `TopicGroupPanel.tsx` have no click/double-click handler. There's no `TaskDetailModal` on the Priorities page.

## Problem 2: Category move doesn't visually move the task
A task like "Submit project tracker" has `category=PROF_EDUCATION` in the database but appears under Career because its topic group ("Career Development") is placed by majority-vote. The menu correctly disables PROF_EDUCATION (it matches the stored category), so the user can't select it. Even if they could, changing only the category wouldn't move the task visually -- it would stay in the same topic group in the Career column.

**The fix:** When a user changes a task's category, also remove it from its current topic group. This way it lands in the "Uncategorized" bucket of the target category column, making the move visually obvious. Also remove the `disabled` condition so all categories are always selectable.

## Technical Changes

### 1. `src/pages/Priorities.tsx`
- Import `TaskDetailModal`
- Add `selectedTask` / `setSelectedTask` state
- Add `handleSaveTask` callback (updates task in DB, refreshes data)
- Pass `onOpenTask={setSelectedTask}` down through `CategoryColumn`
- Render `<TaskDetailModal>` at page level

### 2. `src/components/priorities/CategoryColumn.tsx`
- Accept `onOpenTask: (task: Task) => void` prop
- Pass it through to `TopicGroupPanel` (both for named groups and uncategorized)
- Pass it to `TaskRow` in task view mode; add `onDoubleClick` on `TaskRow`

### 3. `src/components/priorities/TopicGroupPanel.tsx`
- Accept `onOpenTask: (task: Task) => void` prop
- Add `onDoubleClick={() => onOpenTask(task)}` on each task row div (lines 188-266)
- Pass `onOpenTask` to recursive child `TopicGroupPanel` renders
- Remove `disabled={cat.key === task.category}` (line 227) so all categories are always selectable
- In `handleChangeCategory`: after updating the task's category, also delete the task's topic group mapping so it moves to "Uncategorized" in the target column

### 4. No changes to `TaskDetailModal.tsx`
It already accepts a `Task` object and works standalone.

## Deployment
Frontend-only changes -- no edge function deployment needed.

