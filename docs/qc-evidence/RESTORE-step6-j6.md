# RESTORE step 6 — J6 (task dedup guard + `undo_dedup`), shipped switched OFF

WHAT: restores J6 onto current main. When the owner turns it on, task creation (`create_task`, `parse_and_create_tasks`) skips exact/near duplicates of his open tasks, tags ambiguous ones `possible-duplicate`, sends him one Iris chat message per batch, and `undo_dedup` puts a skipped task back. It ships OFF: with no `dedup` key in his config it does nothing.
WHY: owner's original ask: "are we missing a fuzzy dedup? build one — normalized + semantic ... notify me on every dedup so I can review/undo." Live `execute-tool` v503 (2026-10-19) is main and has none of it. Spec: `RESTORE-J1-J15-diff.md` §J6 and the Summary's "Not a file, but lost behaviour" bullets (on `claude_schedule-sanity-timing`). Owner: "Option a surgical restore approved".
SUPERSEDES: nothing. SUPERSEDED-BY: nothing — current.
EVIDENCE: branch `claude_restore-j6-task-dedup`; commits listed per step; ported commits `22f145b`, `0800e59`, `895f02c` from `claude/huddle-journey-integration-xokgv1`.

Labels: **O** = observed in this pass. **I** = inferred.

## Step 6.0 — re-verifying the spec's claims (O)

| claim | check | result |
|---|---|---|
| J6 is three commits | `git log xokgv1 -- _shared/task-dedup.ts`; `-S runDedup` / `-S undoDedup` on execute-tool | `22f145b`, `0800e59`, `895f02c`; nothing later on the branch touches the dedup code |
| `task_dedup_log` is already on main | `supabase/migrations/20260820155525_task_dedup_log.sql` (added by `590ce54`, step 2) diffed against the branch's `20260220000000_task_dedup_log.sql` | byte-identical. The branch's copy is NOT re-added (it would be a second migration for the same table) |
| execute-tool "auto-merges" | per-commit `git cherry-pick -n 22f145b` onto main | **2 conflict hunks**, not 0 — see 6.1. The spec's 0 came from the whole-branch merge tree, which also carries J4 |

## Step 6.1 — port `22f145b` (dedup guard)

Taken whole (main never changed them): `_shared/task-dedup.ts`, `_shared/task-dedup.test.ts`.
Not taken: `.claude/memory.md` (branch ledger), the duplicate migration (above).

`execute-tool/index.ts` — two conflicts, both from context the branch had and main does not:

