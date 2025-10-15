-- Part 1: Cleanup existing orphaned notifications for completed tasks
DELETE FROM scheduled_notifications
WHERE task_id IN (
  SELECT id FROM tasks 
  WHERE status = 'DONE' OR completed_at IS NOT NULL
)
AND delivered_at IS NULL
AND failed_at IS NULL;

-- Part 2: Drop the old trigger
DROP TRIGGER IF EXISTS schedule_task_reminders_trigger ON tasks;

-- Part 3: Update the trigger function to handle task completion
CREATE OR REPLACE FUNCTION public.schedule_task_reminders()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  reminder_time TIMESTAMPTZ;
  custom_reminder_minutes INTEGER;
  user_prefs RECORD;
BEGIN
  -- Load user's notification preferences
  SELECT * INTO user_prefs 
  FROM notification_prefs 
  WHERE user_id = NEW.user_id 
  LIMIT 1;

  -- If task is completed, delete all pending reminders and exit
  IF NEW.status = 'DONE' OR NEW.completed_at IS NOT NULL THEN
    DELETE FROM scheduled_notifications 
    WHERE task_id = NEW.id 
      AND delivered_at IS NULL 
      AND failed_at IS NULL;
    
    RETURN NEW;
  END IF;

  -- Only process if relevant time fields exist
  IF NEW.start_time IS NOT NULL OR NEW.due_date IS NOT NULL THEN
    -- DELETE existing reminders for this task
    DELETE FROM scheduled_notifications WHERE task_id = NEW.id;

    -- START TIME REMINDERS (only if user has enabled them)
    IF NEW.start_time IS NOT NULL AND (user_prefs IS NULL OR user_prefs.due_reminders_enabled) THEN
      custom_reminder_minutes := COALESCE(NEW.reminder_minutes, 15);
      
      reminder_time := NEW.start_time - (custom_reminder_minutes || ' minutes')::INTERVAL;
      IF reminder_time > NOW() THEN
        INSERT INTO scheduled_notifications (
          user_id, task_id, notification_type, scheduled_for, title, body
        ) VALUES (
          NEW.user_id, NEW.id, 'task_start_reminder', reminder_time,
          'Task Starting Soon',
          'Your task "' || NEW.title || '" starts in ' || custom_reminder_minutes || ' minutes'
        );
      END IF;

      IF NEW.start_time > NOW() THEN
        INSERT INTO scheduled_notifications (
          user_id, task_id, notification_type, scheduled_for, title, body
        ) VALUES (
          NEW.user_id, NEW.id, 'task_start_now', NEW.start_time,
          'Task Starting Now',
          'Your task "' || NEW.title || '" is starting now'
        );
      END IF;
    END IF;

    -- DUE DATE REMINDERS (only if enabled)
    IF NEW.due_date IS NOT NULL AND (user_prefs IS NULL OR user_prefs.due_reminders_enabled) THEN
      -- 1 day before at 9 AM
      reminder_time := (NEW.due_date - INTERVAL '1 day')::date + TIME '09:00:00';
      IF reminder_time > NOW() THEN
        INSERT INTO scheduled_notifications (
          user_id, task_id, notification_type, scheduled_for, title, body
        ) VALUES (
          NEW.user_id, NEW.id, 'due_tomorrow', reminder_time,
          'Task Due Tomorrow',
          'Your task "' || NEW.title || '" is due tomorrow'
        );
      END IF;

      -- 15 minutes before due
      reminder_time := NEW.due_date - INTERVAL '15 minutes';
      IF reminder_time > NOW() THEN
        INSERT INTO scheduled_notifications (
          user_id, task_id, notification_type, scheduled_for, title, body
        ) VALUES (
          NEW.user_id, NEW.id, 'due_soon', reminder_time,
          'Task Due Soon',
          'Your task "' || NEW.title || '" is due in 15 minutes'
        );
      END IF;

      -- At due date
      IF NEW.due_date > NOW() THEN
        INSERT INTO scheduled_notifications (
          user_id, task_id, notification_type, scheduled_for, title, body
        ) VALUES (
          NEW.user_id, NEW.id, 'due_now', NEW.due_date,
          'Task Due Now',
          'Your task "' || NEW.title || '" is due now'
        );
      END IF;
    END IF;
  END IF;

  -- TASK CREATED notification (only if enabled and this is an INSERT)
  IF TG_OP = 'INSERT' AND (user_prefs IS NULL OR user_prefs.task_created_enabled = TRUE) THEN
    INSERT INTO scheduled_notifications (
      user_id, task_id, notification_type, scheduled_for, title, body
    ) VALUES (
      NEW.user_id, NEW.id, 'task_created', NOW(),
      'New Task Created',
      'Task "' || NEW.title || '" has been created'
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- Part 4: Create the new trigger with updated columns
CREATE TRIGGER schedule_task_reminders_trigger
  AFTER INSERT OR UPDATE OF status, completed_at, due_date, start_time, end_time
  ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION schedule_task_reminders();