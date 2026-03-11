

# Combined Plan: Task Drag-and-Drop Between Groups + Protect Manual Groups

## Overview

This plan combines all previously discussed but unimplemented changes into one deliverable:

1. **Database**: Add `is_manual` column to `task_topic_index` and fix the cleanup trigger to skip manually created groups
2. **Database**: Update `task_count` bookkeeping so it stays accurate
3. **UI**: Enable dragging individual tasks between groups/subgroups in "group" view mode
4. **UI**: Add "Ungroup" option to the batch toolbar
5. **Code**: Set `is_manual = true` when users create groups via the dialog
6. **Code**: Update `task_count` in `batchMoveToGroup` and `handleMoveToGroup`

---

## 1. Database Migration

Add the `is_manual` column and replace the cleanup trigger function:

```sql
-- Add is_manual flag (false = auto-created by classifier, true = user-created)
ALTER TABLE public.task_topic_index
  ADD COLUMN IF NOT EXISTS is_manual boolean DEFAULT false;

-- Replace cleanup trigger: decrement counts, only auto-delete non-manual topics
CREATE OR REPLACE FUNCTION public.cleanup_task_topic_on_delete()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.task_topic_index
  SET task_count = task_count - 1, updated_at = now()
  WHERE id IN (
    SELECT topic_id FROM public.task_topic_mappings WHERE task_id = OLD.id
  );

  -- Only auto-delete system-generated (classifier) topics that hit zero
  DELETE FROM public.task_topic_index
  WHERE task_count <= 0
    AND is_manual = false
    AND id IN (
      SELECT topic_id FROM public.task_topic_mappings WHERE task_id = OLD.id
    );

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
```

This means:
- Classifier-created groups still get auto-cleaned when empty (existing behavior)
- User-created groups/subgroups survive indefinitely until manually deleted

---

## 2. `AddTopicGroupDialog.tsx` -- Set `is_manual: true`

When a user creates a group or subgroup via the dialog, add `is_manual: true` to the upsert payload. This flags it as user-created and protects it from the cleanup trigger.

---

## 3. Task Drag-and-Drop Between Groups (Group View Mode)

### `TopicGroupPanel.tsx`

- Import `Droppable` and `Draggable` from `@hello-pangea/dnd`
- Wrap the task list area inside each group panel with a `Droppable` component:
  - `droppableId` = the topic group ID (e.g., `"group-{topicGroup.id}"`)
  - `type` = `"TASK_IN_GROUP"`
- Wrap each task row with a `Draggable`:
  - `draggableId` = `"task-in-group-{task.id}"`
  - The entire task row becomes the drag handle
- Child sub-group panels remain as they are (rendered above the task droppable)
- The "Uncategorized" pseudo-group also gets a droppable (`"group-uncategorized-{categoryKey}"`)

### `Priorities.tsx` (`handleDragEnd`)

Add a new branch at the top of `handleDragEnd` for `type === 'TASK_IN_GROUP'`:

```
if (type === 'TASK_IN_GROUP') {
  const taskId = extract from draggableId
  const srcGroupId = extract from source.droppableId
  const dstGroupId = extract from destination.droppableId

  if srcGroupId === dstGroupId: return (no-op)

  // Delete old mapping
  await supabase.from('task_topic_mappings').delete().eq('task_id', taskId)

  if destination is an uncategorized group:
    // Just remove mapping (task becomes uncategorized)
  else:
    // Insert new mapping to destination topic
    await supabase.from('task_topic_mappings').insert({ task_id, topic_id: dstGroupId })
    // Increment task_count on destination
    // Decrement task_count on source (if it was a real group)

  // Refresh data
}
```

---

## 4. `task_count` Bookkeeping

### `batchMoveToGroup` in `Priorities.tsx`

After deleting old mappings and inserting new ones:
- Query old mappings first to find source topic IDs
- Decrement `task_count` on each source topic
- Increment `task_count` on the destination topic by the number of moved tasks

### `handleMoveToGroup` in `TopicGroupPanel.tsx`

After moving a single task:
- Decrement `task_count` on the current group (`topicGroup.id`)
- Increment `task_count` on the destination group

---

## 5. Batch Toolbar: "Ungroup" Button

Add an "Ungroup" button to the batch action bar (between "Status..." and the close button):
- Icon: `FolderMinus` from lucide-react
- On click: deletes all `task_topic_mappings` for selected task IDs, decrements `task_count` on affected source topics
- Shows toast: "Removed N tasks from their groups"
- Clears selection and refreshes

---

## Files Changed

| File | Change |
|------|--------|
| New migration | Add `is_manual` column; fix `cleanup_task_topic_on_delete` trigger |
| `src/components/priorities/AddTopicGroupDialog.tsx` | Add `is_manual: true` to upsert payload |
| `src/components/priorities/TopicGroupPanel.tsx` | Wrap tasks in `Droppable`/`Draggable` for `TASK_IN_GROUP` type; update `task_count` in `handleMoveToGroup` |
| `src/pages/Priorities.tsx` | Handle `TASK_IN_GROUP` drag in `handleDragEnd`; update `task_count` in `batchMoveToGroup`; add "Ungroup" batch button |

