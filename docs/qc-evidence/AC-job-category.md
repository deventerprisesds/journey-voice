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

Status: IN PROGRESS (sections appended as written)

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
| F-11 | Default keyword ORDER puts `workout` (morning) before `work` (business_hours), and `work` before `homework` (after_work). So today "Morning workout" -> `workout`->morning; "Finish homework" -> `work`->business_hours (never reaches `homework`); "network" / "Networking event" -> `work`->business_hours; "Recall ..." -> `call`; "Preview ..." -> `review`; "Go to post office" -> `office` (before `post_office`). | `schedulingRules.ts:192-260` + F-7 |
| F-12 | Settings: Category Mappings renders one row per key of `config.categoryMappings`; Board Lane is a free-text `<Input>`; Time Window checkboxes list the six windows. Keyword rows: keyword `<Input>`, window `<Select>` (6 windows), lane free-text `<Input placeholder="Status">`; renaming a keyword deletes and re-adds it, MOVING it to the end of the object (changes first-match order). "Add Keyword" seeds `['flexible','LIFE']`. | `src/components/SchedulingSettings.tsx:521-662`, `:765-866` |
| F-13 | `public.task_category` enum = LIFE, CAREER, VENTURES, EDUCATION, PROF_EDUCATION, PERSONAL. `public.task_status` enum ALSO carries category-named lanes CAREER, PROF_EDUCATION, VENTURES, LIFE (no EDUCATION, no JOB). `categoryMappings.*.defaultStatus` holds a `task_status` value. | `src/integrations/supabase/types.ts:4441-4462`, `:4609-4625` |
| F-14 | `Task.category` and `Task.status` TS unions are hand-written and omit JOB. | `src/types/task.ts:15-16` |
