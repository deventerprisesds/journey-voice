-- Add phone field to profiles table
ALTER TABLE profiles ADD COLUMN phone text;

-- Create new notification_channel enum with EMAIL, SMS, SLACK
CREATE TYPE notification_channel_new AS ENUM ('EMAIL', 'SMS', 'SLACK');

-- Update notification_prefs table to use the new enum
ALTER TABLE notification_prefs ADD COLUMN channels_new notification_channel_new[] DEFAULT '{EMAIL}'::notification_channel_new[];
UPDATE notification_prefs SET channels_new = '{EMAIL}'::notification_channel_new[];
ALTER TABLE notification_prefs DROP COLUMN channels;
ALTER TABLE notification_prefs RENAME COLUMN channels_new TO channels;

-- Update delivery_logs table to use the new enum
ALTER TABLE delivery_logs ADD COLUMN channel_new notification_channel_new;
-- Set a default value for existing rows
UPDATE delivery_logs SET channel_new = 'EMAIL'::notification_channel_new;
-- Make the new column NOT NULL
ALTER TABLE delivery_logs ALTER COLUMN channel_new SET NOT NULL;
-- Drop old column and rename
ALTER TABLE delivery_logs DROP COLUMN channel;
ALTER TABLE delivery_logs RENAME COLUMN channel_new TO channel;

-- Now we can safely drop the old enum and rename the new one
DROP TYPE notification_channel;
ALTER TYPE notification_channel_new RENAME TO notification_channel;