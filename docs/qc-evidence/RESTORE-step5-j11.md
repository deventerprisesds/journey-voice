# RESTORE step 5 — J11 (classify-task-topic stops creating near-duplicate topics)

WHAT: restores J11 onto current main. The topic classifier sees only live topics. It reuses an existing topic when the model's name differs from it only by case, punctuation, word order or filler words ("Tasks", "Management", …). It revives an archived topic instead of creating a copy of it.
WHY: live `classify-task-topic` v306 (2026-10-19) is byte-identical to main, which lacks the fix. Live topics for the main user went from 38 after the 08-25 cleanup to 95 today. Spec: `RESTORE-J1-J15-diff.md` §J11, apply-order step 5. Owner: "Option a surgical restore approved".
SUPERSEDES: nothing. SUPERSEDED-BY: nothing — current.
EVIDENCE: branch `claude_restore-j11-topic-dedupe`; commits listed per step; live source read with Supabase MCP `get_edge_function` on 2026-10-26; read-only `SELECT` on `task_topic_index` and the Supabase deploy-run list on 2026-10-26.

Labels: **O** = observed in this pass. **I** = inferred.

## Step 5.0 — re-verifying the spec's claims (O)

| claim | check | result |
|---|---|---|
| main has not touched `classify-task-topic` since the split | `git log 0459770..origin/main -- supabase/functions/classify-task-topic`, and `nsishi..origin/main` | both empty |
| no conflicts | branch file compared with merge tree `72d3cd8` | byte-identical |
| live = main | `get_edge_function classify-task-topic`: v306, bundle `index.ts`, `_shared/call-context-builder.ts`, `_shared/scheduling-defaults.ts`, compared with `origin/main` `aeef3d3` | 0 diff lines in all 3 |
| schema is live | the code reads `archived_at` / `merged_into`; the live `SELECT` returns both (75 archived rows, 3 merged) | live; no migration in this branch (another lane handles it) |

Not established (O): which version of this function ran on which day between 08-26 and 10-19. Deploys alternated between the parked branches (08-26 … 10-08) and main (09-13, 10-08 …). The run list does not show whether a manual run deployed "all" or one function.

## Step 5.1 — the branch's file, verbatim

Commit `f8585d3`: the code from `1eda8f2`, equal to the 3-way merge.
