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

// ============================================================
// PHASE 1 OPTIMIZATION: Tool Definition Caching
// ============================================================
let cachedToolDefinitions: any[] | null = null;
let toolCacheTimestamp: number = 0;
const TOOL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getToolDefinitions(): Promise<any[]> {
  const now = Date.now();
  if (cachedToolDefinitions && (now - toolCacheTimestamp) < TOOL_CACHE_TTL_MS) {
    console.log(`[HYBRID] Using cached tool definitions (${cachedToolDefinitions.length} tools, age: ${Math.round((now - toolCacheTimestamp) / 1000)}s)`);
    return cachedToolDefinitions;
  }
  
  console.log('[HYBRID] Fetching fresh tool definitions...');
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/execute-tool/definitions`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      cachedToolDefinitions = (data.tools || [])
        .filter((t: any) => !['hang_up', 'initiate_phone_call'].includes(t.name))
        .map((t: any) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters }
        }));
      toolCacheTimestamp = now;
      console.log(`[HYBRID] Cached ${cachedToolDefinitions.length} tool definitions`);
      return cachedToolDefinitions;
    }
  } catch (e) {
    console.warn('[HYBRID] Failed to fetch tool definitions:', e);
  }
  
  return cachedToolDefinitions || [];
}

// ============================================================
// PHASE 4 OPTIMIZATION: Smart Routing for Simple Queries
// ============================================================
const TRIVIAL_PATTERNS = [
  /^(hi|hello|hey|yo|sup|hola|greetings)\.?$/i,
  /^(thanks|thank you|thx|ty|cheers)\.?$/i,
  /^(ok|okay|k|alright|got it|sounds good|perfect|great|awesome|cool)\.?$/i,
  /^(yes|no|yep|nope|yeah|nah|sure)\.?$/i,
  /^(bye|goodbye|later|see you|cya|ttyl)\.?$/i,
  /^good (morning|afternoon|evening|night)\.?$/i,
  /^(what's up|how are you|how's it going)\??$/i,
];

function isTrivialMessage(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length > 30) return false;
  return TRIVIAL_PATTERNS.some(p => p.test(trimmed));
}

async function handleTrivialMessage(
  userInput: string,
  userId: string,
  threadId: string,
  timezone: string
): Promise<{ success: boolean; response: string; threadId: string; fastPath: true }> {
  console.log(`[HYBRID] Fast path: Handling trivial message "${userInput}"`);
  
  const currentDateTime = getCurrentTimeString(timezone);
  
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: `You are Iris, a friendly and helpful AI assistant. Current time: ${currentDateTime}. Respond naturally and briefly.`
        },
        { role: 'user', content: userInput }
      ],
      max_tokens: 100,
      temperature: 0.7
    })
  });
  
  if (!response.ok) {
    throw new Error(`Chat completions failed: ${await response.text()}`);
  }
  
  const data = await response.json();
  const reply = data.choices?.[0]?.message?.content || "Hey there!";
  
  console.log(`[HYBRID] Fast path response: "${reply}"`);
  
  return {
    success: true,
    response: reply,
    threadId,
    fastPath: true
  };
}

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

// Interface for extracted facts from tool responses
interface ExtractedFacts {
  type: 'task_list' | 'today_tasks' | 'task_created' | 'task_updated' | 'web_search' | 'communication' | 'other';
  count?: number;
  scheduled?: number;
  unscheduled?: number;
  rawAnswer?: string;
  source?: string;
  taskTitle?: string;
}

// Collected tool outputs for validation
const collectedToolOutputs: Array<{ toolName: string; extractedFacts?: ExtractedFacts }> = [];

// Validation function - checks AI response against tool outputs
function validateAiResponse(
  aiResponse: string, 
  toolOutputs: Array<{ toolName: string; extractedFacts?: ExtractedFacts }>
): { valid: boolean; correction?: string } {
  
  for (const output of toolOutputs) {
    if (!output.extractedFacts) continue;
    
    const facts = output.extractedFacts;
    
    // Validate task counts
    if (facts.type === 'task_list' || facts.type === 'today_tasks') {
      const actualCount = facts.count ?? 0;
      
      const countPatterns = [
        /you have (\d+) tasks?/i,
        /(\d+) tasks? (?:for|scheduled|today)/i,
        /found (\d+) tasks?/i,
        /there (?:are|is) (\d+) tasks?/i,
        /(\d+) scheduled/i,
        /have (\d+) things?/i
      ];
      
      for (const pattern of countPatterns) {
        const match = aiResponse.match(pattern);
        if (match) {
          const claimedCount = parseInt(match[1]);
          if (claimedCount !== actualCount) {
            console.log(`[HYBRID-VALIDATE] Discrepancy: AI claimed ${claimedCount}, tool returned ${actualCount}`);
            return {
              valid: false,
              correction: `Actually, I need to correct myself - you have ${actualCount} task${actualCount !== 1 ? 's' : ''}, not ${claimedCount}.`
            };
          }
        }
      }
    }
  }
  
  return { valid: true };
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
    
    // Collect extracted facts for post-validation
    if (result.extractedFacts) {
      collectedToolOutputs.push({ toolName: name, extractedFacts: result.extractedFacts });
      console.log(`[HYBRID] Collected extracted facts for validation:`, result.extractedFacts);
    }
    
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

// ============================================================
// PHASE 2 OPTIMIZATION: SSE Streaming Support
// ============================================================
async function handleStreamingRequest(
  userInput: string,
  userId: string,
  threadId: string,
  assistantId: string,
  contextualInstructions?: string
) {
  console.log(`[HYBRID-STREAM] Starting streaming request for user ${userId}`);
  
  // Pre-processing (same as polling mode but parallel)
  let additionalInstructions = contextualInstructions || '';
  let userTimezone = 'America/New_York';
  
  const parallelStart = Date.now();
  
  const [prefsResult, ragResult, agendaResult, toolDefinitions] = await Promise.all([
    supabase.from('user_scheduling_prefs')
      .select('core_instructions, assistant_extensions, config, timezone')
      .eq('user_id', userId)
      .maybeSingle(),
    
    fetch(`${supabaseUrl}/functions/v1/rag-context-retrieval`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${supabaseServiceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_context', userInput, userId, threadId })
    }).catch(() => null),
    
    fetch(`${supabaseUrl}/functions/v1/agenda-manager`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${supabaseServiceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'get_status', threadId, userId })
    }).catch(() => null),
    
    getToolDefinitions()
  ]);
  
  console.log(`[HYBRID-STREAM] Parallel pre-processing: ${Date.now() - parallelStart}ms`);
  
  // Build additional instructions
  const prefs = prefsResult.data;
  if (prefs) {
    if (prefs.timezone) userTimezone = prefs.timezone;
    
    const parts: string[] = [];
    const currentDateTime = getCurrentTimeString(userTimezone);
    parts.push(`CURRENT DATE AND TIME: ${currentDateTime} (${userTimezone})`);
    if (prefs.core_instructions) parts.push(prefs.core_instructions);
    if (prefs.assistant_extensions) parts.push(prefs.assistant_extensions);
    if (prefs.config?.customAIInstructions) parts.push(`Scheduling Philosophy:\n${prefs.config.customAIInstructions}`);
    if (contextualInstructions) parts.push(contextualInstructions);
    additionalInstructions = parts.join('\n\n');
  } else {
    const currentDateTime = getCurrentTimeString(userTimezone);
    additionalInstructions = `CURRENT DATE AND TIME: ${currentDateTime}\n\n${contextualInstructions || ''}`;
  }
  
  // Process RAG and agenda (already fetched)
  if (ragResult && ragResult.ok) {
    try {
      const ragData = await ragResult.json();
      if (ragData.contextualInstructions) {
        additionalInstructions += `\n\n${ragData.contextualInstructions}`;
      }
    } catch (e) { console.warn('[HYBRID-STREAM] RAG parse failed:', e); }
  }
  
  if (agendaResult && agendaResult.ok) {
    try {
      const agendaData = await agendaResult.json();
      if (agendaData.items?.length > 0) {
        additionalInstructions += `\n\nCONVERSATION AGENDA:\n${agendaData.items.map((i: any) => `- [${i.status}] ${i.item_text}`).join('\n')}`;
      }
    } catch (e) { console.warn('[HYBRID-STREAM] Agenda parse failed:', e); }
  }
  
  // Get or create OpenAI thread
  const { data: existingThread } = await supabase
    .from('ai_threads')
    .select('openai_thread_id')
    .eq('id', threadId)
    .eq('user_id', userId)
    .single();
  
  let openaiThreadId: string;
  const storedThreadId = existingThread?.openai_thread_id;
  const isValidOpenAIThread = storedThreadId && storedThreadId.startsWith('thread_');
  
  if (isValidOpenAIThread) {
    openaiThreadId = storedThreadId;
  } else {
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
    
    await supabase.from('ai_threads')
      .update({ openai_thread_id: openaiThreadId })
      .eq('id', threadId)
      .eq('user_id', userId);
  }
  
  // Add user message to thread
  await fetch(`https://api.openai.com/v1/threads/${openaiThreadId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'assistants=v2'
    },
    body: JSON.stringify({ role: 'user', content: userInput })
  });
  
  // Create streaming run
  const runPayload: any = {
    assistant_id: assistantId,
    stream: true
  };
  
  if (additionalInstructions) {
    runPayload.additional_instructions = additionalInstructions;
  }
  
  if (toolDefinitions.length > 0) {
    runPayload.tools = toolDefinitions;
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
    throw new Error(`Failed to create streaming run: ${await runResponse.text()}`);
  }
  
  // Create a transform stream to process OpenAI events and forward to client
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  
  let fullContent = '';
  let currentRunId = '';
  let requiresAction = false;
  let pendingToolCalls: ToolCall[] = [];
  
  const transformStream = new TransformStream({
    async transform(chunk, controller) {
      const text = decoder.decode(chunk);
      const lines = text.split('\n');
      
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        
        const data = line.slice(6);
        if (data === '[DONE]') {
          controller.enqueue(encoder.encode(`data: {"type":"done","content":"${fullContent.replace(/"/g, '\\"').replace(/\n/g, '\\n')}","threadId":"${openaiThreadId}"}\n\n`));
          continue;
        }
        
        try {
          const event = JSON.parse(data);
          
          // Handle different event types
          if (event.object === 'thread.run') {
            currentRunId = event.id;
            if (event.status === 'requires_action') {
              requiresAction = true;
              pendingToolCalls = event.required_action?.submit_tool_outputs?.tool_calls || [];
            }
          }
          
          if (event.object === 'thread.message.delta') {
            const delta = event.delta?.content?.[0]?.text?.value || '';
            if (delta) {
              fullContent += delta;
              controller.enqueue(encoder.encode(`data: {"type":"delta","content":"${delta.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"}\n\n`));
            }
          }
          
          if (event.object === 'thread.run.step.delta') {
            // Tool call streaming - inform frontend
            const toolDelta = event.delta?.step_details?.tool_calls?.[0];
            if (toolDelta) {
              controller.enqueue(encoder.encode(`data: {"type":"tool_call","name":"${toolDelta.function?.name || 'unknown'}"}\n\n`));
            }
          }
          
        } catch (e) {
          // Skip malformed JSON
        }
      }
    }
  });
  
  // Note: For tool calls, we need to handle them synchronously. 
  // This initial implementation streams text-only responses.
  // Tool calls will fall back to polling mode for now.
  
  return new Response(runResponse.body?.pipeThrough(transformStream), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}

