-- Mirror every task change to the Huddle app so Huddle can run prioritization
-- supabase-independently. The trigger POSTs to the huddle-task-sync edge function; that
-- function resolves the owner email (with its own injected service key) and forwards the
-- change to Huddle's webhook using the shared JOURNEY_PROXY_TOKEN (an edge secret).
-- Covers INSERT/UPDATE/DELETE; DELETE is the only deletion signal (tasks are hard-deleted).
-- SECURITY DEFINER + errors swallowed so task writes never fail on the mirror.
--
-- The project URL and anon key below are PUBLIC (the anon key ships in the client app), so
-- hardcoding them here exposes no secret. The anon key only satisfies the edge function's
-- verify_jwt; no service key or private secret is stored in the database.

CREATE OR REPLACE FUNCTION public.notify_huddle_task_sync()
RETURNS TRIGGER AS $$
DECLARE
  rec RECORD;
BEGIN
  rec := COALESCE(NEW, OLD);

  PERFORM net.http_post(
    url := 'https://wwxgajrtmslzklnyplah.supabase.co/functions/v1/huddle-task-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3eGdhanJ0bXNsemtsbnlwbGFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0MDI3MzIsImV4cCI6MjA3Mzk3ODczMn0._M_B3093_wjfFe4vwXmKXVCcw-QG5UhRAT4-H-aGoHE'
    ),
    body := jsonb_build_object(
      'operation', TG_OP,
      'user_id', rec.user_id,
      'task', to_jsonb(rec)
    )
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Huddle task sync failed: %', SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS huddle_task_sync_trigger ON public.tasks;
CREATE TRIGGER huddle_task_sync_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_huddle_task_sync();
