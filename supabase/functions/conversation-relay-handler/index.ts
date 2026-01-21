import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GLOBAL_VERSION, corsHeaders, createHealthResponse } from "../_shared/config.ts";

const HANDLER_VERSION = `${GLOBAL_VERSION}-conversation-relay-handler`;

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const openaiKey = Deno.env.get('OPENAI_API_KEY')!;

// ConversationRelay message types from Twilio
interface SetupMessage {
  type: 'setup';
  sessionId: string;
  callSid: string;
  parentCallSid?: string;
  from?: string;
  to?: string;
  forwardedFrom?: string;
  callerName?: string;
  direction?: string;
  callType?: string;
  callStatus?: string;
  accountSid?: string;
  applicationSid?: string;
  customParameters: Record<string, string>;
}

interface PromptMessage {
  type: 'prompt';
  voicePrompt: string;
  lang?: string;
  last?: boolean;
  confidence?: number;
  inputMode?: string;
  sequenceNumber?: number;
}

interface InterruptMessage {
  type: 'interrupt';
  durationUntilInterruptMs?: number;
  utteranceUntilInterrupt?: string;
}

interface DtmfMessage {
  type: 'dtmf';
  digit: string;
  sequenceNumber?: number;
}

type TwilioMessage = SetupMessage | PromptMessage | InterruptMessage | DtmfMessage;

// OpenAI tool definitions for voice context
const voiceTools = [
  {
    type: "function",
    function: {
      name: "get_today_tasks",
      description: "Get all tasks scheduled for today",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "get_tasks",
      description: "Get tasks with optional filtering by date or status",
      parameters: {
        type: "object",
        properties: {
          time_filter: { type: "string", description: "Time filter like 'tomorrow', 'this week', 'January 19th'" },
          status: { type: "string", enum: ["BACKLOG", "TODO", "DOING", "DONE"] }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_task",
      description: "Create a new task",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Task title" },
          description: { type: "string", description: "Optional description" },
          priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] }
        },
        required: ["title"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_task",
      description: "Update an existing task's status",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Task ID to update" },
          status: { type: "string", enum: ["BACKLOG", "TODO", "DOING", "DONE"] }
        },
        required: ["task_id", "status"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web for real-time information",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query - pass the user's exact words" },
          topic: { type: "string", enum: ["general", "news", "finance"] }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "end_call",
      description: "End the phone call when the user says goodbye",
      parameters: { type: "object", properties: {}, required: [] }
    }
  }
];

// Execute tool via centralized execute-tool function
async function executeTool(
  toolName: string, 
  args: Record<string, unknown>, 
  userId: string,
  timezone: string
): Promise<string> {
  console.log(`[RELAY] Executing tool: ${toolName}`, args);
  
  // Handle end_call locally
  if (toolName === 'end_call') {
    return '__END_CALL__';
  }
  
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const { data, error } = await supabase.functions.invoke('execute-tool', {
      body: {
        toolName,
        args,
        userId,
        context: {
          interface: 'phone',
          timezone
        }
      }
    });
    
    if (error) {
      console.error(`[RELAY] Tool error:`, error);
      return `Error executing ${toolName}: ${error.message}`;
    }
    
    console.log(`[RELAY] Tool result:`, data);
    return data.message || JSON.stringify(data.result);
  } catch (error) {
    console.error(`[RELAY] Tool execution failed:`, error);
    return `Failed to execute ${toolName}`;
  }
}

// Get user context from database
async function getUserContext(userId: string): Promise<{ timezone: string; instructions: string }> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const { data: prefs } = await supabase
    .from('user_scheduling_prefs')
    .select('timezone, core_instructions, realtime_extensions')
    .eq('user_id', userId)
    .maybeSingle();
  
  return {
    timezone: prefs?.timezone || 'America/New_York',
    instructions: [prefs?.core_instructions, prefs?.realtime_extensions].filter(Boolean).join('\n\n')
  };
}

