# RESTORE step 2 — record in the repo the database objects the live DB already has

WHAT: seven migration files added to main's `supabase/migrations/`, each named for the version it was
applied under live, so the repo describes the live journey database again (J2, J3, J6, J9, J11 schema, J15).
WHY: owner approved the surgical restore ("Option a surgical restore approved"). Step 2 of the apply order in
`docs/qc-evidence/RESTORE-J1-J15-diff.md` (branch `claude_schedule-sanity-timing`): these objects run in
production, but main's repo has no file for them, so a rebuild from main would silently lose them. And every
branch file name differs from the applied version, so landing them under their branch names would make a
`supabase db push` try to re-run them.
SUPERSEDES: nothing. SUPERSEDED-BY: nothing — current.
EVIDENCE: Supabase project `wwxgajrtmslzklnyplah`, 2026-10-26: `list_migrations`; read-only `SELECT`s on
`supabase_migrations.schema_migrations.statements`, `information_schema.columns`, `pg_policies`, `pg_indexes`,
`pg_class.relrowsecurity`, `pg_constraint`, `pg_proc.prosrc`, `pg_trigger`, `obj_description`/`col_description`
and `cron.job`. Branch source: `origin/claude/mobile-widget-web-bridge-debug-nsishi` @ `d1059fe`. Base: `origin/main` @ `aeef3d3`.

**Nothing was applied to the database.** No `apply_migration`, no DDL, no DML. Only `SELECT`s.
**Nothing under `supabase/functions/` changes**, so merging this deploys nothing.

Labels: **O** = observed in this pass. **I** = inferred.

## How each file was checked (O)

1. **File == what was applied.** For each version, Supabase stores the exact SQL it ran in
   `supabase_migrations.schema_migrations.statements`. I took md5 of that SQL with `--` comments and all
   whitespace removed (computed in Postgres), and the same md5 of the file (computed locally with
   `sed 's/--.*$//' | tr -d ' \t\n\r\f\v'`). Equal md5 = same statements.
2. **The live object exists and matches.** Tables: columns, types, nullability, defaults, FKs, CHECK/UNIQUE
   constraints, indexes, RLS on, policy names and commands. Functions: md5 of live `prosrc` vs md5 of the
   file's function body (same normalisation). Trigger: `pg_get_triggerdef`. Cron: `cron.job` schedule, command, `active`.

## The table

| feature | branch file | applied version (live name) | new file on main | statements == applied? (md5) | live object verified? | drift |
|---|---|---|---|---|---|---|
| J2 | `20260726000000_task_overflow_queue.sql` | `20260726051049` `task_overflow_queue` | `20260726051049_task_overflow_queue.sql` | **branch file: NO** (`223e22f9…` vs `d0ec937e…`); **recorded file: YES** (`d0ec937e…`) | YES — 14 columns, 3 FKs, UNIQUE(task_id, overflow_date), `task_overflow_queue_user_open_idx`, RLS on, 2 policies (SELECT, UPDATE) | **The applied SQL has `DROP POLICY IF EXISTS` before each of the 2 `CREATE POLICY`; the branch file does not.** The recorded file adds those 2 lines (plus a header comment saying so), so it matches what ran. Branch comments kept. |
| J3 | `20260726010000_external_event_attendance.sql` | `20260726112200` `external_event_attendance` | `20260726112200_external_event_attendance.sql` | YES (`1ceeaabf…`) | YES — 12 columns, 2 FKs, UNIQUE(user_id, external_event_id), `external_event_attendance_user_status_idx`, RLS on, 3 policies (SELECT, INSERT, UPDATE) | none; byte-identical copy of the branch file |
| J6 | `20260220000000_task_dedup_log.sql` | `20260820155525` `task_dedup_log` | `20260820155525_task_dedup_log.sql` | YES (`145ee391…`) | YES — 13 columns, CHECK on `action` and `method`, `idx_task_dedup_log_user_created`, RLS on, 2 policies (SELECT, UPDATE) | none; byte-identical copy |
| J9 | `20260828020000_preserve_task_provenance.sql` | `20260828025806` `preserve_task_provenance` | `20260828025806_preserve_task_provenance.sql` | YES (`6b83cf7e…`) | YES — `preserve_task_provenance()` body md5 `7f7297d2…` = file body; function COMMENT md5 `e4a8ff6d…` = file; trigger `preserve_task_provenance_trigger BEFORE UPDATE OF scheduling_context ON public.tasks FOR EACH ROW` | none; byte-identical copy |
| J11 (schema) | **none — no file on any branch** | `20260826022400` `topic_index_dedup_and_lifecycle` | `20260826022400_topic_index_dedup_and_lifecycle.sql` | YES (`451ffcb8…`) — the SQL is copied verbatim from `statements` | YES — `task_topic_index.archived_at timestamptz`, `merged_into uuid`, FK `merged_into → task_topic_index(id) ON DELETE SET NULL`, both column comments match, `idx_task_topic_index_live` present | none; file written from the applied SQL itself, plus a 3-line header comment |
| J15 | `20261008130000_db_maintenance_cron.sql` | `20261008125356` `db_maintenance_cron` | `20261008125356_db_maintenance_cron.sql` | YES (`dc45dd05…`) | YES — 4 jobs active with the file's schedules and commands: `maint-http-response-vacuum` `*/15 * * * *`, `maint-cron-history-prune` `17 4 * * *`, `maint-cron-history-vacuum` `27 4 * * *`, `maint-weekly-vacuum-full` `37 4 * * 0` | none; byte-identical copy |
| J15 | `20261008150000_unscheduled_task_cancels_start_alarms.sql` | `20261008142455` `unscheduled_task_cancels_start_alarms` | `20261008142455_unscheduled_task_cancels_start_alarms.sql` | YES (`19327f56…`) | YES — live `schedule_task_reminders()` body md5 `220edb63…` (len 3463) = file body | none; byte-identical copy. This is also the live home of J10's 9am-local due-tomorrow rule (I, per the diff report). |

