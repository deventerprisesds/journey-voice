

# Fix Priorities Dashboard: Reassign, Delete, and New Groups

## Problems Identified

1. **Tasks in wrong category/group**: No UI to change a task's category or move it between topic groups
2. **Can't delete a group**: No delete option on topic group panels
3. **New groups never appear**: When you create a group via "Add Group", it has zero tasks. The code assigns groups to categories based on the majority category of their mapped tasks -- a group with 0 tasks matches nothing and is invisible

## Solution

### Fix 1: Make new groups appear immediately

When creating a topic group under a specific category, store the `window_affinity` field (which already exists on `task_topic_index`) with the category key. Then update the category-assignment logic in `Priorities.tsx` to check `window_affinity` as a fallback when a group has no tasks.

**File: `AddTopicGroupDialog.tsx`**
- Set `window_affinity` to `[categoryKey]` on insert so the group has an explicit category association

**File: `Priorities.tsx`**
- Update the topic-to-category mapping logic: if a topic has mapped tasks, use majority category; if not, fall back to `window_affinity[0]`

### Fix 2: Add "Delete Group" to topic group panels

**File: `TopicGroupPanel.tsx`**
- Add a trash icon button (visible on hover or via a small dropdown menu) on each topic group header
- On click, confirm with an AlertDialog, then delete the topic from `task_topic_index` (cascade will remove `task_topic_mappings` entries)
- Call `onRefresh` to reload the dashboard
- The "Uncategorized" pseudo-group cannot be deleted

**Props change**: Add `onRefresh: () => void` and `isDeletable: boolean` props

### Fix 3: Allow reassigning tasks (category + topic group)

**File: `TopicGroupPanel.tsx`**
- Add a click handler on each task row that opens a small popover or dropdown with:
  - **Change Category**: Select from user's categories (updates `tasks.category`)
  - **Move to Group**: Select from topic groups in the target category (updates `task_topic_mappings`)
  - **Remove from Group**: Removes the `task_topic_mappings` entry (task becomes uncategorized)

To keep it simple, use a `DropdownMenu` on each task row (triggered by a "..." button on hover).

## Files Changed

| File | Change |
|------|--------|
| `src/components/priorities/AddTopicGroupDialog.tsx` | Set `window_affinity: [categoryKey]` on insert |
| `src/pages/Priorities.tsx` | Use `window_affinity` as fallback for category assignment; pass available categories and topic groups to columns for reassignment |
| `src/components/priorities/TopicGroupPanel.tsx` | Add delete group button; add task reassignment dropdown (change category, move to group, remove from group) |
| `src/components/priorities/CategoryColumn.tsx` | Pass `onRefresh`, delete/reassign props through to TopicGroupPanel |

## Technical Details

### Category assignment logic (updated)

```text
For each topic group:
  1. If it has mapped tasks -> use majority category of those tasks
  2. Else if window_affinity is set -> use window_affinity[0]
  3. Else -> skip (orphan group, won't appear)
```

### Task reassignment

When changing a task's category:
- `UPDATE tasks SET category = ? WHERE id = ?`
- Call `onRefresh()` to re-render

When moving a task to a different group:
- Delete existing `task_topic_mappings` row for this task
- Insert new `task_topic_mappings` row with the target topic_id
- Call `onRefresh()`

When removing a task from a group:
- Delete the `task_topic_mappings` row
- Task becomes "Uncategorized" in its category column

### Delete group

- `DELETE FROM task_topic_index WHERE id = ?` (cascading deletes handle mappings)
- Affected tasks become uncategorized in their category

