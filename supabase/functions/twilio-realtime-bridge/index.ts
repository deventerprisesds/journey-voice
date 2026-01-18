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

// Get time-based greeting with proper timezone
function getTimeBasedGreeting(timezone: string = 'America/New_York'): string {
  try {
    const now = new Date();
    const timeStr = now.toLocaleString('en-US', { 
      timeZone: timezone, 
      hour: 'numeric', 
      hour12: false 
    });
    const hour = parseInt(timeStr, 10);
    
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  } catch (error) {
    console.warn('[BRIDGE] Timezone error, using UTC:', error);
    const hour = new Date().getUTCHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }
}

// Get current date/time string in user's timezone
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

// Load user profile
async function loadUserProfile(supabase: any, userId: string): Promise<any> {
  try {
    const { data } = await supabase
      .from('profiles')
      .select('full_name, first_name, email, phone')
      .eq('user_id', userId)
      .maybeSingle();
    return data || {};
  } catch (error) {
    console.warn('[BRIDGE] Failed to load user profile:', error);
    return {};
  }
}

// REMOVED: loadTodayTasks - AI should use tools instead of pre-loaded context
// This forces tool-first architecture matching in-app assistant

// Load RAG context - improved to query knowledge base
async function loadRAGContext(supabase: any, userId: string, userInput?: string): Promise<string> {
  try {
    const { data, error } = await supabase.functions.invoke('rag-context-retrieval', {
      body: {
        action: 'get_context',
        userInput: userInput || 'general assistant knowledge and user preferences',
        userId,
        baseInstructions: ''
      }
    });

    if (error || !data?.context) {
      console.warn('[BRIDGE] RAG context retrieval failed:', error);
      return '';
    }

    let contextParts: string[] = [];

    // Include knowledge base context if available
    if (data.context.knowledgeContext) {
      contextParts.push(`KNOWLEDGE BASE:\n${data.context.knowledgeContext}`);
    }

    // Include conversation history
    const convHistory = data.context.conversationContext || [];
    if (convHistory.length > 0) {
      const relevantContext = convHistory
        .slice(0, 5)
        .map((c: any) => `${c.message_type}: ${c.content}`)
        .join('\n');
      contextParts.push(`RECENT CONVERSATION:\n${relevantContext}`);
    }

    return contextParts.length > 0 ? '\n\n' + contextParts.join('\n\n') : '';
  } catch (error) {
    console.warn('[BRIDGE] RAG context error:', error);
    return '';
  }
}

