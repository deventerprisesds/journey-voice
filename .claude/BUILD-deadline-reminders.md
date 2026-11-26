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

## Chunk 3 — Settings card
- `src/utils/deadlineReminders.ts` (new): add / patch (On stamps enabledSince) / remove, deadline-weekday picker
  (same weekday = same day, never next week), whole-list validation before Save, save payload that sends an
  agent-editable list only when edited (AC-S9 / H9).
- `src/components/DeadlineRemindersSettings.tsx` (new): its OWN "Deadline reminders" card.
- `src/components/SchedulingSettings.tsx`: mounts the card right after Activities; `deadlineRemindersEdited`
  guard; an invalid item blocks the whole save with a field-named error (AC-S8); saves the validated items.
- `src/config/schedulingRules.ts`: `deadlineReminders?` on SchedulingConfig, passed through undefined-when-unsaved.
- `src/utils/deadlineReminders.test.ts` (new): 12 tests (helpers + source shape).
- NOT verified: a real TypeScript typecheck / Vite build of the frontend (no node_modules installable here);
  syntax checked with `ts.transpileModule` only. No browser run.
- Tests: 825 total (UTC). Under TZ=America/Los_Angeles every new test passes; the one failure is
  `notification-scheduler/reminder-rules.test.ts`'s own pre-existing "run with TZ=UTC" guard (on main too).

## Chunk 4 — wiring guards, mutation proofs
- Added source-shape guards for delivery (H1 ancient exemption x2, channel split, chat, failure kinds, no
  throw for a nag) and the scheduler (nag pass per user in try/catch, before and apart from the bulk insert).
- Added a race test (a task the one SELECT missed is refused by the unique key, re-read, reused) and made the
  repeat-run test assert zero duplicate-key errors.
- FINAL: `node scripts/run-tests.mjs` = **829 / 829** (765 baseline + 64 new). Floors in scripts/run-tests.mjs
  were not raised (src >= 2, supabase/functions >= 1 are far below the real counts; nothing required it).

### Mutation results (`mutate.sh`, anchors/replacements from files; each FIRED was controlled)
| id | file | guard (test that must fail) | result |
|---|---|---|---|
| M01 | _shared/deadline-reminders.ts | per-item email switch (AC-D3) | FIRED (control EQUIVALENT) |
| M02 | same | quiet hours skip (AC-N1) | FIRED (control EQUIVALENT) |
| M03 | same | not-before skips the start day (S-33) | FIRED (control EQUIVALENT) |
| M04 | same | integer days only, 5.5 rejected (S-16, S-18) | FIRED (control EQUIVALENT) |
| M05 | same | no back-fill of missed slots (AC-N7) | FIRED (control EQUIVALENT) |
| M06 | same | no catch-up after switching On (AC-E5) | FIRED (control EQUIVALENT) |
| M07 | same | deadline slot inclusive (AC-N1, G1) | FIRED (control EQUIVALENT) |
| M08 | same | last week's task not reused (S-35 / AC-O6) | FIRED (control EQUIVALENT) |
| M09 | same | seed only for a missing key, [] stays empty (AC-S2/S3) | FIRED (control EQUIVALENT) |
| M10 | notification-scheduler/reminder-rules.ts | isInQuietHours via localClockParts, TZ=America/Los_Angeles (AC-N1) | **INERT**: behaviourally equivalent. The old `toLocaleString` re-parse reads and writes in the SAME process timezone, so it is wrong only inside a DST gap of the server's own zone. H10 overstated the risk; the refactor is kept (strictly more correct) but is NOT a proven guard |
| M11 | _shared/deadline-reminders-run.ts | Done stops nags (AC-N10) | FIRED (control EQUIVALENT) |
| M12 | same | re-read on unique-key refusal (AC-O2 race) | FIRED (control EQUIVALENT) |
| M13 | same | nag upsert ignores duplicates (AC-O2 / AC-N6) | FIRED (control EQUIVALENT) |
| M14 | src/utils/deadlineReminders.ts | unedited list sent as undefined (AC-S9) | FIRED (control EQUIVALENT) |
| M15 | same | same weekday = same day, not next week (S-24 via picker) | FIRED (control EQUIVALENT) |
| M16 | src/components/SchedulingSettings.tsx | invalid item blocks the save (AC-S8) | FIRED (control EQUIVALENT) |
| M17 | notification-delivery/index.ts | nag never dropped as ancient (H1) | FIRED (control EQUIVALENT) |
| M18 | same | `deadline_reminder` in ALARM_TYPES (H2) | FIRED (control EQUIVALENT) |

### New hazard found while building (not in the AC file)
- **H11. `schedule_task_reminders` trigger** (migrations/20261008142455_unscheduled_task_cancels_start_alarms.sql).
  For any task with a due_date it (a) on every INSERT/UPDATE DELETES the task's undelivered rows of every type
  except `task_created` -- including a pending `deadline_reminder` row if the task is edited in the ~1 minute
  between the scheduler insert and delivery (the next scheduler run in the same hour re-inserts it, because the
  upsert key is then free; delivered rows are never deleted, so no double fire); and (b) adds its own
  `task_created` push at creation, `due_soon` at deadline-15 min and `due_now` at the deadline. So the owner
  also gets "Task Due Soon" at Sat 19:45 and "Task Due Now" at Sat 20:00 as ordinary (non-alarm) pushes,
  unless due reminders are off. Left as is (no change to the trigger); owner to decide.

### Decisions taken on safe defaults (reversible)
- Seed parity with Activities: a user whose config has NO `deadlineReminders` key gets the seeded time card,
  in Settings AND in the scheduler. Every account with notification_prefs and no saved list would nag on Fridays.
  Alternative: scheduler acts only on a SAVED list (then the owner must touch the card once to switch it on).
- Single start day in the UI (the stored shape and backend accept several; the window must fit between them).
- `respectQuietHours` and `intervalMinutes` are per-item fields (default true / 60), beyond the spec's minimum.
- Start alarm vs nag (G6): delivery skips a `task_start_*` alarm for any task that has deadline nag rows
  (failure_reason `deadline_reminder_owns_alarm`); fails open on a lookup error.
