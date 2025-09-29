-- Phase 1: Complete Notification System Fix (retry with robust duplicate cleanup)

-- Step 1: Clean up existing duplicate notifications using window function
WITH ranked AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, task_id, notification_type, scheduled_for 
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM scheduled_notifications
)
DELETE FROM scheduled_notifications sn
USING ranked r
WHERE sn.id = r.id AND r.rn > 1;

-- Step 2: Add unique constraint to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_notifications_unique 
ON scheduled_notifications(user_id, task_id, notification_type, scheduled_for);

-- Step 3: Update schedule_task_reminders() to be idempotent
CREATE OR REPLACE FUNCTION public.schedule_task_reminders()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  reminder_time TIMESTAMPTZ;
BEGIN
  -- Only process if the task has relevant time fields
  IF NEW.start_time IS NOT NULL OR NEW.due_date IS NOT NULL THEN
    -- DELETE existing reminders for this task to ensure idempotency
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
$function$;

-- Step 4: Create the trigger (drop first to ensure clean state)
DROP TRIGGER IF EXISTS trigger_schedule_task_reminders ON tasks;

CREATE TRIGGER trigger_schedule_task_reminders
  AFTER INSERT OR UPDATE OF start_time, due_date ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION schedule_task_reminders();