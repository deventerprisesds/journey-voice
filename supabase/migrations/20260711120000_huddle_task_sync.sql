-- Mirror every task change to the Huddle app so Huddle can run prioritization
-- supabase-independently. Modeled on notify_task_topic_classification (20260205142334):
-- the trigger POSTs to a journey edge function (huddle-task-sync) using the already-configured
-- app.settings.supabase_url + service_role_key; that edge function forwards to Huddle's webhook
-- with the shared secret (kept in Supabase edge secrets, synced from the GitHub org secret by
-- deploy-supabase-functions.yml — no DB-level secret and nothing hand-typed).
-- Covers INSERT/UPDATE/DELETE; DELETE is the only deletion signal (tasks are hard-deleted).
-- SECURITY DEFINER + errors swallowed so task writes never fail on the mirror.

CREATE OR REPLACE FUNCTION public.notify_huddle_task_sync()
RETURNS TRIGGER AS $$
DECLARE
  supabase_url TEXT;
  service_key  TEXT;
  rec          RECORD;
BEGIN
  supabase_url := current_setting('app.settings.supabase_url', true);
  service_key  := current_setting('app.settings.service_role_key', true);

  -- Not configured → skip silently (task writes must never fail on the mirror).
  IF supabase_url IS NULL OR service_key IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  rec := COALESCE(NEW, OLD);

  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/huddle-task-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
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
