import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");

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

// Default Iris persona (fallback if database is empty)
const DEFAULT_IRIS_PERSONA = `You are Iris, a knowledgeable and proactive executive assistant.

HONESTY - ABSOLUTE RULE (NEVER VIOLATE):
- NEVER fabricate, invent, or assume factual data (scores, weather, news, prices, dates, statistics)
- If a web_search fails or returns no results, say "I couldn't find that information"
- If uncertain about real-world facts, explicitly state uncertainty
- ALWAYS report exactly what web_search returns - do not embellish or add information
- When asked about current events and search is unavailable, respond: "I need to search for that but couldn't access real-time data right now"
- If no sources returned from search, say "I found this but couldn't verify the source"

PERSONALITY:
- Warm, efficient, and naturally conversational
- Action-first: Execute tasks immediately with brief confirmations
- Proactive: Offer helpful follow-up suggestions after completing tasks
- Time-aware: Use appropriate greetings based on time of day

TOOL USAGE - CRITICAL:
- ALWAYS use tools to get current data (get_tasks, get_today_tasks, web_search)
- Never rely on pre-loaded context for dynamic information
- For weather, sports, news, stocks, current events - use web_search immediately

Available functions:
- get_tasks: Search/retrieve tasks with time/keyword filtering
- get_today_tasks: Get today's scheduled tasks
- create_task: Create new tasks (only when explicitly requested)
- update_task: Modify existing tasks
- reschedule_task: Move tasks to different date/time
- schedule_task: Auto-schedule unscheduled tasks
- unschedule_task: Remove from calendar
- web_search: Real-time internet search for weather, news, sports, facts
- send_email: Send emails
- send_slack_message: Send Slack messages
- create_outlook_event: Create Outlook calendar events
- create_google_event: Create Google calendar events
- hang_up: End the phone call gracefully

IMPORTANT:
- Only create tasks when explicitly requested
- Use web_search for any real-time information
- Keep responses concise and conversational
- When user says goodbye, use the hang_up function`;

