<!--
WHAT:          acceptance criteria (Given/When/Then, numbered, binary) for adding the JOB task category,
               the category-gated keyword rule, the shared category list, and the JOB classifier ruling.
WHY:           employer (Trinnex) work is filed as CAREER today and scheduled by CAREER's after-work
               windows; keyword windows apply regardless of category ('work' matches 'workout'/'homework');
               the category list is hand-copied across ~43 files. Owner decisions 1-5 in the AC brief.
SUPERSEDES:    nothing
SUPERSEDED-BY: nothing -- current
EVIDENCE:      written cold by an independent AC-writing subagent against origin/main 0796822
               (branch claude/jolly-archimedes-is9jyz). Every "current behaviour" claim cites file:line.
-->

# Acceptance Criteria — JOB task category, category-gated keywords, shared category list

Status: COMPLETE -- see section 6 for open rulings

## 0. Current behaviour, observed in code (origin/main 0796822)

Every AC below is written against these facts. Each was read this session; line numbers are from 0796822.

| # | Fact | Source |
|---|---|---|
| F-1 | Client default `CAREER.defaultTimeWindow` is `['business_hours']` (not after_work+weekends). | `src/config/schedulingRules.ts:156-160` |
| F-2 | Server default `CAREER` is `['business_hours']`; there are TWO default-mapping copies (client + server). | `supabase/functions/_shared/scheduling-defaults.ts:100-108` |
| F-3 | Client merge spreads defaults UNDER stored mappings -> a new default category (JOB) appears in Settings even for a user with saved mappings. | `src/config/schedulingRules.ts:327-330` |
| F-4 | Server `resolveConfig` uses stored `categoryMappings` WHOLESALE when non-empty -> a JOB default added to code does NOT reach the nightly builder for a user with saved mappings; `getPreferredWindows` then returns every active window for JOB ("unknown/unmapped category keeps anywhere today"). | `scheduling-defaults.ts:196-209`, `:282-296` |
| F-5 | `resolveCategoryDailyCap` falls back per-category to DEFAULT mappings (a third merge rule). | `scheduling-defaults.ts:59-82` |
| F-6 | Keyword map shape `{ keyword: [timeWindow, status] }`; stored non-empty keyword map replaces defaults wholesale on BOTH client and server. | `schedulingRules.ts:64-67`, `src/utils/resolveKeywords.ts:18-23`, `nightly-schedule-builder/index.ts:302-303` |
| F-7 | Scheduler matcher: iterates keywords in object order; skips entries whose window is falsy or `'flexible'`; skips keywords < 3 chars; replaces `_` with space; matches by **plain substring** `lower.includes(kw)` (the comment says "word boundary" — the code does not do that); returns the FIRST match whose window is active today, else keeps scanning. The second field (`mapping[1]`) is **never read**. | `nightly-schedule-builder/index.ts:214-238` |
| F-8 | A keyword match PREPENDS its window to the category windows (`withKeywordWindow`); it does not confine. A keyword-matched task is excluded from aggregate-capacity fallback. | `scheduling-defaults.ts:302-304`, `nightly-schedule-builder/index.ts:1230-1247`, `:1273` |
| F-9 | Daily QC matcher: same skip rules as F-7, but (a) does NOT check the keyword window is active today, (b) does not stop at the first matching keyword — it `break`s only on a VIOLATION, so a later matching keyword can flag a task whose first match agreed, (c) uses HARDCODED hour buckets (after_work 17-19, evening 19-23) instead of config `timeWindows` (after_work 17-22), (d) never reads `mapping[1]`. | `src/utils/dailyReviewPipeline.ts:491-535` |
| F-10 | Third keyword consumer: `extractSchedulingContext` — reached only when the task's category has NO mapping; raw `text.includes(keyword)` (no `_`->space, no length guard, no flexible skip); DOES read `mapping[1]` as `suggestedStatus`. Called from TaskCreationModal. | `src/services/schedulingService.ts:311-412`, `src/components/TaskCreationModal.tsx:558,759` |
| F-11 | **CORRECTED after reading the live row.** Keyword precedence in PRODUCTION is NOT the code-literal order: `config` is `jsonb`, and Postgres jsonb stores object keys sorted by key LENGTH, then bytewise. The owner's stored order (query Q-1 below) is `tax, bank, call, mall, side, text, work, class, email, ..., workout, contract, exercise, homework, ...`. So TODAY, live: "Morning workout" -> `work` -> business_hours (not `workout`->morning); "Finish homework" -> `work` -> business_hours; "Networking event" -> `work`; "Recall the order" -> `call`; "Preview the deck" -> `review`; "Go to post office" -> `office` (6 chars, before `post_office`). Unit tests that build the keyword map as a JS literal test a DIFFERENT order than production unless they sort by (length, bytes). | `schedulingRules.ts:192-260`, F-7, Q-1 |
| F-12 | Settings: Category Mappings renders one row per key of `config.categoryMappings`; Board Lane is a free-text `<Input>`; Time Window checkboxes list the six windows. Keyword rows: keyword `<Input>`, window `<Select>` (6 windows), lane free-text `<Input placeholder="Status">`; renaming a keyword deletes and re-adds it (moves it to the end in memory, but after a save the jsonb round-trip reorders by length — see F-11). "Add Keyword" seeds `['flexible','LIFE']`. | `src/components/SchedulingSettings.tsx:521-662`, `:765-866` |
| F-13 | `public.task_category` enum = LIFE, CAREER, VENTURES, EDUCATION, PROF_EDUCATION, PERSONAL. `public.task_status` enum ALSO carries category-named lanes CAREER, PROF_EDUCATION, VENTURES, LIFE (no EDUCATION, no JOB). `categoryMappings.*.defaultStatus` holds a `task_status` value. | `src/integrations/supabase/types.ts:4441-4462`, `:4609-4625` |
| F-14 | `Task.category` and `Task.status` TS unions are hand-written and omit JOB. | `src/types/task.ts:15-16` |
| F-15 | LIVE owner `categoryMappings` (Q-2) has 6 rows, NO JOB, and differs from code defaults: CAREER `[business_hours, weekends]`, VENTURES `[evening, weekends]`, LIFE/PERSONAL `[after_work, weekends]`, EDUCATION `[evening, weekends]` status `EDUCATION` (not a `task_status` value, F-13), PROF_EDUCATION `[evening, weekends]`. | Q-2 |
| F-16 | LIVE owner keyword map has 46 entries. All of the 13 work-sounding keywords the brief names are present and labelled CAREER, and so is `interview` (CAREER). `morning` has lane `flexible` (not a category). `appointment` has window `flexible` and is never applied. | Q-1 |
| F-17 | `profiles.company` is currently NULL for the owner. | Q-3 |
| F-18 | The 5 rows to recategorize all exist and all are `status = DONE`: 3x "Create a visual for my/the SDLC workflow" (VENTURES: b3816b3f..., ad95646f..., 1e356db7...), "Finalize ops deck" (CAREER, 24905bd3...), "Finalize ops process diagrams" (CAREER, 2cdabc28...). Two of the SDLC rows share an identical title. | Q-4 |

