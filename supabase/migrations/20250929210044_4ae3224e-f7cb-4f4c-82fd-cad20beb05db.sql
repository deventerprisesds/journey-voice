-- Ensure extensions exist
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 1) Restore complete reminder system (idempotent)
CREATE OR REPLACE FUNCTION public.schedule_task_reminders()
RETURNS TRIGGER AS $$
DECLARE
  reminder_time TIMESTAMPTZ;
BEGIN
  -- Only process if the task has relevant time fields
  IF NEW.start_time IS NOT NULL OR NEW.due_date IS NOT NULL THEN
    -- Delete existing reminders for this task to avoid duplicates
    DELETE FROM scheduled_notifications WHERE task_id = NEW.id;

    -- START TIME REMINDERS
    IF NEW.start_time IS NOT NULL THEN
      -- 3 minutes before start_time
      reminder_time := NEW.start_time - INTERVAL '3 minutes';
      IF reminder_time > NOW() THEN
        INSERT INTO scheduled_notifications (
          user_id, task_id, notification_type, scheduled_for, title, body
        ) VALUES (
          NEW.user_id,
          NEW.id,
          'task_start_reminder',
          reminder_time,
          'Task Starting Soon',
          'Your task ' || '"' || NEW.title || '"' || ' starts in 3 minutes'
        );
      END IF;

      -- At start_time
      IF NEW.start_time > NOW() THEN
        INSERT INTO scheduled_notifications (
          user_id, task_id, notification_type, scheduled_for, title, body
        ) VALUES (
          NEW.user_id,
          NEW.id,
          'task_start_now',
          NEW.start_time,
          'Task Starting Now',
          'Your task ' || '"' || NEW.title || '"' || ' is starting now'
        );
      END IF;
    END IF;

    -- DUE DATE REMINDERS
    IF NEW.due_date IS NOT NULL THEN
      -- 1 day before at 9 AM
      reminder_time := (NEW.due_date - INTERVAL '1 day')::date + TIME '09:00:00';
      IF reminder_time > NOW() THEN
        INSERT INTO scheduled_notifications (
          user_id, task_id, notification_type, scheduled_for, title, body
        ) VALUES (
          NEW.user_id,
          NEW.id,
          'due_tomorrow',
          reminder_time,
          'Task Due Tomorrow',
          'Your task ' || '"' || NEW.title || '"' || ' is due tomorrow'
        );
      END IF;

      -- 15 minutes before due date
      reminder_time := NEW.due_date - INTERVAL '15 minutes';
      IF reminder_time > NOW() THEN
        INSERT INTO scheduled_notifications (
          user_id, task_id, notification_type, scheduled_for, title, body
        ) VALUES (
          NEW.user_id,
          NEW.id,
          'due_soon',
          reminder_time,
          'Task Due Soon',
          'Your task ' || '"' || NEW.title || '"' || ' is due in 15 minutes'
        );
      END IF;

      -- At due date/time
      IF NEW.due_date > NOW() THEN
        INSERT INTO scheduled_notifications (
          user_id, task_id, notification_type, scheduled_for, title, body
        ) VALUES (
          NEW.user_id,
          NEW.id,
          'due_now',
          NEW.due_date,
          'Task Due Now',
          'Your task ' || '"' || NEW.title || '"' || ' is due now'
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2) De-duplicate cron jobs robustly
-- Remove known duplicate-named jobs if present (safe if they don't exist)
SELECT cron.unschedule('invoke-notification-scheduler-every-minute') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'invoke-notification-scheduler-every-minute'
);

SELECT cron.unschedule('process-pending-notifications') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-pending-notifications'
);

-- Keep a single job per function URL by de-duping on the command text (keep the lowest jobid)
DO $$
DECLARE
  keep_id INT;
BEGIN
  -- notification-scheduler
  SELECT MIN(jobid) INTO keep_id
  FROM cron.job
  WHERE active AND command ILIKE '%/functions/v1/notification-scheduler%';
  IF keep_id IS NOT NULL THEN
    PERFORM cron.unschedule(j.jobid)
    FROM cron.job j
    WHERE j.active AND j.command ILIKE '%/functions/v1/notification-scheduler%'
      AND j.jobid <> keep_id;
  END IF;

  -- notification-delivery
  SELECT MIN(jobid) INTO keep_id
  FROM cron.job
  WHERE active AND command ILIKE '%/functions/v1/notification-delivery%';
  IF keep_id IS NOT NULL THEN
    PERFORM cron.unschedule(j.jobid)
    FROM cron.job j
    WHERE j.active AND j.command ILIKE '%/functions/v1/notification-delivery%'
      AND j.jobid <> keep_id;
  END IF;
END $$;

-- Optionally, ensure the canonical job names exist and are active; if not, do nothing here to avoid breaking auth headers.
-- This migration focuses on removing duplicates only.