// Load user instructions from database (single source of truth)
async function loadUserInstructions(userId: string | null, ragContext: string, userProfile: any, timezone: string): Promise<string> {
  const userName = userProfile?.first_name || userProfile?.full_name?.split(' ')[0] || 'sir';
  const currentTime = getCurrentTimeString(timezone);
  
  if (!userId) {
    console.log('[BRIDGE] No userId, using default Iris persona');
    return `${DEFAULT_IRIS_PERSONA}

CURRENT TIME: ${currentTime}
TIMEZONE: ${timezone}
USER: ${userName}
${ragContext}

PHONE CONVERSATION STYLE:
- Keep responses conversational and concise - this is a phone call
- Listen for interruptions and stop speaking when the user starts talking
- Execute actions immediately with brief confirmation
- When the user says goodbye, use the hang_up function`;
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    
    const { data: prefs } = await supabase
      .from('user_scheduling_prefs')
      .select('core_instructions, realtime_extensions, config, timezone, tts_provider, elevenlabs_voice_id')
      .eq('user_id', userId)
      .maybeSingle();

    // Use database instructions or fallback to default Iris persona
    let baseInstructions = prefs?.core_instructions || DEFAULT_IRIS_PERSONA;
    const userTimezone = prefs?.timezone || timezone;
    
    // Build complete instructions
    let instructions = `${baseInstructions}

CURRENT TIME: ${getCurrentTimeString(userTimezone)}
TIMEZONE: ${userTimezone}
USER: ${userName}

${ragContext}

PHONE CONVERSATION STYLE:
- Keep responses conversational and concise - this is a phone call
- Listen for interruptions and stop speaking when the user starts talking
- Execute actions immediately with brief confirmation
- When the user says goodbye, use the hang_up function

CONVERSATIONAL RESPONSIVENESS (CRITICAL):
You are having a real-time voice conversation. Silence feels awkward - humans expect verbal feedback.

1. BEFORE ANY TOOL CALL: Speak a brief, natural acknowledgment that fits the context:
   - Task queries: "Let me check..." / "One moment..."
   - Web searches: "Let me look that up..." / "Searching..."
   - Creating/updating: "Got it, on it..." / "Creating that now..."

2. TIME-AWARE FEEDBACK - If processing feels slow, naturally inject updates:
   - After ~2 seconds: "Still looking..." / "Let me see..."
   - After ~3 more seconds: "Almost there..." / "Just a moment..."
   - After ~3 more seconds: "I think I have it..."

3. NATURAL VARIATION:
   - Never repeat the same phrase twice in a row
   - Match user energy - casual user = casual responses
   - Keep fillers SHORT (2-4 words)

4. INSTANT ANSWERS = NO FILLER:
   - If you can answer immediately, skip the acknowledgment
   - Only use fillers when actual tool calls are needed

NEVER: Stay silent while processing, sound robotic, or over-explain what you're doing`;

    // Add voice-specific extensions if configured
    if (prefs?.realtime_extensions) {
      instructions += `\n\n${prefs.realtime_extensions}`;
    }
    
    // Add scheduling philosophy if configured
    if (prefs?.config?.customAIInstructions) {
      instructions += `\n\nScheduling Philosophy:\n${prefs.config.customAIInstructions}`;
    }
    
    console.log('[BRIDGE] Loaded user instructions from database');
    return instructions;
  } catch (error) {
    console.warn('[BRIDGE] Failed to load user instructions:', error);
  }

  // Fallback to default
  return `${DEFAULT_IRIS_PERSONA}

CURRENT TIME: ${currentTime}
TIMEZONE: ${timezone}
USER: ${userName}
${ragContext}

PHONE CONVERSATION STYLE:
- Keep responses conversational and concise - this is a phone call
- Listen for interruptions and stop speaking when the user starts talking
- Execute actions immediately with brief confirmation
- When the user says goodbye, use the hang_up function

CONVERSATIONAL RESPONSIVENESS (CRITICAL):
You are having a real-time voice conversation. Silence feels awkward - humans expect verbal feedback.

1. BEFORE ANY TOOL CALL: Speak a brief, natural acknowledgment that fits the context:
   - Task queries: "Let me check..." / "One moment..."
   - Web searches: "Let me look that up..." / "Searching..."
   - Creating/updating: "Got it, on it..." / "Creating that now..."

2. TIME-AWARE FEEDBACK - If processing feels slow, naturally inject updates:
   - After ~2 seconds: "Still looking..." / "Let me see..."
   - After ~3 more seconds: "Almost there..." / "Just a moment..."
   - After ~3 more seconds: "I think I have it..."

3. NATURAL VARIATION:
   - Never repeat the same phrase twice in a row
   - Match user energy - casual user = casual responses
   - Keep fillers SHORT (2-4 words)

4. INSTANT ANSWERS = NO FILLER:
   - If you can answer immediately, skip the acknowledgment
   - Only use fillers when actual tool calls are needed

NEVER: Stay silent while processing, sound robotic, or over-explain what you're doing`;
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
      description: "Search the internet for REAL-TIME information using Tavily. CRITICAL: The 'query' parameter MUST be a VERBATIM transcription of what the user said - do NOT rephrase or convert temporal phrases like 'this weekend' or 'today' into specific dates. Use the other parameters to configure the search.",
      parameters: {
        type: "object",
        properties: {
          query: { 
            type: "string", 
            description: "The user's EXACT spoken words - pass verbatim without modification" 
          },
          topic: {
            type: "string",
            enum: ["general", "news", "finance"],
            description: "Search category. Use 'news' for sports scores, current events, breaking news. Use 'finance' for stock prices. Use 'general' for everything else."
          },
          search_depth: {
            type: "string",
            enum: ["basic", "advanced"],
            description: "Use 'advanced' for complex queries (sports scores, specific facts). Use 'basic' for simple lookups."
          },
          time_range: {
            type: "string",
            enum: ["day", "week", "month", "year"],
            description: "Use 'day' for today/tonight, 'week' for this week/weekend. Only set if query implies time constraint."
          },
          include_domains: {
            type: "array",
            items: { type: "string" },
            description: "Optional: Domains to prioritize. Leave empty to search all sources."
          }
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
    
    // POST-VALIDATION: Track last tool output for response validation
    let lastToolOutput: { toolName: string; extractedFacts?: any } | null = null;
    
    // VERBATIM WEB SEARCH: Track last user transcript for web_search override
    let lastUserTranscript: string | null = null;
    
    // === TTS PROVIDER SETTINGS ===
    let ttsProvider: 'openai' | 'elevenlabs' = 'openai';
    let elevenlabsVoiceId: string = 'EXAVITQu4vr4xnSDxMaL';
    
    // === ELEVENLABS TEXT BUFFER ===
    // When using ElevenLabs, we buffer text from OpenAI and send to ElevenLabs TTS
    let pendingTextBuffer: string = '';
    let isProcessingElevenLabsTTS = false;
    
    // === SENTENCE STREAMING FOR ELEVENLABS ===
    // Buffer text deltas and send complete sentences for faster TTS
    let sentenceBuffer: string = '';
    const SENTENCE_ENDERS = /[.!?]\s*$/;
    
    // === SPEECH EVENT DEBOUNCE ===
    // Prevent rapid-fire speech events from causing stuttering
    let lastSpeechStartTime = 0;
    const SPEECH_DEBOUNCE_MS = 300;
    
    // === AUDIO PIPELINE TELEMETRY ===
    let twilioMediaFramesIn = 0;
    let openaiAppendCount = 0;
    let openaiAudioDeltaCount = 0;
    let twilioMediaFramesOut = 0;
    let firstInboundLogged = false;
    let firstAppendLogged = false;
    let firstDeltaLogged = false;
    let firstOutboundLogged = false;
    // Track all OpenAI message types for debugging
    const openaiEventCounts: Record<string, number> = {};
    
    // KEEP-ALIVE: Prevent idle timeout
    let keepAliveInterval: number | null = null;
    
    // ElevenLabs TTS function - sends text to ElevenLabs and streams μ-law audio to Twilio
    async function sendElevenLabsTTS(text: string) {
      if (!streamSid || twilioWs.readyState !== WebSocket.OPEN || !ELEVENLABS_API_KEY) {
        console.warn('[ELEVENLABS] Cannot send TTS - missing streamSid, closed WS, or no API key');
        return;
      }
      
      if (isProcessingElevenLabsTTS) {
        console.log('[ELEVENLABS] Already processing TTS, queueing text');
        pendingTextBuffer += ' ' + text;
        return;
      }
      
      isProcessingElevenLabsTTS = true;
      const fullText = text;
      pendingTextBuffer = '';
      
      console.log(`[ELEVENLABS] Generating TTS for: "${fullText.substring(0, 50)}..." with voice: ${elevenlabsVoiceId}`);
      
      try {
        const startTime = Date.now();
        
        const response = await fetch(`${SUPABASE_URL}/functions/v1/elevenlabs-tts`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            text: fullText,
            voiceId: elevenlabsVoiceId,
            format: 'ulaw'
          })
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[ELEVENLABS] TTS API error: ${response.status} - ${errorText}`);
          isProcessingElevenLabsTTS = false;
          return;
        }
        
        const data = await response.json();
        const latency = Date.now() - startTime;
        
        console.log(`[ELEVENLABS] ✅ Generated ${data.bytes} bytes of μ-law audio in ${latency}ms`);
        
        // Send the μ-law audio directly to Twilio (it's already in the right format!)
        if (data.audio && streamSid && twilioWs.readyState === WebSocket.OPEN) {
          // ElevenLabs returns the full audio at once - we need to chunk it for Twilio
          // Twilio expects ~20ms chunks (160 bytes at 8kHz μ-law)
          const audioBytes = Uint8Array.from(atob(data.audio), c => c.charCodeAt(0));
          const chunkSize = 160; // 20ms at 8kHz
          
          for (let i = 0; i < audioBytes.length; i += chunkSize) {
            const chunk = audioBytes.slice(i, i + chunkSize);
            const chunkBase64 = btoa(String.fromCharCode(...chunk));
            
            twilioMediaFramesOut++;
            twilioWs.send(JSON.stringify({
              event: "media",
              streamSid: streamSid,
              media: { payload: chunkBase64 }
            }));
          }
          
          if (!firstOutboundLogged) {
            console.log(`[ELEVENLABS-OUT] ⬅️ First ElevenLabs audio sent to Twilio`);
            firstOutboundLogged = true;
          }
        }
        
      } catch (error) {
        console.error('[ELEVENLABS] TTS error:', error);
      } finally {
        isProcessingElevenLabsTTS = false;
        
        // Process any queued text
        if (pendingTextBuffer.trim()) {
          const queuedText = pendingTextBuffer;
          pendingTextBuffer = '';
          setTimeout(() => sendElevenLabsTTS(queuedText), 50);
        }
      }
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    twilioWs.onopen = () => {
      console.log("[TWILIO-WS] ✅ WebSocket OPEN - ready to receive stream");
      
      // Keep-alive ping every 30 seconds to prevent idle timeout
      keepAliveInterval = setInterval(() => {
        if (twilioWs.readyState === WebSocket.OPEN) {
          console.log("[BRIDGE] Keep-alive ping");
          twilioWs.send(JSON.stringify({ event: "ping" }));
        }
      }, 30000);
    };

    twilioWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        switch (data.event) {
          case "connected":
            console.log("[TWILIO-STREAM] ✅ Media stream connected - Twilio is ready");
            break;

          case "start":
            streamSid = data.start.streamSid;
            const customParams = data.start.customParameters || {};
            userId = customParams.userId || null;
            userPhone = customParams.phone || null;
            callContext = customParams.context || null;
            callDirection = customParams.direction || 'inbound';
            userTimezone = customParams.timezone || 'America/New_York';
            
            console.log(`[TWILIO-STREAM] ✅ Stream START received - streamSid: ${streamSid}`);
            console.log(`[TWILIO-STREAM] Custom params:`, JSON.stringify(customParams));
            console.log(`[TWILIO-STREAM] Call direction: ${callDirection}, userId: ${userId}, timezone: ${userTimezone}`);
            
            connectToOpenAI();
            break;

          case "media":
            twilioMediaFramesIn++;
            if (!firstInboundLogged) {
              console.log(`[AUDIO-IN] 📥 First Twilio inbound frame received (streamSid: ${streamSid})`);
              firstInboundLogged = true;
            }
            
            if (openaiWs?.readyState === WebSocket.OPEN) {
              // Decode μ-law → PCM16 → Upsample to 24kHz → Base64
              const mulawBytes = Uint8Array.from(atob(data.media.payload), (c) => c.charCodeAt(0));
              const pcm8k = decodeMulaw(mulawBytes);
              const pcm24k = upsample8to24(pcm8k);
              const audioBase64 = int16ToBase64(pcm24k);

              openaiAppendCount++;
              if (!firstAppendLogged) {
                console.log(`[AUDIO-APPEND] ➡️ First audio sent to OpenAI (${audioBase64.length} chars)`);
                firstAppendLogged = true;
              }

              openaiWs.send(JSON.stringify({
                type: "input_audio_buffer.append",
                audio: audioBase64,
              }));
            } else {
              console.warn(`[AUDIO-APPEND] ⚠️ Cannot send - OpenAI WS not open (state: ${openaiWs?.readyState})`);
            }
            break;

          case "stop":
            console.log("[TWILIO-STREAM] Stream stopped");
            openaiWs?.close();
            break;
        }
      } catch (err) {
        console.error("[TWILIO] Error processing message:", err);
      }
    };

    twilioWs.onclose = () => {
      console.log("[TWILIO-WS] WebSocket closed");
      console.log(`[AUDIO-SUMMARY] === Call Pipeline Stats ===`);
      console.log(`  Twilio frames IN:  ${twilioMediaFramesIn}`);
      console.log(`  OpenAI appends:    ${openaiAppendCount}`);
      console.log(`  OpenAI deltas:     ${openaiAudioDeltaCount}`);
      console.log(`  Twilio frames OUT: ${twilioMediaFramesOut}`);
      console.log(`[OPENAI-SUMMARY] Event types received:`, JSON.stringify(openaiEventCounts));
      
      // Clear keep-alive interval
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
      }
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
        const [profile, rag, ttsPrefs] = await Promise.all([
          loadUserProfile(supabase, userId),
          loadRAGContext(supabase, userId),
          // Load TTS provider settings
          supabase
            .from('user_scheduling_prefs')
            .select('tts_provider, elevenlabs_voice_id')
            .eq('user_id', userId)
            .maybeSingle()
        ]);
        userProfile = profile;
        ragContext = rag;
        
        // Set TTS provider from user preferences
        if (ttsPrefs.data) {
          ttsProvider = (ttsPrefs.data.tts_provider as 'openai' | 'elevenlabs') || 'openai';
          elevenlabsVoiceId = ttsPrefs.data.elevenlabs_voice_id || 'EXAVITQu4vr4xnSDxMaL';
          console.log(`[BRIDGE] TTS Provider: ${ttsProvider}, Voice ID: ${elevenlabsVoiceId}`);
        }

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
          
          // Track all OpenAI message types for debugging
          openaiEventCounts[msg.type] = (openaiEventCounts[msg.type] || 0) + 1;
          
          // Log all message types except high-frequency audio deltas
          if (!['response.audio.delta', 'input_audio_buffer.speech_started'].includes(msg.type)) {
            console.log(`[OPENAI-MSG] ${msg.type}`);
          }

          switch (msg.type) {
            case "session.created":
              console.log("[OPENAI-SESSION] ✅ Session CREATED - configuring...");
              
              // Configure modalities based on TTS provider
              // If using ElevenLabs, we only need text output (no audio)
              const modalities = ttsProvider === 'elevenlabs' 
                ? ["text"] 
                : ["text", "audio"];
              
              console.log(`[OPENAI-SESSION] Sending config: modalities=${JSON.stringify(modalities)}, ttsProvider=${ttsProvider}`);
              
              openaiWs!.send(JSON.stringify({
                type: "session.update",
                session: {
                  modalities: modalities,
                  instructions: instructions,
                  voice: "alloy",
                  input_audio_format: "pcm16",
                  output_audio_format: "pcm16",
                  input_audio_transcription: { model: "whisper-1" },
                  turn_detection: {
                    type: "server_vad",
                    threshold: 0.3,  // Balance between sensitivity and false triggers
                    prefix_padding_ms: 400,  // More buffer to capture speech start
                    silence_duration_ms: 600,  // Faster response after confirmed silence
                  },
                  tools: getInlineToolDefinitions(),
                  tool_choice: "auto"
                },
              }));
              break;

            case "session.updated":
              console.log("[OPENAI-SESSION] ✅ Session CONFIGURED");
              console.log(`[OPENAI-SESSION] TTS Provider: ${ttsProvider}, ElevenLabs Voice: ${elevenlabsVoiceId}`);
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
              // Skip OpenAI audio when using ElevenLabs TTS
              if (ttsProvider === 'elevenlabs') {
                break;
              }
              
              openaiAudioDeltaCount++;
              if (!firstDeltaLogged) {
                console.log(`[AUDIO-DELTA] 🔊 First audio delta from OpenAI (delta length: ${msg.delta?.length || 0} chars)`);
                console.log(`[AUDIO-DELTA] 🔊 streamSid: ${streamSid}, twilioWs.readyState: ${twilioWs.readyState}`);
                firstDeltaLogged = true;
              }
              
              if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
                const pcm24k = base64ToInt16(msg.delta);
                const pcm8k = downsample24to8(pcm24k);
                const mulaw = encodeMulaw(pcm8k);
                const mulawBase64 = btoa(String.fromCharCode(...mulaw));

                // Track samples for truncation calculation
                audioSamplesPlayed += pcm24k.length;

                twilioMediaFramesOut++;
                if (!firstOutboundLogged) {
                  console.log(`[AUDIO-OUT] ⬅️ First audio frame sent to Twilio (${mulawBase64.length} chars)`);
                  firstOutboundLogged = true;
                }

                twilioWs.send(JSON.stringify({
                  event: "media",
                  streamSid: streamSid,
                  media: { payload: mulawBase64 },
                }));
              } else {
                console.warn(`[AUDIO-OUT] ⚠️ Cannot send - streamSid: ${streamSid}, twilio state: ${twilioWs.readyState}`);
              }
              break;

            // ElevenLabs sentence streaming: Buffer text deltas and send complete sentences
            case "response.text.delta":
              if (ttsProvider === 'elevenlabs' && msg.delta) {
                sentenceBuffer += msg.delta;
                
                // Check if we have a complete sentence
                if (SENTENCE_ENDERS.test(sentenceBuffer)) {
                  const sentence = sentenceBuffer.trim();
                  sentenceBuffer = '';
                  
                  // Send sentence to ElevenLabs immediately (skip tiny fragments)
                  if (sentence.length > 5) {
                    console.log(`[ELEVENLABS] 📝 Streaming sentence: "${sentence.substring(0, 40)}..."`);
                    sendElevenLabsTTS(sentence);
                  }
                }
              }
              break;
              
            // ElevenLabs text-to-speech: Flush remaining buffer on completion
            case "response.text.done":
              if (ttsProvider === 'elevenlabs') {
                // Flush any remaining buffered text
                if (sentenceBuffer.trim()) {
                  console.log(`[ELEVENLABS] 📝 Flushing remaining: "${sentenceBuffer.substring(0, 40)}..."`);
                  sendElevenLabsTTS(sentenceBuffer.trim());
                  sentenceBuffer = '';
                } else if (msg.text && !sentenceBuffer) {
                  // Fallback if no buffer - send complete text (shouldn't happen often)
                  console.log(`[ELEVENLABS] Text response received: "${msg.text.substring(0, 50)}..."`);
                  sendElevenLabsTTS(msg.text);
                }
              }
              break;

            case "input_audio_buffer.speech_started":
              // Debounce rapid speech events to prevent stuttering
              const now = Date.now();
              if (now - lastSpeechStartTime < SPEECH_DEBOUNCE_MS) {
                console.log("[OPENAI] Debounced rapid speech event");
                break;
              }
              lastSpeechStartTime = now;
              
              console.log("[OPENAI] User started speaking");
              
              // ElevenLabs mode: No OpenAI audio to truncate - just clear Twilio buffer
              if (ttsProvider === 'elevenlabs') {
                console.log("[OPENAI] BARGE-IN: ElevenLabs mode - clearing Twilio buffer only");
                if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
                  twilioWs.send(JSON.stringify({
                    event: "clear",
                    streamSid: streamSid
                  }));
                }
                // Clear sentence buffer to stop pending TTS
                sentenceBuffer = '';
                isAiSpeaking = false;
                break;
              }
              
              // OpenAI audio mode: Use truncation (not cancel) so AI remembers what it said
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
              console.log(`[TRANSCRIPT-USER] 📢 "${msg.transcript}"`);
              // Track for verbatim web_search override
              lastUserTranscript = msg.transcript;
              // Save user message to conversation history
              saveConversationMessage('user', msg.transcript);
              break;

            case "response.audio_transcript.done":
              console.log(`[TRANSCRIPT-AI] 🤖 "${msg.transcript}"`);
              // Save assistant message to conversation history
              saveConversationMessage('assistant', msg.transcript);
              
              // POST-VALIDATION: Check AI response against last tool output
              if (lastToolOutput?.extractedFacts) {
                const validation = validateVoiceResponse(msg.transcript, lastToolOutput);
                if (!validation.valid && validation.correction) {
                  console.log('[BRIDGE] ⚠️ Discrepancy detected, injecting correction');
                  
                  // Inject correction as new system message
                  openaiWs!.send(JSON.stringify({
                    type: "conversation.item.create",
                    item: {
                      type: "message",
                      role: "user", 
                      content: [{
                        type: "input_text",
                        text: `[System: IMPORTANT CORRECTION NEEDED. You just said something inaccurate. ${validation.correction} Please briefly acknowledge this correction to the user.]`
                      }]
                    }
                  }));
                  const correctionModalities = ttsProvider === 'elevenlabs' ? ["text"] : ["text", "audio"];
                  openaiWs!.send(JSON.stringify({ type: "response.create", response: { modalities: correctionModalities } }));
                } else {
                  console.log('[BRIDGE] ✅ Response validated - no discrepancies');
                }
                lastToolOutput = null;  // Clear after validation
              }
              break;

            case "response.function_call_arguments.done":
              console.log(`[OPENAI] Function call: ${msg.name}`, msg.arguments);
              handleFunctionCall(msg);
              break;

            case "error":
              console.error("[OPENAI] ❌ ERROR:", JSON.stringify(msg.error, null, 2));
              // Check for common billing/quota errors
              const errorCode = msg.error?.code;
              const errorMessage = msg.error?.message || '';
              if (errorCode === 'insufficient_quota' || errorMessage.includes('quota') || errorMessage.includes('billing')) {
                console.error("[OPENAI] 💳 BILLING ERROR: OpenAI API credits exhausted or billing issue!");
              } else if (errorCode === 'rate_limit_exceeded' || errorMessage.includes('rate limit')) {
                console.error("[OPENAI] ⏱️ RATE LIMIT: Too many requests - slow down!");
              } else if (errorCode === 'invalid_api_key' || errorMessage.includes('api_key')) {
                console.error("[OPENAI] 🔑 API KEY ERROR: Invalid or expired API key!");
              }
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
      if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN || greetingSent) {
        console.log(`[GREETING] ⚠️ Cannot send - openaiWs open: ${openaiWs?.readyState === WebSocket.OPEN}, greetingSent: ${greetingSent}`);
        return;
      }
      
      greetingSent = true;
      const greeting = getTimeBasedGreeting(userTimezone);
      const userName = userProfile?.first_name || 'sir';
      const currentTime = getCurrentTimeString(userTimezone);
      
      console.log(`[GREETING] 🎤 Triggering greeting for ${userName} with "${greeting}" (timezone: ${userTimezone})`);
      console.log(`[GREETING] System message being sent to OpenAI...`);
      
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

      // CRITICAL: Must specify modalities based on TTS provider
      const greetingModalities = ttsProvider === 'elevenlabs' ? ["text"] : ["text", "audio"];
      openaiWs.send(JSON.stringify({ 
        type: "response.create",
        response: {
          modalities: greetingModalities
        }
      }));
      console.log(`[GREETING] ✅ response.create sent with modalities=${JSON.stringify(greetingModalities)} (ttsProvider: ${ttsProvider})`);
    }

    function sendOutboundGreeting() {
      if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN || greetingSent) return;
      
      greetingSent = true;
      const greeting = getTimeBasedGreeting(userTimezone);
      const userName = userProfile?.first_name || 'sir';
      
      // Parse call context for scheduled calls - it contains structured agenda
      const isScheduledCall = callContext && (
        callContext.includes('[CALL AGENDA]') || 
        callContext.includes('CALL TYPE:') ||
        callContext.includes('Morning Stand-up') ||
        callContext.includes('Midday Check-in') ||
        callContext.includes('End of Day Wrap-up')
      );
      
      console.log(`[BRIDGE] Outbound call for ${userName}, scheduled: ${isScheduledCall}`);
      console.log(`[BRIDGE] Call context: ${callContext?.substring(0, 200)}...`);
      
      if (isScheduledCall && callContext) {
        // SCHEDULED CALL: Use the context to drive the entire conversation
        // Context includes the call type, agenda items, and what to cover
        openaiWs.send(JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [{
              type: "input_text",
              text: `[System: This is a SCHEDULED outbound call to ${userName}. Current time: ${getCurrentTimeString(userTimezone)}.

${callContext}

CRITICAL INSTRUCTIONS FOR THIS CALL:
1. GREETING: Start with "${greeting}, ${userName}!" followed by a brief intro matching the call type above
2. AGENDA-DRIVEN: You MUST cover ALL items listed in the agenda before ending the call
3. PIVOT HANDLING: If the user goes off-topic, address their question briefly, then say "Now, back to..." or "One more thing I wanted to cover..."
4. COMPLETION CHECK: Before using hang_up, mentally verify you've addressed every agenda item
5. NATURAL FLOW: Cover items conversationally, not as a checklist - weave them into dialogue
6. END SIGNAL: Only end the call when ALL agenda items are addressed OR the user explicitly wants to end early

Start speaking IMMEDIATELY with your greeting - the user has just answered the phone!]`
            }]
          }
        }));
        
        // CRITICAL FIX: Trigger AI response immediately for scheduled calls!
        // The user just answered the phone and is waiting for the AI to speak
        const outboundModalities = ttsProvider === 'elevenlabs' ? ["text"] : ["text", "audio"];
        openaiWs.send(JSON.stringify({ 
          type: "response.create",
          response: { modalities: outboundModalities }
        }));
        console.log(`[GREETING] ✅ SCHEDULED CALL - Triggered immediate response (modalities: ${JSON.stringify(outboundModalities)})`);
        
      } else {
        // MANUAL OUTBOUND CALL: Wait for user response first
        const contextInfo = callContext || 'your daily briefing';
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
        // Manual calls: Wait for user audio before responding
      }
    }

    // Validation function for voice responses
    function validateVoiceResponse(
      aiResponse: string, 
      toolOutput: { toolName: string; extractedFacts?: any }
    ): { valid: boolean; correction?: string } {
      if (!toolOutput.extractedFacts) return { valid: true };
      
      const facts = toolOutput.extractedFacts;
      
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
              console.log(`[BRIDGE-VALIDATE] Discrepancy: AI claimed ${claimedCount}, tool returned ${actualCount}`);
              return {
                valid: false,
                correction: `You have ${actualCount} task${actualCount !== 1 ? 's' : ''}, not ${claimedCount}.`
              };
            }
          }
        }
      }
      
      return { valid: true };
    }

    async function handleFunctionCall(msg: any) {
      if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;

      try {
        let args = JSON.parse(msg.arguments);
        const functionName = msg.name;
        
        // For web_search, override with user's verbatim transcript (prevents AI date-rewriting)
        if (functionName === 'web_search' && lastUserTranscript) {
          console.log(`[BRIDGE] web_search - OpenAI query: "${args.query}"`);
          console.log(`[BRIDGE] web_search - Overriding with verbatim: "${lastUserTranscript}"`);
          args = { ...args, query: lastUserTranscript };
        }
        
        console.log(`[BRIDGE] Executing function via execute-tool: ${functionName}`, args);

        // Use centralized tool execution
        const result = await executeTool(functionName, args, userId, {
          timezone: userTimezone,
          userProfile,
          twilioWs,
          streamSid
        });

        console.log(`[BRIDGE] Function result:`, result);
        
        // Store extracted facts for post-validation
        if (result.extractedFacts) {
          lastToolOutput = { toolName: functionName, extractedFacts: result.extractedFacts };
          console.log(`[BRIDGE] Stored extracted facts for validation:`, result.extractedFacts);
        }

        // Send function output back to OpenAI
        openaiWs.send(JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: msg.call_id,
            output: JSON.stringify(result)
          }
        }));

        // Trigger response generation with dynamic modalities
        const fnModalities = ttsProvider === 'elevenlabs' ? ["text"] : ["text", "audio"];
        openaiWs.send(JSON.stringify({ type: "response.create", response: { modalities: fnModalities } }));

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
        const errModalities = ttsProvider === 'elevenlabs' ? ["text"] : ["text", "audio"];
        openaiWs.send(JSON.stringify({ type: "response.create", response: { modalities: errModalities } }));
      }
    }

    return response;
  }

  // Non-WebSocket request
  return new Response("Twilio-OpenAI Realtime Bridge v6 - Self-Correction System", { status: 200 });
});
