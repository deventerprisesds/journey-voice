-- Create cron job to check scheduled calls every minute (same pattern as notification-delivery-job)
SELECT cron.schedule(
  'twilio-scheduled-call-job',
  '* * * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://wwxgajrtmslzklnyplah.supabase.co/functions/v1/twilio-scheduled-call',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3eGdhanJ0bXNsemtsbnlwbGFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0MDI3MzIsImV4cCI6MjA3Mzk3ODczMn0._M_B3093_wjfFe4vwXmKXVCcw-QG5UhRAT4-H-aGoHE"}'::jsonb,
      body := '{"trigger": "cron", "checkRecurring": true}'::jsonb
    ) as request_id;
  $$
);