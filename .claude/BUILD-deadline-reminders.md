<!--
WHAT:          running build log for "deadline reminders" (time-card nag): what is done, test counts, mutation results.
WHY:           the build is chunked and pushed per chunk so a container restart loses at most one chunk; this
               file is the durable record of where it stands.
SUPERSEDES:    nothing
SUPERSEDED-BY: nothing -- current
EVIDENCE:      .claude/ac-deadline-reminders.md (spec); branch claude_deadline-reminders
-->

# BUILD — deadline reminders

Base: origin/main c7cc683c. Baseline `node scripts/run-tests.mjs`: 765/765.
Built in an isolated agent worktree (the scratchpad clone was refused by the worktree-isolation guard).

## Chunk 1 — pure decision module + delivery wiring
- `supabase/functions/_shared/deadline-reminders.ts` (new): shape, seed, validator (spelling table),
  live occurrence, current slot, slot verdict (quiet / not-before / deadline / enabledSince / stale),
  occurrence-task pick by ref, nag row, delivery channel split.
- `supabase/functions/_shared/deadline-reminders.test.ts` (new): 37 tests; also green with TZ=America/Los_Angeles.
- `notification-scheduler/reminder-rules.ts`: `isInQuietHours` now reads the local clock via `localClockParts`
  (H10); same answer on a UTC server, existing reminder-rules tests unchanged.
- `notification-delivery/index.ts`: `deadline_reminder` added to ALARM_TYPES (not a task_start_* type, H2);
  exempt from the "ancient" drop (H1); per-item email (H4) and chat (H5); failure kinds recorded on the row
  (D7/D8); a push failure no longer throws away email/chat for a nag; task_start_* alarm skipped for a task
  that has deadline nags (G6, fails open).
- Tests: 802 total after chunk 1.
