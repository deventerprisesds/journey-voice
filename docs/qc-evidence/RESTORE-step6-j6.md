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
