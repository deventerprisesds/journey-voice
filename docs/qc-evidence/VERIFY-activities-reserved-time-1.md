# VERIFY-activities-reserved-time-1
# WHAT:       Independent verification of PR #76 (activities = reserved time) at 907f22d.
# WHY:        Owner-requested verify loop 1; claims 1-8 from the brief.
# SUPERSEDES: nothing. SUPERSEDED-BY: nothing -- current.
# EVIDENCE:   this file; scratch tests in docs/qc-evidence/activities-verify.test.ts

Target: origin/claude/sleepy-bardeen-kty0n2 @ 907f22d (5b5605c, dd70feb, 907f22d on origin/main 9c81e5f).
Baseline: `npm test` -> 346 tests, 346 pass, 0 fail. `deno check` not run (deno.land blocked) -- not counted.

## Claim 1 -- every busy-time reader includes activities: REFUTED
- smart-calendar-scheduler/index.ts:368-377 adds activities ONLY to `allBusySlots`, built inside
  `if (LOVABLE_API_KEY && userId)` (line 345) and used only in the AI prompt text (line 407). The AI returns
  only `ideal_hour`/window. The deterministic slot finder that actually picks the time uses
  `getAllBusySlotsForDay(dayStartUTC, dayEndUTC, existingTasks, busySlots)` (lines 699, 726) where
  `busySlots` is the request-body param (line 165). Activities never reach it, so a task placed by this
  scheduler can land on Lunch. Callers: src/utils/taskScheduling.ts:98 scheduleNewTask (TaskCreationModal,
  KanbanBoard, useAutoScheduling) and ai-task-parser/index.ts:586.
- src/utils/taskScheduling.ts:218-262 getCalendarAvailability (CalendarModule.tsx:125 conflict detection)
  and :59-80 scheduleNewTask busySlots: tasks + external events only, no activities.
- src/utils/ItineraryEngine.ts:304-342 busySlots (EditableTaskSuggestion conflict flag): no activities.
- nightly-schedule-builder/index.ts:1419-1428 reshuffle pass recomputes capacity from accumulatedBusySlots
  WITHOUT activity blocks (the main pass at :917-926 includes them). Placement is still protected because
  the reshuffle calls batch-calendar-scheduler (:1475), which hard-rejects -- capacity over-estimate only.
- Covered: batch-calendar-scheduler (:182, :659), nightly main-pass capacity (:917), execute-tool findOpenSlots (:3150).

## Claim 2 -- batch-calendar-scheduler hard-rejects activity overlaps: CONFIRMED
- batch-calendar-scheduler/index.ts:659-668 rejects with `overlaps_activity` and `continue`s before
  `acceptedSlots.push` (:672) / `scheduledTasks.push` (:674). The results loop (:564-) is the only
  push site; no branch reaches the push without passing the check. Slots built at :182 from
  `activityBusySlots(userConfig, ...)`; a null config resolves to the seed (activities.ts:86-88).
