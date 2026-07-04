ALTER TABLE notification_prefs
  ADD COLUMN IF NOT EXISTS morning_review_enabled boolean DEFAULT true;
