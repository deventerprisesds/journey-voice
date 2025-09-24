-- Fix security warnings: set search_path for functions to make them secure

-- Drop and recreate functions with proper search_path settings
DROP FUNCTION IF EXISTS match_conversation_embeddings(vector, uuid, uuid, float, int);
DROP FUNCTION IF EXISTS match_assistant_knowledge(vector, uuid, text, float, int);

-- Create conversation similarity search function with secure search_path
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
SET search_path = public
AS $$
  SELECT
    conversation_embeddings.id,
    conversation_embeddings.content,
    conversation_embeddings.message_type,
    conversation_embeddings.timestamp,
    conversation_embeddings.metadata,
    1 - (conversation_embeddings.embedding <=> query_embedding) AS similarity
  FROM public.conversation_embeddings
  WHERE conversation_embeddings.user_id = user_id_param
    AND (thread_id_param IS NULL OR conversation_embeddings.thread_id = thread_id_param)
    AND 1 - (conversation_embeddings.embedding <=> query_embedding) > match_threshold
  ORDER BY conversation_embeddings.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Create assistant knowledge similarity search function with secure search_path
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
SET search_path = public
AS $$
  SELECT
    assistant_knowledge_chunks.id,
    assistant_knowledge_chunks.content,
    assistant_knowledge_chunks.source_type,
    assistant_knowledge_chunks.metadata,
    1 - (assistant_knowledge_chunks.embedding <=> query_embedding) AS similarity
  FROM public.assistant_knowledge_chunks
  WHERE assistant_knowledge_chunks.user_id = user_id_param
    AND assistant_knowledge_chunks.assistant_id = assistant_id_param
    AND 1 - (assistant_knowledge_chunks.embedding <=> query_embedding) > match_threshold
  ORDER BY assistant_knowledge_chunks.embedding <=> query_embedding
  LIMIT match_count;
$$;