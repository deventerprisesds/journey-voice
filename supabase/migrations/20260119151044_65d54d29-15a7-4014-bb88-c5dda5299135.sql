-- Add scheduled_calls column for recurring call configuration
ALTER TABLE user_scheduling_prefs 
ADD COLUMN IF NOT EXISTS scheduled_calls JSONB DEFAULT '[]'::jsonb;

-- Add openai_voice column for OpenAI voice selection
ALTER TABLE user_scheduling_prefs 
ADD COLUMN IF NOT EXISTS openai_voice TEXT DEFAULT 'alloy';

COMMENT ON COLUMN user_scheduling_prefs.scheduled_calls IS 
  'User-defined scheduled voice calls: [{id, name, time, enabled, callType, context}]';

COMMENT ON COLUMN user_scheduling_prefs.openai_voice IS 
  'Selected OpenAI Realtime voice (alloy, echo, fable, etc.)';