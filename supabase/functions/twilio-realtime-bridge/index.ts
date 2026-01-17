import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// G.711 μ-law encoding/decoding tables
const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

// μ-law to linear PCM decoding table (8-bit -> 16-bit)
const mulawToLinearTable: Int16Array = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  let sample = ~i;
  const sign = sample & 0x80;
  const exponent = (sample >> 4) & 0x07;
  let mantissa = sample & 0x0F;
  mantissa = (mantissa << 1) + 33;
  mantissa = mantissa << exponent;
  mantissa -= 33;
  mulawToLinearTable[i] = sign !== 0 ? -mantissa : mantissa;
}

// Linear PCM to μ-law encoding
function linearToMulaw(sample: number): number {
  const sign = sample < 0 ? 0x80 : 0;
  sample = Math.abs(sample);
  if (sample > MULAW_CLIP) sample = MULAW_CLIP;
  sample = sample + MULAW_BIAS;
  
  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1);
  
  const mantissa = (sample >> (exponent + 3)) & 0x0F;
  const mulawByte = ~(sign | (exponent << 4) | mantissa);
  return mulawByte & 0xFF;
}

// Decode μ-law audio to PCM16 (8kHz -> needs upsampling to 24kHz)
function decodeMulaw(mulawData: Uint8Array): Int16Array {
  const pcm = new Int16Array(mulawData.length);
  for (let i = 0; i < mulawData.length; i++) {
    pcm[i] = mulawToLinearTable[mulawData[i]];
  }
  return pcm;
}

// Encode PCM16 to μ-law
function encodeMulaw(pcmData: Int16Array): Uint8Array {
  const mulaw = new Uint8Array(pcmData.length);
  for (let i = 0; i < pcmData.length; i++) {
    mulaw[i] = linearToMulaw(pcmData[i]);
  }
  return mulaw;
}

// Upsample from 8kHz to 24kHz (3x) using linear interpolation
function upsample8to24(pcm8k: Int16Array): Int16Array {
  const pcm24k = new Int16Array(pcm8k.length * 3);
  for (let i = 0; i < pcm8k.length; i++) {
    const current = pcm8k[i];
    const next = i < pcm8k.length - 1 ? pcm8k[i + 1] : current;
    const idx = i * 3;
    pcm24k[idx] = current;
    pcm24k[idx + 1] = Math.round(current + (next - current) / 3);
    pcm24k[idx + 2] = Math.round(current + (2 * (next - current)) / 3);
  }
  return pcm24k;
}

// Downsample from 24kHz to 8kHz (1/3) by averaging
function downsample24to8(pcm24k: Int16Array): Int16Array {
  const pcm8k = new Int16Array(Math.floor(pcm24k.length / 3));
  for (let i = 0; i < pcm8k.length; i++) {
    const idx = i * 3;
    pcm8k[i] = Math.round((pcm24k[idx] + pcm24k[idx + 1] + pcm24k[idx + 2]) / 3);
  }
  return pcm8k;
}

// Convert Int16Array to base64
function int16ToBase64(pcmData: Int16Array): string {
  const uint8 = new Uint8Array(pcmData.buffer);
  let binary = '';
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary);
}

