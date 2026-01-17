import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface TwilioCallRequest {
  action: 'trigger-call' | 'incoming-call' | 'status-callback' | 'process-speech';
  userId?: string;
  delay_minutes?: number;
  context?: string;
  phoneNumber?: string;
}

// Tool definitions for OpenAI
const phoneTools = [
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
      name: "get_upcoming_tasks",
      description: "Get upcoming tasks for the next few days",
      parameters: { 
        type: "object", 
        properties: {
          days: { type: "number", description: "Number of days to look ahead (default 3)" }
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
          description: { type: "string", description: "Task description" },
          due_date: { type: "string", description: "Due date in YYYY-MM-DD format" },
          priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], description: "Task priority" }
        },
        required: ["title"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "complete_task",
      description: "Mark a task as completed",
      parameters: {
        type: "object",
        properties: {
          task_title: { type: "string", description: "Title or partial title of the task to complete" }
        },
        required: ["task_title"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "reschedule_task",
      description: "Reschedule a task to a different time",
      parameters: {
        type: "object",
        properties: {
          task_title: { type: "string", description: "Title or partial title of the task" },
          new_date: { type: "string", description: "New date in YYYY-MM-DD format" },
          new_time: { type: "string", description: "New time in HH:MM format (24h)" }
        },
        required: ["task_title", "new_date"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "end_call",
      description: "End the phone call when the user says goodbye or indicates they're done",
      parameters: { type: "object", properties: {}, required: [] }
    }
  }
];

// Get user context for the AI
async function getUserContext(phoneNumber: string): Promise<{ userId: string | null; timezone: string; instructions: string }> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  // Try to find user by phone number
  const { data: profile } = await supabase
    .from('profiles')
    .select('user_id')
    .eq('phone', phoneNumber)
    .maybeSingle();

  if (!profile?.user_id) {
    return { userId: null, timezone: 'America/New_York', instructions: '' };
  }

  // Get user preferences
  const { data: prefs } = await supabase
    .from('user_scheduling_prefs')
    .select('timezone, core_instructions, realtime_extensions')
    .eq('user_id', profile.user_id)
    .maybeSingle();

  return {
    userId: profile.user_id,
    timezone: prefs?.timezone || 'America/New_York',
    instructions: [prefs?.core_instructions, prefs?.realtime_extensions].filter(Boolean).join('\n\n')
  };
}

// Get user by stored phone number secret (for outbound calls)
async function getUserIdFromPhoneSecret(): Promise<string | null> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const myPhone = Deno.env.get('MY_PHONE_NUMBER');
  
  if (!myPhone) {
    console.log('[getUserIdFromPhoneSecret] MY_PHONE_NUMBER not set');
    return null;
  }

  console.log('[getUserIdFromPhoneSecret] Looking up user for MY_PHONE_NUMBER');
  
  // First try to find a profile with this phone number
  const { data: profile } = await supabase
    .from('profiles')
    .select('user_id')
    .eq('phone', myPhone)
    .maybeSingle();

  if (profile?.user_id) {
    console.log(`[getUserIdFromPhoneSecret] Found user ${profile.user_id} from phone match`);
    return profile.user_id;
  }
  
  // Fallback: Get the first user with scheduling preferences (primary app user)
  console.log('[getUserIdFromPhoneSecret] No phone match, using fallback to scheduling_prefs');
  const { data: prefs } = await supabase
    .from('user_scheduling_prefs')
    .select('user_id')
    .limit(1)
    .maybeSingle();

  if (prefs?.user_id) {
    console.log(`[getUserIdFromPhoneSecret] Using default user ${prefs.user_id} from scheduling_prefs`);
    return prefs.user_id;
  }
  
  console.log('[getUserIdFromPhoneSecret] No user found');
  return null;
}

