import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// G.711 μ-law decoding table (8-bit -> 16-bit)
const mulawToLinearTable: Int16Array = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  let sample = ~i;
  const sign = sample & 0x80;
  const exponent = (sample >> 4) & 0x07;
  let mantissa = sample & 0x0f;
  mantissa = (mantissa << 1) + 33;
  mantissa = mantissa << exponent;
  mantissa -= 33;
  mulawToLinearTable[i] = sign !== 0 ? -mantissa : mantissa;
}

// μ-law to PCM16
function decodeMulaw(mulawData: Uint8Array): Int16Array {
  const pcm = new Int16Array(mulawData.length);
  for (let i = 0; i < mulawData.length; i++) {
    pcm[i] = mulawToLinearTable[mulawData[i]];
  }
  return pcm;
}

// PCM16 to μ-law
function encodeMulaw(pcmData: Int16Array): Uint8Array {
  const mulaw = new Uint8Array(pcmData.length);
  for (let i = 0; i < pcmData.length; i++) {
    let sample = pcmData[i];
    const sign = sample < 0 ? 0x80 : 0;
    sample = Math.abs(sample);
    if (sample > 32635) sample = 32635;
    sample = sample + 0x84;
    let exponent = 7;
    for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1);
    const mantissa = (sample >> (exponent + 3)) & 0x0f;
    mulaw[i] = ~(sign | (exponent << 4) | mantissa) & 0xff;
  }
  return mulaw;
}

// Upsample 8kHz → 24kHz (3x)
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

// Downsample 24kHz → 8kHz (1/3)
function downsample24to8(pcm24k: Int16Array): Int16Array {
  const pcm8k = new Int16Array(Math.floor(pcm24k.length / 3));
  for (let i = 0; i < pcm8k.length; i++) {
    const idx = i * 3;
    pcm8k[i] = Math.round((pcm24k[idx] + pcm24k[idx + 1] + pcm24k[idx + 2]) / 3);
  }
  return pcm8k;
}

// Int16Array → Base64
function int16ToBase64(pcmData: Int16Array): string {
  const uint8 = new Uint8Array(pcmData.buffer);
  let binary = "";
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary);
}

// Base64 → Int16Array
function base64ToInt16(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

// Get time-based greeting
function getTimeBasedGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

// Load user instructions from database
async function loadUserInstructions(userId: string | null): Promise<string> {
  const defaultInstructions = `You are Iris, a helpful and proactive executive assistant. You help with task management and daily planning.

Available functions:
- get_tasks: Retrieve tasks with time/keyword filtering
- get_today_tasks: Get all tasks scheduled for today
- create_task: Create new tasks with title, description, priority, and category
- update_task: Update existing tasks (status, title, description, priority)
- reschedule_task: Move a task to a different date or time
- schedule_task: Schedule an unscheduled task (automatically finds optimal time slot)
- unschedule_task: Remove a task from the calendar

Keep responses brief and conversational - this is a phone call.
When the user says goodbye, acknowledge and end gracefully.`;

  if (!userId) {
    console.log('[BRIDGE] No userId, using default instructions');
    return defaultInstructions;
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    
    const { data: prefs } = await supabase
      .from('user_scheduling_prefs')
      .select('core_instructions, realtime_extensions, config')
      .eq('user_id', userId)
      .maybeSingle();

    if (prefs) {
      let instructions = prefs.core_instructions || defaultInstructions;
      if (prefs.realtime_extensions) {
        instructions += `\n\n${prefs.realtime_extensions}`;
      }
      if (prefs.config?.customAIInstructions) {
        instructions += `\n\nScheduling Philosophy:\n${prefs.config.customAIInstructions}`;
      }
      console.log('[BRIDGE] Loaded user instructions from database');
      return instructions;
    }
  } catch (error) {
    console.warn('[BRIDGE] Failed to load user instructions:', error);
  }

  return defaultInstructions;
}

// Tool definitions (same as in-app assistant)
const toolDefinitions = [
  {
    type: "function",
    name: "get_tasks",
    description: "Retrieve tasks and chat history. Can search by time period, keywords, or status.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query or keywords" },
        time_filter: { type: "string", description: "Time period like 'past week', 'yesterday'" },
        status: { type: "string", enum: ["BACKLOG", "TODO", "DOING", "DONE"] }
      }
    }
  },
  {
    type: "function",
    name: "create_task",
    description: "Create a new task. Use UPPERCASE for priority.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title" },
        description: { type: "string", description: "Task description" },
        priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
        category: { type: "string", enum: ["LIFE", "CAREER", "VENTURES", "EDUCATION"] }
      },
      required: ["title"]
    }
  },
  {
    type: "function",
    name: "update_task",
    description: "Update an existing task's properties.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "ID of the task to update" },
        title: { type: "string" },
        description: { type: "string" },
        status: { type: "string", enum: ["BACKLOG", "TODO", "DOING", "DONE"] },
        priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
        category: { type: "string", enum: ["LIFE", "CAREER", "VENTURES", "EDUCATION"] }
      },
      required: ["task_id"]
    }
  },
  {
    type: "function",
    name: "get_today_tasks",
    description: "Get all tasks for today, including both scheduled and unscheduled tasks.",
    parameters: { type: "object", properties: {} }
  },
  {
    type: "function",
    name: "reschedule_task",
    description: "Move a task to a different date or time.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "ID of the task to reschedule" },
        new_date: { type: "string", description: "New date in YYYY-MM-DD format" },
        new_start_time: { type: "string", description: "New start time in HH:MM format" },
        reason: { type: "string" }
      },
      required: ["task_id", "new_date"]
    }
  },
  {
    type: "function",
    name: "schedule_task",
    description: "Schedule an unscheduled task to a specific date and time.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "ID of the task to schedule" },
        date: { type: "string", description: "Date in YYYY-MM-DD format" },
        start_time: { type: "string", description: "Start time in HH:MM format" },
        duration_minutes: { type: "number" }
      },
      required: ["task_id"]
    }
  },
  {
    type: "function",
    name: "unschedule_task",
    description: "Remove a task from the calendar schedule.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "ID of the task to unschedule" }
      },
      required: ["task_id"]
    }
  }
];

