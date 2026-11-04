<!--
WHAT:          independent verification (round 1) of the SERVER/RULES half of the JOB-category change
               (claims 1-10 from the implementer), against docs/qc-evidence/AC-job-category.md.
WHY:           Tier 1 change (keyword gate decides scheduling windows and QC violations); needs a cold
               adversarial read that shares no context with the implementer.
SUPERSEDES:    nothing
SUPERSEDED-BY: nothing -- current
EVIDENCE:      branch claude/jolly-archimedes-is9jyz @ 52c759f, diff 3995235..52c759f, commands quoted inline.
-->

# VERIFY job-category server, round 1

Scope: `supabase src/config src/lib src/utils src/integrations scripts .github`. Screens and Huddle out of scope.
Verified at: 52c759f (detached, in an isolated worktree). Verdicts appended as reached.

## Claim 9 -- `npm test` 490/490 green: CONFIRMED (test count); mutations: see the mutation section

`npm test` run by the verifier in this worktree at 52c759f, node v22.22.0:
```
# tests 490
# suites 67
# pass 490
# fail 0
```
Discovery includes the three new files (`categories.test.ts`, `category-guide.test.ts`, `keyword-rules.test.ts`);
the spelling-table suite reports `1..37` subtests passing.

## Claim 1 -- one category list; exact name maps to itself first: CONFIRMED (with two defects)

Observed (probe `node --experimental-strip-types probe.ts` importing `_shared/categories.ts` directly):
`JOB->JOB`, `job->JOB`, `PROF-EDUCATION->PROF_EDUCATION`, `prof_education ->PROF_EDUCATION`, `PERSONAL ->PERSONAL`,
`job hunt->CAREER`, `job-search->CAREER`. Exact match runs at `categories.ts:88-89` before any synonym rule.
Voice `RealtimeVoiceAssistant.normalizeCategory` now delegates to the shared function (diff read).

Defects found while trying to break it:
- **D-1 (minor, AC N-8 / G-8):** `normalizeCategory('networking')` -> `JOB` (substring `work`, `categories.ts:103`).
  AC section 3b N-8 says "never JOB by substring alone". `workout -> JOB` likewise. N-8 is not in `categories.test.ts`.
- **D-2 (minor, AC-E1):** `supabase/functions/notification-scheduler/index.ts:28` still declares a hand-written
  `category: 'LIFE' | 'CAREER' | 'VENTURES' | 'EDUCATION'` (no JOB, does not import the shared list). Type only.
- Pre-existing, not introduced: `permit`, `commitment`, `submit` -> EDUCATION (the old `mit` substring rule kept).

## Claim 2 -- one gate, called by scheduler and QC with the task's category; extractSchedulingContext untouched: REFUTED (QC parity on weekends)

What holds (CONFIRMED parts):
- `_shared/keyword-rules.ts` `matchKeywordRule` implements 2-C rules 1-4 (read in full). Ungated when
  `category` is `undefined`/`null` (`:43`). Lane compare is trimmed/upper-cased via `toCategoryKey`.
- Scheduler: `nightly-schedule-builder/index.ts:223` delegates; `:1218` passes `task.category`.
- QC: `src/utils/dailyReviewPipeline.ts:514-517` calls it with `category: task.category`.
- `git diff --stat 3995235..HEAD -- src/services/schedulingService.ts` is empty: extractSchedulingContext unchanged.
  Its `suggestedStatus` (now `'JOB'` for 13 default keywords) only reaches `taskScheduling.ts:141` through
  `asWorkflowStatus(...)`, so a `JOB` lane cannot become a `task_status` value there.
- `grep -rn "mapping\[0\]\|contextRules.keywords" src supabase/functions`: the only remaining keyword loops are
  `schedulingService.ts:395` (claimed, deliberate), `category-guide.ts:26` (reads only `flexible` rows for name
  hints) and the Settings screen. No other ungated window consumer where the category is known.
