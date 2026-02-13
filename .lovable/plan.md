

# Fix Topic Group Creation in Demo Mode + Better Error Logging

## Root Cause

The "Failed to create topic group" error is caused by **RLS policy rejection**. The INSERT policy on `task_topic_index` requires `user_id = auth.uid()`, but in Demo Mode there is no real Supabase auth session -- `auth.uid()` returns `null`, so the policy blocks the insert every time.

The same issue affects `user_presence` (visible in the console logs).

## Solution

Two changes:

### 1. Add Demo-User RLS Policy (Database Migration)

Add a permissive INSERT and UPDATE policy specifically for the demo user UUID (`00000000-0000-0000-0000-000000000001`). This is the same pattern used for other tables that work in demo mode.

```sql
-- Allow demo user to insert into task_topic_index
CREATE POLICY "Demo user can insert topics"
  ON task_topic_index FOR INSERT
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- Allow demo user to update own topics
CREATE POLICY "Demo user can update topics"
  ON task_topic_index FOR UPDATE
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- Allow demo user to read own topics
CREATE POLICY "Demo user can read topics"
  ON task_topic_index FOR SELECT
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid);
```

### 2. Improve Error Handling in AddTopicGroupDialog

Update the catch block to show the **actual** error message from Supabase instead of a generic "Failed to create topic group":

- Show the specific Postgres error code and message in the toast
- Distinguish between RLS violations (42501), duplicate key errors (23505), and other failures
- Log full error details to console for debugging

## Files Changed

| File | Change |
|------|--------|
| New migration | Add demo-user RLS policies for `task_topic_index` |
| `src/components/priorities/AddTopicGroupDialog.tsx` | Show specific error messages: RLS violation vs duplicate vs unknown |