// Execute tool calls
async function executeTool(toolName: string, args: Record<string, unknown>, userId: string, timezone: string): Promise<string> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  // Get current date in user's timezone
  const now = new Date();
  const userNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const todayStr = userNow.toISOString().split('T')[0];

  console.log(`Executing tool: ${toolName} with args:`, args);

  switch (toolName) {
    case 'get_today_tasks': {
      const startOfDay = `${todayStr}T00:00:00`;
      const endOfDay = `${todayStr}T23:59:59`;
      
      const { data: tasks, error } = await supabase
        .from('tasks')
        .select('id, title, description, status, priority, start_time, end_time, due_date, is_scheduled')
        .eq('user_id', userId)
        .or(`start_time.gte.${startOfDay},start_time.lte.${endOfDay},due_date.gte.${startOfDay},due_date.lte.${endOfDay}`)
        .neq('status', 'DONE')
        .order('start_time', { ascending: true, nullsFirst: false });

      if (error) {
        console.error('Error fetching tasks:', error);
        return 'I had trouble fetching your tasks.';
      }

      if (!tasks || tasks.length === 0) {
        return 'You have no tasks scheduled for today.';
      }

      const taskList = tasks.map((t, i) => {
        const time = t.start_time ? new Date(t.start_time).toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit',
          timeZone: timezone 
        }) : (t.due_date ? `due ${new Date(t.due_date).toLocaleDateString('en-US', { timeZone: timezone })}` : 'unscheduled');
        return `${i + 1}. ${t.title} (${time}, ${t.priority} priority)`;
      }).join('; ');

      return `You have ${tasks.length} task${tasks.length > 1 ? 's' : ''} today: ${taskList}`;
    }

    case 'get_upcoming_tasks': {
      const days = (args.days as number) || 3;
      const futureDate = new Date(userNow);
      futureDate.setDate(futureDate.getDate() + days);
      const futureDateStr = futureDate.toISOString().split('T')[0];
      
      const { data: tasks, error } = await supabase
        .from('tasks')
        .select('id, title, status, priority, start_time, due_date')
        .eq('user_id', userId)
        .gte('start_time', `${todayStr}T00:00:00`)
        .lte('start_time', `${futureDateStr}T23:59:59`)
        .neq('status', 'DONE')
        .order('start_time', { ascending: true });

      if (error) {
        console.error('Error fetching tasks:', error);
        return 'I had trouble fetching your upcoming tasks.';
      }

      if (!tasks || tasks.length === 0) {
        return `You have no scheduled tasks for the next ${days} days.`;
      }

      const taskList = tasks.slice(0, 5).map((t) => {
        const date = t.start_time ? new Date(t.start_time).toLocaleDateString('en-US', { 
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          timeZone: timezone 
        }) : 'TBD';
        return `${t.title} on ${date}`;
      }).join('; ');

      return `Upcoming tasks: ${taskList}${tasks.length > 5 ? ` and ${tasks.length - 5} more` : ''}`;
    }

    case 'create_task': {
      // Get default board for user
      const { data: board } = await supabase
        .from('boards')
        .select('id')
        .eq('user_id', userId)
        .eq('is_default', true)
        .single();

      if (!board) {
        return 'I could not find your task board. Please set up a default board in the app.';
      }

      const { error } = await supabase
        .from('tasks')
        .insert({
          user_id: userId,
          board_id: board.id,
          title: args.title as string,
          description: (args.description as string) || null,
          due_date: args.due_date ? `${args.due_date}T23:59:59` : null,
          priority: (args.priority as string) || 'MEDIUM',
          status: 'BACKLOG'
        });

      if (error) {
        console.error('Error creating task:', error);
        return 'I had trouble creating that task.';
      }

      return `Created task: ${args.title}`;
    }

    case 'complete_task': {
      const { data: tasks } = await supabase
        .from('tasks')
        .select('id, title')
        .eq('user_id', userId)
        .neq('status', 'DONE')
        .ilike('title', `%${args.task_title}%`)
        .limit(1);

      if (!tasks || tasks.length === 0) {
        return `I couldn't find a task matching "${args.task_title}"`;
      }

      const { error } = await supabase
        .from('tasks')
        .update({ status: 'DONE', completed_at: new Date().toISOString() })
        .eq('id', tasks[0].id);

      if (error) {
        console.error('Error completing task:', error);
        return 'I had trouble completing that task.';
      }

      return `Marked "${tasks[0].title}" as complete. Nice work!`;
    }

    case 'reschedule_task': {
      const { data: tasks } = await supabase
        .from('tasks')
        .select('id, title')
        .eq('user_id', userId)
        .neq('status', 'DONE')
        .ilike('title', `%${args.task_title}%`)
        .limit(1);

      if (!tasks || tasks.length === 0) {
        return `I couldn't find a task matching "${args.task_title}"`;
      }

      const newDateTime = args.new_time 
        ? `${args.new_date}T${args.new_time}:00`
        : `${args.new_date}T09:00:00`;

      const { error } = await supabase
        .from('tasks')
        .update({ 
          start_time: newDateTime,
          is_scheduled: true
        })
        .eq('id', tasks[0].id);

      if (error) {
        console.error('Error rescheduling task:', error);
        return 'I had trouble rescheduling that task.';
      }

      const formattedDate = new Date(newDateTime).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        timeZone: timezone
      });
      const formattedTime = args.new_time 
        ? new Date(newDateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone })
        : '';

      return `Rescheduled "${tasks[0].title}" to ${formattedDate}${formattedTime ? ` at ${formattedTime}` : ''}`;
    }

    case 'end_call': {
      return 'ENDING_CALL';
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}

