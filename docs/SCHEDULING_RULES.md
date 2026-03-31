# Scheduling Rules

> Mandatory reference for any scheduling, calendar, daily agenda, assignment visibility, or timezone-related planning/change.

## Goal for the daily scheduled agenda

The daily agenda should present a **full, trustworthy day plan** that:

- fills valid open windows before leaving obvious gaps
- respects category-to-window constraints from scheduling preferences
- prioritizes the tasks that matter most now
- keeps assignment-linked and due-soon work visible until completed
- uses the user's timezone consistently across loading, scheduling, and display

## Non-negotiable rules

1. **Single timezone rule**
   - Store UTC, display local.
   - Use shared helpers for day-key comparisons:
     - `getDateInTimezone`
     - `getTimePartsInTimezone`
     - `localTimeToUtcISO`
   - Do **not** use browser-local `isToday()` / `format(date, 'yyyy-MM-dd')` as the source of truth for agenda filtering.

2. **Authoritative scheduling paths**
   - Nightly auto-fill logic is the authoritative reference for candidate scoring and selection.
   - Fill-gaps/manual auto-fill flows must use the same candidate-selection rules, not ad hoc per-task scheduling loops.
   - Parent loaders/hooks remain the source of truth for cross-view task visibility.

3. **Fill-all-slots expectation**
   - Active windows should be filled to capacity with valid candidates before the scheduler reports success.
   - Empty windows are only acceptable when:
     - there are no valid candidates
     - window rules reject all remaining candidates
     - calendar conflicts remove all available space

4. **Priority order for candidates**
   - Priority board mapped tasks get the strongest boost.
   - Then prioritize:
     - due soon / near deadline work
     - financial / money / billing items
     - people / communications / follow-up items
     - `UP_NEXT` tasks
     - pushed/rolled tasks, with diminishing returns and stale-task penalties
   - Assignment-linked tasks must remain eligible until done and should not silently fall out of the candidate pool.

5. **Assignment persistence**
   - Tasks linked to assignments (`assignment_id`) must remain visible in agenda candidate selection until completed or explicitly archived.
   - Due dates on assignment-linked tasks must continue to influence score/order.

6. **Deduplication**
   - No duplicate active tasks with the same normalized title should compete for the same fill pass.
   - Dedup should happen before submission to the scheduler.

7. **Busy-slot handling**
   - External calendar events and scheduled tasks both count as busy slots.
   - Gap-filling must avoid collisions with either source.

## Required planning checklist

Every scheduling-related plan must explicitly answer:

1. **Authoritative path** — which shared loader/hook or scheduler path is being changed?
2. **Affected views** — which tabs/views/components consume the result?
3. **Coverage** — does the fix apply to:
   - nightly builder
   - fill gaps
   - manual scheduling
   - display filtering
4. **Assignments** — how are assignment-linked tasks prevented from dropping off?
5. **Timezone** — how is “today” computed in the user timezone?
6. **Verification** — how will DB state and UI state both be checked before calling it fixed?

## Acceptance gate before claiming a scheduling fix works

Do not call a scheduling fix complete until all relevant items are true:

1. The shared candidate-selection path is updated, not only a leaf view.
2. Focus/Daily/Agenda views use timezone-safe day matching.
3. Due and assignment-linked work still appears where expected.
4. Fill-gaps uses the same priority logic as the authoritative scheduler.
5. Validation is done against both:
   - code/build output
   - actual application data and affected views