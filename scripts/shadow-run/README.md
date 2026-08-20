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

## Second engine: smart-calendar-scheduler (advisory)

journey has **two** scheduling engines and they honor different config:

| | nightly-schedule-builder + batch-calendar-scheduler | smart-calendar-scheduler |
|---|---|---|
| shape | multi-task, **writes** | single-task, **advisory (zero writes)** |
| callers | pg_cron nightly, execute-tool parse | ai-task-parser, taskScheduling.ts, RealtimeVoiceAssistant |
| isolation need | full clone + teardown | shadow rows only — nothing to undo |

`scripts/shadow-run/smart-scheduler-probes.sql` fires probe tasks at the advisory
engine with `userId = <shadow_user>` and archives request/response into
`shadow_run_suggestions`.

**`scoringModel` does not apply to the advisory engine.** Composite vs
priority-rank is a MULTI-TASK RANKING model (which of N tasks gets a slot) and
lives in the nightly builder. `smart-calendar-scheduler` places ONE task; its
internal `score` is slot-fitness (proximity to a preferred time), not task
priority. Probes may run against a composite-configured shadow user, but
composite is inert there.

### ⚠ Deployed-vs-repo drift (found 2026-08-20)

The **deployed** `smart-calendar-scheduler` contains a `resolveWindowPlan` with a
precedence chain — `explicit > trait (appointment/venue-dependent) > keyword table
(FALLBACK) > category` — plus `nudgeToBusinessHours`, `keywordFallbackUsed` and
`placementBasis` in its response. **None of that source is in this repo**, on this
branch or `origin/main` (verified by grep against both, and by reading the
deployed source via the Supabase MCP `get_edge_function`).

Consequences:
1. **A redeploy of this function from repo source would DESTROY that logic.** Do
   not deploy `smart-calendar-scheduler` from the repo until the deployed source
   is recovered into git.
2. The trait/business-hours-nudge behaviour exists ONLY in the advisory engine.
   The deployed nightly slotter has none of it (`resolveWindowPlan`: 0 hits,
   `contextRules`: 0 hits) — it validates on category alone, which is why
   finance/comms tasks get rejected as window violations in the nightly build.
