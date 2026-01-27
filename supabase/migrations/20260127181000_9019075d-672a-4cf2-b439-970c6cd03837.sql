-- Create unified activity_log table
CREATE TABLE public.activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  
  -- Activity identification
  activity_type TEXT NOT NULL,  -- 'phone_inbound', 'phone_outbound', 'voice_webrtc', 'chat'
  session_id TEXT,              -- WR... for WebRTC, MZ... for Twilio, thread_... for chat
  
  -- Status tracking
  status TEXT NOT NULL,         -- 'started', 'connected', 'completed', 'failed', 'error'
  stage TEXT,                   -- 'webhook', 'token_fetch', 'webrtc_setup', 'transcript_save'
  
  -- Error details
  error_message TEXT,
  error_code TEXT,
  
  -- Metrics
  duration_seconds INTEGER,
  message_count INTEGER DEFAULT 0,
  
  -- Rich context
  metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Fast lookup indexes
CREATE INDEX idx_activity_log_user_time ON activity_log(user_id, created_at DESC);
CREATE INDEX idx_activity_log_session ON activity_log(session_id);
CREATE INDEX idx_activity_log_status ON activity_log(status);

-- Enable RLS
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- Users can view their own activity
CREATE POLICY "Users can view their own activity" ON activity_log
  FOR SELECT USING (auth.uid() = user_id);

-- Service role can manage all activity (for edge functions)
CREATE POLICY "Service role can manage activity" ON activity_log
  FOR ALL USING (true);

-- Create debug_timeline view for unified debugging
CREATE OR REPLACE VIEW debug_timeline AS
SELECT 
  created_at as timestamp,
  activity_type,
  status,
  stage,
  session_id,
  duration_seconds,
  message_count,
  error_message,
  user_id
FROM activity_log
WHERE created_at > NOW() - INTERVAL '24 hours'

UNION ALL

-- Include legacy call_sessions for backward compatibility
SELECT 
  started_at as timestamp,
  CASE direction 
    WHEN 'inbound' THEN 'phone_inbound'
    WHEN 'outbound' THEN 'phone_outbound'
  END as activity_type,
  CASE 
    WHEN ended_at IS NOT NULL THEN 'completed'
    ELSE 'started'
  END as status,
  'legacy' as stage,
  stream_sid as session_id,
  duration_seconds,
  NULL as message_count,
  NULL as error_message,
  user_id
FROM call_sessions
WHERE started_at > NOW() - INTERVAL '24 hours'

ORDER BY timestamp DESC;