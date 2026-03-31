
Why it didn’t work:

1. The MD files were not turned into a real enforcement system
- `.lovable/rules.md` only mandates `docs/DEBUG_TRACKER.md`.
- There is no `docs/SCHEDULING_RULES.md` in the repo now.
- There is no single scheduling-specific checklist that must be read before every scheduling plan.

2. The docs that do exist are too general and fragmented
- `docs/TASK_MANAGEMENT.md` says “Fill Gaps” should schedule unscheduled `TODO/READY/UP_NEXT` tasks by priority.
- `docs/CALENDAR_INTEGRATION.md` says busy slots and fill-gaps should use shared availability logic.
- `src/lib/date.ts` provides the timezone helper that should be used app-wide.
- But those rules are spread across files, so they are easy to miss and weren’t enforced together.

3. The actual code paths drifted away from the documented rules
- `nightly-schedule-builder` does contain the priority board, due-soon, keyword, pushed-count, and dedup scoring.
- But `CalendarModule.handleFillGaps()` does not use that same shared selection/scoring path; it loops task-by-task through `smart-calendar-scheduler`.
- That means the app has multiple schedulers/placement paths, so one MD file alone would never keep behavior aligned.

4. Leaf views still bypass the shared date helper in places
- `DailyScheduleView.tsx` still builds `selectedDateStr` with `format(selectedDate, 'yyyy-MM-dd')` instead of the timezone helper pattern.
- `FocusView.tsx` still excludes tasks using `isToday(parseISO(t.start_time))` in one branch while using timezone-aware logic in another.
- So even if backend scheduling were correct, view-level filtering can still hide tasks.

5. The docs are descriptive, not acceptance-test based
- The current docs explain architecture and intent.
- They do not force every new plan to answer:
  - Which shared scheduler path is authoritative?
  - Which views still bypass shared date utilities?
  - How are assignments and due items guaranteed not to drop off?
  - How is “fill all slots” verified?
- Without that checklist, context gets lost across days/threads.

What to build so it actually works next time:

1. Create one authoritative scheduling spec
- Add `docs/SCHEDULING_RULES.md`.
- It should explicitly define:
  - your goal for the daily scheduled agenda
  - fill-all-slots expectation
  - priority order: priority board, due soon, financial, people/comms, assignments
  - assignment persistence rules
  - no duplicate active tasks
  - timezone rule: always use `getDateInTimezone` / shared helpers
  - which scheduling path is authoritative

2. Make it mandatory in `.lovable/rules.md`
- Add a hard rule that any scheduling, calendar, daily agenda, assignment, or timezone plan must read:
  - `docs/SCHEDULING_RULES.md`
  - `docs/TASK_MANAGEMENT.md`
  - `docs/CALENDAR_INTEGRATION.md`
  - `src/lib/date.ts`
- This is the missing enforcement layer.

3. Add a required planning checklist inside the new MD
- Every scheduling plan must explicitly state:
  - parent data source/hook being changed
  - all affected views
  - whether the change applies to nightly builder, fill-gaps, manual scheduling, and display filtering
  - how assignments remain visible until done
  - how “today” is computed in user timezone
  - how success will be verified in DB + UI

4. Consolidate the scheduling logic around one shared source
- The biggest architectural problem is not just missing docs; it is split logic.
- The implementation plan should unify:
  - candidate selection/scoring
  - slot-filling rules
  - timezone date handling
  - assignment priority behavior
- Then all entry points must call the same shared logic instead of each path improvising.

5. Fix the specific drift points already visible in code
- `CalendarModule.handleFillGaps()` must align with the same candidate-selection rules used by nightly scheduling.
- `DailyScheduleView.tsx` must stop using browser-local selected-date formatting.
- `FocusView.tsx` must remove the remaining browser-local `isToday` filtering branch.
- Then verify parent loaders/hooks, not just one leaf tab.

Why your earlier MD requests failed, in one sentence:
- We created documentation, but not a scheduling-specific mandatory-read spec tied to a required verification checklist, and the code itself remained split across multiple competing logic paths.

Technical details
```text
Verified repo evidence:
- .lovable/rules.md mandates DEBUG_TRACKER, but not scheduling rules
- No SCHEDULING_RULES doc currently exists
- nightly-schedule-builder contains the scoring logic you expected
- CalendarModule fill-gaps uses a separate per-task scheduling path
- DailyScheduleView and FocusView still show date-helper drift

So the failure was:
missing enforcement + fragmented docs + split scheduling code paths + incomplete timezone standardization
```
