# FIX — parse_and_create_tasks: request context, batch category accuracy, priority guard, get_tasks created_since, dedup replay

# WHAT:       the fix for the 2026-11-07 Iris bulk-priorities diagnosis: (1) an optional `context` arg on parse_and_create_tasks threaded into ai-task-parser's prompt, (2) batch-dilution measured and fixed, (3) priority mapped onto the task_priority enum, (4) get_tasks `created_since`, (5) an offline+live replay of the 11-07 duplicates through journey's (disabled) dedup.
# WHY:        owner, 2026-11-08: "Fix the problem". 23 work lines were filed across JOB/LIFE/CAREER/VENTURES, 11 inserts died on priority "BACKLOG", and "what did you add today" had no tool that could answer it.
# SUPERSEDES: nothing.
# SUPERSEDED-BY: nothing -- current
# EVIDENCE:   docs/qc-evidence/FINDINGS-iris-bulk-task-categories.md (branch claude_iris-task-category-findings); eval runs cited below; fixture supabase/functions/_shared/fixtures/iris-bulk-2026-11-07.json.

Labels: **O** = observed (run, read, measured). **I** = inferred.
Branch `claude_parse-context-categories` from origin/main 3c5aee4.

## 0. Ground truth gathered (O)
- The 23 owner lines and all 7 journey call inputs, verbatim, from journey's edge log `[PARSE_AND_CREATE] Input` (query_logs 2026-11-07 14:38-15:30Z).
- The 43 stored titles with their category AT CREATION from `activity_log` `task_created`.
- Both saved in `supabase/functions/_shared/fixtures/iris-bulk-2026-11-07.json` (23 lines, 43 stored rows, 20 duplicate→original pairs).
- Side observation: the 15:24 call, whose input BEGAN with an instruction sentence ("Make these priority tasks and schedule them…"), came back 13/13 JOB. The 14:38 call (bare titles) came back 15 JOB / 2 LIFE / 1 CAREER / 5 VENTURES.

- **Correction to FINDINGS 2a/2e (O):** there was a 7th journey call, 15:27:47Z (turn `u-1794065068517` retry), that parsed 6 more paraphrases; all 6 inserts died on `priority="BACKLOG"` too. So the accident blocked **17** duplicate inserts (11 at 14:39:58 + 6 at 15:27:56), not 11. With the priority guard alone, 11-07 would have produced 60 rows, not 43 (see 3 and the PR's "What will no longer be in place").

## Coordinator update, 2026-11-08 (applied)
- Owner turned journey dedup ON (`user_scheduling_prefs.config.dedup = {"enabled":true}`, O: read 13:5xZ). The replay in 5 is now a regression check on the live setting.
- `profiles.company` is now `Trinnex (a CDM Smith company)` (O). The briefing line was `Work for Trinnex (a CDM Smith company) is JOB whether or not "Trinnex (a CDM Smith company)" appears`, which tells the model to look for a string no task contains. Now: `THE OWNER'S EMPLOYER is Trinnex (a CDM Smith company). Work for Trinnex or CDM Smith is JOB whether or not "Trinnex" or "CDM Smith" appears in the task.` (`employerNames`, tests G-8/G-9).
- Owner ruling: "work on" is NOT a work signal. The context block now says only an EXPLICIT framing ("for work", "my work priorities today") covers every line, and names "things I need to work on" as not a framing. The eval gained B-work (explicit framing); the preface variant (B-pref) no longer gates the two lines with no signal.

## 1. `context` arg (O: code + tests)
- Schema: `parse_and_create_tasks.context` (optional string) in `_shared/tool-definitions.ts`.
- `execute-tool` `parseAndCreateTasks`: trims it, logs it in `[PARSE_AND_CREATE] Input`, forwards it as `context` in the ai-task-parser body.
- `ai-task-parser`: reads `context` from the body; `buildRequestContextBlock` (`_shared/category-guide.ts`) renders it right after the category guide, in the SYSTEM prompt (so it can never be parsed into a task), capped at 1000 chars. With no context the prompt is byte-identical to main.
- Huddle already sends it: huddle main #164 `journeyCreateContext(data.text)` → `context` on the batch create. Journey ignored the field until this change.
- Tests PC-1..PC-6.

## 3. Priority guard (O)
- `normalizePriority` + `TASK_PRIORITIES` in `_shared/categories.ts` (PR-2 checks it against the generated `task_priority` enum). The `parseAndCreateTasks` insert uses it: anything outside LOW/MEDIUM/HIGH/URGENT becomes MEDIUM.
- Not changed (backlog rows, same defect class, different semantics): `create_task` insert `args.priority?.toUpperCase()` (execute-tool ~929), `update_task` (~1007) and bulk update (~1083). An UPDATE with a bad priority should keep the old value, not become MEDIUM.

## 4. `get_tasks created_since` (O)
- `resolveCreatedSince` in `_shared/timezone.ts`: 'today'/'yesterday' = local midnight in the user's tz; YYYY-MM-DD = local midnight; offset-less timestamp = local; offset/Z timestamp = exact; anything else = an ERROR returned to the model (never a silent "no filter").
- `getTasks`: `.gte('created_at', …)`, and orders newest-first when set so the 50-row cap keeps the newest rows. On 11-07 at 15:23Z, `created_since:'today'` = `2026-11-07T05:00:00Z`, which covers all 30 rows created that day.
- Tests CS-1..CS-6.

## 5. Dedup replay (O)
**Offline, `_shared/task-dedup-replay.test.ts`** (through `runDedup` with the guard ON, embeddings forced to fail so it is signature-only): call 1's 23 lines → 23 kept, **0 false merges**; repeats → **12 of 37 caught by signature**, each against the line it really restates; 25 need the semantic layer.

**Live, `scripts/replay-task-dedup.mjs`** (workflow `eval-job-category.yml job=dedup-replay`, run 42487131810; report `docs/qc-evidence/REPLAY-task-dedup-2026-11-08.md`): real `text-embedding-3-small`, the live config, against the owner's 62 open tasks created before 14:38Z 11-07 (their CURRENT state, an approximation).

| result | count |
|---|---|
| false merges among the 23 distinct items | **0** |
| wrong-target merges (a repeat skipped as a different item) | **0** |
| repeats skipped, correct target | **23 of 37** |
| repeats created but tagged possible-duplicate (0.80-0.90) | 12 |
| repeats missed (created again, < 0.80) | 2 ("Sign up for Aha!" 0.775; "Walk backwards from 30/60/90 to weekly tasks" 0.722) |
| **call-1 item skipped against an OLDER open task: REVIEW** | 1: "Sign up for an Esri developer account" ~ existing "Sign up for Esri developer account" (signature). It already existed, so this reads as a true catch; it would not have been created. |

INFERRED (high): on 11-07 with dedup ON and the priority guard in place, the board would have had 22 originals (Esri skipped) + 12 flagged + 2 missed = 36 new rows, instead of 43 (or 60 with the guard alone). Dedup cuts the repeats by about two thirds; it does not stop the re-run loop (that is Huddle #164's job).

## Progress
- [x] 1 context arg
- [ ] 2 batch eval + fix
- [x] 3 priority guard
- [x] 4 get_tasks created_since
- [x] 5 dedup replay
- [ ] tests / deno check / mutations / PR
