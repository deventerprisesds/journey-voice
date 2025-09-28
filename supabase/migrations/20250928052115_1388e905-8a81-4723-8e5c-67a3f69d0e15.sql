-- Migrate existing 'SMS' channels to use OUTLOOK_EVENT and GOOGLE_EVENT instead
UPDATE notification_prefs
SET channels = (
  SELECT ARRAY(
    SELECT DISTINCT ch::notification_channel
    FROM unnest(array_remove(channels, 'SMS'::notification_channel) || ARRAY['OUTLOOK_EVENT','GOOGLE_EVENT']::notification_channel[]) AS ch
  )
)
WHERE 'SMS'::notification_channel = ANY(channels);