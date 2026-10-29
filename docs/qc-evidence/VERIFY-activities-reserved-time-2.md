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
