

# Fix Topic Group Creation (Demo) and Category Changes

## Two Issues

### Issue 1: Topic group creation fails for demo user (error 23503)
The `task_topic_index` table has a foreign key constraint `task_topic_index_user_id_fkey` referencing `auth.users(id)`. The demo user ID (`00000000-0000-0000-0000-000000000001`) does not exist in `auth.users`, so any INSERT into `task_topic_index` with that user_id is rejected by Postgres.

**Fix**: Drop the foreign key constraint and replace it with one pointing to `public.profiles(user_id)` instead (where the demo user already has a row). This follows Supabase best practices -- public tables should not reference `auth.users` directly.

### Issue 2: "Failed to change category" for some columns
The database `task_category` enum only contains: `LIFE`, `CAREER`, `VENTURES`, `EDUCATION`. The UI defines 6 categories including `PROF_EDUCATION` and `PERSONAL`, so updating a task to either of those values is rejected by Postgres.

**Fix**: Add the two missing values to the enum.

## Database Migration

```sql
-- 1. Fix FK: point to profiles instead of auth.users
ALTER TABLE public.task_topic_index
  DROP CONSTRAINT task_topic_index_user_id_fkey;

ALTER TABLE public.task_topic_index
  ADD CONSTRAINT task_topic_index_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;

-- 2. Add missing category enum values
ALTER TYPE public.task_category ADD VALUE IF NOT EXISTS 'PROF_EDUCATION';
ALTER TYPE public.task_category ADD VALUE IF NOT EXISTS 'PERSONAL';
```

## Code Change

**`src/components/priorities/TopicGroupPanel.tsx`** -- Add detailed error logging to `handleChangeCategory`, `handleMoveToGroup`, and `handleRemoveFromGroup` so future failures are immediately diagnosable (log error code, message, and details).

## Files Changed

| File | Change |
|------|--------|
| New migration | Drop/recreate FK on `task_topic_index`, add enum values |
| `src/components/priorities/TopicGroupPanel.tsx` | Add detailed error logging to all three action handlers |

