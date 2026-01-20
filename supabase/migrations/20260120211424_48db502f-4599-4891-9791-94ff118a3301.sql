-- Create pre_connect_sessions table for persistent session storage across Edge Function instances
CREATE TABLE pre_connect_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT UNIQUE NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  context TEXT,
  agenda JSONB,
  timezone TEXT DEFAULT 'America/New_York',
  profile JSONB,
  greeting_text TEXT,
  audio_base64 TEXT,
  tts_provider TEXT DEFAULT 'openai',
  voice_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '2 minutes')
);

-- Indexes for fast lookup and cleanup
CREATE INDEX idx_pre_connect_session_id ON pre_connect_sessions(session_id);
CREATE INDEX idx_pre_connect_expires ON pre_connect_sessions(expires_at);

-- RLS: Only service role can access (edge functions use service key)
ALTER TABLE pre_connect_sessions ENABLE ROW LEVEL SECURITY;

-- Add master toggle column to user_scheduling_prefs
ALTER TABLE user_scheduling_prefs 
ADD COLUMN recurring_calls_enabled BOOLEAN DEFAULT true;