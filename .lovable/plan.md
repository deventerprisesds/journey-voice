
# Validation-First Plan

You are right to push on this. Based on the code I just checked, I should not have treated the earlier fix as high-confidence for “all tabs.”

## What I verified in the code

- `tasks_with_schedule` was created correctly in `supabase/migrations/20260328191148_353c2dc8-bafc-4920-b96c-8c8dfffe035b.sql`.
- But only `WeeklyAgendaView.tsx` reads that view (`src/components/WeeklyAgendaView.tsx:715-766`).
- The parent loaders still fetch raw `tasks`:
  - `src/pages/TasksPage.tsx:122-126`
  - `src/pages/DailyPriorities.tsx:65-69`
- `FocusView.tsx` and `DailyScheduleView.tsx` still operate on the raw `tasks` prop, so they never receive historical rows from `tasks_with_schedule`.
- `DailyScheduleView.tsx` still builds `selectedDateStr` with `format(selectedDate, 'yyyy-MM-dd')`, which is not fully aligned with the timezone helper it uses for task timestamps.

## Why that matters

That means the previous change could only partially help Weekly Agenda. It could not reliably fix Focus View, Daily Schedule, or any other tab fed from the shared `tasks` loader. So the problem was architectural, not just a leaf-component filter bug.

## What I should do differently before claiming “fixed”

### 1. Fix the shared data source first
Move the history/live merge to the parent data-loading layer so every tab receives the same source of truth.

Likely targets:
- `src/pages/TasksPage.tsx`
- `src/pages/DailyPriorities.tsx`

### 2. Use the view only where it actually fits
Keep this split:

- Past dates: use `tasks_with_schedule`
- Today/future: use live `tasks`

That preserves historical schedule snapshots without breaking current scheduling/edit behavior.

### 3. Stop making each tab invent its own task visibility rules
Refactor so:
- parent loader prepares the correct date-scoped task list
- child views render it
- only minimal local filtering remains

Targets:
- `src/components/WeeklyAgendaView.tsx`
- `src/components/FocusView.tsx`
- `src/components/DailyScheduleView.tsx`

### 4. Unify timezone day-key logic
Use one shared rule for both:
- turning timestamps into day keys
- turning `selectedDate` / visible days into comparable day keys

This removes the current mismatch where one side is timezone-aware and the other side is still local-date formatted.

## Concrete acceptance gate I should meet before saying it works

I should not call this done until all of these are true:

1. A past scheduled task appears in Weekly Agenda on its original day.
2. The same past task appears in Daily Schedule when that past date is selected.
3. A rolled-over task with no current `start_time` still appears in the current-day backlog/unscheduled area where expected.
4. A late-night task stays on the correct day in the user’s configured timezone.
5. Today/future scheduling, drag/drop, and task editing still work normally.

## Why this approach has a higher chance of working

Because it follows the app’s existing architecture:
- parent pages already own task loading
- child views already depend on props
- fixing the shared source once is much more reliable than patching each screen separately

## Next implementation scope

1. Replace raw `tasks` loading in parent pages with a unified loader/hook.
2. Feed historical rows only for past dates.
3. Update Weekly, Focus, and Daily views to consume the unified source.
4. Standardize timezone date-key generation.
5. Only then treat the fix as verified.

## Process change going forward

Before I say a fix has a high chance:
- I will check every parent loader that feeds the affected screens
- I will confirm the fix is applied at the shared source if multiple tabs are involved
- I will use an explicit acceptance checklist like the one above instead of assuming one patched tab proves the whole feature
