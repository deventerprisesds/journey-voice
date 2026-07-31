# Action Tracker — journey-voice
Last updated: 2026-07-29

> Enforced by the session-level `eds-claude-skills` Stop-hook gate (installed at `/root/.claude/`,
> shared with huddle-extension-app — see that repo's `actions.md` ACT-2 for the gate itself).
> Nothing may be claimed "done" without ACs + the `verifier` subagent / observed evidence for
> code changes, or memory.md/actions.md updates for docs/config changes.

## Open

### ACT-J1: No dedicated `.claude/skills/` playbooks in this repo yet
**Status:** open, low priority. huddle-extension-app has `test-agent-serverfn` +
`verify-task-sync` skills for exercising the pipeline from its side; this repo has no scripted
equivalent for verifying its own edge functions (calendar sync, notifications, voice) end to end
— verification here is still ad hoc (workflow dispatch + job-log reads). Not blocking; revisit if
edge-function verification friction becomes a recurring cost.

## Closed

### ACT-J0: `definition_of_done` schema (journey side of the WIP confirm-intent gate)
**Status:** done, verified live. `20260729000000_add_definition_of_done.sql` applied via the
`apply-migration.yml` escape-hatch workflow (Supabase MCP was unauthorized in-session); confirmed
landed with an `information_schema.columns` check through the same workflow. Backs Huddle's
`confirm_task_intent` tool and the review gate — see huddle-extension-app memory for the full
cross-repo flow.

### ACT-J-1: IN_REVIEW task status
**Status:** done, verified live. `20260727000000_add_in_review_task_status.sql` +
`20260727000001_seed_in_review_column.sql`; reflected in `tool-definitions.ts` enums and the
frontend `Task` type/board UI so agent-produced work lands in review, never silently DONE.

### ACT-J-2: Source-app-aware push targeting
**Status:** done, verified live. `execute-tool` gained `register_push_token`; confirmed via
one-shot diagnostic workflows (`verify-push-targeting`, now removed post-verification) that
journey/Huddle push target sets are disjoint — a Huddle push reaches only the Huddle app.

### ACT-J-3: Huddle task-sync outbound pipeline
**Status:** done, verified live (eventually-consistent, polled not assumed-sync).
`notify_huddle_task_sync` trigger + `huddle-task-sync` edge fn → Huddle's `tasks-sync` webhook.
Full facts in this repo's `CLAUDE.md`; live-verify via huddle-extension-app's
`verify-task-sync` skill.
