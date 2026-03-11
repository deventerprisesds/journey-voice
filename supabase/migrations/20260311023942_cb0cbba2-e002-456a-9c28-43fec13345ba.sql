-- Re-seed scheduling queue to use the new 8-parameter schedule_next_call
-- This triggers sync_scheduled_calls which calls the new function
UPDATE user_scheduling_prefs SET updated_at = now() WHERE scheduled_calls IS NOT NULL;