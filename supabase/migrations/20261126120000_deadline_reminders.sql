-- WHAT:          schema for deadline reminders (the hourly "time card" nag): a stable occurrence reference on
--                the task the nag belongs to, a unique key so one occurrence can never get two tasks, and the
--                nag row's metadata column (per-item email/chat switches) if this project does not have it yet.
-- WHY:           .claude/ac-deadline-reminders.md AC-O1/O2/O3 (one task per occurrence across repeat runs and
--                a crash after the write; H7: idempotency must be built, not assumed) and S-35 (the task is
--                matched by reference, never by title). Nag rows themselves are already deduplicated by the
--                existing idx_scheduled_notifications_unique (user_id, task_id, notification_type, scheduled_for).
--                ADDITIVE ONLY: a nullable column, a partial unique index, and ADD COLUMN IF NOT EXISTS.
--                NOT APPLIED by the build session. Apply BEFORE merging the code: until then the scheduler's
--                deadline pass fails its own task read (logged as task_read_failed) and inserts nothing, while
--                every other notification is unaffected.
-- SUPERSEDES:    nothing
-- SUPERSEDED-BY: nothing -- current
-- EVIDENCE:      supabase/functions/_shared/deadline-reminders-run.ts; .claude/BUILD-deadline-reminders.md

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS deadline_reminder_ref text;

COMMENT ON COLUMN public.tasks.deadline_reminder_ref IS
  'Deadline reminders: <itemId>@<local start date YYYY-MM-DD> of the occurrence this task belongs to (user_scheduling_prefs.config.deadlineReminders). NULL for every other task.';

CREATE UNIQUE INDEX IF NOT EXISTS tasks_deadline_reminder_ref_uniq
  ON public.tasks (user_id, deadline_reminder_ref)
  WHERE deadline_reminder_ref IS NOT NULL;

-- notification-delivery already reads scheduled_notifications.metadata (scheduled_chat) and task-dedup writes
-- it; this is a no-op where the column exists and makes the dependency explicit where it does not.
ALTER TABLE public.scheduled_notifications
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
