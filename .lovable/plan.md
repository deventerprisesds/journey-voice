

# Fix: Add-to-Priority Button Missing in Group View

## Problem

The Priorities page defaults to **group view**, where tasks render inside `TopicGroupPanel`. The `onAddToPriority` callback is only wired into the `TaskRow` component used in **task view**. So in group view, there is no way to add tasks to the priority lane.

## Root Cause

`TopicGroupPanel` does not accept or forward an `onAddToPriority` prop. Its internal task rows have no plus button or star indicator.

## Fix

### 1. `src/components/priorities/TopicGroupPanel.tsx`
- Add `onAddToPriority?: (task: Task) => void` to the props interface
- Pass it through to child/nested `TopicGroupPanel` instances
- In the task list rendering section, add a plus (+) button next to each task (or a filled star if `task.is_priority` is already true), identical to how `TaskRow` in `CategoryColumn.tsx` does it

### 2. `src/components/priorities/CategoryColumn.tsx`
- In the **group view** branch, pass `onAddToPriority` to every `TopicGroupPanel` instance (both for named topic groups and the uncategorized fallback)

### Files changed

| File | Change |
|------|--------|
| `src/components/priorities/TopicGroupPanel.tsx` | Accept and use `onAddToPriority` prop; render plus/star button on each task row |
| `src/components/priorities/CategoryColumn.tsx` | Pass `onAddToPriority` to all `TopicGroupPanel` instances in group view |

