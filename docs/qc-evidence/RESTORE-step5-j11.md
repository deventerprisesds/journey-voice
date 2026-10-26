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

## Step 5.2 — one name lookup, and a gap in the parked fix closed (commit `989095f`)

- `TOPIC_FILLER_WORDS` and `normalizeTopicName` moved verbatim into `classify-task-topic/topic-match.ts`, alongside a single `findMatchingTopic` lookup (exact name first, then normalized). Both the live match and the dormant revive use it. Reason: `index.ts` calls `serve()` and reads `Deno.env` when imported, so nothing in it can be unit-tested.
- **Gap closed (beyond a verbatim restore; flagged for the owner, separable as its own commit).** The parked fix (`1eda8f2`) ran the near-duplicate match only when the model answered `"existing"`. If the model answered `"new"` with "Career Development Tasks" while "Career Development" was live, the code still inserted a duplicate. The unique constraint is on the exact name, and the dormant/revive check only looks at archived rows. Now the live match runs for both answers. To drop it, revert `989095f`'s `liveMatch` block, which leaves the branch's behaviour.
- A side effect of exact-first (O, from the code): the revive path's old `.find(exact || normalized)` could pick an earlier near match over a later exact one. `findMatchingTopic` always prefers the exact one.

## What it does and does not catch — measured on the real topics (O)

The normalizer was run over the main user's 95 live and 75 dormant topic names (read-only `SELECT`, 2026-10-26):

| what | result |
|---|---|
| live topics that collapse together | **1 pair**: "Application Development" + "Application Development Management" (the second was created 2026-09-14) |
| a live name that matches a dormant one (it would be revived or reused, not duplicated) | "Career Development" ~ "Career Development Tasks"; "Application Development" ~ "Application Development Projects"; "Personal Communication" ~ "Personal Communication Management" |
| dormant clusters it would have prevented | "Life Management" / "Life Management Tasks" / "General Life Tasks"; "Family Grooming Plans/Tasks/Management"; "Travel Planning" / "Travel Management"; "Venture Development" / "Venture Development Projects" |
| live near-duplicates it does **not** catch (by design: the extra word is not filler) | "Geospatial Development" / "Geospatial Development Tools" / "Geospatial Application Development"; "Inventory Management" / "Inventory Database Management"; "Research Resource Management" / "Research Material Management" |

**Consequence (I, high confidence):** most of the 38 → 95 growth is NOT filler-only variants. These are subset or synonym names and single-task topics. The normalizer is built to leave those apart. For them, J11 relies on two weaker levers: the shorter live-only list in the prompt, and the "a near-duplicate is a failure" instruction to the model. Expect J11 to slow topic growth, not to stop it. It does not merge any of the existing 95 (that would be a separate data cleanup, as on 08-25). Whether the 09-14 "Application Development Management" was created while the parked fix was live cannot be told from the run list (§5.0).

## Proof

**`deno check`** (deno 2.5.6) on `index.ts`, `topic-match.ts`, `topic-match.test.ts`: rc=0. This used the same scratchpad import map as step 4, because the proxy blocks `deno.land` and `esm.sh`. Main's own file also passes it.
**Unit tests**: `node --experimental-strip-types --test supabase/functions/classify-task-topic/topic-match.test.ts`: 6/6 pass. `deno test --allow-read`: 6/6 pass. Repo `npm test`: 286/286 pass. The repo's `test` glob does not collect this folder (the same note as step 4), so CI will not run it until J12's collector lands.

**Near-duplicates resolve to the existing topic (unit-level, O):** with live topics [Career Development, Application Development, Personal Communication, …], `findMatchingTopic` returns the existing topic for "Career Development Tasks", "Application Development Management", "Personal Communication Management", "career development", "Development Career" and "Career-Development!". It returns nothing for "Car Rental Management", "Geospatial Development Tools", "Research Material Management" and "Vehicle Rental". In `index.ts`, that result is used for both a "new" and an "existing" answer (static wiring test).

**Mutation proof** (`mutate.sh`, anchors and replacements in files under the scratchpad `mut/j11/`):

| # | defect reinstated | test that must fail | outcome |
|---|---|---|---|
| M1 | exact-name match only (main's behaviour) | near-duplicates resolve to the existing live topic | FIRED |
| M2 | filler list emptied | filler/case/punctuation/order collapse | FIRED |
| M3 | a "new" answer no longer checked against live topics (the gap) | index.ts wiring | FIRED |
| M4 | archived/merged topics back in the classifier's list | index.ts wiring | FIRED |
| M5 | first-of-either match instead of exact-first | exact match wins | FIRED |
| M6 | an all-filler name collapses to an empty key | all-filler keeps its words | FIRED |

All six restores were checked: the file matches HEAD.

**Live vs new (O):** live v306 = main (0 lines). Live v306 vs this branch's `index.ts`: 71 changed lines (+66/−5), plus the new `topic-match.ts`, which the deploy bundles through the import. The test file is not imported, so it is not bundled.

## What will no longer be in place

- **Archived and merged topics in the classifier's prompt.** The classifier will no longer see the 75 archived / 3 merged topics, so it can no longer file a new task into an archived topic directly. If the model invents a name that matches an archived topic, that topic is **un-archived** (following `merged_into` to the surviving topic) and reused. So archived topics can come back to life on their own, which they could not before.
- **A new topic row for every near-variant name.** The classifier will no longer create a new row when the model's name differs from a live or archived topic only by case, punctuation, word order or filler words (task(s), management, project(s), plan(s)/planning, activit(y/ies), general, misc, related, and, the, of, for). The task goes into the existing topic. This applies whether the model said "existing" or "new" (the second case is step 5.2's gap fix).
- **Two subjects whose names differ only by filler words.** They can no longer exist as separate topics in future. For example, "Project Management Integration" and an "Integration Tasks" topic would now be one topic (I, from the normalizer: both reduce to "integration"). No live pair is affected today: only "Application Development" / "Application Development Management" collide, and they are the same subject.
- **The prompt's old wording.** The model is now told that creating a near-duplicate is a failure and that it should prefer a broader existing topic. Expect fewer brand-new single-task topics (I).
- Nothing main gained since the split is lost (O: no main commit on this function after `0459770`). Main's `get_task_topics` in `execute-tool` is untouched and still returns archived and merged rows to the Huddle widget. That is the separate main-side question the spec raised.

## How the owner confirms it live

After merge (auto-deploys `classify-task-topic`): add a task close to an existing topic (for example "Draft the career development plan"). In Supabase function logs for `classify-task-topic`, look for `Fuzzy-matched … → existing`, `Model proposed new … reusing it` or `Added to existing topic`. Over the next week, the live-topic count should stay near 95 instead of climbing:
`SELECT count(*) FROM task_topic_index WHERE user_id='a3378f93-d655-4913-b2fa-ca5b1d8020f1' AND archived_at IS NULL AND merged_into IS NULL;`