Queries run this session (read-only, journey project `wwxgajrtmslzklnyplah`, 2026-11-03):
- Q-1 `select string_agg(key||'='||value::text,' | ' order by ord) from user_scheduling_prefs, jsonb_each(config->'contextRules'->'keywords') with ordinality t(key,value,ord) where user_id='a3378f93-...'`
- Q-2 `select jsonb_object_keys(config->'categoryMappings'), ... from user_scheduling_prefs where user_id='a3378f93-...'`
- Q-3 `select company from profiles where id='a3378f93-...'`
- Q-4 `select id,title,category::text,status::text from tasks where user_id='a3378f93-...' and (title ~* 'visual for (my|the) sdlc workflow' or title ~* 'finalize ops (deck|process diagram)')`
| F-19 | `smart-calendar-scheduler` carries its own hard-coded mapping copy for only 4 categories and rebuilds the user's config from exactly those 4 keys -> any JOB row the user saves is DROPPED on this path. | `supabase/functions/smart-calendar-scheduler/index.ts:262-265`, `:323-326` |
| F-20 | `src/lib/timeWindows.ts` holds a FOURTH category->window table (CAREER business_hours, VENTURES after_work/evening/weekends, ...), used by `useChatAssistant` to suggest "what fits now". `_shared/call-context-builder.ts:27-36` derives a FIFTH (for Iris) from `DEFAULT_CATEGORY_MAPPINGS`, ignoring the user's saved rows. | as cited |
| F-21 | Same category, deliberately different styles today, e.g. VENTURES is GREEN in `KanbanBoard.tsx:75,100`, `TaskFilters.tsx:48` (status option), `GanttChart.tsx:48`, `EnhancedTaskGridView.tsx:72,79`, `TaskGridView.tsx:70`, `ColumnManager.tsx:41` (#10b981), and PURPLE in `TaskCard.tsx:77`, `TaskFilters.tsx:68` (category option, which ALSO uses purple for PROF_EDUCATION), and the CSS token `--category-ventures: 25 95% 53%` (ORANGE) in `src/index.css:72` used by `FocusView`, `WeeklyAgendaView`, `DailyScheduleView`, `TimeSlotGrid`, `Priorities`. Tailwind exposes only 4 category tokens (life/career/ventures/education). | as cited, `tailwind.config.ts:94-98` |
| F-22 | Board tabs: `TabbedKanbanBoard` tabs = time_filtered, career, prof_education (PROF_EDUCATION+EDUCATION), ventures, life; `normalizeTasks` rewrites a task whose STATUS is LIFE/CAREER/PROF_EDUCATION/VENTURES into that category + BACKLOG. | `TabbedKanbanBoard.tsx:18-32`, `:148-170` |
| F-23 | Huddle mirror `tasks.journey_tasks.category` is free `TEXT` (no CHECK) -> the sync carries any string. Huddle display: `CATEGORY_DISPLAY_MAP`/`DISPLAY_CATEGORY_ORDER`/`CATEGORY_LABELS` (unknown key passes through as its own bucket, labelled by title-casing), `CATEGORY_HUES` seeded for LIFE 250 / EDUCATION 70 / CAREER 149 / VENTURES 303, unknown keys hashed. **`hashHue("JOB")` = 189, 40 degrees from CAREER (149), under the suite's `MIN_GAP = 45`.** `ceremonies.ts` CATEGORY_OWNER has no JOB -> falls back to `iris-chase`. | huddle `lib/tasks/tasks.server.ts:37`, `widgets.server.ts:590-625`, `widget-colors.ts:33-36,77-80`, `scripts/widget-colors.test.ts:38,60`, `ceremonies.ts:21-32` |
| F-24 | `getKeywordWindowOverride` is a non-exported function inside the edge-function entrypoint, so it has no unit test today; the QC matcher is inline in `runStep`. | `nightly-schedule-builder/index.ts:214`, `dailyReviewPipeline.ts:496-532` |

## 1. Every place that ASSIGNS (or rewrites) a task category

"Assigns" = decides the value written to `tasks.category`. Consumers (display, scheduling by category) are in section 2's shared-list ACs, not here.

| ID | Site | How it decides today | JOB-relevant defect today |
|---|---|---|---|
| C-1 | `supabase/functions/ai-task-parser/index.ts:150` (field list), `:183-217` (CATEGORY INFERENCE), `:240-254`, `:269`, `:291-297` | LLM prompt; no server-side validation of the returned value; no profile read | Lists 4 categories at :150 but 5 at :269; CAREER defined as "Work tasks, job responsibilities" AND "Career advancement" (the exact split the owner is making); "Prepare slides for client meeting" -> CAREER; VENTURES includes "Networking for business opportunities"; EDUCATION says "Attending classes at MIT, EMBA" while PROF_EDUCATION also claims MIT/EMBA |
| C-2 | `supabase/functions/execute-tool/index.ts:911` (`create_task`), `:989` (`update_task`), `:1055` (batch grooming), `:1853` (`parse_and_create_tasks` insert, takes C-1's value) | Takes the tool argument, `.toUpperCase()`, default `LIFE`; no allow-list check | A misspelt/unknown category reaches the insert and fails on the enum (or, for JOB before the migration, fails) |
| C-3 | `execute-tool/index.ts:3262-3276` `quickCreateTask` | Forwards ONLY `title`/`date`/`auto_schedule` to C-1; the comment says hints are "injected by prefixing" but nothing is | The tool's explicit `category` argument is DROPPED; the parser re-infers |
| C-4 | `supabase/functions/_shared/tool-definitions.ts:48` (get_tasks filter enum), `:88` (update_task enum = LIFE/CAREER/VENTURES/EDUCATION only), `:153` (caveat categories prose), `:370` (quick_create_task enum) | JSON-schema enums the voice + chat models must obey | Three different enum sets; update_task cannot even set PROF_EDUCATION today |
| C-5 | `src/utils/RealtimeVoiceAssistant.ts:1499-1522` `normalizeCategory`, used at `:1647`, `:1756` | substring rules on the model's category string: `education|professional|mit|...` -> EDUCATION; `career|work|job` -> CAREER; `venture|startup|business` -> VENTURES; else LIFE | `"JOB"` -> CAREER (contains `job`); `"PROF_EDUCATION"` -> EDUCATION (collapses a real category) |
| C-6 | `supabase/functions/classify-task-topic/index.ts:112-116` | Does NOT assign the category; it reads it to pick a fallback topic name and window affinity (`CATEGORY_WINDOW_MAPPING`) | JOB would fall to "General Tasks" / `['flexible']`. Listed as a CONSUMER that must know JOB, not a classifier |
| C-7 | `src/components/TaskCreationModal.tsx:143,880` (default LIFE), `:930` (PROF_EDUCATION), `:1345`, `:1694` (category Select) ; `EditableTaskSuggestion.tsx:159-172`; `TaskDetailModal.tsx:508,545`; `SmartTaskInput.tsx:25` | Human picks from a hand-written list | JOB not offered |
| C-8 | `src/components/TabbedKanbanBoard.tsx:22-32` `normalizeTasks` | Rewrites category from a category-named STATUS | A `status='JOB'` row (if `task_status` ever gains JOB) would not be normalized |
| C-9 | `supabase/functions/_shared/assignment-intake.ts:236`, `_shared/work-sessions.ts:225`, `src/utils/assignmentFetching.ts:54,140,183` (PROF_EDUCATION), `src/utils/assignmentSync.ts:80,207` (EDUCATION) | Fixed literal for coursework | None for JOB; regression-guard only |
| C-10 | `supabase/functions/create-test-task/index.ts:134`, `create-quick-test-task/index.ts:115` | Fixed `LIFE` | None; regression-guard only |
| C-11 | `src/utils/ItineraryEngine.ts:410-425` | Read this session: does NOT write `category`. It emits scheduling-context tags (VENTURES or business words -> `business_hours`) | A consumer, not a classifier. Note that it sends VENTURES to business hours, the opposite of the VENTURES default; this is pre-existing and out of scope |
| C-12 | Huddle side: grooming writes `category` through journey `update_task`/batch (C-2, C-4) | via journey tools | inherits C-4's enum |

Not found: any code that reads `profiles.company` while classifying. The only server read of `company` is the profile tool at `execute-tool/index.ts:2933`. The employer name has to be added as an INPUT to C-1 (and to whichever model path C-4/C-5 feed).

## 2. Acceptance criteria

Task: add category JOB (employer work, Trinnex) beside a narrowed CAREER (next role), make every classifier file employer work as JOB, gate keyword windows by category when the keyword's lane is a category, and replace the ~43 hand-copied category lists with one shared definition without changing how existing categories look.

Sources read: listed in section 0 and section 1 (every row cites file:line), plus live rows Q-1..Q-4.

Existing systems this EXTENDS (no parallel system allowed):
- Category config = `categoryMappings` in `user_scheduling_prefs.config` (client `src/config/schedulingRules.ts`, server `_shared/scheduling-defaults.ts`). JOB is one more row there, not a new table.
- Keyword rules = `contextRules.keywords`. The gate is a rule ON the existing second field, not a new keyword store.
- Employer name = `profiles.company`. No new column.
- Huddle display = the existing `CATEGORY_DISPLAY_MAP` / `CATEGORY_HUES` / `CATEGORY_OWNER` tables. No second Huddle category system.
- The shared list must REPLACE the copies listed in F-19..F-23 and section 1, not sit beside them. **A new `categories.ts` that the old copies do not import is itself an AC failure (AC-E1).**

Shorthand: "weekday" = a Tuesday with windows morning/business_hours/after_work/evening active; "the owner" = user a3378f93-d655-4913-b2fa-ca5b1d8020f1.

### A. Database and data move

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| AC-A1 | Given the migration has run, when `select enum_range(null::public.task_category)` executes, then the result contains `JOB` and still contains LIFE, CAREER, VENTURES, EDUCATION, PROF_EDUCATION, PERSONAL in their existing order. | happy | Supabase SQL; result pasted into the verify record |
| AC-A2 | Given the migration file, when it is read, then it uses `ALTER TYPE public.task_category ADD VALUE IF NOT EXISTS 'JOB'` and nothing else in the SAME migration uses the new value (Postgres refuses to use a value added in the same transaction). | error | file read + `apply_migration` succeeds on first try |
| AC-A3 | Given JOB exists, when a task is inserted with `category='JOB'` through `execute-tool` `create_task` (C-2), then the response is success and `select category::text from tasks where id=<id>` returns `JOB`. | happy | edge-fn call + SQL (use a `Test-` title, delete after) |
| AC-A4 | Given JOB exists, when the data move runs, then exactly these 5 ids have `category='JOB'`: b3816b3f-6aff-4aff-8581-56d8c164af16, ad95646f-cc05-43a0-ae3d-ec0d5f9407c2, 1e356db7-ca26-46c1-b3b0-a7c2f8d8be38, 24905bd3-7505-4b86-a066-510ce0b4e191, 2cdabc28-b148-4044-8c00-a54faa4bb782. The move is by id, never by title pattern. | happy | `select id, category::text, status::text, updated_at from tasks where id in (...)` |
| AC-A5 | Given the data move, when the same query runs, then all 5 rows still have `status='DONE'` and an unchanged `completed_at`. The move changes the category only. | regression | same query, before/after diff |
| AC-A6 | Given the data move, when `select count(*) from tasks where user_id=<owner> and category='JOB'` runs, then it returns 5. No other row was swept up, including any other title containing "SDLC" or "ops". | edge | SQL count |
| AC-A7 | Given the 5 UPDATEs fire the `notify_huddle_task_sync` trigger, when Huddle `tasks.journey_tasks` is polled (retry up to 30s, since sync is eventually consistent), then all 5 ids show `category='JOB'`. | happy | `azure-pg-query.yml` or huddle-pg MCP: `select id, category from tasks.journey_tasks where id in (...)` |
| AC-A8 | Given the regenerated types, when `src/integrations/supabase/types.ts` is read, then `task_category` (both the union at ~:4441 and the `Constants` array at ~:4609) includes `"JOB"`. | regression | file diff + `tsc --noEmit` passes |
| AC-A9 | Given `profiles.company` is NULL today (F-17), when the owner sets it, then `select company from profiles where id=<owner>` returns `Trinnex`. This is a data step in the rollout, not a code default. | happy | SQL |

### B. Config and Settings (JOB row, CAREER narrowed)

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| AC-B1 | Given code defaults, when `DEFAULT_SCHEDULING_CONFIG.categoryMappings.JOB` (client) and `DEFAULT_CATEGORY_MAPPINGS.JOB` (server) are read, then both equal `defaultTimeWindow: ['business_hours']` with the same `defaultStatus` and `estimatedDuration`. One source must feed both (see AC-E1), so this is one value, not two copies that happen to match. | happy | unit test importing both, `deepEqual` |
| AC-B2 | Given code defaults, when `CAREER.defaultTimeWindow` is read on client and server, then both equal `['after_work','weekends']`. | happy | same unit test |
| AC-B3 | Given the owner's saved config has NO JOB row (F-15), when Settings > Scheduling opens, then a "JOB" row is visible with "Business Hours" checked and no other window checked. | happy | Playwright `/settings` scheduling tab, screenshot |
| AC-B4 | **Server parity.** Given the same saved config with no JOB row, when the nightly builder resolves windows for a JOB task, then it uses `['business_hours']`, not "every active window". Today `resolveConfig` would return the stored map without JOB, and `getPreferredWindows` would return all windows (F-4). | happy (the F-4 trap) | unit test: `resolveConfig(ownerStoredConfig)` then `getPreferredWindows('JOB', ...)` returns `['business_hours']` on a weekday |
| AC-B5 | Given the owner unchecks Business Hours and checks Morning on the JOB row and clicks Save, when the config is re-read, then `config->'categoryMappings'->'JOB'->'defaultTimeWindow'` = `["morning"]`, AND the next nightly run places JOB tasks in morning. No code change involved. | happy (user-editable) | SQL + `nightly-schedule-builder` single-day run trace `dayPlacements[].window` |
| AC-B6 | Given the owner's saved CAREER row is `[business_hours, weekends]` (F-15), when this change deploys, then that saved row is UNCHANGED unless the owner rules otherwise (Gaps G-3). The new CAREER default reaches only users with no saved CAREER row. | regression | SQL before/after on `config->'categoryMappings'->'CAREER'` |
| AC-B7 | Given `smart-calendar-scheduler` rebuilds config from 4 hard-coded keys (F-19), when it schedules a JOB task for a user with a saved JOB row, then it uses that saved JOB row. Proof: a test config with JOB=`['morning']` returns a morning slot. | happy | unit/integration test on the extracted config builder |
| AC-B8 | Given every consumer of category -> window (`src/lib/timeWindows.ts` CATEGORY_WINDOW_MAPPING, `_shared/call-context-builder.ts` CATEGORY_WINDOW_MAPPING, `classify-task-topic` window affinity, `execute-tool` `validateTaskWindow`/`limitFor`), when each is asked for JOB, then it returns business_hours-only, not `['flexible']` or "every window". | edge | one table-driven test per consumer |
| AC-B9 | Given a saved config, when the owner edits any unrelated setting (e.g. the LIFE duration) and saves, then the JOB row, the caveats, the activities and the keyword list are all byte-identical after the save. This is the `mergeSchedulingConfig` drop hazard documented at `schedulingRules.ts:340-348`. | regression | extend `src/utils/mergeStoredConfig.test.ts` |
| AC-B10 | Given `validateSchedulingConfig`, when a JOB row has zero windows, then validation returns false and Save is blocked with the existing "At least one time window" message, the same as for every other category. | error | unit test + Playwright |
| AC-B11 | Given the `customAIInstructions` default text (`schedulingRules.ts:273`) and the `smart-calendar-scheduler` prompts (`:390`, `:453`) say "CAREER during business_hours", when this ships, then they name JOB for business hours and CAREER for after_work/weekends, OR read the windows from config. No prompt may contradict the config. | regression | grep: `grep -rn "CAREER during business" src supabase` returns 0 lines |

### C. Keyword gate (scheduler + daily QC + creation-time hints)

**The rule, stated once.** All three consumers must implement it through ONE exported function. For each keyword entry `[window, lane]`, taken in the order the scheduler iterates the stored jsonb:
1. Skip it exactly as today if `window` is falsy or `'flexible'`, or if the keyword is under 3 chars (F-7).
2. NEW: if `lane` (trimmed, upper-cased) is a member of the shared category list, and `task.category` is not equal to it, **skip and keep scanning**. Do not stop.
3. Otherwise (the lane is not a category: `flexible`, `TODO`, empty, unknown) the keyword applies exactly as today.
4. The match test itself (lower-case substring on the title, `_` turned into a space) is unchanged. The owner asked to keep keywords, not to re-tokenise them.

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| AC-C1 | Given the rule above, when the code is grepped, then there is ONE matcher exported from `supabase/functions/_shared/` (e.g. `keyword-rules.ts`). `nightly-schedule-builder` imports it (replacing `getKeywordWindowOverride` at :214), `dailyReviewPipeline.ts` QC_VIOLATIONS imports it, and so does `schedulingService.extractSchedulingContext`. No inline `lower.includes(kw)` keyword loop remains in any of the three. | regression (no parallel copy) | grep: `grep -rn "mapping\[0\]" src supabase/functions` shows only the shared module |
| AC-C2 | Given the shared matcher, when it is fed every row of the spelling table (section 3), then each row returns the "New lead window / keyword" column exactly. | happy | `supabase/functions/_shared/keyword-rules.test.ts` (auto-discovered by `scripts/run-tests.mjs`) |
| AC-C3 | Given the spelling-table test, when its keyword map is built, then it is either loaded from a JSON fixture captured from Q-1, or sorted by (length, then bytewise). This reproduces jsonb order (F-11). A literal object in code order does NOT satisfy this AC, because it tests a precedence production never uses. | edge | test file read; a meta-assertion that the fixture's key order equals `Object.keys(fixture).sort(byLenThenBytes)` |
| AC-C4 | Given a keyword whose lane is NOT a category (`morning: ['morning','flexible']`, or a lane of `TODO`, or an empty lane), when a title containing it is scheduled with ANY category, then the keyword window leads, the same as at 0796822. | regression | spelling rows S-1, S-16, S-17 |
| AC-C5 | Given the gate skips a keyword, when no later keyword matches, then `preferredWindows` equals `getPreferredWindows(category, ...)` exactly, AND the task is again eligible for aggregate-capacity fallback (`!keywordOverride` at :1273). A gated-out keyword must count as "no override", not as an override with no window. | edge | unit test on the extracted placement step, or a builder trace with `keywordOverride: null` in `dayPlacements` |
| AC-C6 | **QC parity.** Given the same task, title, category and stored keywords, when QC_VIOLATIONS runs, then the keyword it checks against is the SAME keyword the scheduler would pick. A task whose only matching keywords are gated out produces NO violation. Example: "Morning workout" LIFE at 06:30 produces no violation; today it is flagged against `work`->business_hours. | happy | `src/utils/dailyReviewPipeline` test, or a pure test of the extracted QC function, over all spelling rows |
| AC-C7 | Given QC evaluates a task, when a later keyword in the list disagrees with the window but the first applicable keyword agrees, then NO violation is raised. Today QC `break`s only on a violation, so it effectively tests "any keyword" (F-9b). | edge | unit test: title "Text about the dinner" LIFE at 10:00 (text->business_hours agrees, dinner->evening disagrees) gives 0 violations |
| AC-C8 | Given QC classifies the scheduled hour into a window, when the config's `after_work` is 17-22 (the live default), then QC uses the config `timeWindows` (the same windows the scheduler used), not the hard-coded 17-19 / 19-23 buckets (F-9c). A JOB task at 18:30 matched to an after_work keyword is not a violation. | edge | unit test with config windows |
| AC-C9 | Given the owner's live keyword map, when the relabel migration runs, then exactly these 13 keys have lane `JOB`: work, email, reply, respond, message, call, meeting, follow_up, review, budget, invoice, contract, office. `interview` stays `CAREER`, every other key's lane is unchanged, and every key's WINDOW is unchanged. | happy | SQL: `select key, value from user_scheduling_prefs, jsonb_each(config->'contextRules'->'keywords') where user_id=<owner> order by key`, diffed against Q-1 |
| AC-C10 | Given code defaults, when `DEFAULT_SCHEDULING_CONFIG.contextRules.keywords` is read, then the same 13 keys have lane JOB, `interview` is CAREER, and no keyword was REMOVED. The count is unchanged at 50 default entries, counted this session with `sed -n 192,260p src/config/schedulingRules.ts | grep -cE "^\s+[a-z_]+: \["` (owner: keywords are not to be removed). The `resolveKeywords.ts` header says "48 defaults"; that comment is stale. | regression | unit test on the defaults |
| AC-C11 | Given the relabel is a jsonb edit, when it runs, then it uses `jsonb_set` per key (or a whole-object write built from the CURRENT stored object). It must never write the code defaults over the owner's list, which would resurrect bill/business/project/startup (see `resolveKeywords.ts` header). | regression | SQL key count stays 46; `bill` absent |
| AC-C12 | Given Settings > Keyword Detection Rules, when a keyword row renders, then the lane control is a Select whose options are exactly the shared category list (in its canonical order) plus a "No category (applies to all)" option, and it is pre-selected to the row's stored lane. | happy | Playwright: open a row's lane Select and read its option texts |
| AC-C13 | Given a stored lane that is not a category (e.g. `flexible` on `morning`), when its row renders, then the Select shows "No category (applies to all)" and Save writes the original stored value back unchanged. Merely opening and saving Settings must not change keyword behaviour. | edge | Playwright: open, Save, then SQL shows `morning` = `["morning","flexible"]` |
| AC-C14 | Given the owner changes `email`'s lane from JOB to CAREER in the Select and saves, when the next nightly run schedules "Email recruiter" (CAREER), then the trace shows `matchedKeyword: 'email'`, `overrideWindow: 'business_hours'`. No code change involved. | happy (user-editable) | builder trace `dayKeywordOverrides` |
| AC-C15 | Given "Add Keyword" seeds `['flexible','LIFE']` today (SchedulingSettings.tsx:858), when a keyword is added, then its seed lane is "No category" (or the owner's ruled default), so a new keyword is not silently gated to LIFE. | edge | Playwright + saved JSON |
| AC-C16 | Given `extractSchedulingContext` (F-10) is reached only for a task with no category mapping, when it evaluates keywords, then it calls the shared matcher with `category = undefined`, and category-gated keywords do NOT apply. See Gaps G-6: if the owner rules otherwise, this AC flips. | edge | unit test |
| AC-C17 | Given `PERSONAL` tasks today schedule with `defaultStatus: 'LIFE'`, and `EDUCATION` sits beside `PROF_EDUCATION`, when a LIFE-lane keyword meets a PERSONAL task or a PROF_EDUCATION-lane keyword meets an EDUCATION task, then the result matches the owner's ruling G-5. Without a ruling, the literal rule applies (no match), and the spelling rows S-4 and S-19 pin that. | edge | spelling rows |

## 3. SPELLING TABLE: keyword gate (Tier 1 matcher)

**What defines a valid spelling here.** This is a matcher over free text, but no external grammar governs it. Its contract is the code plus the owner's decision. The "Documented by" column therefore cites the code line that fixes TODAY's behaviour, and the owner decision that fixes the NEW behaviour:
- `NSB:222` iteration in stored order; `NSB:226` flexible-window skip; `NSB:229` `_` turned into a space; `NSB:230` length below 3 skipped; `NSB:231` substring test on TITLE only; `NSB:232` window must be active today (NSB = `supabase/functions/nightly-schedule-builder/index.ts`).
- `ORD`: precedence = jsonb key order (length, then bytewise), measured from the live row Q-1.
- `D3`: owner decision 3 (gate only when the lane is a real category; JOB relabel of 13 keys).

**Keyword map used** = the owner's live map (Q-1) AFTER the AC-C9 relabel. Lanes: call/work/email/reply/budget/office/review/invoice/meeting/message/respond/contract/follow_up = JOB; interview = CAREER; side = VENTURES; class/study/lecture/homework/assignment = PROF_EDUCATION; morning lane = `flexible` (not a category); `appointment` window = `flexible` (always skipped); the rest are LIFE. Category windows are the owner's saved rows (F-15), plus JOB = business_hours (AC-B4). Day = a weekday unless the row says otherwise.

Direction of a wrong answer: **TOO LOOSE** = the gate applied a keyword it should have skipped (a FALSE PASS of the keyword). **TOO TIGHT** = the gate skipped a keyword that should apply (a FALSE REFUSAL). **ORDER** = right gate, wrong precedence.

| # | Title | Task category | Today at 0796822 (keyword -> lead window) | NEW expected (keyword -> lead window) | Documented by | Wrong answer would be |
|---|---|---|---|---|---|---|
| S-1 | `Morning workout` | LIFE | `work` -> business_hours | `morning` -> morning (lane `flexible` is not a category, so it is ungated) | NSB:222,231 ORD D3 | TOO LOOSE if still `work`; TOO TIGHT if `morning` is gated |
| S-2 | `Workout at the gym` | LIFE | `work` -> business_hours | `workout` -> morning | NSB:231 ORD D3 | TOO LOOSE (`work` is substring of `workout`) |
| S-3 | `Finish homework` | PROF_EDUCATION | `work` -> business_hours | `homework` -> after_work | NSB:231 ORD D3 | TOO LOOSE; also STOP-not-continue bug if it returns no keyword |
| S-4 | `Finish homework` | EDUCATION | `work` -> business_hours | none -> EDUCATION windows (evening, weekends) | D3 (literal); ruling G-5 | TOO LOOSE if `homework` applies without a G-5 alias ruling |
| S-5 | `Networking event` | CAREER | `work` -> business_hours | none -> CAREER windows | NSB:231 D3 | TOO LOOSE (`network` over-match) |
| S-6 | `Networking event` | JOB | `work` -> business_hours | `work` -> business_hours (in-category substring over-match is KEPT; no re-tokenising) | NSB:231 D3 | TOO TIGHT if word-boundary matching was added unasked |
| S-7 | `Recall the library book` | LIFE | `call` -> business_hours | none -> LIFE windows | NSB:231 D3 | TOO LOOSE (`recall`) |
| S-8 | `Recall Trinnex invoice` | JOB | `call` -> business_hours | `call` -> business_hours | NSB:222 ORD D3 | ORDER if `invoice` is reported as the matched keyword (call is 4 chars, sorts first) |
| S-9 | `Email the dentist` | LIFE | `email` -> business_hours | `dentist` -> business_hours (skip, CONTINUE, match a later keyword) | NSB:222 D3 | TOO TIGHT if the scan stops at the first gated keyword |
| S-10 | `Email recruiter about Acme role` | CAREER | `email` -> business_hours | none -> CAREER windows | D3 | TOO LOOSE |
| S-11 | `Prep for interview with Acme` | CAREER | `interview` -> business_hours | `interview` -> business_hours | D3 (`interview` stays CAREER) | TOO TIGHT |
| S-12 | `Prep for interview with Acme` | JOB | `interview` -> business_hours | none -> JOB windows (business_hours) | D3 | TOO LOOSE if `interview` reported in trace |
| S-13 | `Reply to Huddle beta users` | VENTURES | `reply` -> business_hours | none -> VENTURES windows (evening, weekends) | D3 | TOO LOOSE: owner's own product pulled into business hours |
| S-14 | `Go to post office` | LIFE | `office` -> business_hours | `post_office` -> business_hours | NSB:229 ORD D3 | TOO TIGHT if `_`->space is lost in the refactor |
| S-15 | `Text mom` | LIFE | `text` -> business_hours | `text` -> business_hours | NSB:231 | TOO TIGHT |
| S-15b | `Write context doc` | JOB | `text` -> business_hours | none -> JOB windows | NSB:231 D3 | TOO LOOSE (`context` contains `text`) |
| S-16 | `Morning standup` | JOB | `morning` -> morning | `morning` -> morning | NSB:226 D3 (non-category lane ungated) | TOO TIGHT |
| S-17 | `Focus block` with synthetic entry `focus: ['morning','TODO']` | JOB | `focus` -> morning | `focus` -> morning | D3 (lane not a category) | TOO TIGHT if every non-empty lane is treated as a gate |
| S-18 | `Workout` with legacy entry `work: ['business_hours','job']` (lower-case lane) | LIFE | `work` -> business_hours | none from `work` (lane normalised to JOB, so gated); then `workout` -> morning | D3 + ruling G-9 | TOO LOOSE if lane compare is case-sensitive (`job` is not seen as a category, so it is ungated) |
| S-19 | `Go to the mall` | PERSONAL | `mall` -> after_work | none -> PERSONAL windows (literal rule); ruling G-5 may alias PERSONAL->LIFE | D3, G-5 | TOO LOOSE or TOO TIGHT depending on G-5; must match the ruling |
| S-20 | title `Fix bug`, description `reply to the email` | JOB | none | none | NSB:231 (title only) | TOO LOOSE if the shared matcher starts reading the description (extractSchedulingContext passes title+description, F-10) |
| S-21 | `Email the dentist` on a SATURDAY | LIFE | none (business_hours inactive) | none | NSB:232 | ORDER/TOO LOOSE if QC flags it (QC ignores active windows today, F-9a) |
| S-22 | `Dinner with the Trinnex team` | JOB | `dinner` -> evening | none -> JOB windows (business_hours) | D3; ruling G-7 | behaviour CHANGE the owner should see before ship |
| S-23 | `Lunch with Trinnex team` | JOB | `lunch` -> business_hours | none -> JOB windows (business_hours) | D3 | same window, no keyword in trace |
| S-24 | `Budget review` | LIFE | `budget` -> business_hours | none -> LIFE windows (after_work, weekends) | ORD D3 | TOO LOOSE |
| S-25 | `Side project kickoff call` | VENTURES | `call` -> business_hours | `side` -> after_work | ORD D3 | TOO TIGHT/ORDER: skip `call`, continue, reach `side` |
| S-26 | `Follow-up with Trinnex PM` (hyphen) | JOB | none | none (`follow up` does not match `follow-up`) | NSB:229,231 | TOO LOOSE if hyphen normalisation was added unasked |
| S-27 | `Follow up with Trinnex PM` | JOB | `follow_up` -> business_hours | `follow_up` -> business_hours | NSB:229 | TOO TIGHT |
| S-28 | `WORK ON OPS DECK` | JOB | `work` -> business_hours | `work` -> business_hours | NSB:220 (lower-cased title) | TOO TIGHT if case folding is lost |
| S-29 | `Study for MIT exam` | PROF_EDUCATION | `study` -> evening | `study` -> evening | D3 | TOO TIGHT |
| S-30 | `Study for MIT exam` | LIFE (misfiled) | `study` -> evening | none -> LIFE windows | D3 | TOO LOOSE |
| S-31 | `Homework review` | PROF_EDUCATION | `work` -> business_hours | `homework` -> after_work (skips `work` and `review`, both JOB) | ORD D3 | TOO TIGHT if the scan stops after two skips |
| S-32 | `Go home` with entry `go: ['after_work','LIFE']` | LIFE | none (length below 3) | none | NSB:230 | TOO LOOSE if the length guard is dropped |
| S-33 | `Plan appointment` | LIFE | none (`appointment` window `flexible`) | none | NSB:226 | TOO LOOSE |

**QC parity rows.** For every row above, the daily QC step must report as `matchedKeyword` the SAME keyword as the NEW column, or no violation when that column says "none". Check: one test iterates this table through both the scheduler's and QC's call into the shared matcher and asserts equal keyword ids.

### 3b. SPELLING TABLE: voice `normalizeCategory` (C-5, `RealtimeVoiceAssistant.ts:1499-1522`)

The contract: an exact member of the shared category list (case-insensitive; spaces, `-` and `_` ignored) maps to itself BEFORE any synonym rule runs.

| # | Model-supplied category string | Today | NEW expected | Wrong answer would be |
|---|---|---|---|---|
| N-1 | `JOB` | CAREER (`includes('job')`, :1512) | JOB | TOO LOOSE into CAREER |
| N-2 | `job` / `Job` | CAREER | JOB | same |
| N-3 | `CAREER` | CAREER | CAREER | regression |
| N-4 | `PROF_EDUCATION` / `prof education` | EDUCATION (`includes('education')`) | PROF_EDUCATION | collapses a real category |
| N-5 | `job search` / `job_search` | CAREER | CAREER (next-role synonym; must NOT become JOB because it contains `job`) | TOO LOOSE into JOB |
| N-6 | `work` | CAREER | JOB (ruling G-8; the owner's "all job tasks go to JOB") | wrong lane |
| N-7 | `homework` | CAREER (`includes('work')`, since no education word matches) | PROF_EDUCATION or EDUCATION per G-8 (never CAREER or JOB) | over-match on `work` |
| N-8 | `networking` | CAREER (`work`) | per G-8; never JOB by substring alone | over-match |
| N-9 | `VENTURES` / `venture` / `startup` | VENTURES | VENTURES | regression |
| N-10 | `` (empty) / undefined | LIFE | LIFE | regression |
| N-11 | `GARDENING` (unknown) | LIFE | LIFE | regression |

### D. Classifiers file employer work as JOB

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| AC-D1 | Given `profiles.company = 'Trinnex'`, when `ai-task-parser` builds its prompt, then the prompt text contains the literal employer name read from `profiles.company` for the calling user. It is NOT hard-coded "Trinnex" in source: `grep -rn "Trinnex" supabase/functions src` returns only test fixtures. | happy | unit test on the prompt builder with a stubbed profile; grep |
| AC-D2 | Given `profiles.company` is NULL or empty, when the parser runs, then it still returns a valid category from the shared list, the prompt contains no `undefined`/`null` text, and employer-generic titles ("Complete benefits enrollment") still return JOB. | edge | unit test on the prompt string; eval rows E-1, E-2 with company NULL |
| AC-D3 | Given the parser prompt, when it is read, then (a) every place that lists the categories is generated from the shared list (no hand-typed `LIFE, CAREER, VENTURES, or EDUCATION` at :150), (b) JOB is defined as work for the employer, CAREER as getting the next role, VENTURES as the owner's own products and clients, NAMED: Huddle, Nexus, TaskOS, Sidecar, Prompto, Boost, Compass, Howard County, and (c) the owner rulings are stated: Esri GIS and Power BI work, SDLC work, ops decks and ops process diagrams are JOB, and **SDLC-related work defaults to JOB even when an owner product is named** (ruling 2026-11-03; E-21, E-27). | happy | prompt snapshot test |
| AC-D4 | Given the venture list in AC-D3(b), when it is read by the prompt builder, then it comes from ONE editable place (config or a shared constant, see G-2), not a string typed into two prompts. | regression (no parallel copy) | grep shows the list defined once |
| AC-D5 | Given the parser returns a category that is not in the shared list (e.g. `WORK`, `Job `), when `execute-tool` inserts the task (C-2 :1853, :911, :989, :1055), then the value is normalised by the same function as C-5 (section 3b). An unmappable value becomes `LIFE` with a log line naming the raw value. The insert never fails on the enum. | error | unit test on the normaliser + a `Test-` insert with `category:'job'` resulting in `JOB` |
| AC-D6 | Given `quick_create_task` is called with `category: 'JOB'`, when the task is created, then the stored category is `JOB`. Today the argument is dropped (C-3). | happy | edge-fn call + SQL (`Test-` title, cleaned up) |
| AC-D7 | Given `tool-definitions.ts`, when the four category enums are read (:48, :88, :153 prose, :370), then each equals the shared list and includes JOB. `update_task` (:88) gains PROF_EDUCATION and PERSONAL as a side effect, so it is no longer a narrower set. | regression | unit test: `deepEqual(enum, CATEGORY_KEYS)` for each |
| AC-D8 | Given the voice assistant, when the model calls create/update with any N-1..N-11 string, then `normalizeCategory` returns the section 3b NEW column. | happy | `src/utils/normalizeCategory.test.ts` (extract the method) |
| AC-D9 | **Eval scorecard.** Given `profiles.company='Trinnex'`, when every SCORED row of section 4 is sent to the real `ai-task-parser` 3 times, then each row returns its expected category on all 3 runs for the owner-ruling rows (marked R), and on at least 2 of 3 runs for every other scored row. Rows marked RULING are excluded until ruled. | happy | `scripts/eval-job-category.mjs` writing `docs/qc-evidence/EVAL-job-category-<n>.md` (pass/fail per row, the raw category per run) |
| AC-D10 | Given the eval harness creates nothing, when it runs, then it calls the parser in a mode that writes no tasks (parse only), or uses `Test-` titles and deletes them. Zero rows are left: `select count(*) from tasks where title like 'Test-%' and created_at > <run start>` = 0. | regression | SQL |
| AC-D11 | Given the "Team standup meeting" -> CAREER and "Prepare slides for client meeting" -> CAREER examples in the current prompt (:249, :297), when the new prompt is read, then neither example still says CAREER for employer work. Standup becomes JOB; client slides follow ruling G-4. | regression | prompt snapshot |
| AC-D12 | Given `classify-task-topic` (C-6) receives `task_category='JOB'`, when the AI call fails, then the fallback topic name is a JOB-specific name (e.g. "Job Tasks"), not "General Tasks", and the window affinity is `['business_hours']`. | edge | unit test on the fallback branch |
| AC-D14 | **A manual category change is kept.** Given the owner re-files a task by hand (TaskDetailModal Select, the board, or an explicit voice/chat instruction such as "move this to Ventures"), e.g. "Work on my SDLC app" from JOB to VENTURES, when ANY automated writer later touches that task, then `tasks.category` is still VENTURES. Automated writers: (a) a Huddle grooming `batch_update_tasks` call carrying `category` (`execute-tool/index.ts:1055`), (b) an agent-initiated `update_task` with `category` that the owner did not ask for (:989), (c) any JOB backfill or re-classification script, (d) the nightly builder and the daily review. The other fields in the same automated update (tags, rank, assignee) still apply; only `category` is held. | regression (owner ruling 2026-11-03) | test: create a `Test-` task, set VENTURES by hand, send a batch update with `category:'JOB'` plus a tag, then SQL shows category=VENTURES and the tag applied |
| AC-D15 | Given the hold in AC-D14, when the code is read, then the "set by the owner" fact is stored on the task row (a column or a field in the existing `scheduling_context` jsonb, see G-10), written by every manual path, and read by every automated writer through ONE shared function. It must not be inferred from timestamps, and it must not be kept in browser state. | regression (no parallel copy) | grep: one exported guard function, called from all writers in (a)-(c) |
| AC-D16 | Given the owner re-files a task by hand a SECOND time (VENTURES back to JOB), when it is saved, then the new value is stored. The hold blocks automated writers only, never the owner. | edge | Playwright or edge-fn call + SQL |
| AC-D17 | Given an automated writer's category change is held back, when it returns, then its response names the task as `category_kept_by_owner` (or similar). It must not report the category as updated: a silent 200 that pretends the write happened is a failure. | error | edge-fn response body asserted in the AC-D14 test |
| AC-D13 | Given a task's category is changed by hand (the TaskDetailModal Select) from CAREER to JOB, when it is saved, then the row stores JOB and the next nightly run uses JOB's windows. | happy | Playwright + SQL + builder trace |

## 4. CLASSIFIER EVAL SET (scorecard for AC-D9)

`profiles.company = 'Trinnex'`. R = owner-ruled (must pass 3/3). 25 of the 27 titles do not name Trinnex.

| # | Title | Expected | Names employer? | Why / ruling |
|---|---|---|---|---|
| E-1 | Complete benefits enrollment | JOB (R) | no | owner example |
| E-2 | Prep for my team's standup | JOB (R) | no | owner example |
| E-3 | Create a visual for my SDLC workflow | JOB (R) | no | owner ruling (SDLC = work engineering); live rows are VENTURES today (F-18) |
| E-4 | Finalize ops deck | JOB (R) | no | owner ruling; live row is CAREER today |
| E-5 | Finalize ops process diagrams | JOB (R) | no | owner ruling |
| E-6 | Build an Esri GIS layer for the water main inventory | JOB (R) | no | Esri GIS = JOB tool |
| E-7 | Update the Power BI dashboard for the weekly ops review | JOB (R) | no | Power BI = JOB tool |
| E-8 | Submit Trinnex timesheet | JOB (R) | yes | baseline |
| E-9 | 1:1 with my manager | JOB | no | employer implied |
| E-10 | Reply to Trinnex client about the asset inventory | JOB | yes | employer's client, not the owner's |
| E-11 | Document the release checklist for the SDLC pipeline at work | JOB (R) | no | SDLC + "at work" |
| E-12 | Update my LinkedIn headline | CAREER (R) | no | next-role work |
| E-13 | Apply for the Director of Data role at Acme | CAREER (R) | no | next role |
| E-14 | Session with my career coach | CAREER (R) | no | named in decision 1 |
| E-15 | Prep for interview with the Esri recruiter | CAREER | no | AMBIGUOUS: Esri as a prospective employer, not a tool. The tool ruling must not override intent |
| E-16 | Ship Huddle push notifications | VENTURES (R) | no | owner product |
| E-17 | Fix the Nexus login bug | VENTURES (R) | no | owner product |
| E-18 | Send the Howard County proposal | VENTURES (R) | no | owner client |
| E-19 | Draft the Boost pitch deck | VENTURES (R) | no | "deck", but not an ops deck: product wins |
| E-20 | Email Prompto beta testers | VENTURES (R) | no | owner product |
| E-21 | Write the SDLC doc for Sidecar | JOB (R) | no | RULED 2026-11-03 (coordinator relay): anything SDLC-related defaults to JOB even when an owner product is named; the owner re-files individual tasks to VENTURES by hand (AC-D14) |
| E-22 | Prepare slides for client meeting | RULING (G-4) | no | AMBIGUOUS: no client named; existing prompt example. Excluded until ruled |
| E-23 | Take a Power BI course on Coursera | EDUCATION | no | AMBIGUOUS: JOB tool, but self-paced learning. Proposed EDUCATION; confirm with G-4 |
| E-24 | Complete MIT assignment 3 | PROF_EDUCATION | no | regression |
| E-25 | Pick up groceries | LIFE | no | regression |
| E-26 | Pay the credit card bill | LIFE | no | regression |
| E-27 | Work on my SDLC app | JOB (R) | no | RULED 2026-11-03: SDLC-related defaults to JOB; a manual re-file to VENTURES must then stick (AC-D14) |

Scored rows: 26 (only E-22 is excluded until ruled). Pass bar: per AC-D9.

### E. One shared category list, no visible change for existing categories

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| AC-E1 | Given the shared definition (one module, importable by the Vite app AND by Deno edge functions, the same way `schedulingRules.ts:12` already imports `_shared/activities.ts`), when the repo is grepped for a hand-written category union or array, then zero hits remain outside that module and generated types: `grep -rnE "'LIFE' \| 'CAREER'|\['LIFE', 'CAREER'|\"LIFE\", \"CAREER\"" src supabase/functions --include=*.ts --include=*.tsx` excluding the module, `types.ts`, tests and `*.backup.ts`. Every file in the F-21 list and section 1 (C-4, C-7, C-8) imports the keys from the module. | regression (no parallel copy) | grep output = 0 lines; the list of importers attached |
| AC-E2 | Given the shared module, when it is read, then it holds per category: key, label, canonical order, icon, and the existing per-surface style values (or the copies keep their own style maps keyed by the shared key type, so a missing JOB entry is a TYPE error). It must NOT collapse the per-surface shades into one colour. | regression | file read + `tsc --noEmit` fails when a surface map omits JOB (prove by deleting JOB from one map) |
| AC-E3 | **Pixel-identical existing categories.** Given a fixture board with one task in each of LIFE, CAREER, VENTURES, EDUCATION, PROF_EDUCATION, PERSONAL, when each surface below is screenshotted at 0796822 and after the change at the same viewport, then the crops for those six tasks are pixel-identical (0 differing pixels). Surfaces: TaskCard, KanbanBoard column + card, TabbedKanbanBoard tabs, TaskFilters (status AND category options), GanttChart bar, EnhancedTaskGridView, TaskGridView, TimeSlotGrid, DailyScheduleView, WeeklyAgendaView, FocusView, Priorities, ProductivityDashboard, ColumnManager, AddColumnModal, TaskCreationModal Select, EditableTaskSuggestion Select, TaskDetailModal Selects. | regression (owner hard constraint) | `verify-uat.yml` Playwright with `toHaveScreenshot` per surface, both runs with the same fixture |
| AC-E4 | Given AC-E3 compares pixels, when the computed style is ALSO compared (`getComputedStyle(el).backgroundColor/color/borderColor` for each existing-category chip), then values are identical before/after, including the deliberate differences in F-21 (VENTURES green on Kanban, purple on TaskCard, orange via `--category-ventures`). | regression | Playwright JSON dump diff = empty |
| AC-E5 | Given the existing label text ("Ventures", "Prof. Education", "Ventures Backlog", "Life & Personal" etc.), when each Select/filter/tab is opened, then option texts AND their ORDER for existing categories are unchanged. JOB is the only addition, at the position the owner rules (G-11; default: directly before CAREER). | regression | Playwright: read option texts into an array, diff |
| AC-E6 | Given the board tabs (F-22), when rendered, then the 5 existing tabs keep their labels, order and counts for the fixture. A JOB tab exists only if the owner rules for one (G-11). Without a JOB tab, JOB tasks still appear under "Time filtered" and are not silently absent from every tab: the count of tasks reachable from the tabs equals the fixture total. | edge | Playwright tab counts |
| AC-E7 | Given JOB is new, when it renders on every surface in AC-E3, then it has a non-empty label "Job" (or the ruled label), a defined colour on each surface (not the fallback grey/undefined class), and an icon on TaskCard. No surface shows the raw key `JOB` where siblings show a label. | happy | Playwright screenshot of a JOB task per surface + a check that no element has `class` containing `undefined` |
| AC-E8 | Given Tailwind exposes 4 category colour tokens (F-21), when JOB is added, then a `--category-job` token exists in `src/index.css` for light AND dark themes, plus `category.job` in `tailwind.config.ts`. Its hue is visibly distinct from `--category-career` (proposed: at least 45 degrees of hue apart, the same floor Huddle uses). | happy | CSS file read + computed-style check |
| AC-E9 | Given `ProductivityDashboard` counts per category (`:64`), when the fixture includes 2 JOB tasks, then a JOB count of 2 appears, and the sum of the category counts equals the total task count (no task falls out of the funnel). | edge (cross-surface reconciliation) | Playwright text read |
| AC-E10 | Given the same fixture, when the JOB count is read on ProductivityDashboard, the TabbedKanbanBoard, the category filter result, and Huddle's category widget (section F), then all four agree. | edge (cross-surface reconciliation) | Playwright + Huddle widget read |
| AC-E11 | Given `TaskFilters` category filter, when "Job" is selected, then exactly the JOB fixture tasks are listed; when "Career" is selected, no JOB task is listed. | happy | Playwright |

### F. Huddle (`/home/user/huddle-extension-app`)

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| AC-F1 | Given a journey task changes to JOB, when the sync settles (poll up to 30s), then `tasks.journey_tasks.category = 'JOB'` for that id. INSERT, UPDATE and DELETE all propagate (use the `verify-task-sync` skill). | happy | huddle mirror SQL |
| AC-F2 | Given `CATEGORY_HUES`, when it is read, then JOB is SEEDED with a hue at least 45 degrees from each of LIFE 250, EDUCATION 70, CAREER 149 and VENTURES 303 (feasible ranges: about 348-25, or about 194-205). Today an unseeded JOB hashes to 189, 40 degrees from CAREER (F-23). `scripts/widget-colors.test.ts`'s `JOURNEY_CATEGORIES` includes JOB and the all-pairs check passes. | happy | `bun scripts/widget-colors.test.ts` (or the repo's runner) |
| AC-F3 | Given the 4 existing seeded hues, when the change ships, then LIFE/EDUCATION/CAREER/VENTURES hues are byte-identical (250/70/149/303), and FAMILY is still grey. | regression | same test, plus a pinned-value assertion |
| AC-F4 | Given `widgets.server.ts`, when JOB tasks exist, then `displayCategory('JOB') = 'JOB'`, `categoryLabel('JOB')` returns the ruled label ("Job"), and JOB has a fixed slot in `DISPLAY_CATEGORY_ORDER` (default: before CAREER, G-11) instead of being appended alphabetically as a "dynamic" bucket. CAREER tasks still render under "Career" only. | happy | unit test on `displayCategory`/`categoryLabel`/order |
| AC-F5 | Given `JourneyWidgets.tsx` `CategoryChip`, when a JOB task renders, then the chip text is "Job" and its background uses the seeded JOB hue. | happy | Huddle Playwright via `verify-uat.yml` |
| AC-F6 | Given `ceremonies.ts` `CATEGORY_OWNER`, when a JOB task appears in a standup, then its owner is the agent the owner rules (G-12). Without a ruling it falls back to `iris-chase`, and that fallback is recorded in the ceremony output rather than silently assigned. | edge | unit test on `ownerForCategory('JOB')` |
| AC-F7 | Given the tool descriptions in `lib/calendar/tools.ts:26` and `lib/tasks/tools.ts:33,79` list the journey categories, when read, then they include JOB. `prioritize(category='JOB')` returns only JOB mirror rows. | happy | grep + a server-fn call via `test-agent-serverfn` with `journey:{enabled:false}` |
| AC-F8 | Given the Huddle default `prioritiesWidget.categories` (`widgets.server.ts:~1352`, default `LIFE, CAREER, VENTURES, EDUCATION, FAMILY`), when the owner has JOB tasks, then JOB is included by default, or the owner can add it in Huddle Settings with no code change. | edge | Huddle settings read + widget render |

### G. Error states

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| AC-G1 | Given the edge functions deploy BEFORE the enum migration (wrong order), when a classifier returns JOB, then the task is NOT lost. The create still succeeds (the fallback value is ruling G-13; proposed CAREER plus tag `needs-job-recategorize`), the error `invalid input value for enum task_category` is logged with the task title, and the caller's response says the category was substituted. The PR states the rollout order: migration, then functions, then UI. | error | integration test with a mocked supabase client returning that error |
| AC-G2 | Given the Settings keyword lane Select, when a stored lane is a category key that has since been removed from the shared list, then the row shows the raw value with a warning badge and the gate treats it as a non-category (applies to all). It is never silently dropped. | error | Playwright with a seeded config |
| AC-G3 | Given `profiles` read fails in `ai-task-parser`, when parsing runs, then it proceeds without the employer name (AC-D2 behaviour) and logs the failure. It does not return 500. | error | unit test with a throwing profile fetch |
| AC-G4 | Given the relabel migration (AC-C9) runs a second time, when it finishes, then the stored keyword object is byte-identical to after the first run (idempotent). | error | SQL hash compare |

### H. Regression guards (beyond those inline above)

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| AC-H1 | Given a frozen fixture of the owner's open tasks for one weekday and one Saturday (from 0796822) with NO JOB tasks and the CURRENT keyword lanes (before relabel), when the nightly builder's placement step runs before and after the code change, then every LIFE/EDUCATION/PROF_EDUCATION/VENTURES/PERSONAL task gets the identical window, EXCEPT tasks whose matched keyword's lane is a category different from the task's (the only intended change). Each excepted task is listed with its old and new keyword. | regression | deterministic test on the extracted placement function; diff report attached |
| AC-H2 | Given the excepted list from AC-H1, when it is read, then it contains the `work`-before-`workout`/`homework` cases (S-1, S-2, S-3, S-31) and no task with a non-category-lane keyword. | regression | same report |
| AC-H3 | Given the existing suites, when `npm test` runs (`scripts/run-tests.mjs`), then every pre-existing test passes, including `scheduling-windows`, `scheduling-caps`, `schedulingCaveats`, `resolveKeywords`, `mergeStoredConfig`, `workflowStatus`, and Huddle `widget-colors`. | regression | runner output |
| AC-H4 | Given caveats are a read-time overlay above keywords (`NSB:1253-1257`, caveat > keyword > category), when a caveat matches a JOB task, then the caveat window leads, the keyword gate does not affect caveat matching, and `caveat.match.categories` accepts JOB. | regression | extend `schedulingCaveats.test.ts` |
| AC-H5 | Given PROF_EDUCATION caps (`maxPerDay 2 / weekend 6`, `resolveCategoryDailyCap`), when the change ships, then the assignment cap per day is unchanged on the owner's fixture. JOB has no cap unless the owner sets one in Settings. | regression | `scheduling-caps.test.ts` |
| AC-H7 | Given the new gate is a Tier 1 guard, when it is mutation-proved with `mutate.sh`, then each mutation is reported FIRED: (1) remove the category check, so S-1/S-2/S-5 fail; (2) turn "skip and continue" into "stop", so S-9/S-25/S-31 fail; (3) make the lane compare case-sensitive, so S-18 fails; (4) gate non-category lanes too, so S-16/S-17 fail. A NOT-APPLIED result counts as unproven, not as a pass. | regression | `mutate.sh` output attached to the verify record |
| AC-H6 | Given `task_status` still contains CAREER/VENTURES/LIFE/PROF_EDUCATION lanes (F-13), when any create path runs with a JOB task, then the stored `status` is a workflow state (BACKLOG etc.), never `JOB`. This matches the existing "status is never the category" rule in `workflowStatus.ts`. | regression | `workflowStatus.test.ts` new row + SQL |

### I. Performance

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| AC-I1 | Given the shared matcher replaces the inline loop, when the matcher runs over the 46-keyword live map for 500 titles, then median wall time is at most 2x the old loop and under 5 ms total. | performance | micro-benchmark in the test file |
| AC-I2 | Given `ai-task-parser` now reads `profiles.company`, when it parses, then it adds exactly one `profiles` select per request (not per task in a multi-task parse). | performance | supabase client spy counts 1 call for a 5-task input |
| AC-I3 | Given the nightly builder single-day run for the owner, when run before and after, then total duration differs by under 10% (logged `durationMs`). | performance | two traces' `durationMs` |
| AC-I4 | Given the Settings page with the 46-keyword list rendered as Selects, when it opens, then it is interactive in under 2 s on the CI runner (same budget as today, measured before and after). | performance | Playwright timing |

## 5. Goal -> AC coverage

| Owner goal | ACs |
|---|---|
| 1. JOB is a user-editable Settings row (business_hours); CAREER narrowed (after_work + weekends); no code change to retune | AC-A1..A3, A8, B1..B11, D13 |
| 2. All job tasks go to JOB, employer from `profiles.company`; owner products stay VENTURES; next-role stays CAREER; Esri/Power BI/SDLC/ops rulings | AC-A9, D1..D12, eval set E-1..E-27 |
| 2b. (ruling 2026-11-03) SDLC defaults to JOB; a manual re-file is kept | AC-D3(c), D14..D17, E-21, E-27 |
| 3. Keywords kept, gated by a category lane; same rule in scheduler and QC; 13 relabelled to JOB; lane editable | AC-C1..C17, H1, H2, H7, spelling tables 3 and 3b |
| 4. One shared category list; existing categories look identical; Huddle shows JOB; sync carries JOB | AC-E1..E11, F1..F8 |
| 5. Enum value plus the 5-row move | AC-A1, A2, A4..A7 |
| Non-goal guards (nothing else changes) | AC-B6, B9, C4, C11, F3, H1..H6 |
| Performance (the brief gave none, so these are proposed defaults to confirm) | AC-I1..I4 |

No AC lacks a goal. The QC fixes AC-C7 and AC-C8 change QC output for ALL categories, not just JOB. They are tied to goal 3 ("both must follow the same rule"), but they go beyond JOB; see G-14.

## 6. Contradictions found in the code, and rulings the owner must make

Each item states the observation, its source, and a proposed safe default (the AC that applies if the owner does not rule).

| # | Observation (source) | Why it matters | Proposed default |
|---|---|---|---|
| G-1 | Server `resolveConfig` uses saved `categoryMappings` WHOLESALE (scheduling-defaults.ts:196-209); the client spreads defaults underneath (schedulingRules.ts:327). | A JOB default in code shows in Settings but the nightly builder would place JOB tasks "anywhere today" (F-4). Settings and the scheduler would disagree. | Server fills any category MISSING from the saved map from the default (a per-key merge), exactly like the client. No-op for the 6 saved rows. Pinned by AC-B4. |
| G-2 | The VENTURES product/client list (Huddle, Nexus, TaskOS, Sidecar, Prompto, Boost, Compass, Howard County) exists nowhere in code. | Org rule: config, not literals. A new venture would need a code change. | A user-editable list in Settings (next to Category Mappings), seeded with these 8. AC-D4. |
| G-3 | The owner's SAVED CAREER row is `[business_hours, weekends]` (Q-2). The decision changes only the DEFAULT. | After shipping, the owner's CAREER tasks still land in business hours, which is the opposite of "CAREER = after work". | Ask the owner: also set his saved CAREER row to `[after_work, weekends]`? AC-B6 holds it unchanged until he says yes. |
| G-4 | Ambiguous titles: "Prepare slides for client meeting" (no client named; a live prompt example at ai-task-parser:297); "Take a Power BI course on Coursera" (JOB tool vs self-paced learning). | Two readings, two categories. | Client unnamed: JOB (employer is the default home for work). Course: EDUCATION. E-22 stays unscored until ruled. |
| G-5 | PERSONAL schedules as LIFE (`defaultStatus 'LIFE'`), and EDUCATION is the sibling of PROF_EDUCATION; the keyword lanes say LIFE and PROF_EDUCATION. | The literal gate makes "Go to the mall" (PERSONAL) and "Finish homework" (EDUCATION) lose their keyword windows, which is a change for non-JOB categories that the owner said must not change. | Treat PERSONAL as LIFE, and EDUCATION as PROF_EDUCATION, for gating only (an alias table in the shared module). Flip S-4 and S-19 if adopted. |
| G-6 | `extractSchedulingContext` applies keywords ONLY when the category has no mapping (schedulingService.ts:327). | Under the gate, an uncategorised task would match no category-lane keyword at all, so almost every keyword goes dead on that path. | Ungated on that path (category unknown means "apply as today"). AC-C16 currently says the opposite; it flips on this ruling. **Real fork: needs an answer.** |
| G-7 | LIFE-lane keywords (dinner, lunch, doctor, family, social) will no longer steer JOB/CAREER/VENTURES tasks. | "Dinner with the Trinnex team" (JOB) moves from evening to business hours (S-22). | Show the owner S-22. If unwanted, set those keywords' lane to "No category" in Settings; no code change needed. |
| G-8 | Voice `normalizeCategory` maps `job`->CAREER, `PROF_EDUCATION`->EDUCATION, `homework`->CAREER (RealtimeVoiceAssistant.ts:1499-1522). | Voice-created JOB tasks would be filed CAREER. | Exact-key match first; `work`->JOB; `homework`->PROF_EDUCATION; `job search`->CAREER; `networking` left to the LLM (not mapped by substring). |
| G-9 | The Settings lane is free text today; stored values could be any case. | A case-sensitive compare would treat `job` as a non-category and leave it ungated (S-18). | Trim and upper-case before comparing. |
| G-10 | No field records who set a task's category (grep: none). | AC-D14 (manual change kept) cannot be enforced without one. | A boolean in the existing `scheduling_context` jsonb (`category_set_by: 'owner'`), avoiding a schema change. A column is cleaner if the owner prefers. |
| G-11 | Where JOB appears in lists, its label, and whether it gets its own board tab. | AC-E5, E6, F4 need a position. | Label "Job", placed directly before Career, with its own board tab placed before Career. |
| G-12 | The Huddle `CATEGORY_OWNER` has no JOB (ceremonies.ts:21-30); CAREER goes to cole-blake. | JOB standup items would go to iris-chase (the fallback). | cole-blake owns JOB; CAREER needs its own ruling. |
| G-13 | `categoryMappings.*.defaultStatus` holds a `task_status` value, but `task_status` has no JOB (and no EDUCATION; the owner's saved EDUCATION row uses `EDUCATION`, F-15). | A `defaultStatus: 'JOB'` would fail the enum wherever it is written. | JOB `defaultStatus = 'BACKLOG'`. Do NOT add JOB to `task_status`. Settings > Board Lane becomes a status Select so typos cannot be saved. |
| G-14 | Today QC uses hard-coded hour buckets (after_work 17-19), ignores active windows, and flags on any matching keyword (F-9). | Making QC "follow the same rule" (AC-C6..C8) changes QC warnings for every category, not just JOB. | Accept it: QC exists to check the scheduler, and a QC that disagrees with the scheduler raises false warnings. |
| G-15 | Keyword matching is plain substring, and the code comment claims word boundaries (NSB:228). | `network`->work, `recall`->call, `context`->text over-match within the same category (S-6, S-8). The owner said keep keywords, not re-tokenise. | Keep substring matching. Fix the misleading comment only. |
| G-16 | `smart-calendar-scheduler` rebuilds the user config from 4 hard-coded keys (F-19); `src/lib/timeWindows.ts` and `call-context-builder.ts` hold further category->window tables (F-20) that ignore saved rows. | JOB would be dropped or mis-windowed on those paths (AC-B7, B8). | All of them read through the shared resolver. |
| G-17 | The 5 rows to move are all DONE (Q-4). | Moving them changes history and display only; no scheduling effect. That is fine, but it is not a live test of JOB scheduling. | Keep the move; prove JOB scheduling with a `Test-` task (AC-B5). |
| G-18 | The brief says "~43 files"; this read measured 40 `.ts/.tsx` files containing `VENTURES` (including tests, types and a `.backup.ts`), plus SQL migrations, plus the CSS/Tailwind tokens. | The AC-E1 grep is the real inventory; the count is an estimate. | Use the AC-E1 grep, not a number. |
| G-19 | `ItineraryEngine.extractSchedulingContext` sends VENTURES and business words to `business_hours` (ItineraryEngine.ts:415); `ai-task-parser` has its own hard-coded hint table (:21-39). | Two more scheduling heuristics outside the config, neither category-aware. | Out of scope; recorded so nobody assumes they follow the gate. |

Status: COMPLETE (written cold, 2026-11-03). Owner ruling of 2026-11-03 (SDLC defaults to JOB; manual re-file kept) is incorporated in E-21, E-27 and AC-D3(c), D14..D17.
