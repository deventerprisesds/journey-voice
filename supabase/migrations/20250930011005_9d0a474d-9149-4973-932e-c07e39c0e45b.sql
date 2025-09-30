-- Add reminder_minutes column to tasks table
ALTER TABLE public.tasks 
ADD COLUMN reminder_minutes integer DEFAULT 15;

-- Update the schedule_task_reminders trigger function to use custom reminder_minutes
CREATE OR REPLACE FUNCTION public.schedule_task_reminders()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  reminder_time TIMESTAMPTZ;
  custom_reminder_minutes INTEGER;
BEGIN
  -- Only process if the task has relevant time fields
  IF NEW.start_time IS NOT NULL OR NEW.due_date IS NOT NULL THEN
    -- DELETE existing reminders for this task to ensure idempotency
    DELETE FROM scheduled_notifications WHERE task_id = NEW.id;

    -- START TIME REMINDERS (using custom reminder_minutes)
    IF NEW.start_time IS NOT NULL THEN
      -- Get the custom reminder minutes, default to 15 if null
      custom_reminder_minutes := COALESCE(NEW.reminder_minutes, 15);
      
      -- Custom minutes before start_time
      reminder_time := NEW.start_time - (custom_reminder_minutes || ' minutes')::INTERVAL;
      IF reminder_time > NOW() THEN
        INSERT INTO scheduled_notifications (
          user_id, task_id, notification_type, scheduled_for, title, body
        ) VALUES (
          NEW.user_id,
          NEW.id,
          'task_start_reminder',
          reminder_time,
          'Task Starting Soon',
          'Your task ' || '"' || NEW.title || '"' || ' starts in ' || custom_reminder_minutes || ' minutes'
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

    -- DUE DATE REMINDERS (keep existing logic)
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