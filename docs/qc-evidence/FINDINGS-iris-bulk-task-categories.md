# FINDINGS — Iris bulk "several priorities" message: who made the 40 journey tasks, who picked each category, why duplicates, why Iris said "only one added"

# WHAT:       diagnosis of the 2026-11-07 14:38Z Huddle 1:1 (dm-iris-chase) turn u-1794062312621 — a 23-line priority list that produced 40 journey tasks with mixed categories (JOB/LIFE/CAREER/VENTURES), and Iris's false 15:23Z recap.
# WHY:        owner: all 23 were work (Trinnex) tasks, yet they were filed across four categories, duplicated ~17 times with paraphrased titles, and Iris then claimed only one task was added.
# SUPERSEDES: nothing. Builds on (does not repeat) docs/qc-evidence/AC-job-category.md (category assigner table C-1..C-12) and EVAL-job-category-live-2026-11-04.md.
# SUPERSEDED-BY: nothing -- current
# EVIDENCE:   origin/main journey-voice 3c5aee4, huddle-extension-app e0628702 (fetched 2026-11-08); live Supabase wwxgajrtmslzklnyplah read-only SELECTs; huddle azure-pg-query.yml runs cited inline.

Labels: **OBSERVED (O)** = read from code/git/live DB in this pass, cited. **INFERRED (I)** = reasoning from those facts.
Diagnosis only. No production code, no deploy, no DB writes.

Status: COMPLETE 2026-11-08 (sections 0-4)

---

## 0. Correction to the brief's facts (OBSERVED, journey live, read 2026-11-08 ~12:55Z)

- **43 rows, not 40**, in 5 bursts: 14:39:26-29 (23), 14:40:35 (3), 14:41:54 (2), 14:42:23 (2), 15:25:01-03 (13). Query: `select id, created_at, category, status, title from tasks where user_id='a3378f93-...' and created_at between '2026-11-07 14:30Z' and '16:00Z'`.
- **Every one of the 43 reads `category=JOB` TODAY.** The mixed categories in the brief are the values AT CREATION, preserved in `activity_log` (`activity_type='task_created'`, `metadata.category`): of the first 23, **15 JOB, 2 LIFE** ("Hang my panel on the wall", "Clean my office"), **1 CAREER** ("Update my LinkedIn job history and certificates"), **5 VENTURES** ("Create two Trinnex images: About page and profile", "Integrate Huddle with my diagram builder app", "Create a Trinnex slide template for Claude and Copilot", "Sign up for Aha! and create initial strategies", "Sign up for an Esri developer account"). All 20 follow-on rows were created as JOB.
- The rows were re-categorized LATER: `tasks.updated_at` clusters at 11-07 19:29-19:32Z, 11-08 05:02-05:03Z (the nightly builder) and **11-08 12:51:48-12:52:16Z (9 rows)**. `user_scheduling_prefs.updated_at` = 11-08 12:47Z. Who did this is not established here (another session or the owner). The 11-07 state of the keyword name-hints is therefore NOT readable now (see 1d).

## 1. Which code path created the tasks, and who chose each category

### 1a. OBSERVED: the path is journey `parse_and_create_tasks` → `ai-task-parser`
- Every `task_created` row in `activity_log` carries `stage='parse_and_create'`. Only one writer sets that: journey `supabase/functions/execute-tool/index.ts:2000-2007` (fire-and-forget insert inside `parseAndCreateTasks`, defined at `:1753`, dispatched at `:404`).
- The Huddle caller is `createBatchTasksFromTool` (`create_huddle_tasks` tool) in huddle `src/features/huddle/lib/huddle.functions.ts:3190-3320`, or Iris's raw `parse_and_create_tasks` catalog call screened by `guardRawJourneyCreate` (`:2864`). Both reach the same journey call. Huddle's record of WHICH one was used is gone, because the timed-out attempts' `toolUses` were discarded (section 2). It calls `invokeJourneyTool({ toolName: "parse_and_create_tasks", args: { text: survivors.join("\n"), auto_schedule: true, target_date? } })` at `:3236-3245`. **It passes no category and no context** — just the newline-joined task titles that survived Huddle's own dedup.
- `parseAndCreateTasks` forwards `text` unchanged to `ai-task-parser` with `mode:'multiple'` (`execute-tool/index.ts:1810-1828`) and inserts each parsed task with `category: normalizeCategory(task.category)` (`:1895`). `normalizeCategory` (`_shared/categories.ts:87`) maps an exact enum name to itself, so it passes the model's value straight through.
- Not journey's own Iris, not a classifier: `classify-task-topic` reads the category, it does not write it (AC-job-category.md C-6).

