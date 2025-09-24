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

async function syncAssistantKnowledge(assistantId: string, userId: string) {
  console.log(`Syncing knowledge for assistant ${assistantId}`);

  try {
    // Get assistant configuration from OpenAI
    const assistantResponse = await fetch(`https://api.openai.com/v1/assistants/${assistantId}`, {
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'OpenAI-Beta': 'assistants=v2'
      }
    });

    if (!assistantResponse.ok) {
      throw new Error(`Failed to fetch assistant: ${await assistantResponse.text()}`);
    }

    const assistant = await assistantResponse.json();
    console.log(`Retrieved assistant: ${assistant.name}`);

    // Clear existing knowledge for this assistant
    await supabase
      .from('assistant_knowledge_chunks')
      .delete()
      .eq('user_id', userId)
      .eq('assistant_id', assistantId);

    const knowledgeChunks = [];

    // Extract and chunk instructions
    if (assistant.instructions) {
      const instructionChunks = chunkText(assistant.instructions, 1000);
      for (const chunk of instructionChunks) {
        knowledgeChunks.push({
          content: chunk,
          source_type: 'instructions',
          metadata: { 
            assistant_name: assistant.name,
            chunk_type: 'instructions'
          }
        });
      }
    }

    // Extract tool definitions
    if (assistant.tools && assistant.tools.length > 0) {
      for (const tool of assistant.tools) {
        const toolDescription = `Function: ${tool.function?.name}\nDescription: ${tool.function?.description}\nParameters: ${JSON.stringify(tool.function?.parameters, null, 2)}`;
        knowledgeChunks.push({
          content: toolDescription,
          source_type: 'function_definition',
          metadata: {
            assistant_name: assistant.name,
            function_name: tool.function?.name,
            chunk_type: 'function_definition'
          }
        });
      }
    }

    // Generate embeddings and store chunks
    let processedCount = 0;
    for (const chunk of knowledgeChunks) {
      try {
        const embedding = await generateEmbedding(chunk.content);
        
        await supabase
          .from('assistant_knowledge_chunks')
          .insert({
            user_id: userId,
            assistant_id: assistantId,
            content: chunk.content,
            embedding,
            source_type: chunk.source_type,
            metadata: chunk.metadata
          });

        processedCount++;
        console.log(`Processed chunk ${processedCount}/${knowledgeChunks.length}`);
      } catch (error) {
        console.error(`Error processing chunk ${processedCount + 1}:`, error);
      }
    }

    return {
      success: true,
      message: `Successfully synced ${processedCount} knowledge chunks for assistant ${assistant.name}`,
      chunks_processed: processedCount,
      assistant_name: assistant.name
    };

  } catch (error) {
    console.error('Error syncing assistant knowledge:', error);
    throw error;
  }
}

function chunkText(text: string, maxChunkSize: number): string[] {
  const words = text.split(' ');
  const chunks = [];
  let currentChunk = '';

  for (const word of words) {
    if ((currentChunk + ' ' + word).length <= maxChunkSize) {
      currentChunk = currentChunk ? currentChunk + ' ' + word : word;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      currentChunk = word;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      assistantId = 'asst_BcZBxlx9zH8VIPvfJrhPP3EF',
      userId = '00000000-0000-0000-0000-000000000000'
    } = await req.json();

    console.log(`Processing knowledge sync for assistant ${assistantId}`);

    const result = await syncAssistantKnowledge(assistantId, userId);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in sync-assistant-knowledge function:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});