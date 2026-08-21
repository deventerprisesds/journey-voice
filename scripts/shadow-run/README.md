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

### ⚠ Unmerged scheduler branch — NOT deployed-vs-repo drift (corrected 2026-08-20)

The **deployed** `smart-calendar-scheduler` contains a `resolveWindowPlan` with a
precedence chain — `explicit > trait (appointment/venue-dependent) > keyword table
(FALLBACK) > category` — plus `nudgeToBusinessHours`, `keywordFallbackUsed` and
`placementBasis` in its response.

**CORRECTION.** An earlier version of this note claimed that source was in no git
ref. That was WRONG: the grep had only covered the working branch and
`origin/main` *before* all remote refs were fetched. The source is in git, on
**`origin/claude/mobile-widget-web-bridge-debug-nsishi`** — commit `a1ffd16`
"feat(scheduler): systematic trait layer; demote keyword table to FALLBACK (both
paths)", plus `2813f5c`, `b229ec7` and ~17 more scheduler commits.
Always `git fetch origin '+refs/heads/*:refs/remotes/origin/*'` and
`git log --all -S<symbol>` before concluding code is missing.

The real situation is an **unmerged branch**, not lost source:
1. That branch is in neither `origin/main` nor this working branch, yet at least
   `smart-calendar-scheduler` was DEPLOYED from it — so prod runs code main does
   not have.
2. The deployed **nightly** slotter genuinely lacks the trait layer: its bundle,
   including its own bundled copy of `_shared/scheduling-defaults.ts`, has 0
   occurrences of `resolveWindowPlan`/`trait`/`contextRules`. Each function
   bundles its own `_shared` copy, so the two engines are running different
   versions of the shared config module. That is why finance/comms tasks are
   rejected as window violations by the nightly build but handled by the
   advisory engine.
3. That branch already contains fixes for most of the "ignored config" audit:
   `6825684` (keyword rules on the voice path + priority multipliers),
   `849f956` (customAIInstructions into the batch placer prompt),
   `dc15925`/`32aaa71` (maxDailyHours capacity guard, made opt-in),
   `8231f14` (de-fork smart-calendar-scheduler onto shared config),
   `aa23eea` (after_work 17-19 non-overlapping; reconcile drifted copies).
   **Merge that work rather than rebuilding it.** A dry-run merge into this
   branch conflicts in only 3 files (`.claude/memory.md`,
   `execute-tool/index.ts`, `nightly-schedule-builder/index.ts`);
   `smart-calendar-scheduler` and `scheduling-defaults.ts` merge cleanly.