// Convert base64 to Int16Array
function base64ToInt16(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

// Tool definitions for OpenAI Realtime API
const realtimeTools = [
  {
    type: "function",
    name: "get_today_tasks",
    description: "Get all tasks scheduled for today",
    parameters: { type: "object", properties: {}, required: [] }
  },
  {
    type: "function",
    name: "get_upcoming_tasks",
    description: "Get upcoming tasks for the next few days",
    parameters: { 
      type: "object", 
      properties: {
        days: { type: "number", description: "Number of days to look ahead (default 3)" }
      },
      required: [] 
    }
  },
  {
    type: "function",
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
  },
  {
    type: "function",
    name: "complete_task",
    description: "Mark a task as completed",
    parameters: {
      type: "object",
      properties: {
        task_title: { type: "string", description: "Title or partial title of the task to complete" }
      },
      required: ["task_title"]
    }
  },
  {
    type: "function",
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
  },
  {
    type: "function",
    name: "end_call",
    description: "End the phone call when the user says goodbye or indicates they're done",
    parameters: { type: "object", properties: {}, required: [] }
  }
];

// Execute tool calls server-side
async function executeTool(
  toolName: string, 
  args: Record<string, unknown>, 
  userId: string, 
  timezone: string
): Promise<string> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const now = new Date();
  const userNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const todayStr = userNow.toISOString().split('T')[0];

  console.log(`[TOOL] Executing: ${toolName}`, args);

  switch (toolName) {
    case 'get_today_tasks': {
      const startOfDay = `${todayStr}T00:00:00`;
      const endOfDay = `${todayStr}T23:59:59`;
      
      const { data: tasks, error } = await supabase
        .from('tasks')
        .select('id, title, description, status, priority, start_time, end_time, due_date')
        .eq('user_id', userId)
        .or(`start_time.gte.${startOfDay},start_time.lte.${endOfDay},due_date.eq.${todayStr}`)
        .neq('status', 'DONE')
        .order('start_time', { ascending: true, nullsFirst: false });

      if (error) {
        console.error('[TOOL] Error fetching tasks:', error);
        return 'I had trouble fetching your tasks.';
      }

      if (!tasks || tasks.length === 0) {
        return 'You have no tasks scheduled for today. Your calendar is clear!';
      }

      const taskList = tasks.map((t, i) => {
        const time = t.start_time ? new Date(t.start_time).toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit',
          timeZone: timezone 
        }) : 'unscheduled';
        return `${i + 1}. ${t.title} at ${time}, ${t.priority} priority`;
      }).join('. ');

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
        console.error('[TOOL] Error fetching tasks:', error);
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
      }).join('. ');

      return `Upcoming tasks: ${taskList}${tasks.length > 5 ? `. And ${tasks.length - 5} more` : ''}`;
    }

    case 'create_task': {
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
        console.error('[TOOL] Error creating task:', error);
        return 'I had trouble creating that task.';
      }

      return `Done! I created the task: ${args.title}`;
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
        console.error('[TOOL] Error completing task:', error);
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
        .update({ start_time: newDateTime, is_scheduled: true })
        .eq('id', tasks[0].id);

      if (error) {
        console.error('[TOOL] Error rescheduling task:', error);
        return 'I had trouble rescheduling that task.';
      }

      const formattedDate = new Date(newDateTime).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        timeZone: timezone
      });

      return `Rescheduled "${tasks[0].title}" to ${formattedDate}`;
    }

    case 'end_call': {
      return 'ENDING_CALL';
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}

// Get user context from phone number or userId
async function getUserContext(
  phoneNumber?: string,
  userId?: string
): Promise<{ userId: string | null; timezone: string; instructions: string }> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  let resolvedUserId = userId || null;
  
  if (!resolvedUserId && phoneNumber) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('phone', phoneNumber)
      .maybeSingle();
    resolvedUserId = profile?.user_id || null;
  }

  if (!resolvedUserId) {
    return { userId: null, timezone: 'America/New_York', instructions: '' };
  }

  const { data: prefs } = await supabase
    .from('user_scheduling_prefs')
    .select('timezone, core_instructions, realtime_extensions')
    .eq('user_id', resolvedUserId)
    .maybeSingle();

  return {
    userId: resolvedUserId,
    timezone: prefs?.timezone || 'America/New_York',
    instructions: [prefs?.core_instructions, prefs?.realtime_extensions].filter(Boolean).join('\n\n')
  };
}

