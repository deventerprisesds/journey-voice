-- WHAT:       the 15-minute heartbeat that fires `calendar-delta-sync` for every user with an active READ
--             calendar connection, so a meeting accepted (tentative -> accepted) or added mid-day is stored,
--             and today's plan is rebuilt by the function itself (_shared/calendar-today-change.ts).
-- WHY:        Owner 2026-11-20: "when I update it from tentative to accepted it has to immediately update on
--             my schedule otherwise meetings I planned to attend after accepting mid day are being missed
--             because they were already filtered out at the start of the day". calendar-delta-sync had NO
--             cron: it ran only from nightly-schedule-builder (03:00 UTC), the 06:00 briefing, and app open.
-- SUPERSEDES: nothing
-- SUPERSEDED-BY: nothing -- current
-- EVIDENCE:   docs/qc-evidence/BUILD-tentative-group-only.md.
--
-- ONE call per tick, no user_id in the body: calendar-delta-sync with no user_id/connection_id already
-- selects EVERY active connection with the READ purpose (`is_active = true`, `purposes @> {READ}`) and
-- syncs each, so it covers every user with an active calendar connection without a per-user loop here.
-- `[functions.calendar-delta-sync] verify_jwt = false` is already in supabase/config.toml, so a call with
-- no Authorization header (the shape send-digests-job uses) is accepted.
--
-- Mirrors send-digests-job (20260913170000): net.http_post to an edge fn, no JWT, the PUBLIC project URL
-- inline (CLAUDE.md: never read app.settings). Idempotent: drops any existing job of the same name first.

do $$
begin
  perform cron.unschedule('calendar-delta-sync-job');
exception
  when others then null; -- not scheduled yet
end $$;

select cron.schedule(
  'calendar-delta-sync-job',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://wwxgajrtmslzklnyplah.supabase.co/functions/v1/calendar-delta-sync',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := concat('{"time": "', now(), '"}')::jsonb
  ) as request_id;
  $$
);
