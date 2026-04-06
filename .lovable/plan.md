

# Assignment Scheduling Grace Period + Assignments Page

## Problem

1. **Assignments vanish from scheduling the moment they're due.** The scoring logic penalizes overdue tasks (-3 at 14 days, -10 at 30 days) and archives education tasks at 30 days past due. But there's no **boost** for assignments in their first week past due — they just fade from the schedule, causing you to forget to submit them.

2. **No dedicated assignment management page.** Assignments are scattered across the Kanban board, Focus View, and Settings sync tab. There's no single view to see all assignments grouped by course, sorted by due date, with status and overdue indicators.

## Part 1: 7-Day Grace Period Boost for Past-Due Assignments

**File**: `supabase/functions/nightly-schedule-builder/index.ts`

In the scoring section (~line 740-765), add a new block specifically for assignment-sourced tasks that are 0-7 days past due:

```text
if task has assignment_id AND due_date is in the past AND within 7 days:
  → score += 10  (highest boost — treat as urgent)
  → auto-elevate priority to URGENT in the prompt payload
  → log: "🚨 Assignment grace period: {title} (due {date}, {N} days overdue)"
```

This ensures assignments in their first week past due get scheduled at the top of the day, not penalized.

Also modify the archival logic (STEP 1.6, ~line 524-558): change the education archive threshold from 30 days to **only archive assignments that are 30+ days overdue AND have no `assignment_id`**, or assignments that are **14+ days overdue** (giving a full 2-week window before archival instead of losing them immediately).

**File**: `supabase/functions/batch-calendar-scheduler/index.ts`

Add to the AI prompt instructions: "Tasks marked `[OVERDUE-ASSIGNMENT]` must be scheduled in the earliest available morning slot and styled as urgent."

## Part 2: Assignments Page

**New file**: `src/pages/Assignments.tsx`

A dedicated page accessible from the sidebar/nav, showing all assignment-linked tasks.

**Layout (mobile-first, 411px viewport)**:

- **Header**: "Assignments" title + last sync timestamp + manual sync button
- **Filter bar**: Course filter dropdown, Status filter (All / Upcoming / Overdue / Completed)
- **Assignment cards** grouped by course, sorted by due date:
  - Each card shows: title, course name, due date, status badge, priority badge
  - **Overdue styling**: Red left border + "OVERDUE - X days" badge for past-due items in grace period
  - **Completed styling**: Muted/strikethrough with green checkmark
  - Click opens existing `TaskDetailModal`
- **Summary stats** at top: Total assignments, Upcoming count, Overdue count, Completed count

**Files to modify**:
- `src/App.tsx`: Add `/assignments` route
- `src/components/MainLayout.tsx`: Add "Assignments" nav item with `GraduationCap` icon

## Part 3: FocusView Overdue Assignment Styling

**File**: `src/components/FocusView.tsx`

For tasks with `assignment_id` where `due_date` is in the past:
- Change left border from violet to red (`border-l-red-500`)
- Show "OVERDUE" badge in red instead of the normal EMBA/MIT badge
- Add pulsing dot or subtle animation to draw attention

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/nightly-schedule-builder/index.ts` | Add 7-day grace boost for past-due assignments; adjust archive threshold |
| `supabase/functions/batch-calendar-scheduler/index.ts` | Add OVERDUE-ASSIGNMENT prompt instruction |
| `src/pages/Assignments.tsx` | New dedicated assignments management page |
| `src/App.tsx` | Add `/assignments` route |
| `src/components/MainLayout.tsx` | Add Assignments nav item |
| `src/components/FocusView.tsx` | Red overdue styling for past-due assignments |

