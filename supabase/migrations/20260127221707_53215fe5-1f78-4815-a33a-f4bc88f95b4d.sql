-- Create conversation_agenda table for shared agenda state across all interfaces
CREATE TABLE public.conversation_agenda (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES ai_threads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  
  -- Agenda item details
  item_index INTEGER NOT NULL,
  item_text TEXT NOT NULL,
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  -- Tangent/pause tracking
  paused_for TEXT,
  paused_at TIMESTAMPTZ,
  
  -- Context
  source TEXT,
  metadata JSONB DEFAULT '{}',
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(thread_id, item_index)
);

-- Indexes for fast queries
CREATE INDEX idx_conversation_agenda_thread ON conversation_agenda(thread_id);
CREATE INDEX idx_conversation_agenda_user_status ON conversation_agenda(user_id, status);

-- Enable RLS
ALTER TABLE conversation_agenda ENABLE ROW LEVEL SECURITY;

-- RLS policy for users to manage their own agenda items
CREATE POLICY "Users manage own agenda" ON conversation_agenda
  FOR ALL USING (auth.uid() = user_id);

-- Demo mode policy for Lovable preview
CREATE POLICY "Demo user agenda access" ON conversation_agenda
  FOR ALL USING (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- Trigger for updated_at
CREATE TRIGGER update_conversation_agenda_updated_at
  BEFORE UPDATE ON conversation_agenda
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();