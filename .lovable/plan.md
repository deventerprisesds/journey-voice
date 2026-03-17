

## Problem

The nightly schedule builder has been **silently failing for every user since March 11** due to a schema mismatch.

**Root cause**: Line 112-115 in `nightly-schedule-builder/index.ts` queries `task_topic_mappings` with `.eq('user_id', userId)`, but that table has no `user_id` column — only `id`, `task_id`, `topic_id`, `created_at`. The error triggers a `continue`, which skips the entire user without logging to `activity_log`. Every user hits this, so the function returns `results: {}` every night.

This worked on March 11 because either (a) the column existed briefly, or (b) a different version of the function was deployed at that time.

## Fix

### Modify `supabase/functions/nightly-schedule-builder/index.ts`

**Replace the broken topic mappings query (lines 112-122)** with a join through the `tasks` table:

```typescript
// Get priority board task IDs for this user by joining through tasks
const { data: mappedTasks, error: mappedError } = await supabase
  .from('task_topic_mappings')
  .select('task_id, tasks!inner(user_id)')
  .eq('tasks.user_id', userId);
```

Alternatively (simpler, avoids foreign key join issues): query `tasks` directly that have topic mappings:

```typescript
const { data: mappedTasks, error: mappedError } = await supabase
  .from('tasks')
  .select('id, task_topic_mappings!inner(topic_id)')
  .eq('user_id', userId)
  .is('completed_at', null)
  .not('status', 'in', '("DONE","BLOCKED")');
```

This reverses the query direction — start from `tasks` (which has `user_id`) and inner-join to `task_topic_mappings`. The `mappedIds` extraction changes to `(mappedTasks || []).map(t => t.id)`.

**Additionally**: Change the `continue` on line 119 to a warning + fallback (proceed with just READY/UP_NEXT tasks) so that a topic mapping failure doesn't prevent scheduling entirely.

### Redeploy

Deploy `nightly-schedule-builder` after the fix.

### Files Modified
- `supabase/functions/nightly-schedule-builder/index.ts` — fix the topic mappings query and add error resilience

