-- Update the schedule_task_reminders function to use 3 minutes instead of 15 minutes
CREATE OR REPLACE FUNCTION schedule_task_reminders()
RETURNS TRIGGER AS $$
DECLARE
  reminder_time TIMESTAMPTZ;
BEGIN
  -- Only process if the task has relevant time fields
  IF NEW.start_time IS NOT NULL OR NEW.due_date IS NOT NULL OR NEW.end_time IS NOT NULL THEN
    
    -- Delete existing reminders for this task to avoid duplicates
    DELETE FROM scheduled_notifications WHERE task_id = NEW.id;
    
    -- Create reminder 3 minutes before start_time
    IF NEW.start_time IS NOT NULL THEN
      reminder_time := NEW.start_time - INTERVAL '3 minutes';
      IF reminder_time > NOW() THEN
        INSERT INTO scheduled_notifications (
          user_id,
          task_id,
          notification_type,
          scheduled_for,
          title,
          message,
          status
        ) VALUES (
          NEW.user_id,
          NEW.id,
          'TASK_REMINDER',
          reminder_time,
          'Task Starting Soon',
          'Your task "' || NEW.title || '" starts in 3 minutes',
          'PENDING'
        );
      END IF;
    END IF;
    
    -- Create reminder on due_date at 9 AM
    IF NEW.due_date IS NOT NULL THEN
      reminder_time := NEW.due_date + TIME '09:00:00';
      IF reminder_time > NOW() THEN
        INSERT INTO scheduled_notifications (
          user_id,
          task_id,
          notification_type,
          scheduled_for,
          title,
          message,
          status
        ) VALUES (
          NEW.user_id,
          NEW.id,
          'TASK_REMINDER',
          reminder_time,
          'Task Due Today',
          'Your task "' || NEW.title || '" is due today',
          'PENDING'
        );
      END IF;
    END IF;
    
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;