### 1b. OBSERVED: the chooser is ONE gpt-4o-mini call over the whole batch
- `ai-task-parser/index.ts:336-344`: `model:'gpt-4o-mini'`, `temperature:0.1`, messages = `[system: systemPrompt, user: text]`. In multiple mode the `text` is all 23 titles in a single user message, and the model returns one category per task.
- What the chooser sees:
  | input | source | present on 11-07? |
  |---|---|---|
  | the 23 titles, newline-joined | huddle `huddle.functions.ts:3240` | yes |
  | the owner's preface "I have several priorities I need to work on today." | — | **no**. OBSERVED in journey's edge log: call 1's input (14:38:55Z) starts `"Measure my panel\nDevelop my panel\n…"`, with no preface |
  | the employer | `profiles.company`, read `.eq('user_id', userId)` at `ai-task-parser/index.ts:108`; `Trinnex`, updated 2026-11-04 16:48Z | yes (read is valid: `profiles` has a `user_id` column, and the row is found) |
  | the owner's name hints (Flexible keyword rows with a category lane) | `user_scheduling_prefs.config.contextRules.keywords`, `:109`, rendered by `_shared/category-guide.ts` `buildCategoryGuide` | today: `trinnex/esri/arcgis/sdlc/power_bi → JOB`, `huddle/nexus/boost/taskos/compass/prompto/sidecar/howard_county → VENTURES`. **11-07 state unknown** (prefs rewritten 11-08 12:47Z) |
  | the Huddle conversation, the Executive Profile, Huddle memory (`rag_chunks`, which knows Trinnex is the employer) | — | **no**. Nothing in Huddle or journey passes any of it to the parser |

### 1c. INFERRED: why five titles were mis-filed
- **"Create two Trinnex images…" and "Create a Trinnex slide template…" → VENTURES, despite employer=Trinnex in the prompt.** The single-title live eval passed (`EVAL-job-category-live-2026-11-04.md`: "Submit Trinnex timesheet" and "Reply to Trinnex client…" were JOB 3/3). That eval calls the parser **one title per call**. The 11-07 call put 23 titles in one gpt-4o-mini completion, where the per-item attention to the briefing is weaker. Nothing tests that batch shape. Confidence medium; it would be confirmed by replaying the same 23-line text through `ai-task-parser` (read-only, parse path) and comparing per-title results against single-title calls.
- **"Integrate Huddle with my diagram builder app" → VENTURES** follows the owner's own rules: `huddle` is a VENTURES name hint today, and rule 1 of `buildCategoryGuide` says a named own product is VENTURES. That is the classifier obeying the configuration. The owner's position that it was work does not match the configuration.
- **"Update my LinkedIn job history and certificates" → CAREER** follows rule 4 (LinkedIn → CAREER, `category-guide.ts`). Same situation: the rule fired as written.
- **"Hang my panel on the wall", "Clean my office" → LIFE**: the titles alone read as household. The one signal that they were work, the preface "priorities I need to work on today", was dropped by Huddle before the call (1b).
- **"Sign up for Aha!…", "Sign up for an Esri developer account" → VENTURES**: if the `esri → JOB` hint existed on 11-07, this is the same batch-dilution miss as Trinnex. If it was added today at 12:47Z, the model had no hint to follow. Not decidable from current data.

