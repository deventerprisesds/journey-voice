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

### D-7 -- W-1/W-2 guard the category wiring in both callers -- **CONFIRMED** (plus one unguarded line, G-1)

`scripts/mutate.sh`, test cmd `npm test`, each restored and asserted against HEAD:

| # | file | mutation | must-fail | result |
|---|---|---|---|---|
| M-3 | nightly-schedule-builder/index.ts | drop `task.category` from `getKeywordWindowOverride(...)` call | W-1 | **FIRED** (loop 1: INERT) |
| M-4 | src/utils/dailyReviewPipeline.ts | delete `category: task.category,` from the QC call | W-2 | **FIRED** (loop 1: INERT) |
| M-5 | src/utils/dailyReviewPipeline.ts | `activeWindowNamesOn` returns `undefined` instead of `activeWindowNamesForDay(...)` | W-2 | **FIRED** |
| M-6 | nightly-schedule-builder/index.ts | `matchKeywordRule(title, contextKeywords, { activeWindowNames })` (category dropped inside the wrapper) | W-1 | **FIRED** |
| M-7 | src/utils/dailyReviewPipeline.ts | `activeWindowNames: activeWindowNamesOn(...)` -> `activeWindowNames: undefined` at the QC call | W-2 | **INERT** -- full suite green |

