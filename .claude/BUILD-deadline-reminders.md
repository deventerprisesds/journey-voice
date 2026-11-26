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

## Chunk 2 — per-user run, scheduler hook, migration
- `supabase/functions/_shared/deadline-reminders-run.ts` (new): one user's pass with the client injected.
  One config read, one task query per user (P3), task find-or-create by ref with re-read on a unique-key
  refusal (O2/O3), due date follows an edited deadline (G5), nag inserted by its OWN upsert on the existing
  unique index `idx_scheduled_notifications_unique` (N6, H6).
- `supabase/functions/_shared/deadline-reminders-run.test.ts` (new): 11 tests against a stateful double.
- `notification-scheduler/index.ts`: per-user deadline pass, each user in try/catch, BEFORE (and separate
  from) the single bulk insert; logs failure kinds only.
- `supabase/migrations/20261126120000_deadline_reminders.sql` (new, NOT applied): `tasks.deadline_reminder_ref`
  + partial unique index `(user_id, deadline_reminder_ref)`; `scheduled_notifications.metadata` IF NOT EXISTS.
- Correction to H7: a unique index on scheduled_notifications DOES exist
  (migrations/20250929221846_..., `(user_id, task_id, notification_type, scheduled_for)`); the nag upsert uses it.
- Tests: 813 total after chunk 2 (765 baseline + 48 new).
