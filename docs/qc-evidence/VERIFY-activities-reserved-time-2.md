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
