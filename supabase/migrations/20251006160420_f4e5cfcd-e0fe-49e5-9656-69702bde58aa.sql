-- Add timezone column to user_scheduling_prefs table
ALTER TABLE user_scheduling_prefs 
ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'America/New_York';

-- Add helpful comment
COMMENT ON COLUMN user_scheduling_prefs.timezone IS 'IANA timezone identifier for user scheduling (e.g., America/New_York, Europe/London)';