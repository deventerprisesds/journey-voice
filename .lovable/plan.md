

# Fix Build Error + Ensure All Tasks Get Mapped + Add `is_priority` Scoring

## Build Error Fix

**`src/pages/Assignments.tsx` line 483-487**: The `updates` object from `TaskDetailModal.onSave` contains client-only fields (`checklist_items`, `assignment_url`, `scheduling_context`) that Supabase rejects. Fix by destructuring out non-DB fields before the `.update()` call.

## Current Mapping Gap — Confirmed

Tasks are only classified into topic groups when the user visits the Priorities page:
- **Auto-classify on load**: classifies up to 10 unmapped tasks per visit
- **Manual "Classify All" button**: handles the rest on demand
- **No background classification**: tasks created via Kanban, voice, quick input, or assignment sync stay unmapped until a Priorities page visit

This means a large number of tasks can sit unmapped indefinitely if the user doesn't visit Priorities regularly.

## Fix: Auto-classify on task creation/update

The `classify-task-topic` edge function already exists and handles single-task classification. The fix is to call it automatically when tasks are created or updated — not just from the Priorities page. This can be done via a Supabase database webhook trigger on the `tasks` table for INSERT and UPDATE operations, which already partially exists but needs to be verified and enabled.

Alternatively, call `classify-task-topic` from the client after any task create/update operation (in `useUnifiedTasks` or wherever tasks are persisted). This ensures every task gets mapped without waiting for a Priorities page visit.

## ±48h Overdue Boost

Confirmed: keeping overdue tasks within the `isDueSoon()` +3 boost is correct. No change needed.

## Changes

| File | Change |
|------|--------|
| `src/pages/Assignments.tsx` | Strip `checklist_items`, `assignment_url`, `scheduling_context` from update payload before `.update()` — fixes build error |
| `src/hooks/useUnifiedTasks.ts` | After every task INSERT or UPDATE, call the `classify-task-topic` edge function so all tasks get mapped automatically |
| Migration | Add `is_priority boolean NOT NULL DEFAULT false` to `tasks` |
| `src/types/task.ts` | Add `is_priority?: boolean` to Task interface |
| `supabase/functions/nightly-schedule-builder/index.ts` | Query `is_priority`; boost `is_priority` tasks +12, reduce topic-mapped boost from +10 to +2; add recency boost (+2 for ≤3 days, +1 for 4-7 days) |
| `src/lib/schedulingCandidates.ts` | Mirror server scoring: `is_priority` +12, mapped +2, recency boost, reorder due-date boosts (48h = +5, 3-7 days = +3) |