// ============================================================
// Original Polling-based Request Handler
// ============================================================
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
    // PHASE 3 OPTIMIZATION: Parallelize all pre-processing fetches
    let additionalInstructions = contextualInstructions || '';
    let userTimezone = 'America/New_York';
    
    try {
      console.log('[HYBRID] Starting parallel pre-processing...');
      const parallelStart = Date.now();
      
      // Fetch all context in parallel for latency optimization (tools now cached)
      const parallelResults = await Promise.all([
        // 1. User preferences
        supabase
          .from('user_scheduling_prefs')
          .select('core_instructions, assistant_extensions, config, timezone')
          .eq('user_id', userId)
          .maybeSingle(),
        
        // 2. RAG context
        fetch(`${supabaseUrl}/functions/v1/rag-context-retrieval`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            action: 'get_context',
            userInput: userInput,
            userId: userId,
            threadId: threadId,
            dbAssistantId: undefined
          })
        }).catch(e => { console.warn('[HYBRID] RAG fetch failed:', e); return null; }),
        
        // 3. Agenda status
        fetch(`${supabaseUrl}/functions/v1/agenda-manager`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ operation: 'get_status', threadId, userId })
        }).catch(e => { console.warn('[HYBRID] Agenda fetch failed:', e); return null; }),
        
        // 4. Tool definitions (NOW CACHED)
        getToolDefinitions()
      ]);
      
      const [prefsResult, ragResult, agendaResult, toolDefinitions] = parallelResults;
      
      console.log(`[HYBRID] Parallel pre-processing completed in ${Date.now() - parallelStart}ms`);
      
      const prefs = prefsResult.data;

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
      }
      
      // Process agenda result (already fetched in parallel)
      if (agendaResult && agendaResult.ok) {
        try {
          const agendaStatus = await agendaResult.json();
          if (agendaStatus.items?.length > 0) {
            const agendaContext = `\n\nCONVERSATION AGENDA:\n${
              agendaStatus.items.map((i: any) => `- [${i.status}] ${i.item_text}`).join('\n')
            }`;
            additionalInstructions += agendaContext;
            
            if (agendaStatus.isPaused && agendaStatus.currentItem) {
              additionalInstructions += `\n\nNote: User went on a tangent. When appropriate, guide back to: "${agendaStatus.currentItem.item_text}"`;
            }
            console.log(`[HYBRID] Agenda loaded: ${agendaStatus.completed}/${agendaStatus.total} completed`);
          }
        } catch (agendaErr) {
          console.warn('[HYBRID] Failed to parse agenda:', agendaErr);
        }
      }
      
      // Process RAG result (already fetched in parallel)
      if (ragResult && ragResult.ok) {
        try {
          const ragData = await ragResult.json();
          if (ragData.contextualInstructions) {
            additionalInstructions += `\n\n${ragData.contextualInstructions}`;
            console.log(`[HYBRID] Added RAG context (${ragData.context?.conversationContext?.length || 0} matches)`);
          }
        } catch (ragError) {
          console.warn('[HYBRID] Failed to parse RAG context:', ragError);
        }
      }
      
      // Get or create OpenAI thread
      let openaiThreadId: string;
      
      const { data: existingThread } = await supabase
        .from('ai_threads')
        .select('openai_thread_id')
        .eq('id', threadId)
        .eq('user_id', userId)
        .single();

      const storedThreadId = existingThread?.openai_thread_id;
      const isValidOpenAIThread = storedThreadId && storedThreadId.startsWith('thread_');

      if (isValidOpenAIThread) {
        openaiThreadId = storedThreadId;
        console.log(`Using existing OpenAI thread: ${openaiThreadId}`);
      } else {
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

      // Create run with combined instructions and tool overrides
      const runPayload: any = {
        assistant_id: assistantId
      };

      if (additionalInstructions) {
        runPayload.additional_instructions = additionalInstructions;
      }

      // Override tools with cached definitions
      if (toolDefinitions.length > 0) {
        runPayload.tools = toolDefinitions;
        console.log(`[HYBRID] Using ${toolDefinitions.length} tool definitions`);
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
      // PHASE 3 OPTIMIZATION: Reduced polling interval from 1000ms to 500ms
      let attempts = 0;
      const maxAttempts = 120; // 60 seconds timeout (120 * 500ms)
      let runStatus = 'queued';
      let finalRunData: any = runData;

      while (attempts < maxAttempts && !['completed', 'failed', 'cancelled', 'expired'].includes(runStatus)) {
        await new Promise(resolve => setTimeout(resolve, 500)); // Reduced from 1000ms
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

            // Execute all tool calls - override web_search query with verbatim userInput
            const toolOutputs: ToolOutput[] = await Promise.all(
              toolCalls.map(async (toolCall) => {
                // For web_search, override the assistant's rewritten query with user's original input
                if (toolCall.function.name === 'web_search') {
                  const originalArgs = JSON.parse(toolCall.function.arguments || '{}');
                  console.log(`[HYBRID] web_search - Assistant query: "${originalArgs.query}"`);
                  console.log(`[HYBRID] web_search - Overriding with verbatim userInput: "${userInput}"`);
                  const modifiedToolCall = {
                    ...toolCall,
                    function: {
                      ...toolCall.function,
                      arguments: JSON.stringify({ ...originalArgs, query: userInput })
                    }
                  };
                  return {
                    tool_call_id: toolCall.id,
                    output: await executeToolCall(modifiedToolCall, userId, undefined, userTimezone)
                  };
                }
                return {
                  tool_call_id: toolCall.id,
                  output: await executeToolCall(toolCall, userId, undefined, userTimezone)
                };
              })
            );

            // DEBUGGING: Log exactly what we're sending to OpenAI
            console.log('[HYBRID] ==================== TOOL OUTPUTS ====================');
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
      
      // POST-VALIDATION: Check AI response against tool outputs and correct if needed
      let finalResponse = responseContent;
      if (collectedToolOutputs.length > 0) {
        const validation = validateAiResponse(responseContent, collectedToolOutputs);
        if (!validation.valid && validation.correction) {
          finalResponse = `${responseContent}\n\n${validation.correction}`;
          console.log('[HYBRID] ⚠️ Self-correction applied:', validation.correction);
        } else {
          console.log('[HYBRID] ✅ Response validated - no discrepancies found');
        }
        collectedToolOutputs.length = 0;
      }
      
      console.log('[HYBRID] ==========================================================');

      return {
        success: true,
        response: finalResponse,
        threadId: openaiThreadId,
        runId
      };

    } catch (error) {
      console.warn('Failed to load user instructions, adding time anchor anyway:', error);
      const currentDateTime = getCurrentTimeString(userTimezone);
      additionalInstructions = `CURRENT DATE AND TIME: ${currentDateTime} (${userTimezone})\n\n${contextualInstructions || ''}`;
      throw error;
    }

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
      assistantId = Deno.env.get('OPENAI_ASSISTANT_ID') || 'asst_BcZBxlx7zH8VIPvfJrhPP3EF',
      dbAssistantId,
      contextualInstructions,
      stream = false  // New: streaming flag
    } = await req.json();

    console.log(`[HYBRID] Processing request for user ${userId}, stream=${stream}`);

    // PHASE 4: Smart routing for trivial messages (skip RAG and Assistants API)
    if (isTrivialMessage(userInput)) {
      const result = await handleTrivialMessage(userInput, userId, threadId, 'America/New_York');
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // PHASE 2: Handle streaming requests
    if (stream) {
      return handleStreamingRequest(userInput, userId, threadId, assistantId, contextualInstructions);
    }

    // Default: polling-based request
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