- Extra spellings through the matcher (verifier probe, not in the test file): lane `" job "`, `Job`, `job_`,
  `prof education`, `PROF-EDUCATION` all gate; lanes `BACKLOG`, `TODO`, `""`, `flexible` stay ungated;
  task category `job` / `" Job "` gate correctly; `null`/`undefined` ungated. All as the rule says.

**D-3 (REFUTES "QC flags the same keyword as the scheduler, including on a weekend").** The two callers pass
DIFFERENT active-window sets on a weekend:
- Scheduler `getActiveWindows` (`nightly-schedule-builder/index.ts:134-154`): "WEEKEND ENFORCEMENT: On Saturday
  (6) and Sunday (0), ONLY the 'weekends' window is returned".
- QC's new `activeWindowNamesOn` (`dailyReviewPipeline.ts:705-716`): every non-flexible window whose `days`
  includes the weekday. No weekend enforcement. (The same file already does `isWeekend ? ['weekends'] : [...]` at :255.)
- Owner's LIVE `timeWindows` (read-only SELECT, 2026-11-04): `evening.days = [0..6]`. So on a Saturday QC sees
  `[evening, weekends]`, the scheduler sees `[weekends]`.
- Verifier probe through the real matcher with the live keyword fixture (post-relabel lanes):
  ```
  Family dinner LIFE        scheduler= none   qc(evening+weekends)= dinner->evening
  Study for MIT exam PROF_EDUCATION scheduler= none   qc= study->evening
  Relax LIFE                scheduler= none   qc= relax->evening
  Weekend hobby LIFE        scheduler= hobby->weekends   qc= hobby->weekends
  ```
  A Saturday "Family dinner" placed at 18:00 in the weekends window: the scheduler applied no keyword; QC
  buckets 18:00 as `after_work`, matches `dinner->evening`, and raises a violation. Different keyword, false warning.
- There is NO test of QC at all: `grep -rln "QC_VIOLATIONS\|buildDailyReviewReasoning\|activeWindowNamesOn"`
  finds only `dailyReviewPipeline.ts`, `DailyReviewModal.tsx` and a comment in `keyword-rules.ts`. The AC
  section 3 "QC parity rows" test (both callers over the spelling table) was not written.

Minor: task category `""` (empty string) is treated as a known category and gates out every category-lane
keyword (probe: `"" -> none`), where the old code applied them. Only reachable if a row has an empty category.

## Claim 3 -- resolveConfig fills missing categories; JOB=business_hours, CAREER=after_work+weekends; smart-calendar-scheduler and timeWindows.ts know JOB: CONFIRMED (one nit)

- `scheduling-defaults.ts:211-214` now `{ ...DEFAULT_CATEGORY_MAPPINGS, ...saved }`. Tests J1-J3 in
  `scheduling-windows.test.ts` pass inside the 490 (J1: owner-shaped saved map without JOB -> `getPreferredWindows('JOB')`
  = `['business_hours']` on a weekday). The live owner map has exactly 6 saved rows, no JOB (SELECT above), so
  the merge adds only JOB for him.
- Defaults: server `JOB ['business_hours'] BACKLOG 120`, `CAREER ['after_work','weekends']`; client
  `schedulingRules.ts` identical values (diff read). `call-context-builder.ts:27` derives from the server defaults,
  so classify-task-topic / execute-tool / send-chat-message window affinity know JOB.
- `smart-calendar-scheduler`: JOB added to its DEFAULT_CONFIG and to the per-key rebuild at `:325`.
- `src/lib/timeWindows.ts`: `JOB: ['business_hours']`, `CAREER: ['after_work','evening','weekends']`.
- Nit: smart-calendar-scheduler's own CAREER default is a single string `'after_work'` (that file's format), so
  weekends are not in its CAREER default; and `timeWindows.ts` CAREER adds `evening`. Neither contradicts the claim.
