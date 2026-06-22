-- Records a diagnostic snapshot every time the app loads on any device.
-- Lets us confirm APK version, JS bundle, bridge detection, and FCM token
-- state without guessing.
CREATE TABLE IF NOT EXISTS bridge_diagnostics (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- What the JS runtime sees
  is_android_bridge   boolean NOT NULL,
  user_agent          text,
  js_bundle           text,           -- Vite asset URL identifies the deployed bundle
  window_android_bridge_present  boolean,
  bridge_platform_flag  text,         -- window.__BRIDGE_PLATFORM__ value

  -- From AndroidBridge.getCapabilities() — only present when bridge detected
  apk_version         text,
  apk_platform        text,
  apk_voice_enabled   boolean,
  apk_notifications   boolean,

  -- FCM token state
  fcm_token_present   boolean,
  fcm_token_prefix    text,           -- first 20 chars so we can correlate without exposing full token

  -- Push subscription state in DB at time of load
  push_sub_endpoint   text,
  push_sub_fcm_token_present  boolean
);

ALTER TABLE bridge_diagnostics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own diagnostics"
  ON bridge_diagnostics FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read own diagnostics"
  ON bridge_diagnostics FOR SELECT
  USING (auth.uid() = user_id);
