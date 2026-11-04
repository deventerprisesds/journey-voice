<!--
WHAT:          independent verification (round 2) of the SERVER/RULES half of the JOB-category change,
               re-deriving the loop-1 refutations (C2/D-3, D-1, D-2, D-4, D-6, D-7, N-1, Q-4) and re-checking C1, C3-C8.
WHY:           Tier 1 change (the keyword gate decides scheduling windows and QC violations). Loop 1 REFUTED C2
               (QC and scheduler used different weekend window sets) and found D-1..D-7; this round checks the fixes.
SUPERSEDES:    docs/qc-evidence/VERIFY-job-category-server-1.md (its REFUTED verdicts are re-derived here).
SUPERSEDED-BY: nothing -- current
EVIDENCE:      branch claude/jolly-archimedes-is9jyz @ cf9f680, diff 3995235..cf9f680, commands quoted inline.
-->

# VERIFY job-category server, round 2

Verifier started 2026-11-04 03:08 UTC. Code under test: `origin/claude/jolly-archimedes-is9jyz` @ `cf9f680` (detached).
Live DB: read-only SELECTs only on `wwxgajrtmslzklnyplah`. No writes, no deployed-function calls.


## Suite re-run (covers everything)

| command | result |
|---|---|
| `npm test` | **501 tests, 70 suites, 501 pass, 0 fail**, exit 0 |
| `npm run check:symbols` | 108 files, **0 NEW** undefined symbols, 1 known (baselined `send-chat-message:buildCallContext`), exit 0 |
| esbuild syntax pass over notification-scheduler, execute-tool, ai-task-parser, nightly-schedule-builder, smart-calendar-scheduler, classify-task-topic, batch-calendar-scheduler | all parse (ALL-SYNTAX-OK) |

## Claims

### C2 / D-3 -- QC and scheduler share activeWindowNamesForDay -- **CONFIRMED**

Observation (code): `nightly-schedule-builder/index.ts:141` `getActiveWindows` now iterates
`activeWindowNamesForDay(timeWindows, targetDayOfWeek)`; `dailyReviewPipeline.ts` `activeWindowNamesOn` returns
`activeWindowNamesForDay(timeWindows, day)` and passes it plus `task.category` into `matchKeywordRule`.

Probe 1 -- builder windows unchanged for every day: the pre-change `getActiveWindows` body (copied from 3995235)
vs the new one, on every live `timeWindows` shape (dev@ `a3378f93` = the owner's scheduling row, the `0000..01`
template row, and DEFAULT_TIME_WINDOWS which `von.ellis@` and `madisonbmellis@` resolve to because their
`timeWindows` is null), days 0-6: **21/21 SAME, TOTAL DIFFS 0** (Sat/Sun = `weekends`; Mon-Fri = morning,
business_hours, after_work, evening).

Edge drift found (not reachable with live data): a window with `end` but no `start` was dropped by the old code
(`NaN > 0` false) and is now kept with `totalMinutes: null` (`(win.end ?? 0) - (win.start ?? 0) > 0`, then
`(win.end - win.start)*60` = NaN). No live row has that shape (all six windows carry start/end in every row).
Severity: low; recorded as L2-2.

Probe 2 -- the real `buildDailyReviewReasoning` (esbuild bundle of src/utils/dailyReviewPipeline.ts, `@`→src),
owner's live timeWindows + 46 live keywords, America/New_York:
- Saturday 2026-11-07: `Family dinner` LIFE at 15:00 -> **no violation**; same task with no category -> **no
  violation**; `Family dinner` 19:30 -> no violation. `Weekend hobby` 19:30 -> flagged evening vs weekends
  (pre-existing: QC's hour buckets have no `weekends` bucket, so any weekends-keyword task always flags; same as
  before this change).
- Tuesday 2026-11-10 20:00: `Work on Nexus application` VENTURES -> **not flagged** (lane CAREER gate);
  `Work on the report` CAREER -> flagged business_hours/work; `Email the team` category '' -> flagged (ungated, Q-4).
Output: `SAT QCRESULT [["Weekend hobby","evening","weekends","hobby"]]`,
`TUE QCRESULT [["Work on the report","evening","business_hours","work"],["Email the team","evening","business_hours","email"]]`.

### D-1 -- whole-word work/job/employment in normalizeCategory -- **CONFIRMED**

Probe (real `categories.ts`): `networking`->CAREER, `workout`->LIFE (recognize=null), `work`/`Work stuff`/`job`/
`JOB`/`employment`/`employer`->JOB, `job search`->CAREER, `homework`->EDUCATION, `PROF_EDUCATION` and
`prof-education`->PROF_EDUCATION, `gibberish` and `''`->LIFE (recognize=null).

### D-2 -- notification-scheduler type import -- **CONFIRMED**

`import type { TaskCategory } from '../_shared/categories.ts';` now sits at module scope at line 9, between the
closed `digest-content.ts` import and the next `import {`; `category: TaskCategory`. esbuild parses the file;
`npm run check:symbols` exit 0, 0 new.

### D-6 -- rollout SQL steps 3-4 fire only on pre-rollout values -- **CONFIRMED** (SQL not run)

Read-only SELECT evaluating each WHERE predicate on the live row and on the row as step 3 would leave it:
`s3a_fires_now=true, s3b_fires_now=true, s3a_fires_rerun=false, s3b_fires_rerun=false, s4_fires_now=13,
s4_fires_rerun_if_job=0`; `interview` = `["business_hours","CAREER"]` (not in the 13, stays CAREER).
Observation outside the claim: steps 1 (five tasks -> JOB) and 2 (company = Trinnex) are NOT gated, so a re-run
would overwrite an owner re-categorisation of one of those five tasks; the header line "Every write ... is
idempotent" is true only in the narrow sense. Low; L2-3.
Live state: enum still `{LIFE,CAREER,VENTURES,EDUCATION,PROF_EDUCATION,PERSONAL}`; the five ids exist (2 CAREER,
3 VENTURES); `profiles.company` null -- all pre-rollout, as expected.

