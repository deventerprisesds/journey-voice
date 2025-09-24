-- Enable vector extension for similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Create conversation embeddings table for RAG
CREATE TABLE public.conversation_embeddings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  thread_id UUID REFERENCES public.ai_threads(id),
  content TEXT NOT NULL,
  embedding vector(1536),
  message_type TEXT NOT NULL CHECK (message_type IN ('user', 'assistant', 'system')),
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  metadata JSONB DEFAULT '{}'::jsonb,
  voice_session_id TEXT
);

-- Create conversation messages table for full history
CREATE TABLE public.conversation_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  thread_id UUID REFERENCES public.ai_threads(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  audio_transcript TEXT,
  voice_session_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Create assistant knowledge chunks table
CREATE TABLE public.assistant_knowledge_chunks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  assistant_id TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536),
  source_type TEXT NOT NULL CHECK (source_type IN ('instructions', 'knowledge_base', 'function_definition', 'file_content')),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.conversation_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_knowledge_chunks ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for conversation_embeddings
CREATE POLICY "Users can view their own conversation embeddings"
  ON public.conversation_embeddings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own conversation embeddings"
  ON public.conversation_embeddings FOR ALL
  USING (auth.uid() = user_id);

-- Create RLS policies for conversation_messages
CREATE POLICY "Users can view their own conversation messages"
  ON public.conversation_messages FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own conversation messages"
  ON public.conversation_messages FOR ALL
  USING (auth.uid() = user_id);

-- Create RLS policies for assistant_knowledge_chunks
CREATE POLICY "Users can view their own assistant knowledge"
  ON public.assistant_knowledge_chunks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own assistant knowledge"
  ON public.assistant_knowledge_chunks FOR ALL
  USING (auth.uid() = user_id);

-- Create indexes for performance
CREATE INDEX idx_conversation_embeddings_user_thread ON public.conversation_embeddings(user_id, thread_id);
CREATE INDEX idx_conversation_embeddings_embedding ON public.conversation_embeddings USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_conversation_messages_user_thread ON public.conversation_messages(user_id, thread_id);
CREATE INDEX idx_conversation_messages_created_at ON public.conversation_messages(created_at DESC);
CREATE INDEX idx_assistant_knowledge_user_assistant ON public.assistant_knowledge_chunks(user_id, assistant_id);
CREATE INDEX idx_assistant_knowledge_embedding ON public.assistant_knowledge_chunks USING ivfflat (embedding vector_cosine_ops);

-- Create function for conversation similarity search
CREATE OR REPLACE FUNCTION match_conversation_embeddings(
  query_embedding vector(1536),
  user_id_param uuid,
  thread_id_param uuid DEFAULT NULL,
  match_threshold float DEFAULT 0.8,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  content text,
  message_type text,
  message_timestamp timestamptz,
  metadata jsonb,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    conversation_embeddings.id,
    conversation_embeddings.content,
    conversation_embeddings.message_type,
    conversation_embeddings.timestamp,
    conversation_embeddings.metadata,
    1 - (conversation_embeddings.embedding <=> query_embedding) AS similarity
  FROM conversation_embeddings
  WHERE conversation_embeddings.user_id = user_id_param
    AND (thread_id_param IS NULL OR conversation_embeddings.thread_id = thread_id_param)
    AND 1 - (conversation_embeddings.embedding <=> query_embedding) > match_threshold
  ORDER BY conversation_embeddings.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Create function for assistant knowledge similarity search
CREATE OR REPLACE FUNCTION match_assistant_knowledge(
  query_embedding vector(1536),
  user_id_param uuid,
  assistant_id_param text,
  match_threshold float DEFAULT 0.8,
  match_count int DEFAULT 3
)
RETURNS TABLE (
  id uuid,
  content text,
  source_type text,
  metadata jsonb,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    assistant_knowledge_chunks.id,
    assistant_knowledge_chunks.content,
    assistant_knowledge_chunks.source_type,
    assistant_knowledge_chunks.metadata,
    1 - (assistant_knowledge_chunks.embedding <=> query_embedding) AS similarity
  FROM assistant_knowledge_chunks
  WHERE assistant_knowledge_chunks.user_id = user_id_param
    AND assistant_knowledge_chunks.assistant_id = assistant_id_param
    AND 1 - (assistant_knowledge_chunks.embedding <=> query_embedding) > match_threshold
  ORDER BY assistant_knowledge_chunks.embedding <=> query_embedding
  LIMIT match_count;
$$;