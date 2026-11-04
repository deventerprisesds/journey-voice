<!--
WHAT:          independent verification (round 3) of the SERVER/RULES half of the JOB-category change:
               full re-derivation of the loop-2 refutation/findings (D-4/L2-1, G-1, L2-2, L2-3) and a light
               re-check of everything CONFIRMED in loop 2.
WHY:           Tier 1 change (the keyword gate decides scheduling windows and QC violations). Loop 2 REFUTED D-4
               (narrow) and found G-1, L2-2, L2-3; commits def7879 + 446aa32 claim to fix them.
SUPERSEDES:    docs/qc-evidence/VERIFY-job-category-server-2.md (its REFUTED verdict and findings are re-derived here).
SUPERSEDED-BY: nothing -- current
EVIDENCE:      branch claude/jolly-archimedes-is9jyz @ 446aa32, diff cf9f680..446aa32, commands quoted inline.
-->

# VERIFY job-category server, round 3

Verifier started 2026-11-04 03:50 UTC. Code under test: `origin/claude/jolly-archimedes-is9jyz` @ `446aa32` (detached).
Live DB: read-only SELECTs only on `wwxgajrtmslzklnyplah`. No writes, no deployed-function calls.

## Suite re-run (covers everything)

| command | result |
|---|---|
| `npm test` | **502 tests, 70 suites, 502 pass, 0 fail**, exit 0 (loop 2: 501; +1 = new Q-5) |
| `npm run check:symbols` | 108 files, **0 NEW** undefined symbols, 1 known (baselined `send-chat-message:buildCallContext`), exit 0 |

Diff `cf9f680..446aa32` touches exactly: `ROLLOUT-job-category.sql` (steps 1-2 gated), `keyword-rules.ts`
(`activeWindowNamesForDay` start/end typeof check), `keyword-rules.test.ts` (Q-5, W-2 call-site assert),
`execute-tool/index.ts` (empty-update guard message + `CATEGORY_KEYS` import), and the loop-2 report. Nothing else.

## Claims

### D-4 / L2-1 -- category-only update_task with an unrecognised value says so -- **CONFIRMED**

Observation (code, execute-tool/index.ts 1015-1019): the empty-`updateData` guard now returns
`"${categoryKept}" is not a category (use one of: ${CATEGORY_KEYS.join(', ')}); the task was not changed` when
`categoryKept` is set, else the old `No updatable fields provided`. `CATEGORY_KEYS` is imported at line 6.

Runtime probe: the real `updateTask` body (extracted by awk from line `async function updateTask(` to
`// Batch grooming write`), bundled with esbuild against the REAL `_shared/categories.ts`, driven with a stub
supabase client that records calls:

| args | result | DB calls |
|---|---|---|
| `{category:'gibberish'}` | `success:false`, `"gibberish" is not a category (use one of: LIFE, JOB, CAREER, VENTURES, EDUCATION, PROF_EDUCATION, PERSONAL); the task was not changed` | **none** |
| `{category:'Zz Qx'}` | same shape | none |
| `{category:''}` | `No updatable fields provided` | none |
| `{}` | `No updatable fields provided` | none |
| `{category:'gibberish', title:'New title'}` | `success:true`, `category_not_changed:'gibberish'`, message `... (category "gibberish" is not a category, so it stays LIFE)` | `update {title}` only |
| `{category:'job'}` | `success:true`, `Updated task "New title"` | `update {category:'JOB'}` |

The warn `[UPDATE_TASK] category "..." is not a category; kept the current one` is logged on each unrecognised case.

Observation outside the claim (L3-1, low, guard gap): no test asserts the new guard message (grep for
`is not a category` / `No updatable fields` outside docs hits only source and unrelated comments), so reverting
the message to the generic one leaves the suite green. Behaviour is correct today; it is simply unguarded.
Mutation M-8 (`scripts/mutate.sh`, test cmd `npm test`): `error: categoryKept` -> `error: false` at line 1016
(always the generic message) -> **INERT**, full suite green; restore asserted against HEAD. Not equivalent (the
response text changes), so this measures L3-1: the D-4 message is correct but has no test.

### G-1 -- W-2 now guards the QC call site's activeWindowNames argument -- **CONFIRMED**

Observation: `keyword-rules.test.ts` W-2 adds
`assert.match(QC_SRC, /activeWindowNames: activeWindowNamesOn\(task\.start_time, tz, config\.timeWindows\),/)`;
the source line is `src/utils/dailyReviewPipeline.ts:516`, text identical.

Mutation M-7 re-run (`scripts/mutate.sh`, anchor/replacement from files, test cmd `npm test`, must-fail `W-2`):
`activeWindowNames: activeWindowNamesOn(task.start_time, tz, config.timeWindows),` -> `activeWindowNames: undefined,`
-> **FIRED** ("'W-2' failed with the defect reinstated. The guard is real."), restored, matches HEAD, W-2 green
again. Loop 2: INERT.
Limit (inference, not a defect): W-2 is a source-text assertion, so a reformat of that line (line break inside
the call) would also fail it -- a false red, never a false green.
