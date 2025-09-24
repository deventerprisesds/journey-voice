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

async function getRelevantContext(
  userInput: string,
  userId: string,
  threadId?: string,
  assistantId?: string
) {
  // Generate embedding for current input
  const embedding = await generateEmbedding(userInput);
  
  console.log(`Searching for context for user ${userId}, thread ${threadId}`);

  // Search conversation history
  const { data: conversationContext, error: convError } = await supabase
    .rpc('match_conversation_embeddings', {
      query_embedding: embedding,
      user_id_param: userId,
      thread_id_param: threadId || null,
      match_threshold: 0.7,
      match_count: 5
    });

  if (convError) {
    console.error('Error searching conversation context:', convError);
  }

  // Search assistant knowledge if assistant ID provided
  let knowledgeContext = [];
  if (assistantId) {
    const { data: knowledge, error: knowledgeError } = await supabase
      .rpc('match_assistant_knowledge', {
        query_embedding: embedding,
        user_id_param: userId,
        assistant_id_param: assistantId,
        match_threshold: 0.7,
        match_count: 3
      });

    if (knowledgeError) {
      console.error('Error searching knowledge context:', knowledgeError);
    } else {
      knowledgeContext = knowledge || [];
    }
  }

  return {
    conversationContext: conversationContext || [],
    knowledgeContext,
    embedding
  };
}

function shouldUseAssistantAPI(userInput: string, context: any): boolean {
  const complexityIndicators = [
    'analyze', 'research', 'explain in detail', 'compare', 'generate report',
    'summarize', 'write', 'create content', 'how does', 'what is the difference',
    'pros and cons', 'best practices', 'recommendations'
  ];
  
  const hasComplexHistory = context.conversationContext.some((c: any) => 
    c.metadata?.complexity_score > 0.7 || c.content.length > 200
  );
  
  const needsKnowledgeBase = context.knowledgeContext.length > 0 && 
    context.knowledgeContext[0].similarity > 0.8;
  
  const hasComplexInput = userInput.length > 100 || 
    complexityIndicators.some(indicator => 
      userInput.toLowerCase().includes(indicator)
    );

  console.log('Routing decision factors:', {
    hasComplexInput,
    hasComplexHistory,
    needsKnowledgeBase,
    contextLength: context.conversationContext.length,
    knowledgeLength: context.knowledgeContext.length
  });
  
  return hasComplexInput || hasComplexHistory || needsKnowledgeBase;
}

function buildContextualInstructions(baseInstructions: string, context: any, userInput: string): string {
  const conversationHistory = context.conversationContext
    .slice(0, 5) // Last 5 relevant messages
    .map((c: any) => `[${new Date(c.message_timestamp).toLocaleString()}] ${c.message_type}: ${c.content}`)
    .join('\n');

  const relevantKnowledge = context.knowledgeContext
    .slice(0, 3) // Top 3 relevant knowledge pieces
    .map((k: any) => `${k.source_type}: ${k.content}`)
    .join('\n');

  let contextualInstructions = baseInstructions;

  if (conversationHistory) {
    contextualInstructions += `\n\nRELEVANT CONVERSATION HISTORY:\n${conversationHistory}`;
  }

  if (relevantKnowledge) {
    contextualInstructions += `\n\nRELEVANT KNOWLEDGE:\n${relevantKnowledge}`;
  }

  contextualInstructions += `\n\nCURRENT USER INPUT: ${userInput}`;
  contextualInstructions += `\n\nUse this context to provide more personalized and informed responses. Reference the conversation history when relevant.`;

  return contextualInstructions;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      userInput, 
      userId, 
      threadId, 
      assistantId = 'asst_BcZBxlx9zH8VIPvfJrhPP3EF',
      baseInstructions = 'You are a helpful voice assistant for task management.',
      action = 'get_context'
    } = await req.json();

    console.log(`Processing ${action} for user ${userId}`);

    if (action === 'get_context') {
      const context = await getRelevantContext(userInput, userId, threadId, assistantId);
      const useAssistantAPI = shouldUseAssistantAPI(userInput, context);
      const contextualInstructions = buildContextualInstructions(baseInstructions, context, userInput);

      return new Response(JSON.stringify({ 
        context,
        useAssistantAPI,
        contextualInstructions,
        routing: {
          reason: useAssistantAPI ? 'Complex query requiring assistant API' : 'Simple query for realtime API',
          conversationContextCount: context.conversationContext.length,
          knowledgeContextCount: context.knowledgeContext.length
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'should_use_assistant') {
      const context = await getRelevantContext(userInput, userId, threadId, assistantId);
      const useAssistantAPI = shouldUseAssistantAPI(userInput, context);
      
      return new Response(JSON.stringify({ 
        useAssistantAPI,
        reason: useAssistantAPI ? 'Complex query' : 'Simple query',
        contextSummary: {
          conversationMatches: context.conversationContext.length,
          knowledgeMatches: context.knowledgeContext.length
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    throw new Error('Invalid action specified');

  } catch (error) {
    console.error('Error in rag-context-retrieval function:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});