// Process speech with OpenAI and return response
async function processWithAI(
  speechText: string, 
  userId: string | null, 
  timezone: string,
  instructions: string,
  conversationHistory: Array<{ role: string; content: string }>
): Promise<{ response: string; shouldEndCall: boolean; updatedHistory: Array<{ role: string; content: string }> }> {
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  
  if (!openaiKey) {
    console.error('Missing OPENAI_API_KEY');
    return { 
      response: "I'm having trouble connecting to my brain right now. Please try again later.",
      shouldEndCall: false,
      updatedHistory: conversationHistory
    };
  }

  // Build system prompt
  const now = new Date();
  const userTime = now.toLocaleString('en-US', { timeZone: timezone });
  
  const systemPrompt = `You are Iris Chase, a friendly and efficient phone-based task assistant. You're having a voice conversation over the phone, so keep responses concise and conversational.

Current time in user's timezone (${timezone}): ${userTime}

${instructions ? `User's custom instructions:\n${instructions}\n\n` : ''}

Guidelines:
- Keep responses short and natural for phone conversation (1-3 sentences)
- Be warm but efficient
- Use tool calls to get real task data - don't make up tasks
- When the user says goodbye or indicates they're done, use the end_call tool
- If user asks about their schedule, use get_today_tasks or get_upcoming_tasks
- Confirm actions clearly after completing them
${userId ? '' : '\n- Note: I could not identify this caller, so task management features are limited.'}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
    { role: 'user', content: speechText }
  ];

  try {
    console.log('Calling OpenAI with messages:', JSON.stringify(messages.slice(-3)));

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        tools: userId ? phoneTools : undefined,
        tool_choice: userId ? 'auto' : undefined,
        max_tokens: 300,
        temperature: 0.7
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      return {
        response: "I'm having a moment. Could you repeat that?",
        shouldEndCall: false,
        updatedHistory: conversationHistory
      };
    }

    const data = await response.json();
    const choice = data.choices[0];
    
    console.log('OpenAI response:', JSON.stringify(choice));

    // Handle tool calls
    if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
      const toolResults: string[] = [];
      let shouldEndCall = false;

      for (const toolCall of choice.message.tool_calls) {
        const toolName = toolCall.function.name;
        const toolArgs = JSON.parse(toolCall.function.arguments);
        
        if (userId) {
          const result = await executeTool(toolName, toolArgs, userId, timezone);
          if (result === 'ENDING_CALL') {
            shouldEndCall = true;
            toolResults.push('Call ended at user request');
          } else {
            toolResults.push(result);
          }
        }
      }

      // If ending call, return goodbye message
      if (shouldEndCall) {
        return {
          response: "Goodbye! Have a great day!",
          shouldEndCall: true,
          updatedHistory: [
            ...conversationHistory,
            { role: 'user', content: speechText },
            { role: 'assistant', content: "Goodbye! Have a great day!" }
          ]
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
          model: 'gpt-4o-mini',
          messages: followUpMessages,
          max_tokens: 300,
          temperature: 0.7
        }),
      });

      if (followUpResponse.ok) {
        const followUpData = await followUpResponse.json();
        const finalContent = followUpData.choices[0].message.content;
        
        return {
          response: finalContent,
          shouldEndCall: false,
          updatedHistory: [
            ...conversationHistory,
            { role: 'user', content: speechText },
            { role: 'assistant', content: finalContent }
          ]
        };
      }
    }

    // No tool calls, just return the response
    const content = choice.message.content || "I'm not sure how to help with that.";
    
    return {
      response: content,
      shouldEndCall: false,
      updatedHistory: [
        ...conversationHistory,
        { role: 'user', content: speechText },
        { role: 'assistant', content }
      ]
    };

  } catch (error) {
    console.error('Error processing with AI:', error);
    return {
      response: "I had trouble understanding. Could you say that again?",
      shouldEndCall: false,
      updatedHistory: conversationHistory
    };
  }
}