**G-1 (new, medium -- guard gap, not a product defect today):** M-7 reinstates exactly the loop-1 D-3 defect
(QC stops asking about the day's open windows) and nothing fails. It is not equivalent: with no open-window
list, Saturday 15:00 `Family dinner` matches `dinner`->evening (jsonb order: `dinner` < `family`, both length 6)
against scheduled business_hours and is flagged -- the false warning D-3 fixed. W-2 asserts the helper's body
and the `category:` line, but not that the helper is the value passed at the call site.

### D-4 -- update_task / batch_update_tasks keep the current category on an unrecognised value -- **REFUTED (narrow, low)**

Observation (code, execute-tool/index.ts):
- update path (`updateTask`, ~987-996): `recognizeCategory(args.category)`; null -> no `updateData.category`,
  `console.warn('[UPDATE_TASK] category ... kept the current one')`, `categoryKept` set; on success the result
  carries `category_not_changed` and the message `(category "X" is not a category, so it stays <current>)`. Data
  safety and logging: as claimed.
- batch path (~1064-1068): `recognizeCategory(u.category)`; null -> field omitted + `console.warn('[BATCH_UPDATE] ...')`;
  an entry whose only field was that category returns `no fields to update` in `failed`. As claimed (the claim
  does not promise a batch message).
- **Gap:** an `update_task` call whose ONLY field is an unrecognised category (the most likely shape: "file it under
  side hustle") leaves `updateData` empty and returns at the pre-existing guard
  `if (!Object.keys(updateData).length) return { success: false, error: "No updatable fields provided" }`
  (line 1016) BEFORE the `categoryKept` message (lines 1038-1040) is built. So the response does NOT say the category was unrecognised;
  the caller sees a generic failure. The task is untouched (safe), the warn is logged. Fix belongs at that guard.
  Not runtime-probed: execute-tool imports Deno URL modules and `updateTask` is not exported; verdict is from
  the code path above.

### N-1 -- parser logs the supabase `{error}` -- **CONFIRMED**

`ai-task-parser/index.ts`: both reads destructure `error` (`profileErr`, `prefsErr`) and
`console.warn('⚠️ Category context read failed; parsing without it:', profileErr?.message, prefsErr?.message)`;
a thrown error is caught and warned; the parse continues with `employer=null`, `hints=[]`.

### Q-4 -- empty-string category is ungated -- **CONFIRMED**

`matchKeywordRule` gates on `toCategoryKey(opts.category) !== null`, and `toCategoryKey('')` returns null
(`raw.trim() === ''`). Probe 2 above: `Email the team` with category `''` is flagged against `email`'s
business_hours window exactly as an uncategorised task; test `Q-4` passes in the 501.

### Reduced-depth re-checks (diff hunk re-read + suite + one probe each)

| claim | probe | verdict |
|---|---|---|
| C1 shared list; exact name maps to itself first | `CATEGORY_KEYS` = LIFE,JOB,CAREER,VENTURES,EDUCATION,PROF_EDUCATION,PERSONAL; every key: `normalizeCategory(k)===k` and `toCategoryKey(k.toLowerCase())===k` -> true; `recognizeCategory` returns `toCategoryKey` before any synonym rule | **CONFIRMED** |
| C3 resolveConfig fills missing categories | owner's live saved `categoryMappings` (no JOB row) -> `JOB` = `{business_hours, 120, BACKLOG}`, saved `CAREER` kept `["business_hours","weekends"]`; `resolveConfig(null)` CAREER = `["after_work","weekends"]` | **CONFIRMED** |
| C4 13 keywords to JOB, interview stays CAREER, none removed | live SELECT: all 13 listed keys hold lane CAREER now (13/13 predicate hits), `interview` not in the list; step 4 is `jsonb_set` on element `1` only, gated on `->>1='CAREER'` (no key created or deleted) | **CONFIRMED** (not applied live -- rollout pending) |
| C5 parser guide | `ai-task-parser`: one `profiles` read + one `user_scheduling_prefs` read in one `Promise.all`; output `normalizeCategory(rawTask.category)` with a log on change; `categoryHintsFromKeywords` on a live-shaped map keeps only flexible rows with a category lane (`appointment`->LIFE, `trinnex`->JOB, `huddle`->VENTURES; `work` and `morning` excluded); guide renders with and without employer; esbuild parses the file (template literal valid) | **CONFIRMED** |
| C6 write paths normalise | execute-tool `createTask` and `parseAndCreateTasks` use `normalizeCategory`; RealtimeVoiceAssistant imports the shared `normalizeCategory` (line 7) for create (1628) and update (1737) | **CONFIRMED** |
| C7 tool enums from CATEGORY_KEYS | runtime `getToolDefinitions()`: 3 category `enum`s, all `LIFE,JOB,CAREER,VENTURES,EDUCATION,PROF_EDUCATION,PERSONAL`; the `categories` array description is built from `CATEGORY_KEYS.join` | **CONFIRMED** |
| C8 migration + types.ts | migration is only `ALTER TYPE public.task_category ADD VALUE IF NOT EXISTS 'JOB'`; `types.ts` adds `"JOB"` to the union and the Constants array; live enum still lacks JOB (expected until rollout); `tsc -p tsconfig.app.json`: 27 errors, none about category/JOB (status-union `IN_REVIEW` errors and unrelated files) -- `src/types/task.ts` accepts JOB via the shared `TaskCategory` | **CONFIRMED** |
| C9 suite and mutations | 501/0; M-3..M-6 FIRED this loop; M-7 INERT -> G-1 | **CONFIRMED** (with G-1) |

### Radius challenge

- Inside the radius and checked: `getActiveWindows` (21/21 identical on live configs), both callers of
  `matchKeywordRule`, both execute-tool category paths, the parser, notification-scheduler.
- Outside the stated radius, checked because they import the shared module: smart-calendar-scheduler (JOB row in
  its rebuilt mapping at line 325; file parses) and RealtimeVoiceAssistant (shared normaliser).
- Not reached: smart-calendar-scheduler runtime behaviour with a JOB task (nothing here can run it).

### Regressions (golden path)

**NOT REACHED**, outside this scope: this is server/rules code in journey-voice that is not deployed (rollout
pending), so there is no deployed build of cf9f680 to drive. The executive-engine SWA URL in the verifier
playbook is a different app. Regression coverage this loop is the full 501-test suite plus the symbols guard.

## Findings this loop

| id | severity | finding |
|---|---|---|
| G-1 | medium (guard gap) | The QC call site's `activeWindowNames` wiring is unguarded: M-7 (`activeWindowNames: undefined`) brings back D-3 and the full suite stays green |
| L2-1 | low | `update_task` with ONLY an unrecognised category returns `No updatable fields provided` (line 1016) and never the "is not a category, stays X" message, so D-4's "response says so" fails on that path |
| L2-2 | low, unreachable today | `activeWindowNamesForDay` reads a missing `start` as 0, so a `{end, days}` window with no start now opens with `totalMinutes: NaN`; the old builder dropped it |
| L2-3 | low | rollout steps 1-2 are not gated on pre-rollout values; a re-run after the owner re-files one of the five tasks would move it back to JOB |

## Verdict

CONFIRMED: C1, C2/D-3, C3, C4, C5, C6, C7, C8, C9, D-1, D-2, D-6, D-7, N-1, Q-4 (15)
REFUTED: D-4 (narrow: the response message on the category-only update path) (1)
NOT REACHED: golden-path UI regression (not deployed; out of scope)

Required before done:
- L2-1: build the categoryKept message before the empty-updateData guard (or return it from that guard).
- G-1: assert the QC call passes `activeWindowNamesOn(...)`, or add a behavioural Saturday test of the QC step.
