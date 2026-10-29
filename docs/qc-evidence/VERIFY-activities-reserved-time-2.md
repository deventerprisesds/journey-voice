# VERIFY-activities-reserved-time-2
# WHAT:       Independent verification loop 2 of PR "activities = reserved time" at 8295739 (fix on 907f22d).
# WHY:        Loop 1 (VERIFY-activities-reserved-time-1.md) REFUTED claims 1, 4, 5, 7-adjacent; this loop re-derives them.
# SUPERSEDES: nothing (loop 1 stays as the record of 907f22d). SUPERSEDED-BY: nothing -- current.
# EVIDENCE:   this file; docs/qc-evidence/activities-verify.test.ts (loop 1) + activities-verify-2.test.ts (loop 2)

Target: origin/claude/sleepy-bardeen-kty0n2 @ 8295739. Started 13:57Z.

## Suites (my own run)
- `npm test` -> tests 350, pass 350, fail 0.
- `npm run check:symbols` -> 93 files, 0 NEW undefined symbols, 1 known (send-chat-message buildCallContext, pre-existing).
- `git grep fromMinutes` -> no matches (rc=1). Rename complete.
- `deno check` not run (deno.land blocked) -- not counted.

## Claim 3 -- planPush safe: CONFIRMED (re-check)
`git diff 907f22d 8295739 -- _shared/activities.ts` touches no planPush line. Loop-1 suite re-run against the
new file: `node --experimental-strip-types --test docs/qc-evidence/activities-verify.test.ts` -> 17/17 pass,
`sweep ran=3124 withMoves=936`, 0 failures.

## Claim 2 -- batch overlap rejection: CONFIRMED (re-check)
`git diff 907f22d 8295739 --stat -- supabase/functions/batch-calendar-scheduler` -> empty: file unchanged since loop 1's CONFIRMED read.

## Harness (loop 2)
`docs/qc-evidence/activities-verify-2.test.ts` extracts `extractErrorMessage` and every function from
`readActivityPrefs` up to `unscheduleTask` VERBATIM from execute-tool/index.ts at run time, imports the real
_shared/timezone.ts, activities.ts, scheduling-defaults.ts, and runs them against a mock Supabase client that
logs every select/upsert/update. Run: `node --experimental-strip-types --test docs/qc-evidence/activities-verify-2.test.ts` -> 37/37 pass.
Non-vacuity (mutations applied with sed, restored with `git checkout --`, `git status` clean afterwards):
- index.ts:1396 `if (error) throw` -> `if (false) throw`: 6 tests FAIL (C5 failed-read for add/update/remove/skip/start/undo).
- index.ts `merged.earliest = shift(current.earliest);` -> `void 0;`: 1 test FAILS (C7 range move).

## Claim 5 -- an activity write can never erase other config keys: CONFIRMED (edge path)
- readActivityPrefs (execute-tool/index.ts:1390-1399) throws on `error` (:1396) before `config = data?.config ?? {}`.
- All 7 writes (`grep -n writeActivityConfig`): add :1438, update :1487, remove :1499, skip :1513, start :1612,
  undo :1656 -- each is preceded in the same function by `readActivityPrefs` (:1433, :1464, :1496, :1508, :1529, :1647),
  and list (:1451) does not write. writeActivityConfig (:1401-1413) is the only upsert and spreads `...config`.
- Harness: for each of add/update/remove/skip/start/undo, a failed read -> success:false with "Could not read
  scheduling settings", ZERO upserts and ZERO task updates. A good read -> exactly one upsert, payload keys
  `[config, user_id]` (the `timezone` column is not touched), timeWindows/categoryMappings/caveats/contextRules deep-equal the input.
