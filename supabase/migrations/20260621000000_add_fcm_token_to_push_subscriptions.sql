-- Add FCM token column for Android bridge native notification routing
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS fcm_token text;
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_fcm_token ON push_subscriptions(fcm_token) WHERE fcm_token IS NOT NULL;
