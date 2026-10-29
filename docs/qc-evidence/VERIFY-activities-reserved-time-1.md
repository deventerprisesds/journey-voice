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

## Claim 4 -- startActivity is correct: REFUTED (on two sub-points), rest confirmed
Read: supabase/functions/execute-tool/index.ts startActivity / undoActivityStart / readActivityPrefs / writeActivityConfig.
- "now" tz: Intl en-GB `hourCycle:'h23'` parts in the owner's tz, rounded down to 5 min -> CONFIRMED by reading.
- `start_time` given: interpreted as local today via normalizeDateTime -> zonedTimeToUtc -> CONFIRMED for normal
  hours. DEFECT: the regex `/^([01]\d|2[0-3]):[0-5]\d$/` rejects "9:30" and "09:30:00"; a rejected value
  SILENTLY falls back to NOW instead of returning an error (the agent asked for 9:30, gets now).
- User scoping: every tasks/events/prefs query and every update carries `.eq('user_id', userId)` -> CONFIRMED.
- Undo record: built in memory from the ORIGINAL task rows before any write, covering moved AND overflowed
  tasks -> CONFIRMED. But it is PERSISTED last (`writeActivityConfig(..., { lastActivityStart: undo })` runs
  after both update loops). If any task update throws mid-loop, or the final upsert fails, earlier moves stay
  committed with no undo record and no block -> "captures BEFORE writing" holds in memory only, not durably. REFUTED as a durability guarantee.
- undoActivityStart restores start/end/is_scheduled per saved task (user-scoped) and removes the instance ->
  CONFIRMED by reading. Only the most recent start is undoable (lastActivityStart is overwritten); undo also
  overwrites any manual edit made to those tasks after the start.
- DEFECT (non-ET users): readActivityPrefs prefers the `timezone` COLUMN, but writeActivityConfig prunes
  past one-offs using `config.timezone || 'America/New_York'` (index.ts:1399). The client saves timezone to the
  column and strips it from config (schedulingService.ts:188-203). Mirror test: LA user starting gym at
  21:30 PDT (00:30 EDT next day) -> the just-created instance (date 2026-10-28) is pruned on the same write
  ("kept? false"). Tasks are still moved; the reply says the block is reserved; the block is not stored.
  Not reachable for an America/New_York owner.
- limitFor: a legacy string `defaultTimeWindow` (the client still wraps strings "for backward compatibility",
  schedulingRules.ts:287-289) makes `listed.map` throw; the call fails before any write (safe failure).

## Claim 5 -- writing activities can never erase other config keys: REFUTED
- Client path: CONFIRMED safe. mergeSchedulingConfig (schedulingRules.ts:319) returns `activities: undefined`
  when never saved; saveUserSchedulingConfig merges via mergeStoredConfig, which skips undefined keys
  (mergeStoredConfig.ts:25-27); ActivitiesSettings only calls onChange on an edit (ActivitiesSettings.tsx:39,45,85).
  So a Settings save never writes `activities: []` for a never-saved owner.
- Edge path: readActivityPrefs (execute-tool/index.ts:1391-1393) IGNORES the read `error`; on a failed read
  `data` is null so `config = {}`, and writeActivityConfig then upserts `{ ...{}, activities }` (:1401-1404).
  Mirror test: keys written after a failed read = `activities` only -> timeWindows, categoryMappings, caveats,
  contextRules erased. This is the 2026-09-13 wipe shape that mergeStoredConfig.ts:3-7 exists to prevent;
  the client refuses on a read error (schedulingService.ts:213-217), the edge writer does not.
- Lost-update races (both directions, no version check): the client's loadUserSchedulingConfig is cached per
  user (schedulingService.ts ~107-110), and SchedulingSettings saves the whole loaded object including
  `activities`, so a Settings save after an agent add/start/skip silently reverts the agent's change.

## Claim 8 -- anything else that makes this unsafe to merge: REFUTED (issues found; see list)
Merge auto-deploys execute-tool, batch-calendar-scheduler, nightly-schedule-builder, smart-calendar-scheduler.
- Parse check: `node --experimental-strip-types --check` on all four index.ts + tool-definitions.ts printed no
  errors. Identifiers used in new code are in scope (nightly `config`/`timezone` declared at :288-289 inside
  the per-user loop opened at :286 that still encloses :917; batch `userConfig` :71, `eventsResult` :150).
  `deno check` not run (deno.land blocked) -- types unverified.
- HIGH: edge config wipe on a failed read (claim 5).
- MEDIUM: smart-calendar-scheduler + client paths ignore activities for actual placement (claim 1), so the
  owner's "every scheduler plans around them" is not met for TaskCreationModal / Kanban / auto-scheduling /
  ai-task-parser single-task placement.
- MEDIUM: start_activity is non-atomic; undo is persisted last (claim 4).
- LOW/conditional: non-ET timezone prunes the just-created gym block (claim 4); `start_time` "9:30" silently
  becomes "now"; floating update keeps a stale earliest/latest range (claim 7).
- smart-calendar-scheduler defaults `timezone='UTC'` (:173) when a caller omits it; activities then expand
  in UTC in the AI prompt (prompt-only impact).
- Behaviour change on deploy for a never-saved owner: the seed Lunch (weekdays, floating 11:30-13:30, length
  = workingHours.breakMinutes or 60) immediately becomes a hard reject in batch-calendar-scheduler and
  reduces nightly capacity. Owner-approved per the brief, but it is live the moment this merges.

## Regression baseline
NOT RUN against a live URL: the PR is unmerged/undeployed and the brief forbids calling deployed functions.
`npm test` on the branch: 346/346 pass (re-run 13:20Z, 12 activity tests among them).