### 1d. Smallest fix location (describe only)
- **Context, in Huddle:** `createBatchTasksFromTool` (`huddle.functions.ts:3236-3245`) already owns the call. It could pass a batch-level category when the user's message states one, or pass the user's preface along. journey `parse_and_create_tasks` would need a matching optional arg (`category` default / `context`), threaded into the `ai-task-parser` body at `execute-tool/index.ts:1818-1826` and into the prompt beside `categoryGuide` (`ai-task-parser/index.ts:120`, `:240`). That extends the existing parser; no new classifier.
- **Batch accuracy, in journey:** keep one parser, but either classify category per title (reuse the same `buildCategoryGuide` prompt that passed the single-title eval) or add the 23-line batch to `eval-job-category.yml` so the batch shape is measured. The existing eval is the guard to extend.
- **Rule conflicts (LinkedIn, Huddle):** these are configuration, not code. The owner changes them in Settings > Keyword rules (a `linkedin` Flexible→JOB row would conflict with rule 4's CAREER default; the owner has to rule which one wins).

## 2. Why 43 rows for 23 items

### 2a. OBSERVED: the journey calls, from journey's edge-function log (`query_logs`, `[PARSE_AND_CREATE] Input/Parsed`)
Turn `u-1794062312621` (created 14:38:32.6Z, `chunks=6`). Its six `fallbacks` timestamps decode to timeouts at 14:39:13.0, 14:39:53.2, 14:40:33.4, 14:41:13.6, 14:41:53.7 and 14:42:34.0, about 40.2s apart.

| # | journey call input logged | lines sent | parsed | rows inserted | inside attempt |
|---|---|---|---|---|---|
| 1 | 14:38:55.8 | the 23 owner lines, verbatim, no preface | 23 at 14:39:26.6 (a 31s parse) | **23** at 14:39:26-29 | 1 (timed out 14:39:13, **before** the parse finished) |
| 2 | 14:39:41.0 | 11 paraphrases ("Create two Trinnex images: one for the About page and one for the Profile", …) | 11 at 14:39:58.7 | **0**: every insert failed `22P02 invalid input value for enum task_priority: "BACKLOG"` | 2 |
| 3 | 14:40:04.7 | 3 paraphrases, `target_date: today` | 3 | **3** at 14:40:35 | 3 (timed out 14:40:33) |
| — | none logged | — | — | — | 4 |
| 4 | 14:41:34.1 | 2 paraphrases | 2 | **2** at 14:41:54 | 5 |
| 5 | 14:42:03.6 | 2 paraphrases | 2 | **2** at 14:42:23 | 6 |
| 6 | 15:24:41.9 (turn `u-1794065068517`, "How can we get the schedule updated with these as the priority?") | `"Make these priority tasks and schedule them … Avoid creating duplicates of tasks that already exist: Measure my panel\ncreate two Trinnex images, one for…"` + 12 more | 13 | **13** at 15:25:01-04 (priority HIGH, `is_priority`) | 1 of that turn (timed out 15:25:08.7; 5 timeouts in all) |

23 + 3 + 2 + 2 + 13 = 43. The parser also REWRITES titles: the stored titles differ from the lines Huddle sent (e.g. sent "Prepare intro scripts for intro meetings, including questions", stored "Prepare intro scripts for meetings").

### 2b. OBSERVED: the code that makes a timed-out attempt re-run its tool calls
- A 1:1 agent gets `budgetMs = 40_000` (`huddle.functions.ts:7196`). On expiry `runBounded` aborts the controller and resolves a synthetic result with **`toolUses: []`, `journeyTaskUpdates: []`**, outcome `skip, timedOut:true` (`:7205-7236`). The in-flight journey HTTP call is not cancelled server-side. Attempt 1's 23 rows landed 13s after its abort.
- `mergeAgentResult` re-queues a timed-out agent: `if (outcome.timedOut && chunked) queue.push(nextId)` (`:6869`). The next chunk runs Iris again from the same user text. The persisted turn shows no reply and no tool use, so Iris does not know she already created anything.
- Up to `MAX_CHUNKS = 6` (`:731`). That is exactly 6 attempts and 6 fallbacks.
- `ensureNotSilentOnRealWork` (`:7280`) only fires when a successful non-catalog `toolUse` is recorded. Every create happened inside a discarded attempt, so the turn finalized `done` with `replies=[]`, `toolUses=[]`. The owner got the "23 Reminders" push (14:40:02) and an empty chat.

### 2c. INFERRED (high): why every attempt timed out
The 23-title parse alone took 31s (14:38:55.8 → 14:39:26.6), plus ~23s of Iris's model time before the call (turn start 14:38:32.6 → call 14:38:55.8). That is more than the 40s 1:1 budget. With a large batch the attempt cannot finish inside its budget, so the re-queue loop repeats until the chunk cap.

### 2d. Why the dedup layers missed
- **Huddle within-turn ledger** (`createdTaskTitles`, `:1932`, carried across chunks by `buildResumeState` `:7241`) and **cross-turn open-title set** (`loadExistingOpenTitles` `:1953` → `create-task-core.ts:109` `loadOpenTaskTitles`, reading `tasks.journey_tasks` open rows) both compare **exact normalized strings** (`scoring.ts:45-56`: trim, strip trailing punctuation and quotes, lowercase, collapse spaces). OBSERVED consequences:
  - The later calls in turn 1 carried only paraphrases. Every verbatim repeat was removed, which is why calls 3-5 are 2-3 lines long (INFERRED from the shrinking inputs). Paraphrases pass an exact-match check by construction.
  - Huddle compares the model's **pre-parse input line**, while journey stores the parser's **rewritten** title. The two keyspaces never line up.
  - At 15:24 the first `\n`-split entry was the whole instruction sentence ending in "…already exist: Measure my panel" (`splitTaskEntries`, `create-task-core.ts:302-314`, splits on `\n` and `;` only). It cannot equal "measure my panel", although the mirror held exactly that title open (OBSERVED: `tasks.journey_tasks` id 4930e1fa "Measure my panel", UP_NEXT, open). The parser then extracted "Measure my panel" from that sentence and inserted a second copy.
- **journey task-dedup is OFF for this owner.** `runDedup` is called on the PARSED titles (`execute-tool/index.ts:1849`), which is the right keyspace. It has a signature layer (sorted stopword-stripped tokens) and a semantic layer (embeddings, 0.90/0.80). But `resolveDedupConfig` returns `enabled: d.enabled === true` (`_shared/task-dedup.ts:73`), and OBSERVED `user_scheduling_prefs.config->'dedup'` = **null**. `task_dedup_log` has 6 rows for the owner, the latest on 2026-08-25. INFERRED: with it on, "Measure my panel" (exact signature) and most paraphrases (semantic) would have been caught.
- The 15:24 input itself said "Avoid creating duplicates of tasks that already exist". That is prose to a parser that has no dedup instruction and no dedup step while the guard is off.

### 2e. Side findings (OBSERVED, not asked)
- `execute-tool/index.ts:1894` `priority: (task.priority || 'MEDIUM').toUpperCase()` accepts anything the model returns. Call 2's 11 inserts all died on `priority="BACKLOG"`. That accident prevented 11 more duplicates, and the response still went back as a parse result.
- The same log window shows `batch-calendar-scheduler` `RangeError: Invalid time value` in `_shared/timezone.ts:69` (`zonedTimeToUtc`) at 14:39:58.7.
- Turn-1 row `aac514c3` (15:25 "Measure my panel") is NOT in `tasks.journey_tasks`, although the mirror holds 43 rows created in the window. Not investigated.

### 2f. Smallest fix locations (describe only)
1. **Stop the re-run, in Huddle `runBounded`/`mergeAgentResult`** (`huddle.functions.ts:7205-7236`, `:6869`). When an attempt that has already dispatched a mutating tool times out, keep the record of that dispatch and do not re-queue the agent blind. Either carry the dispatched tool uses into the resume state the way `createdTaskTitles` already is (`buildResumeState` `:7241`), or re-queue with a directive naming what was already sent. This extends the existing chunk/resume mechanism. Without it, every slow create can multiply.
2. **Turn on the existing journey dedup** for this owner (`user_scheduling_prefs.config.dedup.enabled = true`, a Settings/config change, no code). It already runs on the parser's output titles with signature and semantic layers, so it covers the keyspace Huddle's exact-match guard cannot. It is opt-in "until verified" (`task-dedup.ts:73`), so verify it first.
3. **Optional, in Huddle:** run `normalizeTaskTitle` comparisons against journey's returned/parsed titles (or call journey's signature function) rather than pre-parse lines. Item 2 makes this largely unnecessary, so prefer 2 over building a second fuzzy matcher in Huddle.