// Load user instructions - TOOL-FIRST architecture (no pre-loaded task context)
async function loadUserInstructions(userId: string | null, ragContext: string, userProfile: any, timezone: string): Promise<string> {
  const userName = userProfile?.first_name || userProfile?.full_name?.split(' ')[0] || 'sir';
  const currentTime = getCurrentTimeString(timezone);
  
  // CRITICAL: Tool-first instructions - AI must use tools for data, not pre-loaded context
  const defaultInstructions = `You are Iris, a knowledgeable and proactive executive assistant for ${userName}.

CURRENT TIME: ${currentTime}
TIMEZONE: ${timezone}

CRITICAL: ALWAYS USE TOOLS for data. Do NOT rely on any pre-loaded context.

AVAILABLE TOOLS - USE THEM:
- web_search: Search the internet for REAL-TIME info (weather, sports scores, news, stocks, current events)
- get_tasks: Query ALL tasks - by keyword, status, time period. Use for "how many tasks", "what did I work on", etc.
- get_today_tasks: Get today's COMPLETE schedule. Use for "what's on my calendar", "today's tasks"
- create_task: Create new tasks with title, description, priority, category
- update_task: Update existing tasks (status, title, description, priority)
- reschedule_task: Move a task to a different date or time
- schedule_task: Schedule an unscheduled task
- unschedule_task: Remove a task from the calendar
- send_slack_message: Send a Slack message
- send_email: Send an email
- create_calendar_event: Create an Outlook or Google Calendar event
- initiate_phone_call: Request a callback
- hang_up: End the phone call gracefully

WHEN USER ASKS ABOUT TASKS:
- "What's on my schedule?" → USE get_today_tasks tool
- "How many tasks do I have?" → USE get_tasks tool
- "What did I work on last week?" → USE get_tasks with time_filter
- Any schedule question → USE the appropriate tool

WHEN USER ASKS REAL-TIME DATA:
- Sports scores → USE web_search
- Weather → USE web_search  
- News → USE web_search
- Stock prices → USE web_search
- Any current events → USE web_search

YOU CAN HELP WITH ANYTHING:
- Task and schedule management (use tools)
- General knowledge questions
- Real-time information (use web_search)
- Calculations and reasoning
- Advice and recommendations
- Sending messages and creating calendar events

${ragContext}

PHONE CONVERSATION STYLE:
- Keep responses conversational and concise - this is a phone call
- Listen for interruptions and stop speaking when the user starts talking
- Execute actions immediately with brief confirmation
- Don't ask unnecessary confirmation questions
- When the user says goodbye, use the hang_up function`;

  if (!userId) {
    console.log('[BRIDGE] No userId, using default tool-first instructions');
    return defaultInstructions;
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    
    const { data: prefs } = await supabase
      .from('user_scheduling_prefs')
      .select('core_instructions, realtime_extensions, config, timezone')
      .eq('user_id', userId)
      .maybeSingle();

    if (prefs) {
      // Start with user's core instructions or use default
      let instructions = prefs.core_instructions || defaultInstructions;
      
      // Add critical tool-first context
      instructions += `\n\nCURRENT TIME: ${currentTime}
TIMEZONE: ${prefs.timezone || timezone}

CRITICAL: ALWAYS USE TOOLS for data. Do NOT rely on context alone.
- Use get_today_tasks for schedule questions
- Use get_tasks for task queries
- Use web_search for real-time information (sports, weather, news)

${ragContext}

PHONE CONVERSATION STYLE:
- Keep responses conversational and concise - this is a phone call
- Listen for interruptions and stop speaking when the user starts talking
- Execute actions immediately with brief confirmation
- When the user says goodbye, use the hang_up function`;

      if (prefs.realtime_extensions) {
        instructions += `\n\n${prefs.realtime_extensions}`;
      }
      if (prefs.config?.customAIInstructions) {
        instructions += `\n\nScheduling Philosophy:\n${prefs.config.customAIInstructions}`;
      }
      
      console.log('[BRIDGE] Loaded tool-first user instructions from database');
      return instructions;
    }
  } catch (error) {
    console.warn('[BRIDGE] Failed to load user instructions:', error);
  }

  return defaultInstructions;
}