serve(async (req) => {
  const url = new URL(req.url);
  console.log(`[BRIDGE v3] Request: ${req.method} ${url.pathname}`);

  // Health check endpoint
  if (url.pathname.endsWith("/health")) {
    return new Response(JSON.stringify({ status: "ok", timestamp: Date.now() }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Handle WebSocket upgrade
  if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
    const { socket: twilioWs, response } = Deno.upgradeWebSocket(req);

    let openaiWs: WebSocket | null = null;
    let streamSid: string | null = null;
    let callDirection: string = 'inbound';
    let userId: string | null = null;
    let userPhone: string | null = null;
    let callContext: string | null = null;
    let sessionConfigured = false;
    let greetingSent = false;

    twilioWs.onopen = () => {
      console.log("[TWILIO] WebSocket connected");
    };

    twilioWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        switch (data.event) {
          case "connected":
            console.log("[TWILIO] Media stream connected");
            break;

          case "start":
            streamSid = data.start.streamSid;
            const customParams = data.start.customParameters || {};
            userId = customParams.userId || null;
            userPhone = customParams.phone || null;
            callContext = customParams.context || null;
            callDirection = customParams.direction || 'inbound';
            
            console.log(`[TWILIO] Stream started: ${streamSid}`);
            console.log(`[TWILIO] Custom params:`, JSON.stringify(customParams));
            console.log(`[TWILIO] Call direction: ${callDirection}, userId: ${userId}`);
            
            connectToOpenAI();
            break;

          case "media":
            if (openaiWs?.readyState === WebSocket.OPEN) {
              // Decode μ-law → PCM16 → Upsample to 24kHz → Base64
              const mulawBytes = Uint8Array.from(atob(data.media.payload), (c) => c.charCodeAt(0));
              const pcm8k = decodeMulaw(mulawBytes);
              const pcm24k = upsample8to24(pcm8k);
              const audioBase64 = int16ToBase64(pcm24k);

              openaiWs.send(JSON.stringify({
                type: "input_audio_buffer.append",
                audio: audioBase64,
              }));
            }
            break;

          case "stop":
            console.log("[TWILIO] Stream stopped");
            openaiWs?.close();
            break;
        }
      } catch (err) {
        console.error("[TWILIO] Error processing message:", err);
      }
    };

    twilioWs.onclose = () => {
      console.log("[TWILIO] WebSocket closed");
      openaiWs?.close();
    };

    twilioWs.onerror = (err) => {
      console.error("[TWILIO] WebSocket error:", err);
    };

    async function connectToOpenAI() {
      console.log("[OPENAI] Connecting...");

      // Load user-specific instructions
      const instructions = await loadUserInstructions(userId);

      openaiWs = new WebSocket(
        "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17",
        ["realtime", `openai-insecure-api-key.${OPENAI_API_KEY}`, "openai-beta.realtime-v1"]
      );

      openaiWs.onopen = () => {
        console.log("[OPENAI] Connected, waiting for session.created...");
      };

      openaiWs.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          switch (msg.type) {
            case "session.created":
              console.log("[OPENAI] Session created, sending config...");
              openaiWs!.send(JSON.stringify({
                type: "session.update",
                session: {
                  modalities: ["text", "audio"],
                  instructions: instructions,
                  voice: "alloy",
                  input_audio_format: "pcm16",
                  output_audio_format: "pcm16",
                  input_audio_transcription: { model: "whisper-1" },
                  turn_detection: {
                    type: "server_vad",
                    threshold: 0.3, // Lower threshold for phone audio
                    prefix_padding_ms: 400,
                    silence_duration_ms: 1200, // Longer silence for phone
                  },
                  tools: toolDefinitions,
                  tool_choice: "auto"
                },
              }));
              break;

            case "session.updated":
              console.log("[OPENAI] Session configured");
              sessionConfigured = true;
              
              // Send greeting for inbound calls
              if (callDirection === 'inbound' && !greetingSent) {
                sendGreeting();
              }
              break;

            case "response.audio.delta":
              if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
                // Decode Base64 → PCM16 → Downsample to 8kHz → μ-law → Base64
                const pcm24k = base64ToInt16(msg.delta);
                const pcm8k = downsample24to8(pcm24k);
                const mulaw = encodeMulaw(pcm8k);
                const mulawBase64 = btoa(String.fromCharCode(...mulaw));

                twilioWs.send(JSON.stringify({
                  event: "media",
                  streamSid: streamSid,
                  media: { payload: mulawBase64 },
                }));
              }
              break;

            case "input_audio_buffer.speech_started":
              console.log("[OPENAI] User started speaking");
              break;

            case "input_audio_buffer.speech_stopped":
              console.log("[OPENAI] User stopped speaking");
              break;

            case "conversation.item.input_audio_transcription.completed":
              console.log(`[OPENAI] User said: "${msg.transcript}"`);
              break;

            case "response.audio_transcript.done":
              console.log(`[OPENAI] AI said: "${msg.transcript}"`);
              break;

            case "response.function_call_arguments.done":
              console.log(`[OPENAI] Function call: ${msg.name}`, msg.arguments);
              handleFunctionCall(msg);
              break;

            case "error":
              console.error("[OPENAI] Error:", msg.error);
              break;
          }
        } catch (err) {
          console.error("[OPENAI] Error processing message:", err);
        }
      };

      openaiWs.onclose = () => {
        console.log("[OPENAI] Connection closed");
      };

      openaiWs.onerror = (err) => {
        console.error("[OPENAI] Connection error:", err);
      };
    }

    function sendGreeting() {
      if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN || greetingSent) return;
      
      greetingSent = true;
      const greeting = getTimeBasedGreeting();
      const contextInfo = callContext ? ` regarding ${callContext}` : '';
      
      console.log(`[BRIDGE] Sending inbound greeting: ${greeting}`);
      
      // Create a conversation item with the greeting prompt
      openaiWs.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{
            type: "input_text",
            text: `[System: This is an inbound phone call. Greet the caller with "${greeting}" and ask how you can help${contextInfo}. Be warm and professional.]`
          }]
        }
      }));

      // Trigger response
      openaiWs.send(JSON.stringify({ type: "response.create" }));
    }

    async function handleFunctionCall(msg: any) {
      if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;

      try {
        const args = JSON.parse(msg.arguments);
        const functionName = msg.name;
        
        console.log(`[BRIDGE] Executing function: ${functionName}`, args);

        let result: any = { success: false, error: "Function not implemented for phone" };

        // Execute functions using Supabase
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

        switch (functionName) {
          case "get_tasks":
            result = await getTasks(supabase, userId, args);
            break;
          case "get_today_tasks":
            result = await getTodayTasks(supabase, userId);
            break;
          case "create_task":
            result = await createTask(supabase, userId, args);
            break;
          case "update_task":
            result = await updateTask(supabase, args);
            break;
          case "reschedule_task":
            result = await rescheduleTask(supabase, args);
            break;
          case "schedule_task":
            result = await scheduleTask(supabase, args);
            break;
          case "unschedule_task":
            result = await unscheduleTask(supabase, args);
            break;
          default:
            result = { success: false, error: `Unknown function: ${functionName}` };
        }

        console.log(`[BRIDGE] Function result:`, result);

        // Send function output back to OpenAI
        openaiWs.send(JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: msg.call_id,
            output: JSON.stringify(result)
          }
        }));

        // Trigger response generation
        openaiWs.send(JSON.stringify({ type: "response.create" }));

      } catch (error) {
        console.error("[BRIDGE] Function call error:", error);
        
        openaiWs.send(JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: msg.call_id,
            output: JSON.stringify({ success: false, error: String(error) })
          }
        }));
        openaiWs.send(JSON.stringify({ type: "response.create" }));
      }
    }

    return response;
  }

  // Non-WebSocket request
  return new Response("Twilio-OpenAI Realtime Bridge v3", { status: 200 });
});

