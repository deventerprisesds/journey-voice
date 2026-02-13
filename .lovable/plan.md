

# Prevent Future Orphaned Topic Groups

## Root Cause

The `window_affinity` field on `task_topic_index` is being used for two different purposes:

1. **Auto-classifier** (edge function) stores scheduling time windows: `["business_hours", "evening"]`
2. **Priorities page** fallback logic treats it as a category key: `["CAREER"]`
3. **Add Group dialog** stores category keys: `["EDUCATION"]`

When all tasks are removed from an auto-classified group, the fallback reads `window_affinity[0]` = `"business_hours"` -- which matches no category key, making the group invisible.

## Solution: Add explicit `category_affinity` column

Store the category key directly on each topic group so it never gets lost, regardless of whether the group has tasks or not.

### Database Change

Add a new column `category_affinity` (type `text`, nullable) to `task_topic_index`. This stores the category key (e.g., `"CAREER"`, `"EDUCATION"`) directly.

### Edge Function Update: `classify-task-topic`

When creating or updating a topic, also set `category_affinity` to the task's category. This ensures every auto-classified group has an explicit category link from the start.

### Priorities Page Update

Change the fallback logic from checking `window_affinity[0]` to checking `category_affinity`:

```text
For each topic group:
  1. Has mapped tasks? -> use majority category (existing logic)
  2. Has category_affinity? -> use that
  3. Has window_affinity matching a category key? -> use that (backward compat for manually created groups)
  4. None of the above -> skip (true orphan)
```

### Add Group Dialog Update

When creating/upserting a topic group, set `category_affinity = categoryKey` in addition to `window_affinity`.

### Backfill Existing Groups

Run a one-time update to set `category_affinity` for existing topic groups based on majority category of their current tasks, so nothing is lost.

## Files Changed

| File | Change |
|------|--------|
| New migration | `ALTER TABLE task_topic_index ADD COLUMN category_affinity text;` |
| `supabase/functions/classify-task-topic/index.ts` | Set `category_affinity` to the task's category when inserting/updating topic rows |
| `src/pages/Priorities.tsx` | Use `category_affinity` as the primary fallback instead of `window_affinity[0]` |
| `src/components/priorities/AddTopicGroupDialog.tsx` | Set `category_affinity` on insert/upsert |

## Why This Prevents Future Orphans

- Every topic group gets a `category_affinity` at creation time (whether auto-classified or manually created)
- Even if all tasks are deleted from a group, the category link persists
- The `window_affinity` field goes back to its original purpose: scheduling time windows
- No more semantic mismatch between the two systems

