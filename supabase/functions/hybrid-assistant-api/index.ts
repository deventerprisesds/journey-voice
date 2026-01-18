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

interface ToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

interface ToolOutput {
  tool_call_id: string;
  output: string;
}

// Execute tool calls via centralized execute-tool edge function
async function executeToolCall(
  toolCall: ToolCall,
  userId: string,
  userProfile?: any,
  timezone?: string
): Promise<string> {
  const { name, arguments: argsString } = toolCall.function;
  
  let args: any;
  try {
    args = JSON.parse(argsString);
  } catch (e) {
    return JSON.stringify({ error: 'Invalid tool arguments', details: argsString });
  }

  console.log(`[HYBRID] Executing tool via execute-tool: ${name}`, args);

  try {
    // Call centralized execute-tool edge function
    const response = await fetch(`${supabaseUrl}/functions/v1/execute-tool`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        toolName: name,
        args,
        userId,
        context: {
          interface: 'chat',
          timezone: timezone || 'America/New_York',
          userProfile
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[HYBRID] execute-tool error: ${response.status}`, errorText);
      return JSON.stringify({ 
        success: false, 
        error: `Tool execution failed: ${response.status}` 
      });
    }

    const result = await response.json();
    console.log(`[HYBRID] Tool result:`, result);
    
    return JSON.stringify(result);
  } catch (error) {
    console.error(`[HYBRID] Error executing tool ${name}:`, error);
    return JSON.stringify({ 
      success: false,
      error: `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
  }
}

// Get current date/time string in user's timezone - CENTRAL TIME ANCHOR
function getCurrentTimeString(timezone: string = 'America/New_York'): string {
  try {
    const now = new Date();
    return now.toLocaleString('en-US', { 
      timeZone: timezone, 
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  } catch (error) {
    return new Date().toISOString();
  }
}

async function handleAssistantRequest(
  userInput: string,
  userId: string,
  threadId: string,
  assistantId: string,
  contextualInstructions?: string
) {
  console.log(`Processing assistant request for user ${userId}, thread ${threadId}`);

  try {
    // Load user's AI instructions and timezone from scheduling preferences
    let additionalInstructions = contextualInstructions || '';
    let userTimezone = 'America/New_York';
    
    try {
      const { data: prefs } = await supabase
        .from('user_scheduling_prefs')
        .select('core_instructions, assistant_extensions, config, timezone')
        .eq('user_id', userId)
        .maybeSingle();

      if (prefs) {
        // Get user's timezone for accurate time anchor
        if (prefs.timezone) {
          userTimezone = prefs.timezone;
        }
        
        const instructionParts: string[] = [];
        
        // ============================================================
        // CENTRAL TIME ANCHOR - This prevents wrong date/time issues
        // ============================================================
        const currentDateTime = getCurrentTimeString(userTimezone);
        instructionParts.push(`CURRENT DATE AND TIME (ABSOLUTE TRUTH - DO NOT CONTRADICT):
Today is ${currentDateTime} (${userTimezone}).
Use this as your authoritative time reference for ALL date/time operations.
When asked about "today", "tomorrow", "this week", etc., calculate from this anchor.`);
        
        if (prefs.core_instructions) {
          instructionParts.push(prefs.core_instructions);
        }
        
        if (prefs.assistant_extensions) {
          instructionParts.push(prefs.assistant_extensions);
        }
        
        if (prefs.config?.customAIInstructions) {
          instructionParts.push(`Scheduling Philosophy:\n${prefs.config.customAIInstructions}`);
        }
        
        if (contextualInstructions) {
          instructionParts.push(contextualInstructions);
        }
        
        additionalInstructions = instructionParts.filter(Boolean).join('\n\n');
        console.log(`[HYBRID] Time anchor set: ${currentDateTime} (${userTimezone})`);
        console.log('Loaded user-specific AI instructions');
      } else {
        // No prefs found - still add time anchor with default timezone
        const currentDateTime = getCurrentTimeString(userTimezone);
        additionalInstructions = `CURRENT DATE AND TIME (ABSOLUTE TRUTH - DO NOT CONTRADICT):
Today is ${currentDateTime} (${userTimezone}).
Use this as your authoritative time reference for ALL date/time operations.

${contextualInstructions || ''}`;
        console.log(`[HYBRID] Time anchor set (default): ${currentDateTime}`);
      }
    } catch (error) {
      console.warn('Failed to load user instructions, adding time anchor anyway:', error);
      const currentDateTime = getCurrentTimeString(userTimezone);
      additionalInstructions = `CURRENT DATE AND TIME: ${currentDateTime} (${userTimezone})\n\n${contextualInstructions || ''}`;
    }

    // Get or create OpenAI thread
    let openaiThreadId: string;
    
    // Check if we have an existing OpenAI thread for this conversation
    const { data: existingThread } = await supabase
      .from('ai_threads')
      .select('openai_thread_id')
      .eq('id', threadId)
      .eq('user_id', userId)
      .single();

    // Validate that the stored thread ID is a valid OpenAI thread ID (must start with "thread_")
    const storedThreadId = existingThread?.openai_thread_id;
    const isValidOpenAIThread = storedThreadId && storedThreadId.startsWith('thread_');

    if (isValidOpenAIThread) {
      openaiThreadId = storedThreadId;
      console.log(`Using existing OpenAI thread: ${openaiThreadId}`);
    } else {
      // Create new OpenAI thread (either no stored ID, or stored ID is invalid like "phone_xxx")
      if (storedThreadId) {
        console.log(`Invalid stored thread ID "${storedThreadId}", creating new OpenAI thread`);
      }
      
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

    // Fetch tool definitions from centralized execute-tool function
    let toolDefinitions: any[] = [];
    try {
      const toolsResponse = await fetch(`${supabaseUrl}/functions/v1/execute-tool/definitions`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (toolsResponse.ok) {
        const toolsData = await toolsResponse.json();
        toolDefinitions = (toolsData.tools || [])
          .filter((t: any) => !['hang_up', 'initiate_phone_call'].includes(t.name)) // Exclude phone-only tools
          .map((t: any) => ({
            type: "function",
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters
            }
          }));
        console.log(`[HYBRID] Loaded ${toolDefinitions.length} tool definitions for chat`);
      }
    } catch (error) {
      console.warn('[HYBRID] Failed to fetch tool definitions:', error);
    }

    // Create run with combined instructions and tool overrides
    const runPayload: any = {
      assistant_id: assistantId
    };

    if (additionalInstructions) {
      runPayload.additional_instructions = additionalInstructions;
    }

    // Override tools with our centralized definitions (enables web_search without OpenAI Dashboard config)
    if (toolDefinitions.length > 0) {
      runPayload.tools = toolDefinitions;
      console.log(`[HYBRID] Overriding assistant tools with ${toolDefinitions.length} definitions`);
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
    const maxAttempts = 60; // 60 seconds timeout (increased for tool calls)
    let runStatus = 'queued';
    let finalRunData: any = runData;

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
        finalRunData = await statusResponse.json();
        runStatus = finalRunData.status;
        console.log(`Run status: ${runStatus}`);

        // Handle tool calls when requires_action
        if (runStatus === 'requires_action' && finalRunData.required_action?.type === 'submit_tool_outputs') {
          const toolCalls: ToolCall[] = finalRunData.required_action.submit_tool_outputs.tool_calls;
          console.log(`Processing ${toolCalls.length} tool calls`);

          // Execute all tool calls
          const toolOutputs: ToolOutput[] = await Promise.all(
            toolCalls.map(async (toolCall) => ({
              tool_call_id: toolCall.id,
              output: await executeToolCall(toolCall, userId)
            }))
          );

          // DEBUGGING: Log exactly what we're sending to OpenAI
          console.log('[HYBRID] ==================== TOOL OUTPUTS ====================');
          console.log('[HYBRID] Tool outputs being submitted to OpenAI:');
          for (const output of toolOutputs) {
            console.log(`[HYBRID] Tool ID: ${output.tool_call_id}`);
            console.log(`[HYBRID] Output: ${output.output}`);
          }
          console.log('[HYBRID] ======================================================');

          // Submit tool outputs back to OpenAI
          const submitResponse = await fetch(
            `https://api.openai.com/v1/threads/${openaiThreadId}/runs/${runId}/submit_tool_outputs`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${openaiApiKey}`,
                'Content-Type': 'application/json',
                'OpenAI-Beta': 'assistants=v2'
              },
              body: JSON.stringify({ tool_outputs: toolOutputs })
            }
          );

          if (!submitResponse.ok) {
            const errorText = await submitResponse.text();
            console.error('Failed to submit tool outputs:', errorText);
            throw new Error(`Failed to submit tool outputs: ${errorText}`);
          }

          console.log('[HYBRID] Tool outputs submitted successfully');
          // Continue polling for completion
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

    console.log('[HYBRID] ==================== FINAL RESPONSE ====================');
    console.log('[HYBRID] Full assistant response:', responseContent);
    console.log('[HYBRID] ==========================================================');

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
      assistantId = Deno.env.get('OPENAI_ASSISTANT_ID') || 'asst_BcZBxlx9zH8VIPvfJrhPP3EF',
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
