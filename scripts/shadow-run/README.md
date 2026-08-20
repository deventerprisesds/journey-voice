# Shadow run — testing the scheduler against real components

Runs the **real** `nightly-schedule-builder` (no `dryRun`) against a synthetic
"shadow" user cloned from a real one, then deletes everything. The only variable
under test is the code/config change; every component is production.

## Why not `dryRun`?

`dryRun` is **not faithful** and will mislead you. The slotter re-reads
`is_scheduled` tasks from the DB itself, and that read is not dryRun-aware — so in
a dry run it collides with rows a real run would have **cleared first**.

Measured 2026-08-20, same task snapshot, same config, same code:

| | dryRun | shadow (real run) |
|---|---|---|
| tasks scheduled | 25 | **41** |
| `overlaps_scheduled_task` rejections | 43 | **1** |
| `Window violation` rejections | 46 | **16** |
| Saturday | **0 items** | 8 items |
| Monday | 2 items | 5 items |

42 of the 43 dry-run "overlaps" were phantoms. Any conclusion drawn from a dry run
about gaps, density, or rejection volume is suspect.

## Usage

1. `setup.sql` — clone board, prefs (with `scoringModel` override), open tasks
   (preserving `created_at`), and calendar events onto the shadow user.
2. Invoke the builder: `POST /functions/v1/nightly-schedule-builder`
   with `{"userId": "<shadow_user>", "triggerSource": "shadow_run"}` — **no dryRun**.
3. Inspect `public.tasks WHERE user_id = <shadow_user> AND is_scheduled`.
4. `teardown.sql` — **always**, even on failure.

Params: `:source_user`, `:shadow_user`, `:shadow_board`, `:scoring`.

## A/B testing composite vs priority-rank

Run twice with two shadow users, `:scoring` = `composite` and `priority-rank`,
against the same snapshot. Same tasks, same calendar, same real code — the scoring
model is the only difference.

## Safety — three things that must hold

1. **No `profiles` row for the shadow user.** The huddle-task-sync edge fn resolves
   the owner email from `profiles`; with no row it no-ops, so shadow tasks never
   mirror into Huddle's board. (Verified: 0 rows.)
2. **`notification_prefs` with everything disabled.** The `schedule_task_reminders`
   trigger fires on every task write; the disabled prefs row makes it insert
   nothing. (Verified: 53 task inserts produced 0 notifications.)
3. **Teardown MUST remove `user_scheduling_prefs`.** The nightly cron iterates every
   row in that table — a leftover shadow row would be scheduled every night forever.
   `teardown.sql` asserts this column is 0; treat non-zero as a failed teardown.

Writes to `tasks` fire six triggers; `notify_task_topic_classification` also calls
the classify edge fn per row (harmless, small cost).