## Branch migrations NOT recorded in this step, and why

| branch file | applied live? | why not recorded here |
|---|---|---|
| `20260218000000_due_tomorrow_tz_aware.sql` (J10) | yes, as `20260818133453` `due_tomorrow_tz_aware` | Out of step 2's scope (the brief names J2/J3/J6/J9/J11/J15). The diff report pairs it with J10 (step 4). Its function was later redefined by J15's `20261008142455`, which is what is live and is recorded above. Recording it later under `20260818133453_…` is safe. |
| `20260820000000_shadow_run_archive_tables.sql` (J12) | yes, as `20260820195542` | Out of scope (J12, step 1). |
| `20260820000001_shadow_run_smart_scheduler_support.sql` (J12) | yes, as `20260820202944` | Out of scope (J12, step 1). |

No in-scope branch migration lacked an applied counterpart, so there is nothing in the "not live, not recorded" category (O, `list_migrations`).

## Found along the way, NOT changed (main-side; left alone per the brief)

Two of main's OWN migration files also carry names that differ from their applied versions (O, `list_migrations` vs `git ls-files`):

| main file | applied version |
|---|---|
| `20260913140000_calendar_attendee_capture.sql` | `20261015170549` `calendar_attendee_capture` |
| `20261015180000_schedule_next_call_dedupe.sql` | `20261015170940` `schedule_next_call_dedupe` |

`20260821153000_task_events_capture_deletes.sql` vs applied `20260821152518` and `20260913170000_send_digests_cron.sql`
vs applied `20260913171140` show the same pattern (O). The brief says never to rename main's existing files, so
they are untouched. A `supabase db push` from main would already see these as unapplied today, independent of this PR.

## What will no longer be in place

**Nothing.** This PR only adds files. `git diff --stat origin/main...HEAD` (below) shows 8 files, all additions
(0 deletions). `20261015180000_schedule_next_call_dedupe.sql` is still present. No edge function, workflow,
client file or existing migration is modified, and the database was not touched.

```
# as of the first commit on this branch (this doc's own line count grows in the follow-up commit)
 docs/qc-evidence/RESTORE-step2-db-records.md                                 |  74 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 supabase/migrations/20260726051049_task_overflow_queue.sql                   |  47 +++++++++++++++++++++++++++++++++++++++++++++++
 supabase/migrations/20260726112200_external_event_attendance.sql             |  43 +++++++++++++++++++++++++++++++++++++++++++
 supabase/migrations/20260820155525_task_dedup_log.sql                        |  36 ++++++++++++++++++++++++++++++++++++
 supabase/migrations/20260826022400_topic_index_dedup_and_lifecycle.sql       |  36 ++++++++++++++++++++++++++++++++++++
 supabase/migrations/20260828025806_preserve_task_provenance.sql              | 107 +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 supabase/migrations/20261008125356_db_maintenance_cron.sql                   |  36 ++++++++++++++++++++++++++++++++++++
 supabase/migrations/20261008142455_unscheduled_task_cancels_start_alarms.sql |  90 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
 8 files changed, 469 insertions(+)
A	docs/qc-evidence/RESTORE-step2-db-records.md
A	supabase/migrations/20260726051049_task_overflow_queue.sql
A	supabase/migrations/20260726112200_external_event_attendance.sql
A	supabase/migrations/20260820155525_task_dedup_log.sql
A	supabase/migrations/20260826022400_topic_index_dedup_and_lifecycle.sql
A	supabase/migrations/20260828025806_preserve_task_provenance.sql
A	supabase/migrations/20261008125356_db_maintenance_cron.sql
A	supabase/migrations/20261008142455_unscheduled_task_cancels_start_alarms.sql
```