| hunk | branch side | main side | resolution |
|---|---|---|---|
| imports | `resolveConfig, validateTaskWindow` + dedup import | `resolveConfig, validateTaskWindow, activeCaveats` (main's caveats tools) | keep main's line, add the dedup import |
| `parseAndCreateTasks` insert | dedup skip/flag block, then J4's `dryRun ? … : insert` | plain insert | dedup block + main's plain insert. **J4's `dryRun` is NOT ported** (it is step 8). The four `dryRun` guards inside J6's hunks (`if (!dryRun) dedupEntries.push`, `&& !dryRun` on the flagged entry, `if (!dryRun && dedupEntries.length)`, a comment) are removed, which is what they evaluate to when `dryRun` is false |

Main's work kept, proven by grep on the result (O):
- `case 'get_task_topics'` (dispatcher line 423) and its function (line 2244): count 2 on main, 2 after.
- oldest default board `.order('created_at', { ascending: true })`: 3 on main, 3 after (lines 875 `createTask`, 1407 `parseAndCreateTasks`, 2289 `get_task_topics`).
- The only `-` lines in `git diff origin/main -- execute-tool/index.ts` are `const taskData = {` (→ `: any`), two trailing-whitespace lines of a `return {`, `for (const task of tasks) {` (→ indexed loop), and `}))` (→ `})),` + the `dedupedDuplicates` field). No main logic removed.

Index safety (O, read): after the loop, scheduling indexes `unscheduledTasks` (built from `createdTasks`), never the parsed `tasks` array, so a skipped candidate cannot shift another task's slot.

## Step 6.2 — port `0800e59` (Iris chat notice + `undo_dedup` tool), verbatim

Auto-merged with no conflict (O): `_shared/tool-definitions.ts` gains the `undo_dedup` definition after `parse_and_create_tasks`'s neighbour; execute-tool gains `case 'undo_dedup'` and `undoDedup()`; `task-dedup.ts` switches the batch notice to a `scheduled_chat` row. Main's `notification-delivery/index.ts` still routes `notification_type === 'scheduled_chat'` (lines 143 and 632), so the notice has a consumer (O, grep).

## Step 6.3 — port `895f02c` (notice copy), verbatim

`task-dedup.ts` 2 lines. The commit's `.claude/memory.md` hunk (branch ledger) is not taken.

## Step 6.4 — `undoDedup` re-derives status (beyond a verbatim restore; required by the spec)

The branch's `undoDedup` re-inserted `row.candidate` as-is. Live `task_dedup_log` has 4 not-yet-undone `skipped` rows whose `candidate.status` is a category (`VENTURES` ×2, `LIFE` ×2; spec, O 2026-10-26). `task_status` still contains those four category names, so Postgres would ACCEPT the insert and the task would land in a non-workflow lane — the #28/#31 bug.

- New pure `restorePayloadFromLog(candidate)` in `_shared/task-dedup.ts`: drops `id`; keeps `status` only if it is one of the 9 workflow lanes; otherwise sets `UP_NEXT` when `start_time` or `due_date` is set, else `BACKLOG` (journey's own new-task rule, `defaultStatusForNewTask` in `src/utils/workflowStatus.ts`). `category` is left alone.
- `undoDedup` now calls it (the only change in that function).
- The 9-lane list is restated in `_shared` because edge functions cannot import `src/`; a test asserts it equals `src/utils/workflowStatus.ts`'s `WORKFLOW_STATUSES`.
- Choice taken (reversible, flagged): a VALID workflow status in the payload (e.g. a caller's explicit `DOING`) is kept rather than overwritten, since that is what the original create would have written. To always re-derive instead, drop the `WORKFLOW_SET.has(status)` branch.

## Flag state — ships OFF (O, from code)

`resolveDedupConfig` (task-dedup.ts line 73): `enabled: d.enabled === true`. Absent `dedup`, `dedup: {}`, `enabled: "true"`, `enabled: 1` → OFF. `runDedup` returns a passthrough (every candidate `create:true`, no tags) before reading open tasks or calling embeddings. The owner's config has no `dedup` key (spec, O 2026-10-26), so after deploy nothing changes. This lane did NOT write his config.

## Step 6.5 — `verify_jwt` pins for the deploy-all this merge causes (commit `40ce8e1`)

This step adds a `_shared/` file and edits `_shared/tool-definitions.ts`, so `deploy-supabase-functions.yml` (lines ~118-126: "_shared changed -- … deploying all") runs `supabase functions deploy` for **every** function directory. A function with no `[functions.X]` entry deploys with the CLI default `verify_jwt = true`.

Compared `config.toml` with live `list_edge_functions` (O, 2026-10-27, 127 live functions, 51 repo function dirs): **7 functions would have flipped false → true**: `classify-task-topic`, `huddle-task-sync`, `nightly-assignment-sync`, `run-scheduled-ceremonies`, `send-android-calendar-event`, `test-google-calendar`, `test-outlook-calendar`. These are the same 7 the step-3 lane found. Its pins are on `claude_restore-j13-alarm-actions`, which is not merged.

Added the same 7-pin block, using step 3's exact text and leaving out its `alarm-action` pin, because that function is not on main. Re-check after the edit: **0 mismatches across all 51**. `tomllib` parses the file. **Merge-order note:** if step 3 merges first, this block will conflict with step 3's at the end of `config.toml`. Resolve by taking step 3's side, or drop `40ce8e1`. Never keep both, because duplicate `[functions.X]` tables are invalid TOML.
Pre-existing and unchanged: `[functions.realtime-voice-assistant]` is in `config.toml` with no directory. Main's 10-19 deploy-all ran with it.

## Proof

**`npm test`**: 325/325 pass (main baseline 309; +16 = the 10 original dedup tests, which never ran on main because the file was absent, + 6 new). `npm run check:symbols`: 0 new undefined symbols.
**New tests** (`_shared/task-dedup.test.ts`, all via `runDedup` or the pure helper):
- flag ON (`dedup.enabled: true`): "Make Klarna payments" is skipped by **signature** against "Make payments to Klarna". "Schedule a dentist visit" is skipped by **semantic** match (cos 0.95) against "Book dentist appointment". "Water the plants" is created. One embeddings call.
- flag OFF: the owner's real config key set, `undefined`, `null`, `{dedup:{}}`, `enabled:"true"`, `enabled:1` → `enabled:false`. Every candidate is created. **0** embeddings calls. Open tasks are not even read.
- undo payload: `VENTURES` undated → `BACKLOG`; `LIFE` + `due_date` → `UP_NEXT`; `CAREER` + `start_time` → `UP_NEXT`; `EDUCATION`/`PERSONAL`/empty/null/number → `BACKLOG`; the old `id` is dropped; `category` is kept. Valid `DOING` is kept.
- `_shared` WORKFLOW_STATUSES == `src/utils/workflowStatus.ts`.
- execute-tool wiring: `undoDedup` inserts `restorePayloadFromLog(row.candidate)`; `undo_dedup` is dispatched; `get_task_topics` is present; 3 oldest-board lookups; both create paths call `runDedup`; a skipped duplicate returns (createTask) or `continue`s (parseAndCreateTasks) before the insert.

**`deno check`** (deno 2.5.6, scratchpad import map `denocheck/` because the proxy blocks deno.land/esm.sh): `_shared/task-dedup.ts` + `_shared/tool-definitions.ts` rc=0. `execute-tool/index.ts` rc=1 with **17 errors, the identical message set main's own file produces** (diffed, O). None of them is new; live v506 runs main's file, so deploys do not type-check. `deno test --no-check --allow-read task-dedup.test.ts`: 16/16.

**Mutation proof** (`mutate.sh`, anchors/replacements in files under scratchpad `mut/j6/`, test cmd `node --experimental-strip-types --test supabase/functions/_shared/task-dedup.test.ts`):

| # | defect reinstated | test that must fail | outcome |
|---|---|---|---|
| M1 | flag defaults ON (`enabled !== false`) | runDedup flag OFF | FIRED |
| M2 | flag gate removed from `runDedup` | runDedup flag OFF | FIRED |
| M3 | undo keeps a category status | undo payload: a category status | FIRED |
| M4 | undo ignores the date (always BACKLOG) | undo payload: a category status | FIRED |
| M5 | `VENTURES` added to the edge workflow list | edge WORKFLOW_STATUSES is identical | FIRED |
| M6 | `undoDedup` inserts the raw candidate (the branch's code) | execute-tool wiring | FIRED |
| M7 | parseAndCreateTasks no longer `continue`s on a skip | execute-tool wiring | FIRED |
| M8 | createTask no longer calls `runDedup` | execute-tool wiring | FIRED |
| M9 | semantic high band disabled | runDedup flag ON | FIRED |
| M10 | signature no longer order-independent | runDedup flag ON | FIRED |
| M11 | createTask skip branch disabled | execute-tool wiring | FIRED |

11/11 FIRED. The tree was clean after the runs.

**Live vs new** (Supabase MCP `get_edge_function execute-tool`, read-only, 2026-10-27): live is **v506**, `verify_jwt false`. Its bundle holds `execute-tool/index.ts`, `_shared/{timezone,tool-definitions,call-context-builder,scheduling-defaults}.ts`. Live vs `origin/main`: **0 differing lines in all 5**. Live vs this branch: `index.ts` 137 lines, `tool-definitions.ts` 13 lines (the `undo_dedup` definition), and `task-dedup.ts` is new. These are exactly the J6 hunks above.

## What deploys on merge

`_shared` changed, so **all 51 function directories redeploy from main** (`supabase functions deploy`, every dir under `supabase/functions/` without a leading `_`). Behaviour changes only in the 3 whose bundle content changes:
- `execute-tool`: dedup hooks in `create_task`/`parse_and_create_tasks` (inert while OFF) and the new `undo_dedup` tool (**live even while OFF**, see below).
- `generate-realtime-token`, `twilio-realtime-bridge`: they bundle `tool-definitions.ts`, so the voice model is now offered `undo_dedup`.
The other 48 redeploy byte-for-byte what main holds. Any function whose live copy differs from main (for example an unmerged restore step deployed by dispatch) is overwritten with main's copy. Functions that exist only live (76, including `alarm-action` and `confirm-external-meeting`) are not touched.

## What will no longer be in place

- **Nothing main has is removed.** `get_task_topics` (#42/#47/#52) and the oldest-default-board lookups in `createTask`/`parseAndCreateTasks` (#43) are still there (grep and test, above). Main's `activeCaveats` import is kept.
- **Not restored with J6:** J4's `dryRun` preview in `parse_and_create_tasks` (step 8). J6's own `dryRun` guards were stripped, so there is no dry-run dedup preview until J4 lands. When J4 is restored, its 3-way merge must put `if (!dryRun)` back on the two `dedupEntries.push` lines and the `finalizeDedup` call.
- **The branch's verbatim `undoDedup` is not in place:** it re-inserted the saved payload as-is. Now a category status becomes `UP_NEXT`/`BACKLOG`.
- **Live today, unchanged by this:** the duplicate creations still happen. The guard is OFF.
- **New exposure while OFF:** `undo_dedup` does not check the flag. If a model calls it, it restores the newest un-undone batch from `task_dedup_log`. Today that is the August skips (4 rows: `VENTURES` ×2, `LIFE` ×2). They would land in `BACKLOG`/`UP_NEXT`, not in a category lane. This is the branch's behaviour, kept; gating undo behind the flag is a one-line change if the owner wants it.

## How the owner turns it on and confirms it

There is no Settings toggle. It is one key in his `user_scheduling_prefs.config`, which a Settings save will keep, because since #59 a save merges into the stored config:
```sql
UPDATE public.user_scheduling_prefs
SET config = jsonb_set(config, '{dedup}', '{"enabled": true}'::jsonb, true)
WHERE user_id = '<owner uuid>';
```
Optional keys: `semantic` (default true), `highThreshold` (0.90, skip), `possibleThreshold` (0.80, create + `possible-duplicate` tag). Turn it off: set `enabled` to `false` or remove the key.
Confirm live: (1) ask Iris to add a task whose title is a reworded copy of an open one, e.g. "Test-make Klarna payments" when "Test-make payments to Klarna" is open. The reply says it was skipped. A `task_dedup_log` row appears (`action='skipped'`), and one Iris chat message lists it with the "undo" hint. (2) Reply "undo". The task appears on the board in BACKLOG (or UP_NEXT if dated), and the log row gets `undone_at`. Delete the `Test-` tasks afterwards.
