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

## Progress
- [ ] 1 context arg
- [ ] 2 batch eval + fix
- [ ] 3 priority guard
- [ ] 4 get_tasks created_since
- [ ] 5 dedup replay
- [ ] tests / deno check / mutations / PR