// ============ Task Functions ============

async function getTasks(supabase: any, userId: string | null, args: any) {
  if (!userId) return { success: false, error: "Not authenticated", tasks: [] };

  try {
    let query = supabase.from('tasks').select('*').eq('user_id', userId);
    
    if (args.status) {
      query = query.eq('status', args.status);
    }
    
    const { data, error } = await query.order('created_at', { ascending: false }).limit(20);
    
    if (error) throw error;
    
    return { 
      success: true, 
      tasks: data || [],
      count: data?.length || 0,
      message: `Found ${data?.length || 0} tasks`
    };
  } catch (error) {
    return { success: false, error: String(error), tasks: [] };
  }
}

async function getTodayTasks(supabase: any, userId: string | null) {
  if (!userId) return { success: false, error: "Not authenticated", tasks: [] };

  try {
    const today = new Date().toISOString().split('T')[0];
    
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .or(`due_date.eq.${today},scheduled_date.eq.${today}`)
      .order('scheduled_start_time', { ascending: true });
    
    if (error) throw error;
    
    return { 
      success: true, 
      tasks: data || [],
      count: data?.length || 0,
      message: `You have ${data?.length || 0} tasks for today`
    };
  } catch (error) {
    return { success: false, error: String(error), tasks: [] };
  }
}

