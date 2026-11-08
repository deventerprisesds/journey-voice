# FINDINGS — Iris bulk "several priorities" message: who made the 40 journey tasks, who picked each category, why duplicates, why Iris said "only one added"

# WHAT:       diagnosis of the 2026-11-07 14:38Z Huddle 1:1 (dm-iris-chase) turn u-1794062312621 — a 23-line priority list that produced 40 journey tasks with mixed categories (JOB/LIFE/CAREER/VENTURES), and Iris's false 15:23Z recap.
# WHY:        owner: all 23 were work (Trinnex) tasks, yet they were filed across four categories, duplicated ~17 times with paraphrased titles, and Iris then claimed only one task was added.
# SUPERSEDES: nothing. Builds on (does not repeat) docs/qc-evidence/AC-job-category.md (category assigner table C-1..C-12) and EVAL-job-category-live-2026-11-04.md.
# SUPERSEDED-BY: nothing -- current
# EVIDENCE:   origin/main journey-voice 3c5aee4, huddle-extension-app e0628702 (fetched 2026-11-08); live Supabase wwxgajrtmslzklnyplah read-only SELECTs; huddle azure-pg-query.yml runs cited inline.

Labels: **OBSERVED (O)** = read from code/git/live DB in this pass, cited. **INFERRED (I)** = reasoning from those facts.
Diagnosis only. No production code, no deploy, no DB writes.

Status: IN PROGRESS

---

## 0. Correction to the brief's facts (OBSERVED, journey live, read 2026-11-08 ~12:55Z)

- **43 rows, not 40**, in 5 bursts: 14:39:26-29 (23), 14:40:35 (3), 14:41:54 (2), 14:42:23 (2), 15:25:01-03 (13). Query: `select id, created_at, category, status, title from tasks where user_id='a3378f93-...' and created_at between '2026-11-07 14:30Z' and '16:00Z'`.
- **Every one of the 43 reads `category=JOB` TODAY.** The mixed categories in the brief are the values AT CREATION, preserved in `activity_log` (`activity_type='task_created'`, `metadata.category`): of the first 23, **15 JOB, 2 LIFE** ("Hang my panel on the wall", "Clean my office"), **1 CAREER** ("Update my LinkedIn job history and certificates"), **5 VENTURES** ("Create two Trinnex images: About page and profile", "Integrate Huddle with my diagram builder app", "Create a Trinnex slide template for Claude and Copilot", "Sign up for Aha! and create initial strategies", "Sign up for an Esri developer account"). All 20 follow-on rows were created as JOB.
- The rows were re-categorized LATER: `tasks.updated_at` clusters at 11-07 19:29-19:32Z, 11-08 05:02-05:03Z (the nightly builder) and **11-08 12:51:48-12:52:16Z (9 rows)**. `user_scheduling_prefs.updated_at` = 11-08 12:47Z. Who did this is not established here (another session or the owner). The 11-07 state of the keyword name-hints is therefore NOT readable now (see 1d).

## 1. Which code path created the tasks, and who chose each category

### 1a. OBSERVED: the path is journey `parse_and_create_tasks` → `ai-task-parser`
- Every `task_created` row in `activity_log` carries `stage='parse_and_create'`. Only one writer sets that: journey `supabase/functions/execute-tool/index.ts:2000-2007` (fire-and-forget insert inside `parseAndCreateTasks`, defined at `:1753`, dispatched at `:404`).
- The Huddle caller is `createBatchTasksFromTool` (`create_huddle_tasks` tool) in huddle `src/features/huddle/lib/huddle.functions.ts:3188-3320`. It calls `invokeJourneyTool({ toolName: "parse_and_create_tasks", args: { text: survivors.join("\n"), auto_schedule: true, target_date? } })` at `:3236-3245`. **It passes no category and no context** — just the newline-joined task titles that survived Huddle's own dedup.
- `parseAndCreateTasks` forwards `text` unchanged to `ai-task-parser` with `mode:'multiple'` (`execute-tool/index.ts:1810-1828`) and inserts each parsed task with `category: normalizeCategory(task.category)` (`:1895`). `normalizeCategory` (`_shared/categories.ts:87`) maps an exact enum name to itself, so it passes the model's value straight through.
- Not journey's own Iris, not a classifier: `classify-task-topic` reads the category, it does not write it (AC-job-category.md C-6).

### 1b. OBSERVED: the chooser is ONE gpt-4o-mini call over the whole batch
- `ai-task-parser/index.ts:336-344`: `model:'gpt-4o-mini'`, `temperature:0.1`, messages = `[system: systemPrompt, user: text]`. In multiple mode the `text` is all 23 titles in a single user message, and the model returns one category per task.
- What the chooser sees:
  | input | source | present on 11-07? |
  |---|---|---|
  | the 23 titles, newline-joined | huddle `huddle.functions.ts:3240` | yes |
  | the owner's preface "I have several priorities I need to work on today." | — | **no**: Huddle sends only the entries `splitTaskEntries` extracted from the model's tool args |
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
