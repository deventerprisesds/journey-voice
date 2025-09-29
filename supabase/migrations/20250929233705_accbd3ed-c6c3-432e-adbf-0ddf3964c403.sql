-- Set up notification cron jobs for automated delivery and scheduling

-- 1. Notification Delivery Job (every minute) - processes pending notifications
SELECT cron.schedule(
  'notification-delivery-job',
  '* * * * *', -- every minute
  $$
  SELECT
    net.http_post(
      url := 'https://wwxgajrtmslzklnyplah.supabase.co/functions/v1/notification-delivery',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3eGdhanJ0bXNsemtsbnlwbGFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0MDI3MzIsImV4cCI6MjA3Mzk3ODczMn0._M_B3093_wjfFe4vwXmKXVCcw-QG5UhRAT4-H-aGoHE"}'::jsonb,
      body := concat('{"time": "', now(), '"}')::jsonb
    ) as request_id;
  $$
);

-- 2. Notification Scheduler Job (every hour) - generates new notifications
SELECT cron.schedule(
  'notification-scheduler-job',
  '0 * * * *', -- every hour at minute 0
  $$
  SELECT
    net.http_post(
      url := 'https://wwxgajrtmslzklnyplah.supabase.co/functions/v1/notification-scheduler',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3eGdhanJ0bXNsemtsbnlwbGFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0MDI3MzIsImV4cCI6MjA3Mzk3ODczMn0._M_B3093_wjfFe4vwXmKXVCcw-QG5UhRAT4-H-aGoHE"}'::jsonb,
      body := concat('{"time": "', now(), '"}')::jsonb
    ) as request_id;
  $$
);