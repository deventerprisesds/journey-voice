
# Plan: Fix Demo Mode Task Creation

## Problem

Task creation doesn't work in demo mode because the `boards` and `tasks` tables lack RLS policies for the demo user. The existing policies only allow access via `auth.uid() = user_id`, but demo mode uses a mock session that doesn't set `auth.uid()`.

**Evidence:**
- Boards exist in DB for demo user (`5b5de64e-...` and `4c987563-...`)
- 6 tasks exist for demo user in DB
- But queries return empty results because `auth.uid()` is `null` in demo mode
- Other tables (ai_threads, conversation_messages, assignments, etc.) work because they have explicit demo user policies

---

## Solution

Add RLS policies for the demo user ID (`00000000-0000-0000-0000-000000000001`) to the `boards` and `tasks` tables, following the same pattern used for other demo-enabled tables.

---

## Database Migration

Create RLS policies for demo mode access:

```sql
-- Boards table: Demo mode policies
CREATE POLICY "Demo user can view boards"
  ON boards
  FOR SELECT
  TO public
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Demo user can insert boards"
  ON boards
  FOR INSERT
  TO public
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Demo user can update boards"
  ON boards
  FOR UPDATE
  TO public
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Demo user can delete boards"
  ON boards
  FOR DELETE
  TO public
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- Tasks table: Demo mode policies
CREATE POLICY "Demo user can view tasks"
  ON tasks
  FOR SELECT
  TO public
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Demo user can insert tasks"
  ON tasks
  FOR INSERT
  TO public
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Demo user can update tasks"
  ON tasks
  FOR UPDATE
  TO public
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  WITH CHECK (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

CREATE POLICY "Demo user can delete tasks"
  ON tasks
  FOR DELETE
  TO public
  USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid);
```

---

## Why This Works

1. The `public` role applies to all connections (including unauthenticated/mock sessions)
2. Policies explicitly check for the hardcoded demo user ID
3. Follows the existing pattern used for `ai_threads`, `conversation_messages`, `assignments`, etc.
4. Normal authenticated users are unaffected (their existing policies remain)

---

## Files Changed

| Type | Location | Change |
|------|----------|--------|
| Database | New migration | Add 8 RLS policies (4 for boards, 4 for tasks) |

---

## Expected Result

After this change:
- Demo user can fetch their boards (defaultBoardId will be populated)
- "New Task" button becomes clickable
- Task creation saves to Supabase instead of localStorage
- Demo tasks persist across page refreshes
- Voice/chat assistant tools can see and manage demo tasks
