-- Restore complete reminder system with all notification types
CREATE OR REPLACE FUNCTION public.schedule_task_reminders()
RETURNS TRIGGER AS $$
DECLARE
  reminder_time TIMESTAMPTZ;
BEGIN
  -- Only process if the task has relevant time fields
  IF NEW.start_time IS NOT NULL OR NEW.due_date IS NOT NULL THEN
    
    -- Delete existing reminders for this task to avoid duplicates
    DELETE FROM scheduled_notifications WHERE task_id = NEW.id;
    
    -- ==========================================
    -- START TIME REMINDERS
    -- ==========================================
    IF NEW.start_time IS NOT NULL THEN
      -- Reminder 3 minutes before start_time
      reminder_time := NEW.start_time - INTERVAL '3 minutes';
      IF reminder_time > NOW() THEN
        INSERT INTO scheduled_notifications (
          user_id,
          task_id,
          notification_type,
          scheduled_for,
          title,
          body
        ) VALUES (
          NEW.user_id,
          NEW.id,
          'task_start_reminder',
          reminder_time,
          'Task Starting Soon',
          'Your task "' || NEW.title || '" starts in 3 minutes'
        );
      END IF;
      
      -- Reminder AT start_time (when task actually begins)
      IF NEW.start_time > NOW() THEN
        INSERT INTO scheduled_notifications (
          user_id,
          task_id,
          notification_type,
          scheduled_for,
          title,
          body
        ) VALUES (
          NEW.user_id,
          NEW.id,
          'task_start_now',
          NEW.start_time,
          'Task Starting Now',
          'Your task "' || NEW.title || '" is starting now'
        );
      END IF;
    END IF;
    
    -- ==========================================
    -- DUE DATE REMINDERS
    -- ==========================================
    IF NEW.due_date IS NOT NULL THEN
      -- Reminder 1 day before due date at 9 AM
      reminder_time := (NEW.due_date - INTERVAL '1 day')::date + TIME '09:00:00';
      IF reminder_time > NOW() THEN
        INSERT INTO scheduled_notifications (
          user_id,
          task_id,
          notification_type,
          scheduled_for,
          title,
          body
        ) VALUES (
          NEW.user_id,
          NEW.id,
          'due_tomorrow',
          reminder_time,
          'Task Due Tomorrow',
          'Your task "' || NEW.title || '" is due tomorrow'
        );
      END IF;
      
      -- Reminder 15 minutes before due date
      reminder_time := NEW.due_date - INTERVAL '15 minutes';
      IF reminder_time > NOW() THEN
        INSERT INTO scheduled_notifications (
          user_id,
          task_id,
          notification_type,
          scheduled_for,
          title,
          body
        ) VALUES (
          NEW.user_id,
          NEW.id,
          'due_soon',
          reminder_time,
          'Task Due Soon',
          'Your task "' || NEW.title || '" is due in 15 minutes'
        );
      END IF;
      
      -- Reminder AT due date (when task is actually due)
      IF NEW.due_date > NOW() THEN
        INSERT INTO scheduled_notifications (
          user_id,
          task_id,
          notification_type,
          scheduled_for,
          title,
          body
        ) VALUES (
          NEW.user_id,
          NEW.id,
          'due_now',
          NEW.due_date,
          'Task Due Now',
          'Your task "' || NEW.title || '" is due now'
        );
      END IF;
    END IF;
    
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Remove duplicate cron jobs to fix "runs twice" issue
-- Keep job ID 1 for notification-scheduler, remove job ID 7
SELECT cron.unschedule(7);

-- Keep job ID 2 for notification-delivery, remove job ID 4
SELECT cron.unschedule(4);