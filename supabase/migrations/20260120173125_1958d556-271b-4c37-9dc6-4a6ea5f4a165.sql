-- Call Sessions: Track overall call metadata
CREATE TABLE public.call_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  call_sid TEXT UNIQUE NOT NULL,
  stream_sid TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_number TEXT,
  to_number TEXT,
  call_context TEXT,
  tts_provider TEXT DEFAULT 'elevenlabs',
  started_at TIMESTAMPTZ DEFAULT now(),
  first_audio_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  greeting_latency_ms INTEGER,
  metadata JSONB DEFAULT '{}'
);

-- Call Messages: Full transcript with timing
CREATE TABLE public.call_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_session_id UUID NOT NULL REFERENCES public.call_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL,
  message_index INTEGER NOT NULL,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  latency_ms INTEGER,
  tool_name TEXT,
  tool_input JSONB,
  tool_output JSONB,
  audio_duration_ms INTEGER,
  word_count INTEGER,
  metadata JSONB DEFAULT '{}'
);

-- Indexes for efficient queries
CREATE INDEX idx_call_sessions_user ON public.call_sessions(user_id, started_at DESC);
CREATE INDEX idx_call_sessions_sid ON public.call_sessions(call_sid);
CREATE INDEX idx_call_messages_session ON public.call_messages(call_session_id, message_index);
CREATE INDEX idx_call_messages_user ON public.call_messages(user_id, started_at DESC);

-- Enable RLS
ALTER TABLE public.call_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies for call_sessions
CREATE POLICY "Users can view their own call sessions"
  ON public.call_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert call sessions"
  ON public.call_sessions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role can update call sessions"
  ON public.call_sessions FOR UPDATE
  USING (true);

-- RLS Policies for call_messages
CREATE POLICY "Users can view their own call messages"
  ON public.call_messages FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert call messages"
  ON public.call_messages FOR INSERT
  WITH CHECK (true);