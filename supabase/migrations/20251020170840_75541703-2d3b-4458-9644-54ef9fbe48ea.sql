-- Add auto_greeting_timeout column to user_scheduling_prefs table
ALTER TABLE user_scheduling_prefs 
ADD COLUMN IF NOT EXISTS auto_greeting_timeout INTEGER DEFAULT 5;