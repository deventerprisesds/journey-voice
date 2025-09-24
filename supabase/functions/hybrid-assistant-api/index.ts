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

async function handleAssistantRequest(
  userInput: string,
  userId: string,
  threadId: string,
  assistantId: string,
  contextualInstructions?: string
) {
  console.log(`Processing assistant request for user ${userId}, thread ${threadId}`);

  try {
    // Get or create OpenAI thread
    let openaiThreadId: string;
    
    // Check if we have an existing OpenAI thread for this conversation
    const { data: existingThread } = await supabase
      .from('ai_threads')
      .select('openai_thread_id')
      .eq('id', threadId)
      .eq('user_id', userId)
      .single();

    if (existingThread?.openai_thread_id) {
      openaiThreadId = existingThread.openai_thread_id;
      console.log(`Using existing OpenAI thread: ${openaiThreadId}`);
    } else {
      // Create new OpenAI thread
      const threadResponse = await fetch('https://api.openai.com/v1/threads', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
          'OpenAI-Beta': 'assistants=v2'
        },
        body: JSON.stringify({})
      });

      if (!threadResponse.ok) {
        throw new Error(`Failed to create thread: ${await threadResponse.text()}`);
      }

      const threadData = await threadResponse.json();
      openaiThreadId = threadData.id;

      // Update our thread record with OpenAI thread ID
      await supabase
        .from('ai_threads')
        .update({ openai_thread_id: openaiThreadId })
        .eq('id', threadId)
        .eq('user_id', userId);

      console.log(`Created new OpenAI thread: ${openaiThreadId}`);
    }

    // Add message to thread
    const messageResponse = await fetch(`https://api.openai.com/v1/threads/${openaiThreadId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify({
        role: 'user',
        content: userInput
      })
    });

    if (!messageResponse.ok) {
      throw new Error(`Failed to add message: ${await messageResponse.text()}`);
    }

    // Create run with contextual instructions if provided
    const runPayload: any = {
      assistant_id: assistantId
    };

    if (contextualInstructions) {
      runPayload.additional_instructions = contextualInstructions;
    }

    const runResponse = await fetch(`https://api.openai.com/v1/threads/${openaiThreadId}/runs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
      },
      body: JSON.stringify(runPayload)
    });

    if (!runResponse.ok) {
      throw new Error(`Failed to create run: ${await runResponse.text()}`);
    }

    const runData = await runResponse.json();
    const runId = runData.id;

    console.log(`Created run: ${runId}`);

    // Wait for completion (with timeout)
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds timeout
    let runStatus = 'queued';

    while (attempts < maxAttempts && !['completed', 'failed', 'cancelled', 'expired'].includes(runStatus)) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;

      const statusResponse = await fetch(`https://api.openai.com/v1/threads/${openaiThreadId}/runs/${runId}`, {
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'OpenAI-Beta': 'assistants=v2'
        }
      });

      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        runStatus = statusData.status;
        console.log(`Run status: ${runStatus}`);

        if (runStatus === 'requires_action') {
          // Handle function calls if needed
          console.log('Run requires action - function calls needed');
          // For now, we'll let it timeout and return an error
          // In a full implementation, you'd handle the function calls here
        }
      }
    }

    if (runStatus !== 'completed') {
      throw new Error(`Run did not complete successfully. Status: ${runStatus}`);
    }

    // Get the assistant's response
    const messagesResponse = await fetch(`https://api.openai.com/v1/threads/${openaiThreadId}/messages`, {
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'OpenAI-Beta': 'assistants=v2'
      }
    });

    if (!messagesResponse.ok) {
      throw new Error(`Failed to get messages: ${await messagesResponse.text()}`);
    }

    const messagesData = await messagesResponse.json();
    const assistantMessage = messagesData.data.find((msg: any) => 
      msg.role === 'assistant' && msg.run_id === runId
    );

    if (!assistantMessage) {
      throw new Error('No assistant response found');
    }

    const responseContent = assistantMessage.content
      .filter((content: any) => content.type === 'text')
      .map((content: any) => content.text.value)
      .join('\n');

    console.log(`Assistant response: ${responseContent.substring(0, 100)}...`);

    return {
      success: true,
      response: responseContent,
      threadId: openaiThreadId,
      runId
    };

  } catch (error) {
    console.error('Error in assistant request:', error);
    throw error;
  }
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
      contextualInstructions
    } = await req.json();

    console.log(`Processing hybrid assistant request for user ${userId}`);

    const result = await handleAssistantRequest(
      userInput, 
      userId, 
      threadId, 
      assistantId, 
      contextualInstructions
    );

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in hybrid-assistant-api function:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});