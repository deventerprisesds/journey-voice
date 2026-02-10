-- Fix the trigger to use direct project URL and anon key instead of current_setting()
CREATE OR REPLACE FUNCTION public.notify_task_topic_classification()
RETURNS TRIGGER AS $$
BEGIN
  -- Skip test tasks and blocked tasks
  IF NEW.title ILIKE '%test%' OR NEW.status = 'BLOCKED' THEN
    RETURN NEW;
  END IF;

  -- Use direct project URL and anon key (no dependency on current_setting)
  PERFORM net.http_post(
    url := 'https://wwxgajrtmslzklnyplah.supabase.co/functions/v1/classify-task-topic',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3eGdhanJ0bXNsemtsbnlwbGFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0MDI3MzIsImV4cCI6MjA3Mzk3ODczMn0._M_B3093_wjfFe4vwXmKXVCcw-QG5UhRAT4-H-aGoHE'
    ),
    body := jsonb_build_object(
      'task_id', NEW.id,
      'task_title', NEW.title,
      'task_category', NEW.category,
      'user_id', NEW.user_id,
      'operation', TG_OP
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Don't fail the task operation if classification fails
  RAISE WARNING 'Topic classification failed: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public';