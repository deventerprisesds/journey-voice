import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const openaiApiKey = Deno.env.get('OPENAI_API_KEY')!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${await response.text()}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

async function storeConversationEmbedding(
  userId: string,
  threadId: string,
  content: string,
  messageType: string,
  voiceSessionId?: string,
  metadata: any = {}
) {
  const embedding = await generateEmbedding(content);
  
  const { error } = await supabase
    .from('conversation_embeddings')
    .insert({
      user_id: userId,
      thread_id: threadId,
      content,
      embedding,
      message_type: messageType,
      voice_session_id: voiceSessionId,
      metadata
    });

  if (error) {
    console.error('Error storing conversation embedding:', error);
    throw error;
  }
}

async function storeConversationMessage(
  userId: string,
  threadId: string,
  role: string,
  content: string,
  audioTranscript?: string,
  voiceSessionId?: string,
  assistantId?: string,
  source?: string,
  metadata: any = {}
) {
  const { error } = await supabase
    .from('conversation_messages')
    .insert({
      user_id: userId,
      thread_id: threadId,
      role,
      content,
      audio_transcript: audioTranscript,
      voice_session_id: voiceSessionId,
      assistant_id: assistantId || null,
      source: source || 'chat',
      metadata
    });

  if (error) {
    console.error('Error storing conversation message:', error);
    throw error;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      userId, 
      threadId, 
      assistantId,
      source,
      content, 
      messageType, 
      role, 
      audioTranscript, 
      voiceSessionId, 
      metadata,
      action = 'store_conversation'
    } = await req.json();

    console.log(`Processing ${action} for user ${userId}, source=${source || 'chat'}, assistantId=${assistantId || 'none'}`);

    if (action === 'store_conversation') {
      // Store both embedding and full message
      await Promise.all([
        storeConversationEmbedding(userId, threadId, content, messageType, voiceSessionId, metadata),
        storeConversationMessage(userId, threadId, role, content, audioTranscript, voiceSessionId, assistantId, source, metadata)
      ]);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'generate_embedding') {
      const embedding = await generateEmbedding(content);
      
      return new Response(JSON.stringify({ embedding }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    throw new Error('Invalid action specified');

  } catch (error) {
    console.error('Error in generate-embeddings function:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
