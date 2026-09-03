-- Audit trail could not record DELETEs — two independent defects:
--   1. task_events.task_id had FOREIGN KEY ... ON DELETE CASCADE, so deleting a task deleted its
--      ENTIRE audit history along with it. An audit table must outlive the row it describes; a
--      cascading FK to the parent defeats its whole purpose.
--   2. log_task_changes() only handled INSERT/UPDATE and its trigger only fired on INSERT OR UPDATE.
-- Consequence: a deletion left no trace at all and was unreconstructable (55 rows vanished
-- 2026-08-21 with nothing recorded).

-- 1. Break the cascade. task_id stays a plain uuid (indexed) pointing at a possibly-gone task.
ALTER TABLE public.task_events DROP CONSTRAINT IF EXISTS task_events_task_id_fkey;

-- 2. Teach the existing audit function about DELETE. Extends the current function rather than
--    adding a parallel audit system.
CREATE OR REPLACE FUNCTION public.log_task_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    INSERT INTO public.task_events (task_id, event_type, old_values, new_values, user_id)
    VALUES (NEW.id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), NEW.user_id);
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.task_events (task_id, event_type, new_values, user_id)
    VALUES (NEW.id, 'CREATE', to_jsonb(NEW), NEW.user_id);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- The full row is captured in old_values, so a deleted task can be reconstructed in full.
    -- Wrapped defensively, mirroring notify_huddle_task_sync: an audit failure must never abort
    -- the user's delete. The trade-off is deliberate — a missed audit row beats a broken board.
    BEGIN
      INSERT INTO public.task_events (task_id, event_type, old_values, user_id)
      VALUES (OLD.id, 'DELETE', to_jsonb(OLD), OLD.user_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'log_task_changes: could not audit delete of task %: %', OLD.id, SQLERRM;
    END;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;

-- 3. Fire it on DELETE too (was INSERT OR UPDATE only).
DROP TRIGGER IF EXISTS log_task_changes_trigger ON public.tasks;
CREATE TRIGGER log_task_changes_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.log_task_changes();
