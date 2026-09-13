-- WHAT:       the 15-minute heartbeat that fires `send-digests`, the function that delivers the
--             owner's three morning digests (8am daily brief, meetings, Terry's stand-up).
-- WHY:        the function existed with a header comment reading "TRIGGER: cron every 15 minutes"
--             and NO SUCH CRON ANYWHERE. As committed it fired only if a human invoked it by hand.
--             Caught by an independent verifier, which also found the second half: without a
--             `[functions.send-digests] verify_jwt = false` block in supabase/config.toml the
--             function deploys with Supabase's default JWT check, so a cron in this shape (no
--             Authorization header, exactly like drain-huddle-turns) would have been rejected 401.
--             Both halves are needed; either alone still delivers nothing.
-- SUPERSEDES: nothing
-- SUPERSEDED-BY: nothing -- current
-- EVIDENCE:   .claude/VERIFY-digest-delivery-loop1.md, CLAIM 1b.
--
-- WHY 15 MINUTES and not a single daily 8am job: each user is gated to their OWN local 8am inside
-- the function (`shouldSendAtLocalHour`, TICK_WINDOW_MINUTES = 15), so one tick serves every
-- timezone and DST needs no schedule change. The tick width and the gate's window must stay equal --
-- a wider cron skips users, a narrower one double-sends.
--
-- Mirrors drain-huddle-turns-job: net.http_post to an edge fn, no JWT. Idempotent: drops any
-- existing job of the same name first so re-applying is safe.

do $$
begin
  perform cron.unschedule('send-digests-job');
exception
  when others then null; -- not scheduled yet
end $$;

select cron.schedule(
  'send-digests-job',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://wwxgajrtmslzklnyplah.supabase.co/functions/v1/send-digests',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := concat('{"time": "', now(), '"}')::jsonb
  ) as request_id;
  $$
);
