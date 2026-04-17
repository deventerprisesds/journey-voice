

The user is asking an architectural question about why `assignments` and `assignments_mit` are two separate tables instead of one unified table with a discriminator column (e.g., `program` or `program_id`).

This is a design/research question, not an implementation request — but it has a clear "should we fix this?" undertone. Let me address both: explain why it's split today, then offer a concrete unification plan they can approve.

## Why they're split today (observed from the codebase)

Both tables exist because they were built at different times against different Google Sheet sources, and the split was the path of least resistance — not a deliberate design decision.

Evidence in the codebase:
- Two near-identical sync functions: `sync-google-sheets` (EMBA) and `sync-mit-sheets` (MIT). Each writes to its own table.
- Two near-identical history tables: `assignment_history` and `assignments_mit_history`.
- The `nightly-assignment-sync` function already iterates **both** tables with the same logic — proof that the split adds work without adding behavior.
- The `assignments` table already has a `program_id` FK to `programs`, so the discriminator column the user is asking about **already exists** on the EMBA side. MIT just got its own table instead of a second `program_id` value.
- Memory `features/assignments-management-dashboard` confirms the UI uses an EMBA/MIT toggle — purely a filter on which table to read.

## Costs of keeping them split
- Every new feature gets written twice (sync, dedup, scheduling, history, RLS).
- The `nightly-assignment-sync` and dashboard both carry branching code paths.
- Cross-program queries (e.g. "all assignments due this week") require `UNION ALL` everywhere.
- Two FK targets for `tasks.assignment_id` is impossible — today `tasks.assignment_id` only points to one of them, which is a latent bug for MIT-linked tasks.

## Cost of unifying
- One migration: copy `assignments_mit` rows into `assignments` with `program_id` set to the MIT program row, copy `assignments_mit_history` into `assignment_history`, then drop the MIT tables.
- Update ~6 files: `sync-mit-sheets`, `nightly-assignment-sync`, `Assignments.tsx`, `assignmentFetching.ts`, `assignmentSync.ts`, demo data.
- Re-run the dedup/coverage verification we just finished.

## Recommendation
Unify. The split has no benefit and is actively causing the duplicate sync logic we've been working around for two days. The `program_id` discriminator already exists.

## Plan if approved

### Phase 1 — Schema migration (additive, reversible)
1. Ensure a `programs` row exists for MIT; capture its UUID.
2. Add any columns that exist on `assignments_mit` but not `assignments` (audit first; expected: none material).
3. Copy all `assignments_mit` rows into `assignments` with `program_id = <MIT uuid>`. Preserve `id` so existing `tasks.assignment_id` links survive **if** any tasks already point at MIT rows; if `id` collisions exist, generate new UUIDs and remap.
4. Copy `assignments_mit_history` → `assignment_history` with the new ids.
5. Rename `assignments_mit` → `assignments_mit_deprecated` and `assignments_mit_history` → `assignments_mit_history_deprecated` (rollback safety per memory rule, do not drop yet).

### Phase 2 — Code consolidation
1. `sync-mit-sheets/index.ts` → write to `assignments` with `program_id = <MIT uuid>`. Keep the function name (it's the sheet source, not the table).
2. `nightly-assignment-sync/index.ts` → remove the second loop over `assignments_mit`; one query covers both programs.
3. `Assignments.tsx` + `assignmentFetching.ts` → EMBA/MIT toggle becomes a `program_id` filter on a single query.
4. `assignmentSync.ts` and demo data → single code path.
5. Update `docs/DATABASE_SCHEMA.md` to remove the MIT-specific section.

### Phase 3 — Verification
1. Row counts: `assignments WHERE program_id = MIT` matches old `assignments_mit` count.
2. History row counts match.
3. Dev user dashboard renders identical EMBA + MIT lists pre/post.
4. Re-run the coverage + dedup queries from the prior plan; expect 0 unlinked, 0 duplicates.
5. Trigger `sync-mit-sheets` and `sync-google-sheets`; confirm both write to `assignments` and `nightly-assignment-sync` promotes correctly.

### Phase 4 — Cleanup (separate, after 1 week of stable operation)
Drop the `_deprecated` tables.

### Files to change
- Migration (new)
- `supabase/functions/sync-mit-sheets/index.ts`
- `supabase/functions/nightly-assignment-sync/index.ts`
- `src/pages/Assignments.tsx`
- `src/utils/assignmentFetching.ts`
- `src/utils/assignmentSync.ts`
- `src/utils/demoData.ts` (if it references MIT table)
- `docs/DATABASE_SCHEMA.md`

### Open question to confirm before executing
Do any rows in `tasks.assignment_id` currently point at `assignments_mit.id`? If yes, we must preserve those UUIDs during the copy. I'll check this as the first step of Phase 1 and report before touching anything.

### Stop conditions
- Any UUID collision between `assignments.id` and `assignments_mit.id` → halt, present remap plan.
- Post-migration row counts don't match → halt, do not deprecate old tables.

