-- Mirror every task change to the Huddle app's Azure-PG store so Huddle can run
-- prioritization supabase-independently. Modeled on notify_task_topic_classification
-- (20260205142334): pg_net POST, SECURITY DEFINER, errors swallowed so task writes never fail.
-- Covers INSERT/UPDATE/DELETE (the DELETE branch is the only deletion signal — tasks are hard-deleted).
--
-- One-time config (run once, values from the Huddle deploy):
--   ALTER DATABASE postgres SET app.settings.huddle_sync_url    = 'https://<swa-host>/api/public/tasks-sync';
--   ALTER DATABASE postgres SET app.settings.huddle_sync_secret = '<same value as Huddle TASKS_SYNC_SECRET>';
-- (pg_net is already enabled in this project.)

CREATE OR REPLACE FUNCTION public.notify_huddle_task_sync()
RETURNS TRIGGER AS $$
DECLARE
  huddle_url    TEXT;
  huddle_secret TEXT;
  rec           RECORD;
  u_email       TEXT;
BEGIN
  huddle_url    := current_setting('app.settings.huddle_sync_url', true);
  huddle_secret := current_setting('app.settings.huddle_sync_secret', true);

  -- Not configured yet → skip silently (task writes must never fail on the mirror).
  IF huddle_url IS NULL OR huddle_secret IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  rec := COALESCE(NEW, OLD);

  -- Attach a human-meaningful identity (Huddle scopes by email).
  SELECT email INTO u_email FROM public.profiles WHERE user_id = rec.user_id LIMIT 1;

  PERFORM net.http_post(
    url := huddle_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', huddle_secret
    ),
    body := jsonb_build_object(
      'operation', TG_OP,
      'user_id', rec.user_id,
      'user_email', u_email,
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
