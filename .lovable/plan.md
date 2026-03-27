

# Fix: Upcoming Assignments Not Being Created as Tasks

## Root Cause

The title-based fuzzy dedup on **line 154** is too aggressive. It uses `title.ilike.%${assignment.title}%` which does a broad substring match. For example:

- Assignment **"Project Management Tracker (March 30, 2026)"** matches existing task **"Submit project tracker"** because "project" and "tracker" appear in both
- Assignment **"ASSIGNMENT #7: Draft Client Presentation"** matches **"Finish assignment for Business Problem ALP"** because both contain "assignment"

This causes ALL upcoming assignments to be falsely "linked" to unrelated existing tasks and skipped (663 skipped, 0 created).

Additionally, this false linking **corrupts existing tasks** by overwriting their `assignment_id` and `due_date` with wrong data.

## Fix

### 1. Replace fuzzy title dedup with exact-match dedup

**File**: `supabase/functions/nightly-assignment-sync/index.ts` (lines 145-172)

Replace the broad `ilike` query with an exact title match (with and without the emoji prefix):

```ts
// SECONDARY DEDUP: exact title match only
const { data: titleMatches } = await supabase
  .from('tasks')
  .select('id, title, status')
  .eq('user_id', userId)
  .is('assignment_id', null)
  .is('completed_at', null)
  .not('status', 'eq', 'DONE')
  .or(`title.eq.${assignment.title},title.eq.📚 ${assignment.title}`);
```

This prevents false matches while still linking tasks that were manually created with the exact assignment title.

### 2. Clean up incorrectly linked tasks

The previous runs linked wrong assignments to unrelated tasks. Fix by clearing `assignment_id` on the 6 existing EDUCATION/PROF_EDUCATION tasks that were incorrectly linked (they currently show `assignment_id = null` so this may have already self-corrected, but we should verify after the fix runs).

### 3. Invoke the fixed sync and verify

After deploying:
1. Call `nightly-assignment-sync` for user `a3378f93-d655-4913-b2fa-ca5b1d8020f1`
2. Confirm `created_count > 0` — specifically tasks for "Project Management Tracker (March 30)" and "ASSIGNMENT #7: Draft Client Presentation (March 30)"
3. Call `nightly-schedule-builder` to assign `start_time` values to the new tasks
4. Query tasks to confirm they appear with today/upcoming `start_time` values

## Files to Change

| File | Change |
|------|--------|
| `supabase/functions/nightly-assignment-sync/index.ts` | Replace `ilike` fuzzy match with exact `eq` match on lines 147-154 |

## Single change, high impact

This is a one-line query fix that unblocks all upcoming assignment task creation.

