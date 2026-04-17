

## Pre-flight audit
- Files inspected: `supabase/functions/nightly-assignment-sync/index.ts`, `mem://logic/assignment-data-integrity-and-sync-architecture`, `mem://data/task-deduplication-cleanup-policy`, `mem://logic/same-day-title-deduplication`
- Forbidden patterns in changed files: `now.toISOString().split('T')[0]` for "today" derivation (line 31, 109) — will replace with `getTodayInTimezone(timezone)`
- Helpers: `getTodayInTimezone`, `dateToKeyInTimezone`
- Memory invoked: assignment-data-integrity-and-sync-architecture, task-deduplication-cleanup-policy

## How duplicates are prevented (already built in `nightly-assignment-sync`)

The function has a **3-layer dedup gate** before inserting any task:

1. **Primary key match — `assignment_id`**  
   `tasks.assignment_id = assignment.id` → if found, skip. This is the canonical link and is unique per assignment row.

2. **Legacy title match (exact)**  
   For tasks predating the `assignment_id` column: match on `tasks.title = assignment.title` AND `assignment_id IS NULL` AND not done. If found → **link** (set `assignment_id` on the legacy row) and skip insert. Counted as `repaired`.

3. **Legacy title match (emoji-prefixed)**  
   Same as above but matches `📚 ${assignment.title}` (the prefix this function itself adds). Same link-and-skip behavior.

Additional safeguard: the legacy match uses **two separate `.eq()` queries** instead of `.or()` to avoid the PostgREST comma-delimiter bug already documented in memory.

So a re-run of the sync on the same assignment row produces zero new tasks — it either skips (already linked) or repairs (links a legacy duplicate).

## How we'll ensure all 380+ get promoted this time

The function is correct but is currently **not invoked**. The plan:

### A. Backfill pass (one-shot, all users)
1. Query distinct `user_id` from `assignments` ∪ `assignments_mit`.
2. For each user, invoke `nightly-assignment-sync` with their `userId` and `timezone` (default `America/New_York`).
3. Capture the response per user: `created`, `repaired`, `skipped` counts.

### B. Verification gate (mandatory, dev user `a3378f93-...`)
After the backfill, run these read-only checks and report numbers before declaring success:

1. **Coverage check (the critical one):**
   ```
   SELECT COUNT(*) FROM assignments a
   WHERE a.user_id = '<dev>'
     AND a.status NOT IN ('completed','graded')
     AND NOT EXISTS (
       SELECT 1 FROM tasks t
       WHERE t.assignment_id = a.id AND t.user_id = a.user_id
     );
   ```
   Expected: **0** (or only rows excluded by the 30-day-past-due archive rule, which we will list explicitly).

2. **Same check for `assignments_mit`** — expected 0 unscheduled-eligible rows.

3. **Dedup check:**
   ```
   SELECT assignment_id, COUNT(*) FROM tasks
   WHERE user_id = '<dev>' AND assignment_id IS NOT NULL
   GROUP BY assignment_id HAVING COUNT(*) > 1;
   ```
   Expected: **0 rows**. If any appear, the secondary dedup is leaking and we stop and fix before continuing.

4. **Activity log audit:**  
   Confirm `activity_log` has `nightly_assignment_sync` rows for the dev user with `created_count + repaired_count + skipped_count` matching the eligible assignment total.

5. **Spot check 5 specific April/May assignments** by `sheet_row_number` from the earlier 345-row dump to confirm each has a linked task.

### C. Lock it in (auto-invocation)
1. End of `sync-google-sheets/index.ts` → fire-and-log invoke `nightly-assignment-sync` for the synced user.
2. End of `sync-mit-sheets/index.ts` → same.
3. Top of `nightly-schedule-builder/index.ts` (both full + `singleDay` modes) → invoke `nightly-assignment-sync` and **await** before candidate selection. This is the safety net: even if both sheet syncs are skipped, the builder cannot run against a stale task pool.

### D. Edge cases we will explicitly report (not silently skipped)
- Assignments with `due_date` older than 30 days → counted in `skipped` with a log line; surfaced in the verification report so you can decide whether to override the cutoff.
- Row 21 (malformed source data, NULL due_date) → will produce a task with no `due_date` and the bad title `"Spring 2025"`. We will flag it in the report; fix belongs in the spreadsheet.
- Users with no default board → currently logs an error and continues. Verification will list any user this affected so a default board can be created and the sync re-run.

### E. Timezone correctness
Replace UTC-naive "today" derivation in `nightly-assignment-sync` with `getTodayInTimezone(timezone)` so the 30-day cutoff and any "today" comparisons match the user's local day, not UTC.

## Files to change
- `supabase/functions/nightly-assignment-sync/index.ts` — timezone fix
- `supabase/functions/sync-google-sheets/index.ts` — invoke at end
- `supabase/functions/sync-mit-sheets/index.ts` — invoke at end
- `supabase/functions/nightly-schedule-builder/index.ts` — invoke at top (await)

## Acceptance criteria
- Dev user coverage check returns 0 unlinked eligible assignments for both EMBA and MIT.
- Dedup check returns 0 duplicate `assignment_id` rows in `tasks`.
- Activity log shows the run with concrete counts.
- Sheet syncs and nightly builder both auto-trigger the promotion going forward.
- Any skipped rows (30-day cutoff, missing board, malformed source) are explicitly listed, not hidden.