// Build system prompt for voice assistant
function buildSystemPrompt(timezone: string, instructions: string): string {
  const now = new Date();
  const userTime = now.toLocaleString('en-US', { timeZone: timezone });
  
  return `You are Iris Chase, a friendly and efficient voice assistant for managing tasks and schedules. You're having a natural phone conversation, so keep responses concise and conversational.

Current time (${timezone}): ${userTime}

${instructions ? `User's custom instructions:\n${instructions}\n\n` : ''}

Guidelines:
- Keep responses short and natural (1-3 sentences max)
- Be warm but efficient
- Use tool calls to get real data - don't make up tasks
- When the user says goodbye, use end_call
- Confirm actions clearly after completing them`;
}

// Process message with OpenAI
async function processWithOpenAI(
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }>,
  systemPrompt: string,
  userId: string,
  timezone: string
): Promise<{ response: string; shouldEndCall: boolean; toolsUsed: string[] }> {
  
  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
    { role: 'user', content: userMessage }
  ];
  
  console.log(`[RELAY] Calling OpenAI with ${messages.length} messages`);
  
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages,
      tools: voiceTools,
      tool_choice: 'auto',
      max_tokens: 300,
      temperature: 0.7
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    console.error(`[RELAY] OpenAI error:`, error);
    return { 
      response: "I'm having a moment. Could you repeat that?", 
      shouldEndCall: false,
      toolsUsed: []
    };
  }
  
  const data = await response.json();
  const choice = data.choices[0];
  const toolsUsed: string[] = [];
  
  // Handle tool calls
  if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
    const toolResults: string[] = [];
    let shouldEndCall = false;
    
    for (const toolCall of choice.message.tool_calls) {
      const toolName = toolCall.function.name;
      const toolArgs = JSON.parse(toolCall.function.arguments);
      toolsUsed.push(toolName);
      
      const result = await executeTool(toolName, toolArgs, userId, timezone);
      
      if (result === '__END_CALL__') {
        shouldEndCall = true;
        toolResults.push('Call ended at user request');
      } else {
        toolResults.push(result);
      }
    }
    
    if (shouldEndCall) {
      return { 
        response: "Goodbye! Have a great day!", 
        shouldEndCall: true,
        toolsUsed
      };
    }
    
    // Get final response with tool results
    const followUpMessages = [
      ...messages,
      choice.message,
      ...choice.message.tool_calls.map((tc: { id: string }, i: number) => ({
        role: 'tool',
        tool_call_id: tc.id,
        content: toolResults[i]
      }))
    ];
    
    const followUpResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: followUpMessages,
        max_tokens: 300,
        temperature: 0.7
      }),
    });
    
    if (followUpResponse.ok) {
      const followUpData = await followUpResponse.json();
      return {
        response: followUpData.choices[0].message.content || "Done!",
        shouldEndCall: false,
        toolsUsed
      };
    }
  }
  
  // No tool calls - return direct response
  return {
    response: choice.message.content || "I'm not sure how to help with that.",
    shouldEndCall: false,
    toolsUsed
  };
}

// Main WebSocket handler
serve(async (req) => {
  const url = new URL(req.url);
  
  // Health check
  if (url.searchParams.get('health') === '1') {
    return createHealthResponse('conversation-relay-handler');
  }
  
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  // Check for WebSocket upgrade
  const upgradeHeader = req.headers.get('Upgrade');
  if (upgradeHeader?.toLowerCase() !== 'websocket') {
    return new Response(JSON.stringify({ 
      error: 'WebSocket upgrade required',
      version: HANDLER_VERSION 
    }), { 
      status: 400, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
  
  // Upgrade to WebSocket
  const { socket, response } = Deno.upgradeWebSocket(req);
  
  // Session state
  let userId: string | null = null;
  let timezone = 'America/New_York';
  let systemPrompt = '';
  let conversationHistory: Array<{ role: string; content: string }> = [];
  let callSid = '';
  let messageIndex = 0;
  
  socket.onopen = () => {
    console.log(`[RELAY] WebSocket connected - version ${HANDLER_VERSION}`);
  };
  
  socket.onmessage = async (event) => {
    try {
      const message: TwilioMessage = JSON.parse(event.data);
      console.log(`[RELAY] Received message type: ${message.type}`);
      
      switch (message.type) {
        case 'setup': {
          // Extract session info from setup message
          callSid = message.callSid;
          userId = message.customParameters?.userId || null;
          
          console.log(`[RELAY] Setup - CallSid: ${callSid}, UserId: ${userId}`);
          
          if (userId) {
            const context = await getUserContext(userId);
            timezone = context.timezone;
            systemPrompt = buildSystemPrompt(timezone, context.instructions);
          } else {
            systemPrompt = buildSystemPrompt(timezone, '');
          }
          
          // Note: welcomeGreeting in TwiML handles the initial greeting
          // No need to send text here unless we want to override
          break;
        }
        
        case 'prompt': {
          // User spoke - process their message
          const userMessage = message.voicePrompt;
          console.log(`[RELAY] User said: "${userMessage}"`);
          messageIndex++;
          
          if (!userId) {
            // No user context - limited functionality
            socket.send(JSON.stringify({
              type: 'text',
              token: "I'm sorry, I couldn't identify your account. Please try calling from a registered phone number.",
              last: true
            }));
            break;
          }
          
          // Process with OpenAI
          const result = await processWithOpenAI(
            userMessage,
            conversationHistory,
            systemPrompt,
            userId,
            timezone
          );
          
          // Update history
          conversationHistory.push({ role: 'user', content: userMessage });
          conversationHistory.push({ role: 'assistant', content: result.response });
          
          // Keep history manageable
          if (conversationHistory.length > 20) {
            conversationHistory = conversationHistory.slice(-16);
          }
          
          console.log(`[RELAY] Response: "${result.response}" (tools: ${result.toolsUsed.join(', ') || 'none'})`);
          
          // Send response to Twilio (Twilio will TTS this)
          socket.send(JSON.stringify({
            type: 'text',
            token: result.response,
            last: true
          }));
          
          // End call if requested
          if (result.shouldEndCall) {
            console.log(`[RELAY] Ending call at user request`);
            setTimeout(() => {
              socket.send(JSON.stringify({ type: 'end' }));
            }, 2000); // Give time for farewell to play
          }
          break;
        }
        
        case 'interrupt': {
          // User interrupted - we can acknowledge but Twilio handles stopping
          console.log(`[RELAY] User interrupted after ${message.durationUntilInterruptMs}ms`);
          break;
        }
        
        case 'dtmf': {
          // Handle keypad presses
          console.log(`[RELAY] DTMF digit: ${message.digit}`);
          
          // Common DTMF handling
          if (message.digit === '*') {
            socket.send(JSON.stringify({
              type: 'text',
              token: "You pressed star. How can I help?",
              last: true
            }));
          }
          break;
        }
        
        default:
          console.log(`[RELAY] Unknown message type:`, message);
      }
    } catch (error) {
      console.error(`[RELAY] Error processing message:`, error);
      
      // Try to send error response
      try {
        socket.send(JSON.stringify({
          type: 'text',
          token: "I had trouble with that. Could you try again?",
          last: true
        }));
      } catch { /* Socket may be closed */ }
    }
  };
  
  socket.onerror = (error) => {
    console.error(`[RELAY] WebSocket error:`, error);
  };
  
  socket.onclose = (event) => {
    console.log(`[RELAY] WebSocket closed - code: ${event.code}, reason: ${event.reason}`);
    
    // Log call session to database
    if (callSid && userId) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      supabase.from('call_sessions').insert({
        call_sid: callSid,
        user_id: userId,
        direction: 'relay',
        metadata: {
          version: HANDLER_VERSION,
          messageCount: messageIndex,
          historyLength: conversationHistory.length
        }
      }).then(() => {
        console.log(`[RELAY] Session logged for call ${callSid}`);
      }).catch(err => {
        console.error(`[RELAY] Failed to log session:`, err);
      });
    }
  };
  
  return response;
});