// Generate TwiML that connects to the realtime bridge via Media Streams
function generateRealtimeBridgeTwiML(context?: string, userId?: string | null, callerPhone?: string): string {
  // Build the WebSocket URL for the realtime bridge
  const bridgeUrl = `wss://wwxgajrtmslzklnyplah.supabase.co/functions/v1/twilio-realtime-bridge`;
  const params = new URLSearchParams();
  if (userId) params.set('userId', userId);
  if (callerPhone) params.set('phone', callerPhone);
  if (context) params.set('context', context);
  
  const wsUrl = params.toString() ? `${bridgeUrl}?${params.toString()}` : bridgeUrl;
  
  console.log('Generating Media Streams TwiML with bridge URL:', wsUrl);
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}">
      <Parameter name="userId" value="${userId || ''}" />
      <Parameter name="phone" value="${callerPhone || ''}" />
      <Parameter name="context" value="${escapeXml(context || '')}" />
    </Stream>
  </Connect>
</Response>`;
}

// Generate fallback TwiML with turn-based conversation (for debugging/fallback)
function generateFallbackGreetingTwiML(context?: string, userId?: string | null): string {
  const greeting = context 
    ? `Hello! I'm calling about ${context}. How can I help you?`
    : `Hello! This is Iris, your task assistant. How can I help you today?`;
  
  const processUrl = `${supabaseUrl}/functions/v1/twilio-voice-handler?action=process-speech&turn=1${userId ? `&userId=${userId}` : ''}`;
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${greeting}</Say>
  <Gather input="speech" timeout="5" speechTimeout="auto" action="${processUrl}">
    <Say voice="Polly.Joanna">Go ahead, I'm listening.</Say>
  </Gather>
  <Say voice="Polly.Joanna">I didn't hear anything. Let me know if you need help!</Say>
  <Gather input="speech" timeout="5" speechTimeout="auto" action="${processUrl}">
    <Say voice="Polly.Joanna">I'm still here.</Say>
  </Gather>
  <Say voice="Polly.Joanna">Goodbye!</Say>
  <Hangup/>
