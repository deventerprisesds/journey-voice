---
name: cleanup-board
description: >-
  Review, present, and (only after explicit user confirmation) remove tasks from the user's real
  board that they did not create or ask for — stray test-harness rows, agent process-narration
  cards ("Groom backlog", "Assign tasks"), and other one-off pollution. Use when the user reports
  their backlog/board looks polluted, after running any test harness that can write real tasks
  (create_huddle_task, delegation-test.mjs, direct public.tasks seeds), or as periodic maintenance.
  NEVER deletes anything without the user confirming the specific rows first.
---

# Clean up the user's board — review, present, confirm, remove

The user's board (`public.tasks`, this project's canonical table) is supposed to contain ONLY
things the user themselves created or explicitly asked to be tracked. Two known pollution sources,
both real incidents (see `.claude/memory.md` here and in huddle-extension-app):

1. **Test-harness writes.** Harnesses that exercise task creation
   (`create_huddle_task`/`quick_create_task`, `delegation-test.mjs`, ad-hoc SQL seeds) run under the
   real caller identity — every task they create lands on the user's REAL board, not a sandbox.
2. **Agent process-narration.** An agent files a card that just restates work it (or another agent)
   was performing — `Groom backlog`, `Assign tasks`, `Review backlog grooming outcomes`. A code-level
   guard in huddle-extension-app now blocks the known capability-trigger phrasing
   (`createSuggestedTaskFromTool`, commit `a9bc974`), but it can't catch every phrasing, and it does
   nothing for rows that predate the fix or arrive through a path other than `create_huddle_task`.

This skill is the safety net for both. **Never skip a step — review, present, confirm, remove, in
that order, every time.**

## Step 1 — REVIEW: read the canonical source directly, not a mirror

`public.tasks` in this project (Supabase project `wwxgajrtmslzklnyplah`) is the canonical source of
truth — huddle-extension-app's `tasks.journey_tasks` is a downstream, one-way mirror. **A clean
mirror does NOT mean clean data** — always query `public.tasks` itself (ground-truth rule: read the
primary source, not a proxy).

If `mcp__Supabase__execute_sql` works in-session, use it directly. If Supabase MCP calls are denied
or require approval, recreate the documented one-shot escape hatch (see this repo's CLAUDE.md
"Supabase project & ops facts"):

```yaml
# .github/workflows/apply-migration.yml — recreate exactly this, use it, then delete it again after
name: Apply Migration / Ad-hoc SQL
on:
  workflow_dispatch:
    inputs:
      sql:
        description: "SQL to run against the live Supabase project (one statement/transaction per dispatch)"
        required: true
        type: string
jobs:
  run-sql:
    runs-on: ubuntu-latest
    steps:
      - name: POST SQL to Supabase Management API
        env:
          SQL: ${{ inputs.sql }}
          TOKEN: ${{ secrets.SUPERBASE_ACCESS_TOKEN }}
        run: |
          set -euo pipefail
          echo "----- QUERY OUTPUT -----"
          curl -sS -w "\nHTTP_STATUS:%{http_code}\n" \
            "https://api.supabase.com/v1/projects/wwxgajrtmslzklnyplah/database/query" \
            -H "Authorization: Bearer ${TOKEN}" \
            -H "Content-Type: application/json" \
            -d "$(python3 -c 'import json,sys,os; print(json.dumps({"query": os.environ["SQL"]}))')"
          echo "----- END QUERY OUTPUT -----"
```
Dispatch with `mcp__github__actions_run_trigger`, poll to completion, read the log with
`mcp__github__get_job_logs` (`return_content: true`). Commit it, use it, then **delete it again** —
this repo's established convention (see CLAUDE.md) is not to leave this workflow sitting in the repo.

**Candidate-detection query** (a starting list, never a delete list):
```sql
SELECT id, title, status, assigned_agent, created_at, updated_at
FROM public.tasks
WHERE status <> 'DONE'
  AND (
    title ILIKE 'test-%'                                              -- explicit test-tagged
    OR title ~* '\y(groom|grooming|assign the|triage|prioritize the backlog|review gate|write-up)\y'  -- agent self-narration patterns
  )
ORDER BY created_at DESC;
```
Also pull a plain recent-activity list (say, last 7-30 days, all statuses except DONE) so you can
eyeball anything odd that doesn't match the patterns above — pollution isn't always test-tagged or
capability-phrased. `Add a poll in Microsoft Teams` (2026-07-31 incident) matched NEITHER pattern; it
was found by the user recognizing it didn't belong, not by a query. **Patterns narrow the search,
they don't replace human review.**

## Step 2 — PRESENT: show the candidates verbatim, with your reasoning

For every candidate, show the user: `id`, `title`, `status`, `assigned_agent`, `created_at`, and
**why it was flagged** (matched the `Test-` prefix / matched a self-narration pattern / just looked
out of place and you're asking). Do not pre-filter down to "the ones you're sure about" — the user
is the actual judge of what belongs on their own board; your job is to surface candidates and reasons,
not to make the final call.

## Step 3 — CONFIRM: wait for an explicit go-ahead on the specific rows

This is a destructive, effectively-irreversible operation (no undo once deleted). **Never delete
without the user confirming which exact rows** — either "yes to all of these" over a list you just
showed, or a subset they name. If the user says "that one's real, leave it," honor it exactly — do
not re-suggest it next pass without new evidence.

## Step 4 — REMOVE: delete from the canonical table only

```sql
DELETE FROM public.tasks WHERE id IN ('<uuid1>', '<uuid2>', ...) RETURNING id, title;
```
Deleting from `public.tasks` is sufficient — the existing `notify_huddle_task_sync` trigger fires on
DELETE too, so huddle-extension-app's mirror (`tasks.journey_tasks`) picks up the removal
automatically (allow the usual ~1-3s `pg_net` async lag before treating a mirror row as stale).
**Never delete directly from the Huddle mirror** — it's a single-writer read-model; a row deleted
there just gets re-created on the next unrelated sync of that same journey row, or drifts out of
sync for no real gain.

Log the `RETURNING` output as evidence of exactly what was removed.

## After cleanup: remove the temporary workflow again

If you recreated `apply-migration.yml` for this pass, delete it once you're done (commit + push),
matching this repo's established one-shot convention — don't leave a raw-SQL-over-management-API
workflow sitting in the repo as standing attack surface.

## Related
- **huddle-extension-app CLAUDE.md** "Test-task naming convention" — the same hard rule, mirrored.
- **huddle-extension-app `.claude/actions.md` ACT-huddle-8** — the deeper fix (agents get their own
  separate work-tracking table so they stop generating pollution candidates in the first place).
  This skill is the safety net for whatever gets through anyway, not a substitute for that fix.
- **huddle-extension-app commit `a9bc974`** — the code-level guard that blocks the known
  self-narration capability-trigger phrasing at creation time. This skill catches what that guard
  doesn't (pre-existing rows, other phrasings, non-`create_huddle_task` write paths).