async function createTask(supabase: any, userId: string | null, args: any) {
  if (!userId) return { success: false, error: "Not authenticated" };
  if (!args.title) return { success: false, error: "Task title is required" };

  try {
    // Get user's default board
    const { data: board } = await supabase
      .from('boards')
      .select('id')
      .eq('user_id', userId)
      .limit(1)
      .single();

    if (!board) return { success: false, error: "No board found" };

    const taskData = {
      title: args.title,
      description: args.description || null,
      priority: args.priority?.toUpperCase() || 'MEDIUM',
      category: args.category?.toUpperCase() || 'LIFE',
      status: 'BACKLOG',
      board_id: board.id,
      user_id: userId
    };

    const { data, error } = await supabase
      .from('tasks')
      .insert([taskData])
      .select()
      .single();

    if (error) throw error;

    return { 
      success: true, 
      task: data,
      message: `Created task "${data.title}" with ${data.priority} priority`
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function updateTask(supabase: any, args: any) {
  if (!args.task_id) return { success: false, error: "Task ID is required" };

  try {
    const updateData: any = {};
    if (args.title) updateData.title = args.title;
    if (args.description !== undefined) updateData.description = args.description;
    if (args.status) updateData.status = args.status.toUpperCase();
    if (args.priority) updateData.priority = args.priority.toUpperCase();
    if (args.category) updateData.category = args.category.toUpperCase();

    const { data, error } = await supabase
      .from('tasks')
      .update(updateData)
      .eq('id', args.task_id)
      .select()
      .single();

    if (error) throw error;

    return { 
      success: true, 
      task: data,
      message: `Updated task "${data.title}"`
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function rescheduleTask(supabase: any, args: any) {
  if (!args.task_id) return { success: false, error: "Task ID is required" };
  if (!args.new_date) return { success: false, error: "New date is required" };

  try {
    const updateData: any = {
      scheduled_date: args.new_date,
      due_date: args.new_date
    };
    
    if (args.new_start_time) {
      updateData.scheduled_start_time = args.new_start_time;
    }

    const { data, error } = await supabase
      .from('tasks')
      .update(updateData)
      .eq('id', args.task_id)
      .select()
      .single();

    if (error) throw error;

    return { 
      success: true, 
      task: data,
      message: `Rescheduled "${data.title}" to ${args.new_date}`
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function scheduleTask(supabase: any, args: any) {
  if (!args.task_id) return { success: false, error: "Task ID is required" };

  try {
    const today = new Date().toISOString().split('T')[0];
    const updateData: any = {
      scheduled_date: args.date || today,
      status: 'TODO'
    };
    
    if (args.start_time) {
      updateData.scheduled_start_time = args.start_time;
    }
    if (args.duration_minutes) {
      updateData.estimated_duration = args.duration_minutes;
    }

    const { data, error } = await supabase
      .from('tasks')
      .update(updateData)
      .eq('id', args.task_id)
      .select()
      .single();

    if (error) throw error;

    return { 
      success: true, 
      task: data,
      message: `Scheduled "${data.title}" for ${updateData.scheduled_date}`
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function unscheduleTask(supabase: any, args: any) {
  if (!args.task_id) return { success: false, error: "Task ID is required" };

  try {
    const { data, error } = await supabase
      .from('tasks')
      .update({
        scheduled_date: null,
        scheduled_start_time: null,
        scheduled_end_time: null,
        status: 'BACKLOG'
      })
      .eq('id', args.task_id)
      .select()
      .single();

    if (error) throw error;

    return { 
      success: true, 
      task: data,
      message: `Unscheduled "${data.title}" and moved to backlog`
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
