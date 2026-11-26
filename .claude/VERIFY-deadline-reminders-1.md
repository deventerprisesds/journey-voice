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
