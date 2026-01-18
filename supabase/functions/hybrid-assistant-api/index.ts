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

// Execute tool calls from the Assistant
async function executeToolCall(
  toolCall: ToolCall,
  userId: string
): Promise<string> {
  const { name, arguments: argsString } = toolCall.function;
  
  let args: any;
  try {
    args = JSON.parse(argsString);
  } catch (e) {
    return JSON.stringify({ error: 'Invalid tool arguments', details: argsString });
  }

  console.log(`Executing tool: ${name}`, args);

  try {
    switch (name) {
      case 'send_email':
      case 'Email': {
        // Get user profile for email
        const { data: profile } = await supabase
          .from('profiles')
          .select('email, phone')
          .eq('user_id', userId)
          .maybeSingle();

        const response = await fetch(`${supabaseUrl}/functions/v1/send-unified-notification`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            userId,
            title: args.subject || args.title || 'AI Assistant Email',
            body: args.body || args.message || args.content || '',
            channels: ['EMAIL'],
            data: { type: 'assistant_email' },
            userProfile: profile || {}
          })
        });

        const result = await response.json();
        if (result.success) {
          return JSON.stringify({ 
            success: true, 
            message: `Email sent successfully to ${profile?.email || 'user'}`,
            details: result.channelResults?.email
          });
        } else {
          return JSON.stringify({ 
            success: false, 
            error: result.errors?.join(', ') || 'Failed to send email',
            details: result
          });
        }
      }

      case 'send_slack_message':
      case 'Slack_Message': {
        // Get Slack webhook from environment (stored as secret)
        const slackWebhook = Deno.env.get('SLACK_WEBHOOK_URL');

        const response = await fetch(`${supabaseUrl}/functions/v1/send-unified-notification`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            userId,
            title: args.title || 'AI Assistant',
            body: args.message || args.text || args.body || '',
            channels: ['SLACK'],
            slackWebhook,
            data: { type: 'assistant_slack' }
          })
        });

        const result = await response.json();
        if (result.success) {
          return JSON.stringify({ 
            success: true, 
            message: 'Slack message sent successfully',
            details: result.channelResults?.slack
          });
        } else {
          return JSON.stringify({ 
            success: false, 
            error: result.errors?.join(', ') || 'Failed to send Slack message',
            details: result
          });
        }
      }

      case 'create_outlook_event':
      case 'Outlook_Event': {
        const { data: profile } = await supabase
          .from('profiles')
          .select('email')
          .eq('user_id', userId)
          .maybeSingle();

        const startTime = args.start_time || args.startTime || new Date(Date.now() + 60 * 60 * 1000).toISOString();
        const durationMinutes = args.duration || args.durationMinutes || 60;
        const endTime = args.end_time || args.endTime || new Date(new Date(startTime).getTime() + durationMinutes * 60 * 1000).toISOString();

        const response = await fetch(`${supabaseUrl}/functions/v1/send-unified-notification`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            userId,
            channels: ['OUTLOOK_EVENT'],
            userProfile: profile || {},
            data: {
              type: 'assistant_calendar',
              taskTitle: args.title || args.subject || 'AI Created Event',
              taskDescription: args.description || args.body || '',
              startTime,
              estimateMinutes: durationMinutes
            },
            outlookEvent: {
              title: args.title || args.subject || 'AI Created Event',
              startTime,
              endTime,
              reminder: args.reminder || '15'
            }
          })
        });

        const result = await response.json();
        if (result.success) {
          return JSON.stringify({ 
            success: true, 
            message: `Outlook event "${args.title || 'Event'}" created for ${new Date(startTime).toLocaleString()}`,
            details: result.channelResults?.outlook
          });
        } else {
          return JSON.stringify({ 
            success: false, 
            error: result.errors?.join(', ') || 'Failed to create Outlook event',
            details: result
          });
        }
      }

      case 'create_google_event':
      case 'Google_Event': {
        const { data: profile } = await supabase
          .from('profiles')
          .select('email')
          .eq('user_id', userId)
          .maybeSingle();

        const startTime = args.start_time || args.startTime || new Date(Date.now() + 60 * 60 * 1000).toISOString();
        const durationMinutes = args.duration || args.durationMinutes || 60;
        const endTime = args.end_time || args.endTime || new Date(new Date(startTime).getTime() + durationMinutes * 60 * 1000).toISOString();

        const response = await fetch(`${supabaseUrl}/functions/v1/send-unified-notification`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            userId,
            channels: ['GOOGLE_EVENT'],
            userProfile: profile || {},
            data: {
              type: 'assistant_calendar',
              taskTitle: args.title || args.subject || 'AI Created Event',
              taskDescription: args.description || args.body || '',
              startTime,
              estimateMinutes: durationMinutes
            },
            googleEvent: {
              title: args.title || args.subject || 'AI Created Event',
              startTime,
              endTime,
              reminder: args.reminder || '15'
            }
          })
        });

        const result = await response.json();
        if (result.success) {
          return JSON.stringify({ 
            success: true, 
            message: `Google Calendar event "${args.title || 'Event'}" created for ${new Date(startTime).toLocaleString()}`,
            details: result.channelResults?.google
          });
        } else {
          return JSON.stringify({ 
            success: false, 
            error: result.errors?.join(', ') || 'Failed to create Google Calendar event',
            details: result
          });
        }
      }

      case 'initiate_phone_call':
      case 'Phone_Call': {
        // Trigger a phone call via Twilio
        const response = await fetch(`${supabaseUrl}/functions/v1/twilio-voice-handler`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            action: 'trigger-call',
            userId,
            delay_minutes: args.delay_minutes,
            context: args.context
          })
        });

        const result = await response.json();
        if (result.success) {
          const message = args.delay_minutes 
            ? `I'll call you in ${args.delay_minutes} minute${args.delay_minutes > 1 ? 's' : ''}`
            : 'Calling you now';
          return JSON.stringify({ 
            success: true, 
            message,
            call_sid: result.call_sid
          });
        } else {
          return JSON.stringify({ 
            success: false, 
            error: result.error || 'Failed to initiate phone call'
          });
        }
      }

      default:
        return JSON.stringify({ 
          error: `Unknown tool: ${name}`,
          availableTools: ['send_email', 'send_slack_message', 'create_outlook_event', 'create_google_event', 'initiate_phone_call']
        });
    }
  } catch (error) {
    console.error(`Error executing tool ${name}:`, error);
    return JSON.stringify({ 
      error: `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
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
    // Load user's AI instructions from scheduling preferences
    let additionalInstructions = contextualInstructions || '';
    
    try {
      const { data: prefs } = await supabase
        .from('user_scheduling_prefs')
        .select('core_instructions, assistant_extensions, config')
        .eq('user_id', userId)
        .maybeSingle();

      if (prefs) {
        const instructionParts: string[] = [];
        
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
        console.log('Loaded user-specific AI instructions');
      }
    } catch (error) {
      console.warn('Failed to load user instructions, using contextual only:', error);
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

    // Create run with combined instructions
    const runPayload: any = {
      assistant_id: assistantId
    };

    if (additionalInstructions) {
      runPayload.additional_instructions = additionalInstructions;
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

          console.log('Tool outputs:', toolOutputs);

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

          console.log('Tool outputs submitted successfully');
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
