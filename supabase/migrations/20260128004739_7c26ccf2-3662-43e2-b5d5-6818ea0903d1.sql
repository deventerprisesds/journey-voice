-- Add missing columns for enhanced pre-connect caching
ALTER TABLE pre_connect_sessions 
  ADD COLUMN IF NOT EXISTS openai_voice TEXT,
  ADD COLUMN IF NOT EXISTS phone_call_mode TEXT DEFAULT 'media_streams',
  ADD COLUMN IF NOT EXISTS rag_context TEXT,
  ADD COLUMN IF NOT EXISTS instructions TEXT,
  ADD COLUMN IF NOT EXISTS thread_id UUID;

-- Index on thread_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_pre_connect_thread 
  ON pre_connect_sessions(thread_id);