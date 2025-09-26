-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create cron job to run notification scheduler every minute
SELECT cron.schedule(
  'invoke-notification-scheduler-every-minute',
  '* * * * *',
  $$
  SELECT
    net.http_post(
        url:='https://wwxgajrtmslzklnyplah.supabase.co/functions/v1/notification-scheduler',
        headers:='{"Content-Type": "application/json"}'::jsonb,
        body:=jsonb_build_object('time', now())
    ) as request_id;
  $$
);