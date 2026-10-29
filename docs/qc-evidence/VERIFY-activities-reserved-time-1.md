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

## Claim 3 -- planPush is safe: CONFIRMED (on every adversarial input tried)
Run: `node --experimental-strip-types --test docs/qc-evidence/activities-verify.test.ts` -> 15/15 pass.
Invariant checker (never moves/overflows an immovable; duration kept; no placed item overlaps the block,
any immovable, or another placed item; end <= limitMs; order kept) held for:
back-to-back meetings after the block (hops to 14:00); item in progress at block start (moves whole to
block end); items exactly touching the block (untouched); zero-gap chain (a,b,c moved, d overflows at
limit); block past end of day (overflow); wall overlapping the block (conflict, not moved); a pre-existing
task/meeting overlap after the block; and a seeded random sweep: 3124 valid cases, 936 with moves, 0 failures.
Checker proven non-vacuous: mutating activities.ts:337 `start = hit.endMs` -> `hit.endMs - 60000` made
3 tests fail (1, 7, 8); file restored with `git checkout` (git status clean for activities.ts).
Note (not a defect of the claim): items with `limitMs` NaN would never overflow -- see claim 4 limitFor.

## Claim 6 -- DST: CONFIRMED for the 10:00 case
Locked 10:00 activity expanded on 2026-03-07/08/09 and 2026-10-31/11-01/11-02 in America/New_York,
America/Los_Angeles, America/Phoenix: every block starts 10:00 local on the right local date.
Probe (outside the claim, pre-existing `zonedTimeToUtc` in _shared/timezone.ts:63-82, not in this diff):
a locked 03:00 activity on 2026-03-08 NY expands to 2026-03-08T08:00Z = 04:00 local (one hour late).
The single-pass offset is wrong for local times inside the first |offset| hours of a DST-change day.

## Claim 7 -- updates actually update: CONFIRMED for the snake/camel question, with an adjacent defect
Mirrored execute-tool updateActivity merge (index.ts updateActivity) + real normalizeActivity:
- `duration_min: 45` over stored `durationMin: 90` -> 45 (activities.ts:239 reads snake first).
- `start: '11:15', days: [6]` -> applied (same key names as storage).
- `every_n_weeks: 1` over stored `everyNWeeks: 2` -> biweekly cleared (activities.ts:254 snake first).
- ADJACENT DEFECT: updating floating Lunch `start: '15:00'` keeps stored earliest 11:30 / latest 13:30
  (activities.ts:269-270 take `input.earliest ?? a.start`, and the merged object still carries the old
  earliest/latest). Result stored {start 15:00, earliest 11:30, latest 13:30}; expand places it 15:00-16:00,
  outside its own range, no conflict flag. Also activities.ts:168-171 only bounds `pref+step` by `hi`;
  `pref-step` candidates are never checked against `hi`.
- Minor: `pushes_schedule: false` cannot clear a stored `pushesSchedule: true` (activities.ts:278 ORs the
  camel key). update_activity's schema does not expose pushes_schedule, so this is reachable only if the
  model sends an unlisted arg.