// Build system instructions for OpenAI
function buildSystemInstructions(timezone: string, userInstructions: string): string {
  const now = new Date();
  const userTime = now.toLocaleString('en-US', { timeZone: timezone });
  
  return `You are Iris Chase, a friendly, efficient, and proactive phone-based task assistant. You're having a real-time voice conversation over the phone.

Current time in user's timezone (${timezone}): ${userTime}

${userInstructions ? `User's custom instructions:\n${userInstructions}\n\n` : ''}

PHONE CONVERSATION GUIDELINES:
- Keep responses SHORT and natural (1-2 sentences max for most responses)
- Be warm but efficient - this is a phone call, not a chat
- Speak conversationally, not robotically
- Use the tools to get REAL task data - never make up tasks
- When the user says goodbye, use the end_call tool immediately
- Confirm actions briefly after completing them
- If asked about schedule, use get_today_tasks or get_upcoming_tasks
- Create tasks only when explicitly requested

VOICE STYLE:
- Natural pauses between thoughts
- Friendly and professional tone
- Brief confirmations like "Got it" or "Done"
- Proactive suggestions when appropriate`;
}

// Main WebSocket handler for Twilio Media Streams
serve(async (req) => {
  const url = new URL(req.url);
  
  // Check if this is a WebSocket upgrade request
  if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
    console.log('[BRIDGE] WebSocket upgrade request received');
    
    // Get parameters from URL
    const userIdParam = url.searchParams.get('userId') || undefined;
    const phoneParam = url.searchParams.get('phone') || undefined;
    const contextParam = url.searchParams.get('context') || '';
    
    // Get user context
    const userContext = await getUserContext(phoneParam, userIdParam);
    console.log('[BRIDGE] User context:', { 
      userId: userContext.userId, 
      timezone: userContext.timezone,
      hasInstructions: !!userContext.instructions 
    });
    
    // Upgrade to WebSocket
    const { socket: twilioWs, response } = Deno.upgradeWebSocket(req);
    
    let openaiWs: WebSocket | null = null;
    let streamSid: string | null = null;
    let isConnectedToOpenAI = false;
    let pendingFunctionCalls: Map<string, { name: string; args: string }> = new Map();
    
    // Connect to OpenAI Realtime API
    const connectToOpenAI = () => {
      const openaiKey = Deno.env.get('OPENAI_API_KEY');
      if (!openaiKey) {
        console.error('[BRIDGE] Missing OPENAI_API_KEY');
        twilioWs.close();
        return;
      }
      
      console.log('[BRIDGE] Connecting to OpenAI Realtime API...');
      
      openaiWs = new WebSocket(
        'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17',
        {
          headers: {
            'Authorization': `Bearer ${openaiKey}`,
            'OpenAI-Beta': 'realtime=v1'
          } as unknown as string[]
        }
      );
      
      openaiWs.onopen = () => {
        console.log('[OPENAI] Connected to Realtime API');
        isConnectedToOpenAI = true;
      };
      
      openaiWs.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data as string);
          console.log('[OPENAI] Event:', data.type);
          
          switch (data.type) {
            case 'session.created': {
              // Configure the session after it's created
              console.log('[OPENAI] Session created, sending configuration...');
              
              const sessionConfig = {
                type: 'session.update',
                session: {
                  modalities: ['text', 'audio'],
                  instructions: buildSystemInstructions(userContext.timezone, userContext.instructions),
                  voice: 'alloy',
                  input_audio_format: 'pcm16',
                  output_audio_format: 'pcm16',
                  input_audio_transcription: {
                    model: 'whisper-1'
                  },
                  turn_detection: {
                    type: 'server_vad',
                    threshold: 0.5,
                    prefix_padding_ms: 300,
                    silence_duration_ms: 800
                  },
                  tools: userContext.userId ? realtimeTools : [],
                  tool_choice: userContext.userId ? 'auto' : 'none',
                  temperature: 0.8
                }
              };
              
              openaiWs!.send(JSON.stringify(sessionConfig));
              console.log('[OPENAI] Session configured with tools:', realtimeTools.length);
              
              // Send initial greeting after a short delay
              setTimeout(() => {
                const greeting = contextParam 
                  ? `Hello! I'm calling about ${contextParam}. How can I help you?`
                  : `Hello! This is Iris, your task assistant. How can I help you today?`;
                
                openaiWs!.send(JSON.stringify({
                  type: 'conversation.item.create',
                  item: {
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'text', text: greeting }]
                  }
                }));
                
                openaiWs!.send(JSON.stringify({
                  type: 'response.create',
                  response: { modalities: ['audio', 'text'] }
                }));
              }, 500);
              break;
            }
            
            case 'response.audio.delta': {
              // Forward audio from OpenAI to Twilio
              if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
                // OpenAI sends PCM16 at 24kHz, Twilio needs μ-law at 8kHz
                const pcm24k = base64ToInt16(data.delta);
                const pcm8k = downsample24to8(pcm24k);
                const mulaw = encodeMulaw(pcm8k);
                
                twilioWs.send(JSON.stringify({
                  event: 'media',
                  streamSid: streamSid,
                  media: {
                    payload: btoa(String.fromCharCode(...mulaw))
                  }
                }));
              }
              break;
            }
            
            case 'response.function_call_arguments.delta': {
              // Accumulate function call arguments
              const callId = data.call_id;
              if (!pendingFunctionCalls.has(callId)) {
                pendingFunctionCalls.set(callId, { name: '', args: '' });
              }
              const pending = pendingFunctionCalls.get(callId)!;
              pending.args += data.delta;
              break;
            }
            
            case 'response.function_call_arguments.done': {
              // Execute the function call
              const callId = data.call_id;
              const functionName = data.name;
              const argsStr = data.arguments;
              
              console.log(`[OPENAI] Function call: ${functionName}(${argsStr})`);
              
              try {
                const args = JSON.parse(argsStr);
                
                // Check for end_call
                if (functionName === 'end_call') {
                  console.log('[BRIDGE] End call requested');
                  
                  // Send goodbye audio
                  openaiWs!.send(JSON.stringify({
                    type: 'conversation.item.create',
                    item: {
                      type: 'function_call_output',
                      call_id: callId,
                      output: 'Call ended at user request'
                    }
                  }));
                  
                  openaiWs!.send(JSON.stringify({
                    type: 'response.create',
                    response: { 
                      modalities: ['audio', 'text'],
                      instructions: 'Say a brief goodbye and end the conversation.'
                    }
                  }));
                  
                  // Close connections after a delay for goodbye
                  setTimeout(() => {
                    openaiWs?.close();
                    twilioWs.close();
                  }, 3000);
                  
                  break;
                }
                
                // Execute other tools
                if (userContext.userId) {
                  const result = await executeTool(
                    functionName,
                    args,
                    userContext.userId,
                    userContext.timezone
                  );
                  
                  console.log(`[TOOL] Result: ${result}`);
                  
                  // Send the result back to OpenAI
                  openaiWs!.send(JSON.stringify({
                    type: 'conversation.item.create',
                    item: {
                      type: 'function_call_output',
                      call_id: callId,
                      output: result
                    }
                  }));
                  
                  // Trigger a response
                  openaiWs!.send(JSON.stringify({
                    type: 'response.create',
                    response: { modalities: ['audio', 'text'] }
                  }));
                }
              } catch (e) {
                console.error('[OPENAI] Error executing function:', e);
              }
              
              pendingFunctionCalls.delete(callId);
              break;
            }
            
            case 'input_audio_buffer.speech_started': {
              console.log('[OPENAI] User started speaking');
              // Clear any pending audio output (barge-in)
              if (streamSid) {
                twilioWs.send(JSON.stringify({
                  event: 'clear',
                  streamSid: streamSid
                }));
              }
              break;
            }
            
            case 'input_audio_buffer.speech_stopped': {
              console.log('[OPENAI] User stopped speaking');
              break;
            }
            
            case 'response.audio_transcript.done': {
              console.log('[OPENAI] AI transcript:', data.transcript);
              break;
            }
            
            case 'conversation.item.input_audio_transcription.completed': {
              console.log('[OPENAI] User said:', data.transcript);
              break;
            }
            
            case 'error': {
              console.error('[OPENAI] Error:', data.error);
              break;
            }
          }
        } catch (e) {
          console.error('[OPENAI] Error processing message:', e);
        }
      };
      
      openaiWs.onerror = (e) => {
        console.error('[OPENAI] WebSocket error:', e);
      };
      
      openaiWs.onclose = (e) => {
        console.log('[OPENAI] Connection closed:', e.code, e.reason);
        isConnectedToOpenAI = false;
      };
    };
    
    // Handle Twilio WebSocket events
    twilioWs.onopen = () => {
      console.log('[TWILIO] WebSocket connected');
    };
    
    twilioWs.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data as string);
        
        switch (data.event) {
          case 'connected': {
            console.log('[TWILIO] Media stream connected');
            break;
          }
          
          case 'start': {
            streamSid = data.start.streamSid;
            console.log('[TWILIO] Stream started:', streamSid);
            console.log('[TWILIO] Call SID:', data.start.callSid);
            console.log('[TWILIO] Media format:', data.start.mediaFormat);
            
            // Connect to OpenAI now that we have the stream
            connectToOpenAI();
            break;
          }
          
          case 'media': {
            // Forward audio from Twilio to OpenAI
            if (openaiWs && isConnectedToOpenAI && openaiWs.readyState === WebSocket.OPEN) {
              // Twilio sends μ-law at 8kHz, OpenAI needs PCM16 at 24kHz
              const mulawBytes = Uint8Array.from(atob(data.media.payload), c => c.charCodeAt(0));
              const pcm8k = decodeMulaw(mulawBytes);
              const pcm24k = upsample8to24(pcm8k);
              const base64Audio = int16ToBase64(pcm24k);
              
              openaiWs.send(JSON.stringify({
                type: 'input_audio_buffer.append',
                audio: base64Audio
              }));
            }
            break;
          }
          
          case 'stop': {
            console.log('[TWILIO] Stream stopped');
            break;
          }
          
          case 'mark': {
            console.log('[TWILIO] Mark received:', data.mark.name);
            break;
          }
        }
      } catch (e) {
        console.error('[TWILIO] Error processing message:', e);
      }
    };
    
    twilioWs.onerror = (e) => {
      console.error('[TWILIO] WebSocket error:', e);
    };
    
    twilioWs.onclose = (e) => {
      console.log('[TWILIO] Connection closed:', e.code, e.reason);
      // Clean up OpenAI connection
      if (openaiWs) {
        openaiWs.close();
      }
    };
    
    return response;
  }
  
  // Non-WebSocket request - return info
  return new Response(JSON.stringify({
    name: 'twilio-realtime-bridge',
    description: 'Bridges Twilio Media Streams to OpenAI Realtime API for real-time voice conversations',
    websocket: true,
    usage: 'Connect via WebSocket with ?userId= or ?phone= parameters'
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