## 3. Why Iris said "only one added" at 15:23

### 3a. OBSERVED
- Turn `u-1794064993010` (15:23:13Z, "Hi, confirm what tasks you added per my request today"): `toolUses` = `tool_catalog`, `schedule_and_priorities` (`view=scheduled count=15`), `get_tasks`. Reply: "I added one new task from your list today: 'Prepare intro scripts for meetings,' scheduled for 11:15 PM EST. … The rest of the priorities you listed were not added."
- Turn `u-1794065041288` (15:24:01Z): no data tools at all (`tool_catalog` only). She listed the items from the conversation history ("25 items"; it is the owner's 23) and repeated "the only one actually added…".
- The persisted turn 1 has `replies=[]`, `toolUses=[]`, `journeyTaskUpdates=[]` (section 2b). The conversation history Iris sees at 15:23 has the owner's list and **no** Iris message, tool trace or created-task list.
- `schedule_and_priorities` `view='scheduled'` returns only tasks "already placed on a day/time" (`tasks/tools.ts:17-40`). At 15:23 only 3 of the 30 rows had a `start_time` (`activity_log` `task_scheduled` 14:40:57Z: 91b5 "Prepare intro scripts for meetings" 23:15Z, ddae 00:30Z, a3d1 01:45Z). The other 27 were unscheduled UP_NEXT rows.
- journey `get_tasks` with no `query` orders by `start_time asc nulls last` and `.limit(50)` (`execute-tool/index.ts:755-757`). It has no `created_at` filter. The owner had 462 tasks then, so the 27 unscheduled new rows are past the 50-row cap. No tool in Iris's catalog answers "what was created today / by me".
- "11:15 PM EST" is 23:15**Z** read as local. The actual time was 6:15 PM EST.

### 3b. INFERRED (high)
Iris answered from the schedule view, which by definition shows scheduled items only, and from an unfiltered `get_tasks` that cannot reach unscheduled rows. She had no memory of creating them, because the chunk driver discarded her own tool record. Of the 3 auto-scheduled new rows, only the 23:15Z one falls on 11-07 if the view's day boundary is UTC. That would explain "one" rather than "three", but it is not confirmed (the tool's output is not persisted).