- `batch-calendar-scheduler` had the only `=== DEFAULT_CATEGORY_MAPPINGS` identity check; it was updated (diff read).

## Claim 4 -- 13 work keywords default to JOB; interview CAREER; none removed: CONFIRMED

Extracted the `contextRules.keywords` block from `schedulingRules.ts` at 3995235 and at HEAD (script
`kwcount.sh` in the verifier scratchpad): `old count: 50  new count: 50  new JOB: 13`, `keys removed: (none)`.
Changed rows are exactly budget, call, contract, email, follow_up, invoice, meeting, message, office, reply,
respond, review, work (all `business_hours`, lane CAREER -> JOB; windows unchanged). `interview: ['business_hours', 'CAREER']`.

## Claim 5 -- parser prompt: category guide, employer from profiles.company, name hints, one read each, output normalised: CONFIRMED (two notes)

- `ai-task-parser/index.ts:103-117`: ONE `Promise.all` of `profiles.select('company').eq('user_id', userId)` and
  `user_scheduling_prefs.select('config').eq('user_id', userId)`, before the per-task loop, inside try/catch.
  The only other config read in the file (`:410`, bulk mode) is a pre-existing read of `user_scheduling_config`.
- Column check (read-only SELECT): `profiles where id=<owner>` = 0 rows, `profiles where user_id=<owner>` = 1 row,
  company NULL. So `.eq('user_id', ...)` is the RIGHT key (the AC's Q-3 query used `id`, which matches nothing).
- Template literal validity: copied the file to `.mts` and ran `node --experimental-strip-types --check` -> no
  SyntaxError. Interpolations used: `${CATEGORY_KEYS.join(', ')}`, `${categoryGuide}`, `${CATEGORY_KEYS.join('|')}`,
  all in scope (imports at `:4-5`, `categoryGuide` defined at `:117` before `systemPrompt` at `:157`).
- Output normalised at `:380-385` with a log line when the raw value differs.
- `buildCategoryGuide` probe: employer `null`, `""`, `"  "`, `undefined`, `5` -> no `undefined`/`null` text,
  "The owner's employer is not named. Work for an employer is still JOB."; `"Trinnex"` -> named line.
  `grep -rln Trinnex supabase/functions src` (excluding tests) -> no hits (AC-D1 holds).
- Note N-1: supabase-js returns `{ error }` rather than throwing, so a failed profiles/prefs SELECT is silently
  treated as "no employer" with no log line (AC-G3 asks for a log). The parse still proceeds.
- Note N-2: the owner's LIVE map has one existing row that already fits the name-hint shape:
  `appointment = ["flexible","LIFE"]`. Probe: `categoryHintsFromKeywords(live) = [{"name":"appointment","category":"LIFE"}]`,
  so from deploy the prompt tells the model "a task naming appointment usually belongs to LIFE" (e.g. "Book
  appointment with my manager"). Not a new row; an existing row's meaning changed. Venture names (Huddle, Nexus, ...)
  reach the prompt only once rows are added (see claim 10).

## Claim 6 -- execute-tool create/update/batch/parse normalise; quick_create_task left as is: CONFIRMED (one defect)

Diff read: `:912` create, `:990` update, `:1056` batch, `:1854` parse_and_create insert all use `normalizeCategory`.
`quickCreateTask` (`:3260-3270`) still forwards only title/date/auto_schedule, so its `category` argument
(whose enum now advertises JOB) is still dropped -- AC-D6 stays unmet, as disclosed.

**D-4 (silent re-categorisation on UPDATE).** Before, an unknown category on `update_task` / `batch_update_tasks`
reached the UPDATE and failed on the enum, leaving the row as it was. Now `normalizeCategory` turns any
unrecognised string into `LIFE`, and no log line names the raw value (AC-D5 requires one). Probe values:
`Employment -> LIFE`, `Office -> LIFE`, `FAMILY -> LIFE` (Huddle has a FAMILY bucket), `Professional work -> EDUCATION`,
`networking -> JOB`. A JOB task updated by an agent with `category:"Employment"` is silently re-filed to LIFE and
the response reports success. Create is lower risk (a default is needed there); UPDATE should keep the old value
(or refuse) when the input does not map, rather than writing LIFE.

## Claim 7 -- tool-definitions enums from CATEGORY_KEYS: CONFIRMED

Diff read: get_tasks filter (`:50`), update_task (`:90`), caveat `categories` prose (`:155`), quick_create_task
(`:372`) all use `[...CATEGORY_KEYS]` / `CATEGORY_KEYS.join`. update_task gains PROF_EDUCATION, PERSONAL, JOB.

## Claim 8 -- migration adds JOB; types.ts lists JOB: CONFIRMED (code); NOT APPLIED live

- `supabase/migrations/20261104120000_task_category_job.sql` is one statement:
  `ALTER TYPE public.task_category ADD VALUE IF NOT EXISTS 'JOB';` Nothing else uses the value (AC-A2).
- `types.ts`: JOB added to the union (`:4448`) and the `Constants` array (`:4617`); `categories.test.ts` C-2
  asserts the union equals CATEGORY_KEYS.
- LIVE (read-only): `enum_range(null::task_category)` = `{LIFE,CAREER,VENTURES,EDUCATION,PROF_EDUCATION,PERSONAL}`;
  `schema_migrations` has no `20261104120000`. Expected (not yet run), but see D-5.

**D-5 (rollout order, AC-G1 not implemented).** Edge functions auto-deploy on push to `main`
(`deploy-supabase-functions.yml`, `paths: supabase/functions/**`). If the branch merges before the migration is
applied, the parser prompt now OFFERS JOB and `normalizeCategory('JOB')` keeps it, so every work-task insert fails
with `invalid input value for enum task_category` until the migration runs. No fallback exists in code. The
migration must be applied (MCP `apply_migration`) BEFORE the merge to main.

## Claim 10 -- ROLLOUT-job-category.sql scoped to the owner, idempotent, never overwrites existing keyword rows: CONFIRMED with one caveat (D-6)

Read in full (not run; no writes made by the verifier).
- Every one of the 5 steps has `WHERE user_id = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1'`. Step 1 is by id (5 ids,
  matching AC-A4), changes only `category`.
- Idempotent on a re-run with no intervening edits: steps 1-4 write constant values; step 5 is guarded by
  `AND NOT (config->'contextRules'->'keywords' ? r.k)`.
- Keyword rows: step 4 changes ONLY element `'1'` (the lane) of the 13 ruled keys and only where the key exists
  (`? k`), so a deleted key is not re-created and no window changes; step 5 adds 13 name-hint rows only where
  absent. The live map has none of those 13 hint keys today (SELECT above). Never writes the code defaults.
- **D-6 (category rows, not keyword rows):** step 3 `jsonb_set(config, '{categoryMappings,JOB}', <fixed row>, true)`
  and `'{categoryMappings,CAREER,defaultTimeWindow}'` overwrite UNCONDITIONALLY. Once the code is live, Settings
  shows a JOB row (client merge), so if the owner saves a JOB choice before this runs -- or the script is re-run
  later -- his JOB row and CAREER windows are reset. Guard step 3's JOB write with
  `AND NOT (config->'categoryMappings' ? 'JOB')` if that matters.
- Side note on step 5: the 13 `flexible` rows are skipped by the shared matcher (window `flexible`), but
  `schedulingService.extractSchedulingContext` (unchanged, ungated, no flexible skip, `break` on first hit) will
  match them for uncategorised tasks: e.g. "esri"/"sdlc" (4 chars) sort before most keywords, so an uncategorised
  "Esri meeting" gets `timeWindow: 'flexible'` from `esri` instead of `meeting -> business_hours`. Small, but a
  behaviour change on the path the owner said stays as today.

## Mutations re-run by the verifier (mutate.sh, /usr/local/bin)

| # | File | Mutation | Test cmd / pattern | Outcome |
|---|---|---|---|---|
| M-1 | `_shared/keyword-rules.ts` | delete the gate line `if (gated && lane && !laneCoversCategory(...)) continue;` | keyword-rules.test.ts / `S-2 keyword pick` | **FIRED**, restored, tree clean |
| M-2 | `_shared/keyword-rules.ts` | gate `continue` -> `return null` (stop instead of keep scanning) | keyword-rules.test.ts / `S-25 keyword pick` | **FIRED**, restored, tree clean |
| M-3 | `nightly-schedule-builder/index.ts` | drop `task.category` from the `getKeywordWindowOverride(...)` call (scheduler becomes ungated) | `npm test` / `keyword pick` | **INERT** -- full suite green |
| M-4 | `src/utils/dailyReviewPipeline.ts` | drop `category: task.category,` from the QC call (QC becomes ungated) | `npm test` / `keyword pick` | **INERT** -- full suite green |

(A first M-3 run with pattern `index.ts wiring` matched an UNRELATED notification-scheduler test of the same
name; discarded and re-run.) M-3/M-4 are not equivalent mutations: they turn the gate off in production.
**D-7: the two production call sites of the gate have no test.** The matcher is proven; whether the scheduler
and QC actually pass the category is not. So claim 9's "9 mutations FIRED" can be true of the matcher while
the wiring that makes the gate matter is unguarded.

## Verdict summary

| Claim | Verdict |
|---|---|
| 1 shared list, exact-first normalise | CONFIRMED (D-1 networking->JOB, D-2 one leftover union) |
| 2 one gate in scheduler + QC; extractSchedulingContext unchanged | **REFUTED** -- QC uses a different active-window set on weekends (D-3); no QC test |
| 3 resolveConfig fill; JOB/CAREER defaults; smart-calendar + timeWindows know JOB | CONFIRMED |
| 4 13 keywords -> JOB, interview CAREER, none removed | CONFIRMED (50 -> 50, 13 changed) |
| 5 parser category guide, one read each, output normalised | CONFIRMED (N-1 silent read error, N-2 appointment hint) |
| 6 execute-tool normalises; quick_create left | CONFIRMED, with D-4 (unknown -> LIFE on UPDATE, silently) |
| 7 tool enums from CATEGORY_KEYS | CONFIRMED |
| 8 migration + types.ts | CONFIRMED in code; not applied live; D-5 rollout order |
| 9 490/490; mutations FIRED | 490/490 CONFIRMED; matcher mutations FIRED; wiring mutations INERT (D-7) |
| 10 rollout SQL scoped, idempotent, no keyword-row overwrite | CONFIRMED with caveat D-6 |

## Defects (ordered by impact)

- **D-3** QC vs scheduler weekend window sets differ (`dailyReviewPipeline.ts:705-716` vs
  `nightly-schedule-builder/index.ts:134-154`). Live config makes it real (`evening.days` includes 0 and 6).
  Fix shape: QC should use the scheduler's weekend enforcement (only `weekends` on Sat/Sun, never on weekdays).
- **D-5** Merge-before-migration breaks every JOB insert (edge fns auto-deploy on push to main).
- **D-4** UPDATE/batch paths silently re-file an unmappable category to LIFE, no log line (AC-D5).
- **D-7** No test covers the scheduler's or QC's call into the gate (M-3, M-4 INERT).
- **D-6** Rollout step 3 overwrites a saved JOB row / CAREER windows unconditionally.
- **D-1** `normalizeCategory('networking')` = JOB (AC N-8).
- **D-2** `notification-scheduler/index.ts:28` hand-written category union without JOB.
- Minor: task category `""` gates out every category-lane keyword; name-hint `appointment` row; flexible hint rows
  are matched by the ungated `extractSchedulingContext`.