- Residual (NOT this PR's code, pre-existing on origin/main 9c81e5f:1275-1278): `readCaveats` (index.ts:1292-1297)
  still ignores the read error and `writeCaveats` upserts `{...{}, caveats}`. A failed read during
  add/clear caveat now ALSO erases `activities` (and lastActivityStart). Same wipe shape claim 5 closed for
  activities; outside the activity write paths, so it does not refute claim 5 as stated.

## Claim 4 -- startActivity correct: CONFIRMED
- Order: index.ts:1612 `writeActivityConfig(..., withInstance, tz, { lastActivityStart: undo })` precedes both
  task-update loops (:1614-1625). Harness C4: with 2 tasks to move and the 2nd task update forced to fail, the
  FIRST write in the log is the upsert, it carries the block and an undo record with BOTH t1 and t2 and their
  ORIGINAL start_time; the call returns success:false with "...say \"undo\"...". Every task update carries
  `eq('user_id','u1')`.
- start_time (:1538-1542) uses parseClockTime (activities.ts:107-111). Harness: "9:30"->09:30, "09:30"->09:30,
  "09:30:00"->09:30, "0:05"->00:05, "23:59"->23:59, " 9:30 "->09:30 (trimmed); ERROR with no write for
  "24:00","9:60","9.30","930","9:30pm","abc","09:30:60"; non-strings 930/true/{}/[] -> ERROR. Only
  undefined/null/"" fall to "now" (explicit absence).
- Timezone: start uses `tz` from readActivityPrefs (column first, :1398) for today AND passes it to the prune
  (:1612 -> :1406). Harness LA case: clock frozen at 2026-10-29T04:30Z (21:30 PDT 10-28, 00:30 EDT 10-29),
  column tz America/Los_Angeles, config.timezone absent -> instance date 2026-10-28, start 21:30, and the
  upserted activities CONTAIN it (loop 1: pruned). All other writers also pass the resolved tz.
- Remaining known limits (unchanged from loop 1, not regressions): only the latest start is undoable;
  undo overwrites manual edits made since; tasks/events read errors at :1559-1566 are not checked (an
  events read error would make planPush treat the day as meeting-free -- low, pre-existing in this PR).

## Claim 7-related -- CONFIRMED
- Floating range move (index.ts:1478-1484). Harness: Lunch {12:00, 11:30-13:30} + `start:'15:00'` -> stored
  {15:00, 14:30, 16:30}. With explicit earliest/latest -> the given 14:00/17:00 kept. `start:'23:30'` -> the
  shifted latest clamps at 23:59, range 59 < 60 min -> explicit error "the earliest-latest range is shorter than
  the activity" (refused, nothing written -- correct).
- Inconsistency (LOW): update_activity `start:'9:30'` (unpadded) -> error "start (HH:mm, 24-hour) is required for
  a scheduled activity" (normalizeActivity HHMM is strict), while start_activity accepts "9:30". Explicit error,
  not a silent wrong value.
- `pushes_schedule:false` over stored `pushesSchedule:true` -> cleared (activities.ts:292-293, snake first);
  an unrelated update (duration_min:45) keeps `pushesSchedule:true` and sets durationMin 45.
- expandActivitiesForDate clamp (activities.ts:172-178): `hi = max(lo, latest-dur)`, `pref = min(hi, max(lo, rawPref))`;
  candidates only `pref±step` guarded by `<= hi` / `>= lo` (:180-183); the conflict fallback now uses the
  clamped `pref` (:192). Harness sweep (3000 random floating activities, NY/LA/UTC, 2804 with a preferred start
  OUTSIDE its range, 489 conflicts): every block starts inside [lo, hi] local; every conflict block sits at the
  clamped pref; every non-conflict block avoids all busy spans. Mutation `pref = rawPref` -> sweep FAILS; restored.

## Claim 6 -- DST: CONFIRMED (re-check)
Locked-block code (activities.ts:164-169) unchanged in the diff. Loop-1 test "C6 locked 10:00 activity lands at 10:00
local either side of US DST changes" passes in the 17/17 re-run above. The 03:00-on-DST-day probe from loop 1
(pre-existing zonedTimeToUtc, not in this diff) is unchanged.

## Claim 1 -- busy-time readers include activities: placement CONFIRMED; one display-only reader still misses them (REFUTED at LOW severity under a strict "every reader" reading)
- smart-calendar-scheduler: `activityPickerSlots` (index.ts:618-625) built only when `userId` is truthy, from
  `loadedUserConfig ?? {}` (declared :187, loaded :188-204) and `timezone` (request param, :173), over
  [searchStartDate, +maxSearchDays+1 days] (:591-603, :618). `pickerBusySlots` feeds BOTH
  `getAllBusySlotsForDay` calls (:712 slot finder, :739 overlap re-check). Those are the only placement path:
  the only success `new Response` with `scheduledSlot` is :787 inside the day loop (:661); :837 is reached with
  `scheduledSlot = null` (:810), :825/:854 are failure responses. Import :5.
  Note: a failed config read (:197 `if (!configError && configData)`) leaves loadedUserConfig undefined ->
  `{}` -> resolveActivities seed (Lunch). Fails toward reserving lunch -- safe direction.
- Callers of smart-calendar-scheduler all pass userId: taskScheduling.ts:110 (`task.user_id`, tz `userConfig.timezone`,
  which loadUserSchedulingConfig fills from the column, schedulingService.ts:130/139), TaskCreationModal.tsx ~:569/~:1049,
  CalendarModule.tsx ~:226, RealtimeVoiceAssistant.ts ~:2068, ai-task-parser/index.ts:586-603 (`userId`).
- ItineraryEngine chain: ItineraryEngine.ts:345-358 invokes ai-task-parser with `userId: user.id` + browser tz;
  ai-task-parser forwards `userId` to smart-calendar-scheduler (:586-603, single mode) and to
  batch-calendar-scheduler (:401-413, preview/batch mode). Placement for SmartTaskInput is therefore covered. CONFIRMED.
- Client getCalendarAvailability (taskScheduling.ts:245-275): reads prefs `config, timezone`, tz column-first,
  adds `activityBusySlots(...)` as `type:'activity'` busy slots. Consumer CalendarModule.tsx:125. CONFIRMED.
  Inconsistency (LOW): no prefs row -> `[]` (no seed Lunch), while every edge scheduler applies the seed for a
  missing config. A prefs read error is ignored -> `[]` (display/conflict only; safe).
- nightly reshuffle (nightly-schedule-builder/index.ts:1423-1430): `activityBusySlots(config, dayBounds..., timezone)`
  joins the retry capacity. Scope checked by brace depth: line 1424 is inside the per-day loop (:865-:1593) and
  the per-user loop (:286-:1795) where `config` (:289), `timezone` (:288), `targetISO` (:869) are declared.
  CONFIRMED. (Retry expands floating blocks without `dayEvents`, so lunch may be counted on top of an event --
  capacity UNDER-estimate, conservative.)
- RE-SWEEP: every edge index.ts that reads start_time AND busy/availability: batch(2 refs), execute-tool(3),
  smart(3), nightly(3) include activities; calendar-integration-manager, calendar-delta-sync, twilio-voice-handler,
  send-unified-notification, notification-delivery are sync/notification code, not placement; ai-task-parser
  delegates (above). Client: schedulingService.getAvailableTimeSlots (:497) has no caller in src.
- STILL MISSED (LOW, display-only): ItineraryEngine.ts:304-341 builds `busySlots` from calendar connections + tasks
  only and returns it (:387) to SmartTaskInput.tsx:74 -> EditableTaskSuggestion.tsx:56 `hasConflict`. If the owner
  edits a suggestion onto Lunch, no conflict warning shows. The suggested slot itself avoids activities.

## Claim 5b -- the Settings page cannot revert an agent's activity change: CONFIRMED (by reading; no browser run)
- SchedulingSettings.tsx:44 `clearSchedulingConfigCache()` (schedulingService.ts:559-562 nulls cachedConfig/cachedUserId)
  before `loadUserSchedulingConfig` (:45), then `setActivitiesEdited(false)` (:47).
- Save (:64-67) sends `{ ...config, activities: undefined }` unless `activitiesEdited`. The ONLY setter of
  `activitiesEdited=true` is the ActivitiesSettings onChange (:363); ActivitiesSettings calls onChange only from
  user handlers (ActivitiesSettings.tsx:39 edit, :45 add, :85 remove; no useEffect calls it).
- saveUserSchedulingConfig re-reads the STORED row (schedulingService.ts:206-216, refuses on read error) and
  `mergeStoredConfig` (mergeStoredConfig.ts:24-30) skips `undefined` keys -> stored `activities` kept.
  `lastActivityStart` is never carried by mergeSchedulingConfig (schedulingRules.ts:295-329), so it is never sent
  and the stored undo record survives a Settings save.
- Residual (LOW): if the owner edits the Activities card while an agent changes activities, last writer wins (the
  owner's explicit edit). `handleReset` (:89-95) puts DEFAULT activities in page state without marking edited;
  a later card edit would then save seed+edit over the stored list. Outside 5b: `caveats` are still sent whole
  (schedulingRules.ts:318), so a Settings save reverts an agent caveat change made while the page was open.

## Claim 8 -- anything else unsafe about merging: no blocker found; three things the merger must know
- Parse: `node --experimental-strip-types --check` on execute-tool, smart-calendar-scheduler, nightly-schedule-builder,
  batch-calendar-scheduler index.ts and _shared/activities.ts -> all OK. `deno check` not run (deno.land blocked), so
  types are unverified -- not counted as a failure.
- MAIN HAS MOVED. `git fetch` at ~14:15Z: origin/main = 62e8ae6 (PR #77 assignment-spreading), which is NOT an
  ancestor of 8295739 -- the branch is no longer a fast-forward. #77 touches files this PR also touches:
  SchedulingSettings.tsx, schedulingRules.ts, scheduling-defaults.ts, timezone.ts, nightly-schedule-builder/index.ts.
  `git merge-tree --write-tree origin/main origin/claude/sleepy-bardeen-kty0n2` -> clean tree 47231f3, no conflicts.
  On that merged tree (extracted with git archive): `npm test` 381/381 pass; `check:symbols` 98 files, 0 NEW;
  my two harnesses 55/55 (incl. both sweeps); nightly index.ts parses; merged schedulingRules.ts:326 still passes
  `activities` through; SchedulingSettings keeps `activitiesEdited`; nightly keeps both activity capacity sites (:918, :1433).
  So the merge is textually and test-clean, but the PR must be re-merged on top of 62e8ae6, not fast-forwarded.
- DEPLOY SCOPE IS "ALL FUNCTIONS". This PR changes `supabase/functions/_shared/activities.ts`; the deploy workflow
  (.github/workflows/deploy-supabase-functions.yml:114-127) deploys EVERY function when any `_shared/` path changes.
  Merging redeploys the whole edge estate from main, not just the four activity functions.
- CLIENT BUNDLE NOT BUILT. This PR is the first to import `supabase/functions/_shared/activities.ts` into
  NON-test client code (src/utils/taskScheduling.ts:6, src/components/WeeklyAgendaView.tsx:26; on origin/main only
  *.test.ts files import from _shared). tsconfig.app.json:3 has `allowImportingTsExtensions`, and activities.ts /
  _shared/timezone.ts contain no `Deno.` and no remote imports, so I expect `vite build` to succeed, but I could not
  run it: `npm install` is blocked (proxy rejects europe-west1-npm.pkg.dev). UNPROVEN -- run `npm run build` in CI
  before merging.
- Carried from loop 1, still true: a never-saved owner gets the seed Lunch as a hard reject the moment this deploys
  (owner-approved); readCaveats pre-existing wipe shape now also covers `activities` (see claim 5 residual).