// Tool definitions imported from centralized execute-tool function
// This ensures feature parity with chat interface
async function fetchToolDefinitions(): Promise<any[]> {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/execute-tool/definitions`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log(`[BRIDGE] Loaded ${data.count} tool definitions from execute-tool`);
      return data.tools || [];
    }
  } catch (error) {
    console.warn('[BRIDGE] Failed to fetch tool definitions, using fallback:', error);
  }
  
  // Fallback to inline definitions if fetch fails
  return getInlineToolDefinitions();
}

// Fallback tool definitions (kept in sync with execute-tool)
function getInlineToolDefinitions(): any[] {
  return [
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
    },
    {
      type: "function",
      name: "send_slack_message",
      description: "Send a Slack message to the user.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "The message to send" }
        },
        required: ["message"]
      }
    },
    {
      type: "function",
      name: "send_email",
      description: "Send an email to the user.",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "Email subject" },
          body: { type: "string", description: "Email body content" }
        },
        required: ["subject", "body"]
      }
    },
    {
      type: "function",
      name: "create_calendar_event",
      description: "Create a calendar event in Outlook or Google Calendar.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Event title" },
          start_time: { type: "string", description: "Start time in ISO format or HH:MM" },
          end_time: { type: "string", description: "End time in ISO format or HH:MM" },
          calendar: { type: "string", enum: ["outlook", "google"], description: "Which calendar to use" }
        },
        required: ["title", "start_time"]
      }
    },
    {
      type: "function",
      name: "initiate_phone_call",
      description: "Schedule a callback - useful for 'call me back in X minutes' requests.",
      parameters: {
        type: "object",
        properties: {
          delay_minutes: { type: "number", description: "Minutes to wait before calling back" },
          context: { type: "string", description: "What the callback should be about" }
        }
      }
    },
    {
      type: "function",
      name: "hang_up",
      description: "End the phone call gracefully. Use when the user says goodbye or indicates they're done.",
      parameters: {
        type: "object",
        properties: {
          farewell_message: { type: "string", description: "Optional farewell message to say before hanging up" }
        }
      }
    },
    {
      type: "function",
      name: "web_search",
      description: "Search the internet for REAL-TIME information. Use for: weather, sports scores (NFL, NBA, MLB, etc.), news, stock prices, current events, or anything requiring live data.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query (e.g., 'Ravens game score today', 'weather in Baltimore', 'latest tech news', 'AAPL stock price')" }
        },
        required: ["query"]
      }
    }
  ];
}

// Centralized tool execution via execute-tool edge function
async function executeTool(
  toolName: string,
  args: any,
  userId: string | null,
  context: { timezone?: string; userProfile?: any; twilioWs?: WebSocket; streamSid?: string | null }
): Promise<any> {
  // Handle hang_up specially - needs direct access to WebSocket
  if (toolName === 'hang_up') {
    console.log('[BRIDGE] Hang up requested:', args.farewell_message);
    
    // Give time for the farewell message to play, then close
    if (context.twilioWs) {
      setTimeout(() => {
        if (context.twilioWs && context.twilioWs.readyState === WebSocket.OPEN) {
          context.twilioWs.close();
        }
      }, 3000);
    }

    return {
      success: true,
      message: args.farewell_message || "Call ended gracefully"
    };
  }

  if (!userId) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/execute-tool`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        toolName,
        args,
        userId,
        context: {
          interface: 'phone',
          timezone: context.timezone || 'America/New_York',
          userProfile: context.userProfile || {}
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[BRIDGE] execute-tool error: ${response.status}`, errorText);
      return { success: false, error: `Tool execution failed: ${response.status}` };
    }

    return await response.json();
  } catch (error) {
    console.error(`[BRIDGE] Error executing tool ${toolName}:`, error);
    return { success: false, error: String(error) };
  }
}

serve(async (req) => {
  const url = new URL(req.url);
  console.log(`[BRIDGE v5] Request: ${req.method} ${url.pathname}`);

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
    let userTimezone: string = 'America/New_York';
    let sessionConfigured = false;
    let greetingSent = false;
    let userProfile: any = {};
    let threadId: string | null = null;
    
    // BARGE-IN: Track if AI is currently speaking
    let isAiSpeaking = false;
    let currentResponseId: string | null = null;
    
    // TRUNCATION: Track for proper interruption handling (not cancel)
    let currentResponseItemId: string | null = null;
    let audioSamplesPlayed: number = 0;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

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
            userTimezone = customParams.timezone || 'America/New_York';
            
            console.log(`[TWILIO] Stream started: ${streamSid}`);
            console.log(`[TWILIO] Custom params:`, JSON.stringify(customParams));
            console.log(`[TWILIO] Call direction: ${callDirection}, userId: ${userId}, timezone: ${userTimezone}`);
            
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

      // Load context in parallel - NO pre-loaded tasks (AI uses tools instead)
      let ragContext = "";
      
      if (userId) {
        const [profile, rag] = await Promise.all([
          loadUserProfile(supabase, userId),
          loadRAGContext(supabase, userId)
        ]);
        userProfile = profile;
        ragContext = rag;

        // Create or get thread for conversation persistence
        try {
          const { data: existingThread } = await supabase
            .from('ai_threads')
            .select('id, openai_thread_id')
            .eq('user_id', userId)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (existingThread) {
            threadId = existingThread.id;
            console.log('[BRIDGE] Using existing thread:', threadId);
          } else {
            const { data: newThread } = await supabase
              .from('ai_threads')
              .insert({ 
                user_id: userId, 
                openai_thread_id: `phone_${Date.now()}` 
              })
              .select('id')
              .single();
            threadId = newThread?.id || null;
            console.log('[BRIDGE] Created new thread:', threadId);
          }
        } catch (error) {
          console.warn('[BRIDGE] Thread management error:', error);
        }
      }

      // Load user-specific instructions (no pre-loaded tasks - uses tools instead)
      const instructions = await loadUserInstructions(userId, ragContext, userProfile, userTimezone);

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
                    threshold: 0.2,  // Lower threshold for better phone audio sensitivity
                    prefix_padding_ms: 300,
                    silence_duration_ms: 800,  // Faster response on phone
                  },
                  tools: getInlineToolDefinitions(),
                  tool_choice: "auto"
                },
              }));
              break;

            case "session.updated":
              console.log("[OPENAI] Session configured");
              sessionConfigured = true;
              
              // Send greeting based on call direction
              if (!greetingSent) {
                if (callDirection === 'inbound') {
                  sendInboundGreeting();
                } else {
                  sendOutboundGreeting();
                }
              }
              break;

            case "response.created":
              // Track that AI is generating a response
              currentResponseId = msg.response?.id || null;
              isAiSpeaking = true;
              console.log("[OPENAI] Response started:", currentResponseId);
              break;

            case "response.done":
              // AI finished speaking
              isAiSpeaking = false;
              currentResponseId = null;
              currentResponseItemId = null;
              audioSamplesPlayed = 0;
              console.log("[OPENAI] Response completed");
              break;

            case "response.output_item.added":
              // Track item IDs for truncation
              if (msg.item?.type === "message") {
                currentResponseItemId = msg.item.id;
                audioSamplesPlayed = 0;
                console.log("[OPENAI] Tracking response item:", currentResponseItemId);
              }
              break;

            case "response.audio.delta":
              if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
                const pcm24k = base64ToInt16(msg.delta);
                const pcm8k = downsample24to8(pcm24k);
                const mulaw = encodeMulaw(pcm8k);
                const mulawBase64 = btoa(String.fromCharCode(...mulaw));

                // Track samples for truncation calculation
                audioSamplesPlayed += pcm24k.length;

                twilioWs.send(JSON.stringify({
                  event: "media",
                  streamSid: streamSid,
                  media: { payload: mulawBase64 },
                }));
              }
              break;

            case "input_audio_buffer.speech_started":
              console.log("[OPENAI] User started speaking");
              
              // BARGE-IN: Use truncation (not cancel) so AI remembers what it said
              if (isAiSpeaking && openaiWs?.readyState === WebSocket.OPEN) {
                if (currentResponseItemId) {
                  // Truncation preserves context - AI knows what it said up to this point
                  const audioEndMs = Math.floor(audioSamplesPlayed / 24); // 24kHz to milliseconds
                  console.log(`[OPENAI] BARGE-IN: Truncating at ${audioSamplesPlayed} samples (${audioEndMs}ms)`);
                  
                  openaiWs.send(JSON.stringify({
                    type: "conversation.item.truncate",
                    item_id: currentResponseItemId,
                    content_index: 0,
                    audio_end_ms: audioEndMs
                  }));
                } else {
                  // Fallback to cancel if no item ID tracked
                  console.log("[OPENAI] BARGE-IN: Cancelling (no item ID for truncation)");
                  openaiWs.send(JSON.stringify({ type: "response.cancel" }));
                }
                
                // Clear Twilio's audio buffer to stop playback immediately
                if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
                  twilioWs.send(JSON.stringify({
                    event: "clear",
                    streamSid: streamSid
                  }));
                }
                
                isAiSpeaking = false;
                currentResponseItemId = null;
                audioSamplesPlayed = 0;
              }
              break;

            case "input_audio_buffer.speech_stopped":
              console.log("[OPENAI] User stopped speaking");
              break;

            case "conversation.item.input_audio_transcription.completed":
              console.log(`[OPENAI] User said: "${msg.transcript}"`);
              // Save user message to conversation history
              saveConversationMessage('user', msg.transcript);
              break;

            case "response.audio_transcript.done":
              console.log(`[OPENAI] AI said: "${msg.transcript}"`);
              // Save assistant message to conversation history
              saveConversationMessage('assistant', msg.transcript);
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

    async function saveConversationMessage(role: string, content: string) {
      if (!userId || !threadId || !content) return;
      
      try {
        await supabase.from('conversation_messages').insert({
          user_id: userId,
          thread_id: threadId,
          role: role,
          content: content,
          voice_session_id: streamSid,
          audio_transcript: content
        });
        console.log(`[BRIDGE] Saved ${role} message to conversation history`);
      } catch (error) {
        console.warn('[BRIDGE] Failed to save conversation message:', error);
      }
    }

    // PHASE 4: Open-ended greeting - NOT task-focused
    function sendInboundGreeting() {
      if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN || greetingSent) return;
      
      greetingSent = true;
      const greeting = getTimeBasedGreeting(userTimezone);
      const userName = userProfile?.first_name || 'sir';
      const currentTime = getCurrentTimeString(userTimezone);
      
      console.log(`[BRIDGE] Sending inbound greeting to ${userName} (timezone: ${userTimezone})`);
      
      // OPEN-ENDED greeting - don't assume they want schedule info
      openaiWs.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{
            type: "input_text",
            text: `[System: This is an inbound phone call from ${userName}. Current time is ${currentTime}. Greet them with "${greeting}, ${userName}. What can I help you with?" Keep it brief and WAIT for them to tell you what they need. Do NOT assume they want schedule information - they might ask about anything. You can help with general questions, tasks, or whatever they need.]`
          }]
        }
      }));

      openaiWs.send(JSON.stringify({ type: "response.create" }));
    }

    function sendOutboundGreeting() {
      if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN || greetingSent) return;
      
      greetingSent = true;
      const userName = userProfile?.first_name || 'sir';
      const contextInfo = callContext || 'your daily briefing';
      
      console.log(`[BRIDGE] Waiting for user response on outbound call`);
      
      // For outbound calls, wait for user to say hello first
      openaiWs.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{
            type: "input_text",
            text: `[System: This is an outbound call YOU initiated to ${userName} for ${contextInfo}. Wait silently for them to answer with "hello" or similar. When they do, briefly introduce yourself as Iris and explain why you're calling in one sentence. You have their schedule loaded.]`
          }]
        }
      }));
      
      // Don't trigger response yet - wait for user audio
    }

    async function handleFunctionCall(msg: any) {
      if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;

      try {
        const args = JSON.parse(msg.arguments);
        const functionName = msg.name;
        
        console.log(`[BRIDGE] Executing function via execute-tool: ${functionName}`, args);

        // Use centralized tool execution
        const result = await executeTool(functionName, args, userId, {
          timezone: userTimezone,
          userProfile,
          twilioWs,
          streamSid
        });

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
  return new Response("Twilio-OpenAI Realtime Bridge v5 - Full Capability Parity", { status: 200 });
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

async function getTodayTasksFunction(supabase: any, userId: string | null, timezone: string) {
  if (!userId) return { success: false, error: "Not authenticated", tasks: [] };

  try {
    const now = new Date();
    const today = now.toLocaleDateString('en-CA', { timeZone: timezone });
    
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

// ============ Notification Functions ============

async function sendSlackMessage(supabase: any, userId: string | null, args: any, userProfile: any) {
  if (!userId) return { success: false, error: "Not authenticated" };
  if (!args.message) return { success: false, error: "Message is required" };

  try {
    const { data, error } = await supabase.functions.invoke('send-unified-notification', {
      body: {
        userId,
        title: 'Message from Iris',
        body: args.message,
        channels: ['SLACK'],
        userProfile: userProfile,
        data: { source: 'phone_call' }
      }
    });

    if (error) throw error;

    return {
      success: true,
      message: `Sent Slack message: "${args.message.substring(0, 50)}..."`
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function sendEmail(supabase: any, userId: string | null, args: any, userProfile: any) {
  if (!userId) return { success: false, error: "Not authenticated" };
  if (!args.subject || !args.body) return { success: false, error: "Subject and body are required" };

  try {
    const { data, error } = await supabase.functions.invoke('send-unified-notification', {
      body: {
        userId,
        title: args.subject,
        body: args.body,
        channels: ['EMAIL'],
        userProfile: userProfile,
        data: { source: 'phone_call' }
      }
    });

    if (error) throw error;

    return {
      success: true,
      message: `Sent email with subject: "${args.subject}"`
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function createCalendarEvent(supabase: any, userId: string | null, args: any, userProfile: any) {
  if (!userId) return { success: false, error: "Not authenticated" };
  if (!args.title || !args.start_time) return { success: false, error: "Title and start time are required" };

  try {
    // Parse times - handle both ISO format and HH:MM format
    let startTime = args.start_time;
    let endTime = args.end_time;
    
    if (!startTime.includes('T')) {
      // HH:MM format - add today's date
      const today = new Date().toISOString().split('T')[0];
      startTime = `${today}T${startTime}:00`;
      endTime = endTime ? `${today}T${endTime}:00` : new Date(new Date(startTime).getTime() + 60 * 60 * 1000).toISOString();
    }

    const calendarType = args.calendar?.toUpperCase() || 'OUTLOOK';
    const channel = calendarType === 'GOOGLE' ? 'GOOGLE_EVENT' : 'OUTLOOK_EVENT';

    const eventData = {
      title: args.title,
      startTime,
      endTime: endTime || new Date(new Date(startTime).getTime() + 60 * 60 * 1000).toISOString(),
      reminder: '15'
    };

    const { data, error } = await supabase.functions.invoke('send-unified-notification', {
      body: {
        userId,
        title: args.title,
        body: `Calendar event created via phone call`,
        channels: [channel],
        userProfile: userProfile,
        data: { source: 'phone_call' },
        ...(channel === 'OUTLOOK_EVENT' ? { outlookEvent: eventData } : { googleEvent: eventData })
      }
    });

    if (error) throw error;

    return {
      success: true,
      message: `Created ${args.calendar || 'Outlook'} event: "${args.title}" at ${args.start_time}`
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// PHASE 5: initiate_phone_call for full parity
async function initiatePhoneCall(supabase: any, userId: string | null, args: any) {
  if (!userId) return { success: false, error: "Not authenticated" };

  try {
    const delayMinutes = args.delay_minutes || 0;
    const context = args.context || 'callback request';
    
    if (delayMinutes > 0) {
      // Schedule the callback - this would integrate with your scheduling system
      return {
        success: true,
        message: `I'll call you back in ${delayMinutes} minutes regarding ${context}.`
      };
    } else {
      // Immediate callback doesn't make sense during an active call
      return {
        success: true,
        message: `You're already on the phone with me! What can I help you with?`
      };
    }
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function handleHangUp(args: any, twilioWs: WebSocket, streamSid: string | null) {
  try {
    console.log('[BRIDGE] Hang up requested:', args.farewell_message);
    
    // Give time for the farewell message to play
    setTimeout(() => {
      if (twilioWs.readyState === WebSocket.OPEN) {
        twilioWs.close();
      }
    }, 3000);

    return {
      success: true,
      message: args.farewell_message || "Call ended gracefully"
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// ============ Web Search Function ============

async function webSearch(query: string): Promise<any> {
  const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');
  
  if (!PERPLEXITY_API_KEY) {
    console.warn('[BRIDGE] PERPLEXITY_API_KEY not configured');
    return { 
      success: false, 
      error: "Web search not configured",
      answer: "I don't have real-time search enabled, but I can help from my general knowledge."
    };
  }
  
  try {
    console.log(`[BRIDGE] Web searching: "${query}"`);
    
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          { 
            role: 'system', 
            content: 'Give a concise spoken answer (2-3 sentences max). Focus on the most important facts.' 
          },
          { role: 'user', content: query }
        ],
        search_recency_filter: 'day' // Get today's data for live scores/weather
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[BRIDGE] Perplexity API error: ${response.status}`, errorText);
      return { 
        success: false, 
        error: `Search API error: ${response.status}`,
        answer: "I couldn't search for that information right now. Please try again."
      };
    }
    
    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content || "No results found.";
    const sources = data.citations || [];
    
    console.log(`[BRIDGE] Search result: ${answer.substring(0, 100)}...`);
    
    return {
      success: true,
      answer,
      sources,
      query
    };
  } catch (error) {
    console.error('[BRIDGE] Web search error:', error);
    return { 
      success: false, 
      error: String(error),
      answer: "I encountered an error while searching. Let me help with what I know."
    };
  }
}
