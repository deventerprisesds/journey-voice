-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS schedule_task_reminders_trigger ON public.tasks;

-- Create function to automatically schedule task reminders
CREATE OR REPLACE FUNCTION public.schedule_task_reminders()
RETURNS TRIGGER AS $$
BEGIN
  -- Delete existing reminders for this task
  DELETE FROM public.scheduled_notifications 
  WHERE task_id = NEW.id 
    AND notification_type IN (
      'scheduled_reminder', 
      'scheduled_start_now', 
      'due_reminder_15min', 
      'due_reminder_now', 
      'due_reminder_1day'
    );

  -- Schedule start time reminders (15 min before and at start time)
  IF NEW.start_time IS NOT NULL THEN
    -- 15 minutes before start
    IF NEW.start_time - INTERVAL '15 minutes' > now() THEN
      INSERT INTO public.scheduled_notifications (
        user_id, task_id, notification_type, title, body, scheduled_for
      ) VALUES (
        NEW.user_id, 
        NEW.id, 
        'scheduled_reminder',
        'Task Starting Soon',
        'Task "' || NEW.title || '" starts in 15 minutes',
        NEW.start_time - INTERVAL '15 minutes'
      );
    END IF;
    
    -- At start time
    IF NEW.start_time > now() THEN
      INSERT INTO public.scheduled_notifications (
        user_id, task_id, notification_type, title, body, scheduled_for
      ) VALUES (
        NEW.user_id, 
        NEW.id, 
        'scheduled_start_now',
        'Task Starting Now',
        'Task "' || NEW.title || '" is starting now',
        NEW.start_time
      );
    END IF;
  END IF;

  -- Schedule due date reminders (1 day before, 15 min before, and at due time)
  IF NEW.due_date IS NOT NULL THEN
    -- 1 day before due
    IF NEW.due_date - INTERVAL '1 day' > now() THEN
      INSERT INTO public.scheduled_notifications (
        user_id, task_id, notification_type, title, body, scheduled_for
      ) VALUES (
        NEW.user_id, 
        NEW.id, 
        'due_reminder_1day',
        'Task Due Tomorrow',
        'Task "' || NEW.title || '" is due tomorrow',
        NEW.due_date - INTERVAL '1 day'
      );
    END IF;
    
    -- 15 minutes before due
    IF NEW.due_date - INTERVAL '15 minutes' > now() THEN
      INSERT INTO public.scheduled_notifications (
        user_id, task_id, notification_type, title, body, scheduled_for
      ) VALUES (
        NEW.user_id, 
        NEW.id, 
        'due_reminder_15min',
        'Task Due Soon',
        'Task "' || NEW.title || '" is due in 15 minutes',
        NEW.due_date - INTERVAL '15 minutes'
      );
    END IF;
    
    -- At due time
    IF NEW.due_date > now() THEN
      INSERT INTO public.scheduled_notifications (
        user_id, task_id, notification_type, title, body, scheduled_for
      ) VALUES (
        NEW.user_id, 
        NEW.id, 
        'due_reminder_now',
        'Task Due Now',
        'Task "' || NEW.title || '" is due now',
        NEW.due_date
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger to automatically schedule reminders when tasks are created or updated
CREATE TRIGGER schedule_task_reminders_trigger
  AFTER INSERT OR UPDATE OF due_date, start_time, end_time ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.schedule_task_reminders();

-- Update cron job to run every minute
SELECT cron.unschedule('notification-scheduler-job');
SELECT cron.schedule(
  'notification-scheduler-job',
  '* * * * *', -- every minute
  $$
  select
    net.http_post(
        url:='https://wwxgajrtmslzklnyplah.supabase.co/functions/v1/notification-scheduler',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3eGdhanJ0bXNsemtsbnlwbGFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0MDI3MzIsImV4cCI6MjA3Mzk3ODczMn0._M_B3093_wjfFe4vwXmKXVCcw-QG5UhRAT4-H-aGoHE"}'::jsonb,
        body:=concat('{"time": "', now(), '"}')::jsonb
    ) as request_id;
  $$
);