### 3c. Smallest fix locations (describe only)
- **Primary, same as 2f-1:** keep the dispatched tool uses and `journeyTaskUpdates` of a timed-out attempt in the turn result. Then turn 1 would have ended with a real "created 23" record (and `ensureNotSilentOnRealWork` would have fired). The 15:23 question would also have conversation evidence to answer from.
- **Secondary, journey `get_tasks`:** a `created_since` / `created_today` filter on the existing tool (`execute-tool/index.ts:621`, plus its schema in `_shared/tool-definitions.ts`), so a "what did you add today" question has a tool that can answer it. This extends the existing filters (status/category/time_filter); it is not a new tool.
- The UTC-as-EST time display is a row for the backlog, not part of this fix.

## 4. Root causes (summary)

| symptom | root cause | O / I |
|---|---|---|
| mixed categories | ONE gpt-4o-mini call in `ai-task-parser` categorized all 23 titles together, seeing only the bare titles plus the employer/hints briefing. The owner's "work today" framing was never sent. Two misses (Trinnex → VENTURES) contradict the briefing (batch dilution, I-medium). Three (LinkedIn → CAREER, Huddle → VENTURES, and Esri if the hint existed) follow the owner's own rules/hints as configured. Two (panel, office → LIFE) lacked the dropped context | path O; dilution I |
| 43 rows | a 31s batch parse inside a 40s 1:1 budget → timeout → `runBounded` discards the attempt's tool record while journey still writes → the agent is re-queued and re-creates paraphrases, up to 6 chunks. Huddle's exact-string dedup cannot match paraphrases or a pre-parse sentence. journey's fuzzy dedup exists but is disabled for the owner | O (logs + code + config) |
| "only one added" | Iris's own creates were erased from the turn record, so she had no memory of them. The tools she used read the SCHEDULE (3 scheduled rows) and a 50-row unfiltered `get_tasks`; neither can list unscheduled rows created today | O; the "one vs three" detail I |

Status: COMPLETE 2026-11-08
