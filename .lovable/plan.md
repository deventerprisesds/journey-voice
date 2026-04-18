

User is right — my prior plan was a band-aid. They want a real itinerary assistant: context-aware, tool-rich, conversational, and grounded in the same data the UI shows. Plus fix the empty AI Response panel for good.

## Pre-flight audit
- Files inspected this round: `DailyReviewModal.tsx`, `useChatAssistant.ts`, `hybrid-assistant-api/index.ts`, `dailyReviewPipeline.ts`, `execute-tool/index.ts` (tool surface), `RealtimeVoiceAssistant.ts`, `UnifiedVoiceToolHandler.ts`, `_shared/tool-definitions.ts`, `Assignments.tsx`
- Forbidden patterns scan on changed files: none touch `Date.UTC`, `getDay/getHours`, `toISOString().split`, `isToday`, `format(d,'yyyy-MM-dd')`. Calendar/scheduling helpers untouched.
- Memory invoked: `ai-data-integrity-guardrails`, `global-action-confirmation-rule`, `ai-auto-scheduling-guardrails`, `task-priority-scoring-hierarchy`, `validation-and-testing-workflow`, `development-philosophy-root-cause-first`
- Helpers reused (no new ones): `dailyReviewPipeline.buildDailyReviewReasoning`, `execute-tool` action set (already exposes update_task, schedule_task, batch-calendar-scheduler, search/web/weather)
- Memory NOT invoked because not relevant: scheduling-preflight-audit (no scheduling math change), timezone-normalization (no date math), calendar-token-encryption (no OAuth change)

## Root causes (the real ones)

**1. The AI panel is silent / shows nothing.** Two compounding bugs:
- The "MORNING REVIEW CONTEXT" prompt is sent but never persisted to `conversation_messages`, so realtime never echoes it back and the UI's filter (`ts >= openedAtRef.current`) finds nothing to render. Previously you saw "stale" messages because the panel showed the *whole thread* — I scoped it to the session and broke it.
- `hybrid-assistant-api` returns `data.response` only when the model emits a final text turn. When the model calls tools and returns no trailing text, `response` is empty and the placeholder bubble stays blank.

**2. The agent can't reason about the day.** The current prefix is free-text ("today you have X, Y") with no IDs, no scores, no windows, no calendar holds, no assignment URLs, no priority lane state, no nightly-builder rationale. The model has nothing to ground "move this up", "why so high", "why no assignment", "fill that gap" against.

**3. The agent's tools are call-shaped, not itinerary-shaped.** `execute-tool` exposes `update_task`, `create_task`, `schedule_task`, search, web, weather — but no `reschedule_task_to_window`, no `swap_task_order`, no `explain_score`, no `list_pending_assignments`, no `find_gap_in_day`. So even with grounding it can't do half of what you'd ask.

## The plan

### Part A — Build a real "Day Context" snapshot (the AI sees what you see)

Create `src/utils/buildDayContext.ts` and a server mirror `supabase/functions/_shared/build-day-context.ts`. Both produce one structured JSON the modal sends with every chat turn:

```
{
  date, timezone, currentWindow,
  schedule: [{ id, title, start, end, window, score, scoreBreakdown, source, externalEventId? }],
  gaps: [{ start, end, durationMin, eligibleWindows }],
  priorityLane: [{ id, title, rank, scheduled }],
  rolledOver: [...], overdue: [...], backlogOverdue: [...],
  pendingAssignments: [{ id, title, dueDate, programId, url, hasLinkedTask }],
  calendarHolds: [{ start, end, title, calendar }],
  nightlyBuilder: { ranAt, version, decisions: [...] }, // from activity_log
  windowSummaries: [...], explanations: [...]  // already produced by dailyReviewPipeline
}
```

This is the **same object** rendered in the modal *and* sent to the model. One source of truth.

### Part B — Expand the agent toolbelt

Add to `execute-tool` (and surface in `_shared/tool-definitions.ts` so voice gets them too):
- `reschedule_task` — `{taskId, targetWindow|targetTime, reason}` → calls batch-calendar-scheduler with a single-task payload, respects buffer/window rules (memory: scheduling-buffer, scheduling-window-validation)
- `swap_task_order` — `{taskIdA, taskIdB}` for same-day reorder
- `move_task_to_day` — `{taskId, date, window?}`
- `explain_task_score` — `{taskId}` → returns scoreBreakdown from `task-priority-scoring-hierarchy` 
- `list_pending_assignments` — `{programId?, dueWithinDays?}`
- `find_open_slots` — `{date, minDurationMin, window?}`
- `set_priority_rank` — `{taskId, rank}` (priority lane, memory: explicit-user-priority-system)
- `quick_create_task` — `{title, window?, date?, durationMin?, category?}` for "I need to call John today"

Every state-changing tool follows the **global confirmation rule** (memory): the agent must summarize the action and ask "Confirm?" before dispatch. Read-only tools (`explain_*`, `list_*`, `find_*`) execute immediately.

### Part C — Rewrite the system prompt for itinerary mode

