<!--
WHAT:          independent verification (loop 1) of branch claude_deadline-reminders head 98a8ed7c.
WHY:           Tier 1 change (decides whether a notification fires; parses times/days). Verifier shares no context
               with the implementer; every line below is an observation from a command run in this pass.
SUPERSEDES:    nothing
SUPERSEDED-BY: nothing -- current
EVIDENCE:      commands and outputs inline; worktree of origin/claude_deadline-reminders @ 98a8ed7c
-->
# VERIFY deadline-reminders loop 1

Started 2026-11-26 09:2x UTC. Budget 30 min.

## Claims, one line each as they land
- C-suite: `node scripts/run-tests.mjs` (TZ=UTC container) -> tests 832 / pass 832 / fail 0. CONFIRMED.
- C-suite-TZ: TZ=America/Los_Angeles -> 820 tests, 819 pass, 1 fail = reminder-rules.test.ts own pre-existing "run with TZ=UTC" guard (file unchanged by the branch). The two new deadline test files under TZ=Asia/Kolkata: 55/55. CONFIRMED (AC-T4 PARTIAL as the build log says).
- C-claim-rpc: claim_due_notifications returns SETOF scheduled_notifications via RETURNING *, so delivery sees `metadata` (needed for per-item email/chat). CONFIRMED by reading supabase/migrations/20250929173914_*.sql L9,L33.
- C-week-walk (AC-N1/N2/N3/N5/N6/N8, S-21/S-22/S-27..S-30/S-32, AC-O1/O2/O7, AC-T1/T2/T3/T5/T6, H8): own harness (scratchpad adv/walk.ts) drives `runDeadlineRemindersForUser` (real module, stateful double enforcing both unique keys) hourly across Fri 12:00Z..+40h. Reference week Nov 27 at minute :00 x3 reps, :17 only, :52 only, and :00/:14/:30/:59 -> tasks=1, nags=16 unique=16, exactly Fri 19,20,21 + Sat 08..20. Same 16 for EDT Oct 30, EST Nov 6, EST Mar 6, EDT Mar 13, null tz (NY default), America/Chicago (Chicago-local list). Quiet 22-09 -> 15 (first Sat 09:00, S-28); quiet null -> 18 (Fri 22,23 fire, Sat 00-07 do not, S-30); quiet 23-06 -> 17 (Fri 22 fires, S-29); quiet 19-06 -> 11 (S-32/G4). everyNWeeks=2 anchored 11-27 over 6 weeks -> 3 tasks, 48 nags (AC-O7). DST spans (quiet off): fall-back Sat Oct31 22:00->Sun 04:00 = 8 slots, Sun 01:00 twice (EDT then EST, one per elapsed hour, no duplicate instant); spring Mar 7 = 6 slots, no 02:00, no crash. Whole walk re-run under process TZ=America/Los_Angeles, Pacific/Kiritimati, America/New_York: identical counts (AC-T4 holds for the new code). CONFIRMED.
- C-done-stops (AC-N10 mechanism): same harness, task DONE at Fri 20:03 -> only the 19:00 nag ever inserted. CONFIRMED scheduler side. Delivery side: completedTaskIds drop + trigger DONE branch deletes undelivered rows (migration 20261008142455 L25-29). CONFIRMED by reading.
- C-cadence (G7/AC-P2, informational): migrations show notification-scheduler `0 * * * *` and notification-delivery `* * * * *` (20250929233705 L5-20). Inference; live cron not read.
- C-H11 (informational): trigger read at 20261008142455 L38-42: any task UPDATE deletes undelivered non-task_created rows, incl. a pending deadline_reminder. The build log says the next scheduler run in the same hour re-inserts it; with the scheduler at `0 * * * *` there is no second run in the hour, so that hour's nag is lost if the task is edited between the :00 insert and the next-minute delivery. Narrow window, not counted as a defect; build-log statement INACCURATE.
- C-D8 (push failure recorded on the row): REFUTED. send-push-notification answers HTTP 200 `{success:true, delivered:0, failed:N}` when every send fails (send-push-notification/index.ts L374-385) and 200 `delivered:0` with no subscriptions (L206-209). functions.invoke sets `error` only on non-2xx, so notification-delivery/index.ts L981 `if (isNag && pushError)` never records `push_failed`; the row is marked delivered with failure_reason null (L1068-1074). Only a 500 is recorded.
- C-D7 (email failure recorded on the row): REFUTED. send-unified-notification answers 207 (2xx) when EMAIL fails (send-unified-notification/index.ts L936-953; its own comment says 207 does not change functions.invoke behaviour). notification-delivery/index.ts L1059 `if (unifiedError)` never records `email_failed`, and L1072 writes `failure_reason: null`, overwriting the reason send-unified-notification stored itself (updateNotificationStatus L1023-1030). The other half of D7 (alarm+chat still go out, next slot normal) CONFIRMED by reading: the nag path cannot throw (L1065 `!isNag`).