</Response>`;
}

// Generate response TwiML
function generateResponseTwiML(response: string, shouldEndCall: boolean, turn: number, userId?: string): string {
  if (shouldEndCall) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${escapeXml(response)}</Say>
  <Hangup/>
</Response>`;
  }

  const nextTurn = turn + 1;
  const processUrl = `${supabaseUrl}/functions/v1/twilio-voice-handler?action=process-speech&turn=${nextTurn}${userId ? `&userId=${userId}` : ''}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${escapeXml(response)}</Say>
  <Gather input="speech" timeout="5" speechTimeout="auto" action="${processUrl}">
    <Pause length="1"/>
  </Gather>
  <Say voice="Polly.Joanna">Are you still there?</Say>
  <Gather input="speech" timeout="5" speechTimeout="auto" action="${processUrl}">
    <Pause length="1"/>
  </Gather>
  <Say voice="Polly.Joanna">Goodbye!</Say>
  <Hangup/>
</Response>`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Make outbound call using Twilio REST API
async function triggerOutboundCall(
  toNumber: string,
  context?: string,
  delayMinutes?: number,
  userId?: string
): Promise<{ 
  success: boolean; 
  call_sid?: string; 
  error?: string; 
  scheduled_for?: string;
  debug?: Record<string, unknown>;
}> {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
  const fromNumber = Deno.env.get('TWILIO_PHONE_NUMBER');

  const debug: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    toNumber_provided: !!toNumber,
    toNumber_format: toNumber ? (toNumber.startsWith('+') ? 'E.164' : 'non-E.164') : 'missing',
    fromNumber_configured: !!fromNumber,
    fromNumber_format: fromNumber ? (fromNumber.startsWith('+') ? 'E.164' : 'non-E.164') : 'missing',
    accountSid_configured: !!accountSid,
    authToken_configured: !!authToken,
  };

  console.log('=== TWILIO OUTBOUND CALL DEBUG ===');
  console.log('To Number:', toNumber ? `${toNumber.substring(0, 4)}...${toNumber.slice(-2)}` : 'MISSING');
  console.log('From Number:', fromNumber ? `${fromNumber.substring(0, 4)}...${fromNumber.slice(-2)}` : 'MISSING');

  if (!accountSid || !authToken || !fromNumber) {
    const error = 'Missing Twilio credentials';
    return { success: false, error, debug };
  }

  if (!toNumber || !toNumber.startsWith('+')) {
    const error = 'Invalid phone number format (must be E.164)';
    return { success: false, error, debug };
  }

  if (delayMinutes && delayMinutes > 0) {
    const scheduledFor = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
    console.log(`Call scheduled for ${delayMinutes} minutes from now: ${scheduledFor}`);
    debug.scheduled_for = scheduledFor;
  }

  const twimlUrl = `${supabaseUrl}/functions/v1/twilio-voice-handler?action=incoming-call&context=${encodeURIComponent(context || '')}${userId ? `&userId=${userId}` : ''}`;
  const statusCallbackUrl = `${supabaseUrl}/functions/v1/twilio-voice-handler?action=status-callback`;

  debug.twiml_url = twimlUrl;

  try {
    const credentials = btoa(`${accountSid}:${authToken}`);
    const apiUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`;

    const requestBody = new URLSearchParams();
    requestBody.append('To', toNumber);
    requestBody.append('From', fromNumber);
    requestBody.append('Url', twimlUrl);
    requestBody.append('StatusCallback', statusCallbackUrl);
    requestBody.append('StatusCallbackEvent', 'initiated');
    requestBody.append('StatusCallbackEvent', 'ringing');
    requestBody.append('StatusCallbackEvent', 'answered');
    requestBody.append('StatusCallbackEvent', 'completed');
    requestBody.append('StatusCallbackMethod', 'POST');
    requestBody.append('MachineDetection', 'DetectMessageEnd');
    requestBody.append('MachineDetectionTimeout', '5');

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: requestBody,
    });

    const responseText = await response.text();
    debug.twilio_response_status = response.status;

    if (!response.ok) {
      let errorDetail = responseText;
      try {
        const errorJson = JSON.parse(responseText);
        errorDetail = `Code ${errorJson.code}: ${errorJson.message}`;
      } catch { /* Response wasn't JSON */ }
      return { success: false, error: `Twilio API error: ${errorDetail}`, debug };
    }

    const callData = JSON.parse(responseText);
    console.log('=== CALL INITIATED ===', callData.sid);

    return { 
      success: true, 
      call_sid: callData.sid,
      scheduled_for: delayMinutes ? new Date(Date.now() + delayMinutes * 60 * 1000).toISOString() : undefined,
      debug
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Twilio call error:', errorMessage);
    return { success: false, error: errorMessage, debug };
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action') || 'trigger-call';
  const contextParam = url.searchParams.get('context') || '';
  const turnParam = parseInt(url.searchParams.get('turn') || '1', 10);
  const userIdParam = url.searchParams.get('userId') || '';

  console.log(`Twilio voice handler: action=${action}, turn=${turnParam}`);

  try {
    switch (action) {
      case 'trigger-call': {
        const body: TwilioCallRequest = await req.json();
        
        let phoneNumber = body.phoneNumber || Deno.env.get('MY_PHONE_NUMBER');
        let userId = body.userId;
        
        if (body.userId) {
          const supabase = createClient(supabaseUrl, supabaseServiceKey);
          const { data: profile } = await supabase
            .from('profiles')
            .select('phone')
            .eq('user_id', body.userId)
            .maybeSingle();
          
          if (profile?.phone) {
            phoneNumber = profile.phone;
          }
        } else {
          // Try to get userId from phone secret
          userId = await getUserIdFromPhoneSecret() || undefined;
        }

        if (!phoneNumber) {
          return new Response(JSON.stringify({
            success: false,
            error: 'No phone number configured.'
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const result = await triggerOutboundCall(
          phoneNumber,
          body.context,
          body.delay_minutes,
          userId
        );

        return new Response(JSON.stringify(result), {
          status: result.success ? 200 : 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'incoming-call': {
        // Initial call connection - use Media Streams for real-time AI
        // Try to identify user from caller ID
        const callerPhone = url.searchParams.get('From') || Deno.env.get('MY_PHONE_NUMBER');
        let userId = userIdParam || null;
        
        if (!userId && callerPhone) {
          const context = await getUserContext(callerPhone);
          userId = context.userId;
        }

        // Check if we should use realtime bridge or fallback
        const useFallback = url.searchParams.get('fallback') === 'true';
        
        const twiml = useFallback 
          ? generateFallbackGreetingTwiML(contextParam, userId)
          : generateRealtimeBridgeTwiML(contextParam, userId, callerPhone || undefined);
        
        console.log('Incoming call - using', useFallback ? 'fallback' : 'realtime bridge');
        
        return new Response(twiml, {
          headers: { 'Content-Type': 'application/xml' },
        });
      }

      case 'process-speech': {
        // Handle speech input from Gather
        const formData = await req.formData();
        const speechResult = formData.get('SpeechResult') as string;
        const callerPhone = formData.get('From') as string || Deno.env.get('MY_PHONE_NUMBER') || '';
        
        console.log(`Turn ${turnParam} - Speech received:`, speechResult);

        if (!speechResult) {
          // No speech detected
          const twiml = generateResponseTwiML(
            "I didn't catch that. Could you please repeat?",
            false,
            turnParam,
            userIdParam
          );
          return new Response(twiml, {
            headers: { 'Content-Type': 'application/xml' },
          });
        }

        // Get user context
        let userId = userIdParam || null;
        let timezone = 'America/New_York';
        let instructions = '';

        if (userIdParam) {
          const supabase = createClient(supabaseUrl, supabaseServiceKey);
          const { data: prefs } = await supabase
            .from('user_scheduling_prefs')
            .select('timezone, core_instructions, realtime_extensions')
            .eq('user_id', userIdParam)
            .maybeSingle();
          
          if (prefs) {
            timezone = prefs.timezone || timezone;
            instructions = [prefs.core_instructions, prefs.realtime_extensions].filter(Boolean).join('\n\n');
          }
        } else if (callerPhone) {
          const context = await getUserContext(callerPhone);
          userId = context.userId;
          timezone = context.timezone;
          instructions = context.instructions;
        }

        // For now, we don't persist conversation history across turns
        // (would need a cache like Redis for production)
        const conversationHistory: Array<{ role: string; content: string }> = [];

        // Process with AI
        const { response, shouldEndCall } = await processWithAI(
          speechResult,
          userId,
          timezone,
          instructions,
          conversationHistory
        );

        const twiml = generateResponseTwiML(response, shouldEndCall, turnParam, userId || undefined);

        return new Response(twiml, {
          headers: { 'Content-Type': 'application/xml' },
        });
      }

      case 'status-callback': {
        const formData = await req.formData();
        
        const statusData = {
          callSid: formData.get('CallSid'),
          callStatus: formData.get('CallStatus'),
          callDuration: formData.get('CallDuration'),
          answeredBy: formData.get('AnsweredBy'),
          direction: formData.get('Direction'),
          from: formData.get('From'),
          to: formData.get('To'),
          errorCode: formData.get('ErrorCode'),
          errorMessage: formData.get('ErrorMessage'),
        };

        console.log('=== STATUS CALLBACK ===', JSON.stringify(statusData));

        return new Response(JSON.stringify({ received: true, statusData }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
  } catch (error) {
    console.error('Error in twilio-voice-handler:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
