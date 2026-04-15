

# Daily Review Modal with Schedule Summary and Reasoning

## What it does

When you open Focus View and today's schedule hasn't been confirmed, a full-screen sheet appears showing:

1. **Morning greeting** with stats: tasks confirmed yesterday, carried over, overdue count
2. **Schedule reasoning summary** — a human-readable explanation of WHY each task landed where it did, pulled from the nightly builder's scoring data (via `activity_log` and `scheduling_context`). If assignments, external events, or entire time windows are missing, it explains why (e.g., "No EDUCATION tasks scheduled — all assignments are due after this week" or "Evening window empty — no LIFE/PERSONAL tasks in candidate pool")
3. **Today's Plan** — compact task list with per-item status badges: Confirmed (already scheduled), Schedule (needs a time), Blocked (dependencies unmet)
4. **Auto-Scheduled from Backlog** — items the nightly builder pulled in, with their scores shown
5. **Inline chat** at the bottom — type natural language corrections processed via `useChatAssistant` (reuses existing hook, same tools)
6. **Two action buttons**: "Confirm & Fill Gaps" (runs `nightly-schedule-builder` singleDay, writes confirmation date) and "Skip"

## Reuse map

| Existing piece | How it's reused |
|---|---|
| `activity_log` table (`nightly_schedule_built` entries) | Source for reasoning summary — already stores `week_results`, rolled-over count, archived count |
| `scheduling_context` on each task | Already stores `pre_schedule_status` — will check if task was auto-added vs user-created |
| `nightly-schedule-builder` (singleDay mode) | Called by "Confirm & Fill Gaps" — same as existing "Reschedule Today" button |
| `useChatAssistant` hook | Powers inline corrections — no changes needed |
| `selectSchedulingCandidates` / `scoreSchedulingCandidate` | Used client-side to show scores for unscheduled tasks in the review |
| `notification_prefs` table | Stores `schedule_confirmed_date` (one new column) |

## Database migration

Add one column to `notification_prefs`:

```sql
ALTER TABLE public.notification_prefs
ADD COLUMN IF NOT EXISTS schedule_confirmed_date text DEFAULT '';
```

## New component: `DailyReviewModal.tsx`

**Trigger**: FocusView checks `notification_prefs.schedule_confirmed_date` on mount. If it doesn't match today's date string, the modal opens.

**Data it gathers** (all from existing queries/tables):
- `activity_log` where `activity_type = 'nightly_schedule_built'` and `user_id` matches, most recent — extracts `metadata.rolled_over`, `metadata.archived_stale`, `metadata.week_results[todayISO]`
- Today's scheduled tasks (already in FocusView props)
- Today's external calendar events (already loaded in FocusView)
- Unscheduled candidates with scores (via `selectSchedulingCandidates` from existing lib)
- Overdue task count (tasks with `due_date < today` and status != DONE)

**Reasoning summary generation** (client-side, from existing data):
- "X tasks were rolled over from yesterday (pushed count increased)"
- "Y tasks auto-scheduled based on priority scoring — top scorer: [title] (score: N, reason: urgent + due soon)"
- "Morning window: 2 tasks filling 90/120 min capacity"
- "Evening window: empty — no LIFE/PERSONAL tasks in candidate pool"
- "No assignment tasks scheduled — next assignment due [date]"
- "Z external calendar events blocking [total] minutes"

**Inline chat**: Renders a simplified chat input using `useChatAssistant`. User types corrections, AI applies them via existing `parse_and_create_tasks`, `reschedule_task`, `delete_task` tools.

**Confirm action**: Invokes `nightly-schedule-builder` with `{ singleDay: true, userId }`, then updates `notification_prefs.schedule_confirmed_date` to today's date string, closes modal.

## Files changed

| File | Change |
|---|---|
| `notification_prefs` (migration) | Add `schedule_confirmed_date` column |
| `src/components/DailyReviewModal.tsx` | New: full review modal with summary, reasoning, task list, inline chat |
| `src/components/FocusView.tsx` | Import and render `DailyReviewModal`; pass tasks, external events, onTaskUpdate |

No new edge functions. No new tables. Scoring logic already exists in both the edge function and the client-side `schedulingCandidates.ts`.

