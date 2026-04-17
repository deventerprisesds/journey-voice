

## Pre-flight audit
- Files to invoke (no edits): `nightly-assignment-sync` (already batch-refactored, deployed)
- Helpers used by function: `getTodayInTimezone`
- Memory invoked: assignment-data-integrity-and-sync-architecture, validation-and-testing-workflow

## Current state (just measured)
- EMBA eligible assignments: **345**
- MIT eligible assignments: **124**
- Total eligible: **469**
- Tasks already linked via `assignment_id`: **45**
- **Gap to close: ~424 unlinked eligible assignments** (minus those past the 30-day archive cutoff)

## Next step: Backfill + verify (dev user first)

### Step 1 — Invoke the batch-refactored function
`POST /functions/v1/nightly-assignment-sync` with body:
```json
{ "userId": "a3378f93-d655-4913-b2fa-ca5b1d8020f1", "timezone": "America/New_York" }
```
Capture response: `created_count`, `repaired_count`, `skipped_count`, `skipped_old_count`, `no_board_skipped_count`, plus the arrays.

### Step 2 — Verification queries (run in this order; stop if any fail)

1. **Coverage check (EMBA):**
   ```
   SELECT COUNT(*) FROM assignments a
   WHERE a.user_id = '<dev>' AND a.status NOT IN ('completed','graded')
     AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.assignment_id = a.id);
   ```
   Expected: **0** (or only rows in `skipped_old`)

2. **Coverage check (MIT):** same, against `assignments_mit`. Expected: **0** (or skipped_old).

3. **Dedup integrity:**
   ```
   SELECT assignment_id, COUNT(*) FROM tasks
   WHERE user_id = '<dev>' AND assignment_id IS NOT NULL
   GROUP BY assignment_id HAVING COUNT(*) > 1;
   ```
   Expected: **0 rows**. If any → STOP and investigate before backfilling other users.

4. **Activity log audit:** confirm a fresh `nightly_assignment_sync` row in `activity_log` with counts matching the response.

5. **Spot check:** pick 3 April/May EMBA + 2 MIT assignments and confirm each has a linked `tasks.id`.

### Step 3 — Report results
Show a table:
```
Source     | Eligible | Created | Repaired | Skipped(old) | NoBoard | Unlinked-After
-----------|----------|---------|----------|--------------|---------|---------------
EMBA       |   345    |   ?     |    ?     |      ?       |    ?    |       ?
MIT        |   124    |   ?     |    ?     |      ?       |    ?    |       ?
Dedup dups |   0 expected
```

### Step 4 — Only after dev user passes all 5 checks
Backfill the remaining users by iterating distinct `user_id`s from `assignments ∪ assignments_mit`, invoking the function for each, and reporting per-user counts.

## Stop conditions
- Any duplicate `assignment_id` row → halt, do not run other users.
- Function returns non-200 → halt, surface the error verbatim.
- Coverage gap > 0 with rows NOT in `skipped_old` → halt and list the missed rows.

## Files changed in this step
- **None.** This is a verification + invocation pass against already-deployed code.