In `hybrid-assistant-api`, when the request's `context.interface === 'daily_review'`, swap to a new system prompt:
- Persona: itinerary copilot, not generic chat
- Knowledge anchor: "The DAY_CONTEXT JSON below is the single source of truth. Never invent tasks, scores, gaps, or assignments not in it." (memory: ai-data-integrity-guardrails)
- Capability statement: enumerate the new tools with one-line use cases
- Behavioral rules: confirm before mutations; if user says "why X" use `explain_task_score`/scoreBreakdown; if "fill the gap" use `find_open_slots` then propose; if "add task" use `quick_create_task` with confirmation
- Auto-scheduling guardrail (memory: ai-auto-scheduling-guardrails): vague timeframes → auto_schedule, no clarifying time question
- Output contract: ALWAYS emit a final text turn after tool calls so `data.response` is never empty

Also write a new doc `docs/AI_ITINERARY_ASSISTANT.md` capturing this contract — referenced as a preflight memory entry so future plans don't regress it.

### Part D — Fix the panel (so it never silently swallows replies)

In `useChatAssistant.sendMessage` and `DailyReviewModal`:
1. Persist the morning-review user message to `conversation_messages` (same path as a typed message). It will then echo via realtime and render correctly.
2. Show the in-flight "Iris is thinking…" bubble inside the modal panel itself (not just in the global chat).
3. If `hybrid-assistant-api` returns empty `response` AND tool calls happened, synthesize a fallback line from the tool results ("Marked 2 tasks done · Rescheduled 'Email professor' to 7 PM"). Never render an empty bubble.
4. Surface errors with `sonner` toast + an inline retry button.
5. Replay-on-open: if the user reopens the modal mid-thread, show the last N=10 messages of *this thread* so context isn't lost — but tag stale ones (>30 min) with a muted timestamp instead of hiding them. This solves the "stale or nothing" oscillation once.

### Part E — Wire the four UX fixes from the prior plan into this larger change

- Modal task rows clickable → `TaskDetailModal` (unchanged from prior plan)
- Assignment external-link icon on every `Assignments.tsx` card (unchanged)
- Backfill migration: `UPDATE tasks SET assignment_url = a.assignment_url FROM assignments a WHERE tasks.assignment_id = a.id AND tasks.assignment_url IS NULL`
- `notification-delivery` filter: drop DONE and ancient (`due_date < today_start_tz AND start_time IS NULL`) before composing the batch push

### Part F — Voice parity

`UnifiedVoiceToolHandler` and `RealtimeVoiceAssistant` already route through `execute-tool`. Once Part B ships, the voice agent inherits every new tool automatically. No additional work — but verify by asking Iris over voice "why is X scored so high" and confirming `explain_task_score` fires.

## Files to change
- New: `src/utils/buildDayContext.ts`, `supabase/functions/_shared/build-day-context.ts`, `docs/AI_ITINERARY_ASSISTANT.md`
- New migration: backfill `tasks.assignment_url`
- `src/components/DailyReviewModal.tsx` — clickable rows, in-modal AI bubble, fallback synth, retry, replay-last-10
- `src/hooks/useChatAssistant.ts` — persist morning context message, send DAY_CONTEXT payload, fallback synth
- `supabase/functions/hybrid-assistant-api/index.ts` — itinerary system prompt branch, always emit final text turn
- `supabase/functions/execute-tool/index.ts` — add 8 new tool handlers
- `supabase/functions/_shared/tool-definitions.ts` — declare new tools so voice/realtime sees them
- `src/pages/Assignments.tsx` — external-link icon
- `supabase/functions/notification-delivery/index.ts` — filter DONE + ancient

## Verification (verify-then-report, Dev User `a3378f93-…` only)
- Open Daily Review → confirm DAY_CONTEXT JSON in network payload to `hybrid-assistant-api` includes `schedule[]`, `gaps[]`, `pendingAssignments[]`, `priorityLane[]`
- Type "why is task X scored so high" → confirm `explain_task_score` tool call in edge logs, final text turn rendered
- Type "move the email to professor to morning" → confirm tool call + confirmation prompt + reschedule succeeds; calendar event updated (memory: calendar-reschedule-sync-integrity)
- Type "I need to call John today" → confirm `quick_create_task` proposal + confirmation
- Reopen modal 2 min later → confirm last 10 messages render
- Reopen modal next day → confirm prior day messages render with muted "yesterday 9:14 AM" stamp, not hidden
- Run `SELECT count(*) FROM tasks t JOIN assignments a ON a.id=t.assignment_id WHERE a.assignment_url IS NOT NULL AND t.assignment_url IS NULL` → expect 0 after backfill
- Voice: ask "why is X so high" → confirm same tool fires

## Stop conditions
- Any new tool returns success but the underlying data didn't change → halt, do not ship the tool, log full payload to `activity_log`
- DAY_CONTEXT payload exceeds 12KB on dev user → halt and add summarization tier
- `hybrid-assistant-api` still returns empty `response` after Part C → halt deploy of Part D fallback synth (means deeper bug; investigate before shipping a synth that hides it)

## Open question (one)
For destructive/state-changing tools the agent calls (reschedule, create, set rank), do you want:
- **(a)** Inline confirm: agent says "I'll move Email Prof to 7 PM tonight — confirm?" and waits for "yes"/"no" in the same chat (slower, safer, matches global-action-confirmation-rule)
- **(b)** Optimistic with undo: agent executes immediately and surfaces a toast with "Undo" for 8 seconds (faster, you've said you trust Iris on routine moves)

I'll default to **(a)** unless you say otherwise — it matches the existing memory rule.

