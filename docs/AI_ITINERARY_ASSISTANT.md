# AI Itinerary Assistant — Contract

The chat assistant exposed in the **Daily Review modal** (and on phone/voice
when the user is reviewing today's plan) is an *itinerary copilot*, not a
generic chat. This document is the source of truth for what the agent can
do, what it must never do, and how grounding works. Future plans must not
regress this contract.

## Grounding: DAY_CONTEXT

Every chat turn dispatched from the Daily Review modal MUST include a
`DAY_CONTEXT` block built by `src/utils/buildDayContext.ts` (mirrored
server-side in `supabase/functions/_shared/build-day-context.ts`). The
modal renders the same object — so the agent literally sees what the user
sees: task IDs, titles, start times, scores, windows, categories, gaps,
calendar holds, the priority lane, rolled-over and overdue tasks, and
pending assignments with URLs.

**Hard rule (memory: ai-data-integrity-guardrails):** The agent must never
fabricate task names, scores, gaps, or assignments. If a task isn't in
DAY_CONTEXT, it doesn't exist for the purposes of the conversation.

## Tools the agent can call

State-changing tools (require user confirmation per
`global-action-confirmation-rule`):

- `update_task` — change status, priority, category, etc. (e.g. mark DONE)
- `reschedule_task` — move to a new date/time, validates window rules
- `schedule_task` — schedule an unscheduled task
- `unschedule_task` — return to backlog
- `move_task_to_day` — convenience for "move this to tomorrow / Friday"
- `swap_task_order` — same-day reorder of two tasks
- `set_priority_rank` — promote / demote on the priority lane
- `quick_create_task` — "I need to call John today" — creates and optionally schedules
- `parse_and_create_tasks` — multi-task NL parse with auto-schedule

Read-only tools (execute immediately, no confirmation):

- `get_tasks`, `get_today_tasks`, `get_tasks_by_topic`
- `explain_task_score` — returns the scoring breakdown for one task
- `list_pending_assignments` — filter by program, dueWithinDays
- `find_open_slots` — return open windows on a given date
- `get_my_config`, `web_search`

## Behavioral rules

1. **Confirm before mutating.** Summarize the proposed action ("I'll move
   *Email Professor* from 9 PM to 7 AM tomorrow — confirm?") and wait for
   explicit yes/no in the same chat. Default mode unless the user has
   opted into optimistic mode.
2. **Explain on demand.** "Why is X scored so high?" → call
   `explain_task_score` with that ID, then narrate the breakdown.
3. **Fill gaps deliberately.** "Fill that gap" / "what could go in the
   morning?" → call `find_open_slots` and propose specific candidates from
   `pendingAssignments` or backlog by score.
4. **Never ask for a specific time.** Per
   `ai-auto-scheduling-guardrails`, vague timeframes (today, this week,
   sometime) trigger `auto_schedule: true` — let the batch scheduler
   place it.
5. **Always emit a final text turn.** Even after tool calls, return a
   natural-language summary so `data.response` is never empty. The chat
   panel will otherwise render an empty bubble.
6. **Cite IDs.** When confirming actions, include the task title — the
   user already trusts that the ID came from DAY_CONTEXT.

## What the agent must NEVER do

- Invent tasks, scores, gaps, calendar events, or assignments not in DAY_CONTEXT
- Skip confirmation on a state-changing tool
- Ask "what time should I schedule it?" — pick a time using
  `find_open_slots` and propose
- Return an empty trailing message after a tool execution
- Touch tasks scheduled by `nightly-schedule-builder` without surfacing
  the change to the user first

## Files involved

| Layer | File |
|------|------|
| Day context (client) | `src/utils/buildDayContext.ts` |
| Day context (server mirror, optional) | `supabase/functions/_shared/build-day-context.ts` |
| Modal | `src/components/DailyReviewModal.tsx` |
| Chat dispatch | `src/hooks/useChatAssistant.ts` |
| API | `supabase/functions/hybrid-assistant-api/index.ts` |
| Tools | `supabase/functions/execute-tool/index.ts` |
| Tool definitions | `supabase/functions/_shared/tool-definitions.ts` |

## Verification checklist

When making changes touching the itinerary assistant, verify on Dev User
`a3378f93-d655-4913-b2fa-ca5b1d8020f1`:

- Open Daily Review → confirm DAY_CONTEXT JSON in network payload includes
  `schedule[]`, `gaps[]`, `pendingAssignments[]`, `priorityLane[]`
- "why is task X scored so high" → `explain_task_score` fires, final text
  turn rendered
- "move email to professor to morning" → `reschedule_task` with confirm
  prompt; calendar event updated
- "I need to call John today" → `quick_create_task` proposal + confirmation
- Reopen modal: prior thread tail visible, stale messages tagged
