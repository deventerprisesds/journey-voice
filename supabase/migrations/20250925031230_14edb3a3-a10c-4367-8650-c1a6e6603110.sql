-- Fix remaining security warning by setting search_path for log_task_changes function
CREATE OR REPLACE FUNCTION public.log_task_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    INSERT INTO public.task_events (task_id, event_type, old_values, new_values, user_id)
    VALUES (
      NEW.id,
      'UPDATE',
      to_jsonb(OLD),
      to_jsonb(NEW),
      NEW.user_id
    );
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.task_events (task_id, event_type, new_values, user_id)
    VALUES (
      NEW.id,
      'CREATE',
      to_jsonb(NEW),
      NEW.user_id
    );
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;