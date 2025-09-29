-- Enable required extensions for cron jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule notification-scheduler to run every 5 minutes
SELECT cron.schedule(
  'notification-scheduler-job',
  '*/5 * * * *',
  $$
  SELECT
    net.http_post(
        url:='https://wwxgajrtmslzklnyplah.supabase.co/functions/v1/notification-scheduler',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3eGdhanJ0bXNsemtsbnlwbGFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0MDI3MzIsImV4cCI6MjA3Mzk3ODczMn0._M_B3093_wjfFe4vwXmKXVCcw-QG5UhRAT4-H-aGoHE"}'::jsonb,
        body:='{"trigger": "cron"}'::jsonb
    ) as request_id;
  $$
);

-- Schedule notification-delivery to run every minute  
SELECT cron.schedule(
  'notification-delivery-job',
  '* * * * *',
  $$
  SELECT
    net.http_post(
        url:='https://wwxgajrtmslzklnyplah.supabase.co/functions/v1/notification-delivery',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3eGdhanJ0bXNsemtsbnlwbGFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0MDI3MzIsImV4cCI6MjA3Mzk3ODczMn0._M_B3093_wjfFe4vwXmKXVCcw-QG5UhRAT4-H-aGoHE"}'::jsonb,
        body:='{"trigger": "cron"}'::jsonb
    ) as request_id;
  $$
);