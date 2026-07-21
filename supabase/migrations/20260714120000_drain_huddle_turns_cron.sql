-- Heartbeat that makes Huddle chat replies device-independent.
--
-- A Huddle chat turn is persisted server-side and normally runs in the user's own request. If that
-- request dies mid-turn (phone backgrounded, screen off, app closed) the turn is left queued or
-- stale-running. This per-minute job pings the `drain-huddle-turns` edge function, which POSTs to
-- Huddle's /api/public/run-turn drain endpoint (auth via the shared JOURNEY_PROXY_TOKEN held in edge
-- secrets — never in the DB) to finish any such turn and fire its Web Push. journey is always-on, so
-- a turn never strands on a sleeping device.
--
-- Mirrors the run-scheduled-ceremonies-job pattern (net.http_post to an edge fn, no JWT). Idempotent:
-- drops any existing job of the same name first so re-applying is safe.

do $$
begin
  perform cron.unschedule('drain-huddle-turns-job');
exception
  when others then null; -- not scheduled yet
end $$;

select cron.schedule(
  'drain-huddle-turns-job',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://wwxgajrtmslzklnyplah.supabase.co/functions/v1/drain-huddle-turns',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := concat('{"time": "', now(), '"}')::jsonb
  ) as request_id;
  $$
);
