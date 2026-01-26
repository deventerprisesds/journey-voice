-- Create assistants table for multi-assistant support
CREATE TABLE public.assistants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  avatar_url TEXT,
  avatar_initial TEXT,
  orb_color TEXT DEFAULT '#3B82F6',
  orb_animation TEXT DEFAULT 'pulse',
  openai_assistant_id TEXT,
  voice_id TEXT,
  persona_prompt TEXT,
  tools_enabled JSONB DEFAULT '[]'::jsonb,
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create index for fast user lookups
CREATE INDEX idx_assistants_user_id ON public.assistants(user_id);

-- Enable RLS
ALTER TABLE public.assistants ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own assistants"
  ON public.assistants FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own assistants"
  ON public.assistants FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own assistants"
  ON public.assistants FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own assistants"
  ON public.assistants FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger to update updated_at
CREATE TRIGGER update_assistants_updated_at
  BEFORE UPDATE ON public.assistants
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add assistant_id to ai_threads for assistant-specific conversations
ALTER TABLE public.ai_threads 
  ADD COLUMN IF NOT EXISTS assistant_id UUID REFERENCES public.assistants(id),
  ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'chat';

-- Add source and assistant_id to conversation_messages
ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'chat',
  ADD COLUMN IF NOT EXISTS assistant_id UUID REFERENCES public.assistants(id);