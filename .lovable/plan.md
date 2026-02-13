

# Add Debug Logging to Drag-and-Drop Handler + Demo User Mapping Policies

## Problem

Drag-and-drop of topic groups and tasks fails silently in your live authenticated environment. The RLS policies for authenticated users appear correct (SELECT, INSERT, UPDATE, DELETE all use `auth.uid()`), so the failure is happening somewhere in the `handleDragEnd` logic without any console output to diagnose it.

## Solution

### 1. Add comprehensive logging to `handleDragEnd` in `src/pages/Priorities.tsx`

Insert `console.log` / `console.error` at every decision point:

- Log the raw `DropResult` on entry (source, destination, type, draggableId)
- Log which branch is taken (TASK vs GROUP, same-column vs cross-column)
- Log the found task/group object before the optimistic update
- Log the Supabase response after each `.update()` call, including `error`, `status`, `statusText`
- Log when `loadData()` is triggered due to an error

This will make the next failure fully diagnosable.

### 2. Add demo-user RLS policies for `task_topic_mappings` (Database Migration)

These are still missing from the previous migration and are needed for demo mode task dragging. Three policies on `task_topic_mappings` (SELECT, INSERT, DELETE) plus one DELETE policy on `task_topic_index` for the demo user.

## Files Changed

| File | Change |
|------|--------|
| `src/pages/Priorities.tsx` | Add `console.log` and `console.error` statements throughout `handleDragEnd` |
| New migration | Add demo-user RLS policies for `task_topic_mappings` (SELECT, INSERT, DELETE) and `task_topic_index` (DELETE) |

## Logging Example

```typescript
const handleDragEnd = useCallback(async (result: DropResult) => {
  console.log('[DragEnd] Raw result:', JSON.stringify(result));
  if (!result.destination || !user) {
    console.log('[DragEnd] Abort: no destination or no user');
    return;
  }
  const { source, destination, type, draggableId } = result;
  console.log('[DragEnd] Type:', type, 'From:', source.droppableId, '->', destination.droppableId);

  // ... in GROUP cross-column branch:
  console.log('[DragEnd] Moving group', draggableId, 'from', srcCatKey, 'to', dstCatKey);
  const res1 = await supabase.from('task_topic_index')
    .update({ category_affinity: dstCatKey } as any).eq('id', groupId);
  console.log('[DragEnd] topic_index update:', { error: res1.error, status: res1.status });

  // ... after task update:
  console.log('[DragEnd] tasks update:', { error: res2.error, status: res2.status });

  if (res1.error || res2.error) {
    console.error('[DragEnd] DB error, reloading', { res1Error: res1.error, res2Error: res2.error });
    toast.error('Failed to move group');
    loadData();
  } else {
    console.log('[DragEnd] Success, group moved');
  }
}, [user, categories, loadData]);
```

This ensures the next time a drag fails, we will have the exact Supabase response in the console to determine whether it is an RLS issue, a missing row, or something else.
