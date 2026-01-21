import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GLOBAL_VERSION, FUNCTION_IDS, corsHeaders, createHealthResponse, VOICE_CONFIG } from "../_shared/config.ts";

// Version derived from centralized config
const BRIDGE_VERSION = `${GLOBAL_VERSION}-${FUNCTION_IDS.BRIDGE}`;

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

// Calculate RMS (Root Mean Square) amplitude from PCM audio data
// Used for echo detection and real barge-in detection
function calculateRMSAmplitude(pcmData: Int16Array): number {
  if (pcmData.length === 0) return 0;
  
  let sum = 0;
  let nonZeroCount = 0;
  let maxVal = 0;
  
  for (let i = 0; i < pcmData.length; i++) {
    const val = pcmData[i];
    if (val !== 0) nonZeroCount++;
    if (Math.abs(val) > maxVal) maxVal = Math.abs(val);
    sum += val * val;
  }
  
  const rms = Math.sqrt(sum / pcmData.length);
  
  // Diagnostic: Log if RMS is 0 but we have non-zero samples (indicates bug)
  if (rms === 0 && nonZeroCount > 0) {
    console.log(`[AMPLITUDE-BUG] ⚠️ RMS=0 but nonZeroCount=${nonZeroCount}, maxVal=${maxVal}`);
  }
  
  return rms;
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

// === PRE-CONNECT SESSION STORAGE ===
// Stores pre-established sessions in DATABASE for persistence across Edge Function instances
interface PreConnectSession {
  userId: string;
  context: string;
  agenda: Array<{ index: number; text: string; status: string }>;
  timezone: string;
  profile: any;
  greetingText: string;
  audioBase64: string;
  ttsProvider: 'openai' | 'elevenlabs';
  voiceId: string;
  createdAt: number;
  // NEW: Pre-computed data to skip DB queries during call connect
  ragContext: string;
  instructions: string;
  threadId: string | null;
}

// Store session in database for cross-instance persistence
async function storePreConnectSession(supabase: any, sessionId: string, session: PreConnectSession) {
  const { error } = await supabase
    .from('pre_connect_sessions')
    .insert({
      session_id: sessionId,
      user_id: session.userId,
      context: session.context,
      agenda: session.agenda,
      timezone: session.timezone,
      profile: session.profile,
      greeting_text: session.greetingText,
      audio_base64: session.audioBase64,
      tts_provider: session.ttsProvider,
      voice_id: session.voiceId,
      // NEW: Pre-computed data to eliminate DB queries during call connect
      rag_context: session.ragContext,
      instructions: session.instructions,
      thread_id: session.threadId,
      expires_at: new Date(Date.now() + 120000).toISOString() // 2 min TTL
    });
  
  if (error) {
    console.error('[PRE-CONNECT] Failed to store session in database:', error);
  } else {
    console.log(`[PRE-CONNECT] ✅ Session ${sessionId} stored in database`);
  }
}

// Retrieve session from database (works across Edge Function instances)
async function getPreConnectSession(supabase: any, sessionId: string): Promise<PreConnectSession | null> {
  const { data, error } = await supabase
    .from('pre_connect_sessions')
    .select('*')
    .eq('session_id', sessionId)
    .gt('expires_at', new Date().toISOString())
    .single();
  
  if (error || !data) {
    console.log(`[PRE-CONNECT] Session ${sessionId} not found or expired in database`);
    return null;
  }
  
  // Delete after retrieval (one-time use)
  await supabase.from('pre_connect_sessions').delete().eq('session_id', sessionId);
  
  console.log(`[PRE-CONNECT] ✅ Retrieved session ${sessionId} from database with ${data.audio_base64?.length || 0} bytes audio`);
  
  return {
    userId: data.user_id,
    context: data.context,
    agenda: data.agenda,
    timezone: data.timezone,
    profile: data.profile,
    greetingText: data.greeting_text,
    audioBase64: data.audio_base64,
    ttsProvider: data.tts_provider,
    voiceId: data.voice_id,
    createdAt: new Date(data.created_at).getTime(),
    // NEW: Pre-computed data
    ragContext: data.rag_context || '',
    instructions: data.instructions || '',
    threadId: data.thread_id || null
  };
}

// === AGENDA MANAGER ===
// Tracks conversation progress through agenda items
class AgendaManager {
  private items: Array<{ index: number; text: string; status: string; startedAt?: number; completedAt?: number }>;
  private currentIndex = 0;
  private isPausedState = false;
  private pausedForQuery?: string;

  constructor(parsedAgenda: Array<{ index: number; text: string; status: string }>) {
    this.items = parsedAgenda.map(item => ({ ...item }));
    console.log(`[AGENDA] Initialized with ${this.items.length} items`);
  }

  startItem(index?: number) {
    const idx = index ?? this.currentIndex;
    if (this.items[idx]) {
      this.items[idx].status = 'in_progress';
      this.items[idx].startedAt = Date.now();
      this.currentIndex = idx;
      console.log(`[AGENDA] Started item ${idx}: "${this.items[idx].text.substring(0, 40)}..."`);
    }
  }

  completeCurrentItem() {
    if (this.items[this.currentIndex]) {
      this.items[this.currentIndex].status = 'completed';
      this.items[this.currentIndex].completedAt = Date.now();
      console.log(`[AGENDA] Completed item ${this.currentIndex}`);
      
      // Find next pending
      const nextIdx = this.items.findIndex(
        (i, idx) => idx > this.currentIndex && i.status === 'pending'
      );
      if (nextIdx !== -1) {
        this.currentIndex = nextIdx;
      }
    }
  }

  pauseForQuery(userQuery: string) {
    if (this.items[this.currentIndex]?.status === 'in_progress') {
      this.items[this.currentIndex].status = 'paused';
      this.isPausedState = true;
      this.pausedForQuery = userQuery;
      console.log(`[AGENDA] Paused for user query: "${userQuery.substring(0, 40)}..."`);
    }
  }

  resume() {
    if (this.isPausedState && this.items[this.currentIndex]) {
      this.items[this.currentIndex].status = 'in_progress';
      this.isPausedState = false;
      this.pausedForQuery = undefined;
      console.log(`[AGENDA] Resumed item ${this.currentIndex}`);
    }
  }

  getResumeHint(): string | null {
    if (!this.isPausedState) return null;
    const item = this.items[this.currentIndex];
    return item ? `Getting back to: ${item.text}` : null;
  }

  getCurrentItem() {
    return this.items[this.currentIndex] || null;
  }

  getProgress(): { completed: number; total: number; remaining: string[] } {
    const completed = this.items.filter(i => i.status === 'completed').length;
    const remaining = this.items.filter(i => i.status !== 'completed').map(i => i.text);
    return { completed, total: this.items.length, remaining };
  }

  isComplete(): boolean {
    return this.items.every(i => i.status === 'completed');
  }

  get isPaused(): boolean {
    return this.isPausedState;
  }
}

// === SMART FILLER MANAGER ===
// Inserts natural fillers during long tool calls based on elapsed time
class SmartFillerManager {
  private toolStartTime = 0;
  private fillerTimeouts: number[] = [];
  private sendFiller: (text: string) => void;
  private lastFillerUsed: string = '';

  private readonly FILLERS = {
    short: ["One moment.", "Let me check.", "Checking.", "One sec."],
    medium: ["Still looking...", "Almost there...", "Bear with me..."],
    long: ["This is taking a moment...", "Still working on it...", "Just a bit longer..."]
  };

  private readonly DELAYS = {
    short: 1500,   // First filler after 1.5s
    medium: 3500,  // Second at 3.5s
    long: 6000     // Third at 6s
  };

  constructor(sendFiller: (text: string) => void) {
    this.sendFiller = sendFiller;
  }

  startTool(toolName: string) {
    this.toolStartTime = Date.now();
    console.log(`[FILLER] Starting timer for tool: ${toolName}`);

    // Schedule fillers at intervals
    this.fillerTimeouts.push(
      setTimeout(() => this.insertFiller('short'), this.DELAYS.short) as unknown as number,
      setTimeout(() => this.insertFiller('medium'), this.DELAYS.medium) as unknown as number,
      setTimeout(() => this.insertFiller('long'), this.DELAYS.long) as unknown as number
    );
  }

  endTool() {
    // Cancel all pending fillers
    this.fillerTimeouts.forEach(clearTimeout);
    this.fillerTimeouts = [];
    const elapsed = Date.now() - this.toolStartTime;
    console.log(`[FILLER] Tool completed in ${elapsed}ms`);
  }

  private insertFiller(tier: 'short' | 'medium' | 'long') {
    const phrases = this.FILLERS[tier];
    // Avoid repeating the same filler
    let phrase = phrases[Math.floor(Math.random() * phrases.length)];
    while (phrase === this.lastFillerUsed && phrases.length > 1) {
      phrase = phrases[Math.floor(Math.random() * phrases.length)];
    }
    this.lastFillerUsed = phrase;
    console.log(`[FILLER] Inserting ${tier} filler: "${phrase}"`);
    this.sendFiller(phrase);
  }
}

// Generate greeting text based on call type
function generateGreetingForCallType(context: string, timeGreeting: string, userName: string): string {
  if (context.includes('Morning Stand-up')) {
    return `${timeGreeting}, ${userName}. This is your morning check-in.`;
  } else if (context.includes('Midday Check-in')) {
    return `${timeGreeting}, ${userName}. Just checking in on how your day is going.`;
  } else if (context.includes('End of Day Wrap-up')) {
    return `${timeGreeting}, ${userName}. Let's wrap up the day.`;
  } else if (context.includes('Task reminder')) {
    return `${timeGreeting}, ${userName}. Quick reminder about an upcoming task.`;
  }
  
  // Default
  return `${timeGreeting}, ${userName}. This is Iris.`;
}

// Handle pre-connect mode - establish session before call
// NOW: Pre-computes RAG, instructions, threadId so connectToOpenAI can skip DB queries
async function handlePreConnect(params: {
  userId: string;
  context: string;
  agenda: Array<{ index: number; text: string; status: string }>;
  timezone: string;
  phoneNumber: string;
}): Promise<Response> {
  const { userId, context, agenda, timezone } = params;
  const startTime = Date.now();
  console.log(`[PRE-CONNECT] Starting FULL pre-connect for user ${userId}`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // 1. Load ALL context in parallel - profile, TTS prefs, RAG, and thread
  const [profile, ttsPrefs, ragContext, threadResult] = await Promise.all([
    loadUserProfile(supabase, userId),
    supabase
      .from('user_scheduling_prefs')
      .select('tts_provider, elevenlabs_voice_id')
      .eq('user_id', userId)
      .maybeSingle(),
    // NEW: Pre-load RAG context
    loadRAGContext(supabase, userId),
    // NEW: Pre-fetch thread ID
    supabase
      .from('ai_threads')
      .select('id')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  const ttsProvider = (ttsPrefs.data?.tts_provider as 'openai' | 'elevenlabs') || 'elevenlabs';
  const voiceId = ttsPrefs.data?.elevenlabs_voice_id || 'EXAVITQu4vr4xnSDxMaL';
  
  // Get or create thread
  let threadId: string | null = threadResult.data?.id || null;
  if (!threadId) {
    const { data: newThread } = await supabase
      .from('ai_threads')
      .insert({ user_id: userId, openai_thread_id: `phone_${Date.now()}` })
      .select('id')
      .single();
    threadId = newThread?.id || null;
    console.log(`[PRE-CONNECT] Created new thread: ${threadId}`);
  } else {
    console.log(`[PRE-CONNECT] Using existing thread: ${threadId}`);
  }

  console.log(`[PRE-CONNECT] TTS Provider: ${ttsProvider}, Voice ID: ${voiceId}, RAG: ${ragContext.length} chars`);

  // 2. Generate greeting text
  const timeGreeting = getTimeBasedGreeting(timezone);
  const userName = profile?.first_name || 'sir';
  const greetingText = generateGreetingForCallType(context, timeGreeting, userName);

  console.log(`[PRE-CONNECT] Generated greeting: "${greetingText}"`);

  // 3. NEW: Pre-generate full instructions (the expensive loadUserInstructions call)
  const instructions = await loadUserInstructions(userId, ragContext, profile, timezone);
  console.log(`[PRE-CONNECT] Pre-generated instructions: ${instructions.length} chars`);

  // 4. Generate audio via ElevenLabs TTS
  let audioBase64 = '';
  let audioBytes = 0;

  if (ttsProvider === 'elevenlabs' && ELEVENLABS_API_KEY) {
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/elevenlabs-tts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: greetingText,
          voiceId: voiceId,
          format: 'ulaw'
        })
      });

      if (response.ok) {
        const data = await response.json();
        audioBase64 = data.audio || '';
        audioBytes = data.bytes || 0;
        console.log(`[PRE-CONNECT] ✅ Generated ${audioBytes} bytes of cached audio`);
      } else {
        console.error(`[PRE-CONNECT] ElevenLabs TTS failed: ${response.status}`);
      }
    } catch (error) {
      console.error('[PRE-CONNECT] TTS error:', error);
    }
  }

  // 5. Store session in database with ALL pre-computed data
  const sessionId = crypto.randomUUID();
  const totalTime = Date.now() - startTime;

  await storePreConnectSession(supabase, sessionId, {
    userId,
    context,
    agenda,
    timezone,
    profile,
    greetingText,
    audioBase64,
    ttsProvider,
    voiceId,
    createdAt: Date.now(),
    // NEW: Pre-computed data to skip DB queries during call connect
    ragContext,
    instructions,
    threadId
  });

  console.log(`[PRE-CONNECT] ✅ FULL session stored in ${totalTime}ms: ${sessionId}`);
  console.log(`[PRE-CONNECT] ✅ connectToOpenAI will now skip ~5 DB queries`);

  return new Response(JSON.stringify({
    sessionId,
    greetingText,
    audioBase64,
    audioBytes,
    agenda,
    ttsProvider,
    preConnectTimeMs: totalTime
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

serve(async (req) => {
  const url = new URL(req.url);
  console.log(`[BRIDGE] Version: ${BRIDGE_VERSION}`);
  console.log(`[BRIDGE] Request: ${req.method} ${url.pathname}`);

  // Handle pre-connect mode (HTTP POST, not WebSocket upgrade)
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      if (body.mode === 'pre-connect') {
        return handlePreConnect(body);
      }
    } catch (e) {
      // Not JSON or parsing failed, continue to other handlers
      console.log('[BRIDGE] POST request not pre-connect mode');
    }
  }

  // Health check endpoint - supports both /health path and ?health=1 param
  if (url.pathname.endsWith("/health") || url.searchParams.get('health') === '1') {
    return new Response(JSON.stringify({
      name: 'twilio-realtime-bridge',
      version: BRIDGE_VERSION,
      timestamp: new Date().toISOString(),
      status: 'healthy'
    }), {
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
    
    // === CALL SESSION TRACKING ===
    // For full conversation logging and review
    let callSessionId: string | null = null;
    let messageIndex = 0;
    let callStartTime = Date.now();
    let responseStartTime = 0;
    let firstAudioTime: number | null = null;
    let greetingLatencyMs: number | null = null;
    
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
    let audioSentDuringResponse: boolean = false;  // Track if any audio was sent via streaming
    const SENTENCE_ENDERS = /[.!?]\s*$/;
    
    // === SPEECH EVENT DEBOUNCE ===
    // Prevent rapid-fire speech events from causing stuttering
    let lastSpeechStartTime = 0;
    const SPEECH_DEBOUNCE_MS = 300;
    
    // === AMPLITUDE-BASED ECHO FILTERING ===
    // Suppress OpenAI VAD false-positives caused by TTS echo on phone line
    // Track when we're actively sending TTS audio to detect echo vs real speech
    let isSendingTtsAudio = false;
    let ttsAudioEndTime = 0;
    const TTS_ECHO_GRACE_PERIOD_MS = 500; // Extra time for audio to clear after TTS ends
    
    // === DEBUG FLAG: DISABLE ECHO FILTER ===
    // Set to true to bypass amplitude-based echo filtering (for debugging transcription loss)
    const DISABLE_ECHO_FILTER = true;  // TEMPORARY: Let all audio through to debug
    
    // Amplitude thresholds for echo vs real speech detection
    // Echo from speaker tends to be lower amplitude than real speech into mic
    const ECHO_AMPLITUDE_THRESHOLD = 1500;     // Below this = likely echo, ignore
    const INTERRUPT_AMPLITUDE_THRESHOLD = 3000; // Above this = real speech, process
    
    // Rolling window of recent amplitudes for smoother detection
    let recentAmplitudes: number[] = [];
    const AMPLITUDE_WINDOW = 5; // Number of chunks to average
    let amplitudeDebugCounter = 0;
    
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
    
    // === AGENDA MANAGER INSTANCE ===
    let agendaManager: AgendaManager | null = null;
    
    // === SMART FILLER MANAGER INSTANCE ===
    let fillerManager: SmartFillerManager | null = null;
    
    // === PRE-CONNECTED SESSION STATE ===
    let preConnectedSession: PreConnectSession | null = null;
    let cachedAudioBase64: string = '';
    let preConnectedGreetingText: string = '';
    
    // === HELLO-TRIGGERED GREETING FOR OUTBOUND CALLS ===
    // Wait for user to say hello before AI speaks (works with or without cached audio)
    let waitingForUserHello = false;
    let pendingCachedGreeting: string = '';
    let pendingGreetingMode: 'cached' | 'openai' | null = null; // Track greeting delivery method
    let helloTriggerTimer: number | null = null;
    const HELLO_FALLBACK_MS = VOICE_CONFIG.OUTBOUND_HELLO_WAIT_MS; // Max wait for user audio on outbound
    
    // Unified trigger for pending greeting (called by timer, buffer detection, or VAD)
    function triggerPendingGreeting(source: 'timer' | 'buffer' | 'vad') {
      if (!waitingForUserHello) return;
      
      waitingForUserHello = false;
      if (helloTriggerTimer) {
        clearTimeout(helloTriggerTimer);
        helloTriggerTimer = null;
      }
      
      console.log(`[HELLO-TRIGGER] 🎤 Triggered by ${source}, mode=${pendingGreetingMode}`);
      
      if (pendingGreetingMode === 'cached' && pendingCachedGreeting) {
        t_cachedGreetingPlayed = Date.now();
        playCachedAudio(pendingCachedGreeting);
        greetingSent = true;
        firstOutboundLogged = true;
        console.log(`[TIMING] twilioStart→greetingPlayed: ${t_cachedGreetingPlayed - t_twilioStart}ms (${source})`);
        
        // Inject greeting context now that we've played it
        injectAssistantMessage(preConnectedGreetingText, 'PRE_CONNECT_GREETING_HISTORY');
        const userName = userProfile?.first_name || 'sir';
        const contextMsg = `[System: PRE-CONNECTED CALL - You just said: "${preConnectedGreetingText}"
The user answered with hello/speech. Current time: ${getCurrentTimeString(userTimezone)}.
${callContext || ''}
Cover ALL agenda items naturally before ending. Use hang_up only after all items covered.]`;
        injectSystemMessage(contextMsg, 'PRE_CONNECT_CONTEXT_AFTER_HELLO');
      } else if (pendingGreetingMode === 'openai') {
        // Trigger live OpenAI greeting - sendOutboundGreeting will be called
        console.log(`[HELLO-TRIGGER] 📡 Mode=openai - will trigger sendOutboundGreeting()`);
        sendOutboundGreeting();
      }
      
      pendingCachedGreeting = '';
      pendingGreetingMode = null;
    }
    
    // === EARLY AUDIO BUFFERING ===
    // Buffer audio while OpenAI WS is connecting so we don't lose user's "hello"
    const audioRingBuffer: Int16Array[] = [];
    const MAX_BUFFER_FRAMES = 150; // ~3 seconds of audio at 8kHz (20ms/frame)
    let audioBufferFlushed = false;
    
    // === TELEMETRY TIMESTAMPS ===
    let t_twilioStart = 0;
    let t_openaiWsConstructed = 0;
    let t_sessionConfigured = 0;
    let t_firstAudioBuffered = 0;
    let t_bufferFlushed = 0;
    let t_cachedGreetingPlayed = 0;
    
    // =====================================================
    // === ENHANCED RESPONSE TRIGGER LOGGING SYSTEM ===
    // =====================================================
    // Track EVERY response.create call to identify duplicate/unexpected triggers
    
type ResponseTrigger = 
  | 'INBOUND_GREETING'
  | 'OUTBOUND_GREETING' 
  | 'OUTBOUND_SCHEDULED_GREETING'
  | 'PRE_CONNECT_CACHED_AUDIO'
  | 'FUNCTION_RESULT'
  | 'VALIDATION_CORRECTION'
  | 'FILLER_INJECTION'
  | 'USER_SPEECH_ENDED'
  | 'UNKNOWN';
    
    let lastResponseTrigger: ResponseTrigger = 'UNKNOWN';
    let lastResponseTriggerTime: number = 0;
    let responseCreateCount: number = 0;
    const DUPLICATE_THRESHOLD_MS = 500;
    
    // Wrapper for response.create - logs trigger source and detects duplicates
    function createResponse(trigger: ResponseTrigger, reason?: string): boolean {
      if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) {
        console.warn(`[RESPONSE-CREATE] ⚠️ Cannot send - OpenAI WS not open`);
        return false;
      }
      
      responseCreateCount++;
      const now = Date.now();
      const timeSinceLast = lastResponseTriggerTime > 0 ? now - lastResponseTriggerTime : -1;
      const modalities = ttsProvider === 'elevenlabs' ? ["text"] : ["text", "audio"];
      
      console.log(`[RESPONSE-CREATE] #${responseCreateCount} trigger=${trigger} modalities=${JSON.stringify(modalities)} reason="${reason || ''}" timeSinceLast=${timeSinceLast}ms`);
      
      // DUPLICATE DETECTION: Warn and skip if same trigger within threshold
      if (trigger === lastResponseTrigger && timeSinceLast >= 0 && timeSinceLast < DUPLICATE_THRESHOLD_MS) {
        console.warn(`[RESPONSE-CREATE] ⚠️ DUPLICATE TRIGGER: ${trigger} within ${timeSinceLast}ms - SKIPPING to prevent repeat`);
        return false;
      }
      
      lastResponseTrigger = trigger;
      lastResponseTriggerTime = now;
      
      openaiWs.send(JSON.stringify({
        type: "response.create",
        response: { modalities }
      }));
      
      return true;
    }
    
    // Wrapper for conversation.item.create - logs what context we're injecting
    function injectSystemMessage(content: string, logTag: string) {
      if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) {
        console.warn(`[INJECT-MSG] ⚠️ Cannot send - OpenAI WS not open`);
        return;
      }
      
      // Log first 120 chars to understand what we're telling the AI
      const preview = content.length > 120 ? content.substring(0, 120) + '...' : content;
      console.log(`[INJECT-MSG] ${logTag}: "${preview}"`);
      
      openaiWs.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: content }]
        }
      }));
    }
    
    // Wrapper for injecting assistant messages (for filler/cached greetings)
    function injectAssistantMessage(content: string, logTag: string) {
      if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) {
        console.warn(`[INJECT-ASST] ⚠️ Cannot send - OpenAI WS not open`);
        return;
      }
      
      console.log(`[INJECT-ASST] ${logTag}: "${content}"`);
      
      openaiWs.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: content }]
        }
      }));
    }
    
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
          // === ECHO FILTERING: Mark that we're sending TTS audio ===
          isSendingTtsAudio = true;
          recentAmplitudes = []; // Reset amplitude tracking at start of TTS
          
          // ElevenLabs returns the full audio at once - we need to chunk it for Twilio
          // Twilio expects ~20ms chunks (160 bytes at 8kHz μ-law)
          const audioBytes = Uint8Array.from(atob(data.audio), c => c.charCodeAt(0));
          const chunkSize = 160; // 20ms at 8kHz
          const numChunks = Math.ceil(audioBytes.length / chunkSize);
          const estimatedDurationMs = numChunks * 20; // 20ms per chunk
          
          console.log(`[ELEVENLABS] 🔊 Sending ${numChunks} chunks (~${estimatedDurationMs}ms duration)`);
          
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
          
          // === ECHO FILTERING: Schedule end of TTS playback window ===
          // Audio takes time to play + echo takes time to return
          ttsAudioEndTime = Date.now() + estimatedDurationMs + TTS_ECHO_GRACE_PERIOD_MS;
          console.log(`[ECHO-FILTER] TTS playback window: now + ${estimatedDurationMs + TTS_ECHO_GRACE_PERIOD_MS}ms`);
          
          // Schedule turning off the flag after audio finishes + grace period
          setTimeout(() => {
            if (isSendingTtsAudio && Date.now() >= ttsAudioEndTime - 50) {
              isSendingTtsAudio = false;
              console.log(`[ECHO-FILTER] TTS playback window ended`);
            }
          }, estimatedDurationMs + TTS_ECHO_GRACE_PERIOD_MS);
          
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

    // Play pre-cached audio directly to Twilio (for pre-connected sessions)
    function playCachedAudio(audioBase64: string) {
      if (!streamSid || twilioWs.readyState !== WebSocket.OPEN || !audioBase64) {
        console.warn('[CACHED-AUDIO] Cannot play - missing streamSid, closed WS, or no audio');
        return;
      }

      console.log(`[CACHED-AUDIO] 🎙️ Playing ${audioBase64.length} chars of cached audio`);

      try {
        // === ECHO FILTERING: Mark that we're sending TTS audio ===
        isSendingTtsAudio = true;
        recentAmplitudes = []; // Reset amplitude tracking at start of TTS
        
        // The audio is already in μ-law format from ElevenLabs - chunk it for Twilio
        const audioBytes = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
        const chunkSize = 160; // 20ms at 8kHz
        const numChunks = Math.ceil(audioBytes.length / chunkSize);
        const estimatedDurationMs = numChunks * 20; // 20ms per chunk

        console.log(`[CACHED-AUDIO] 🔊 Sending ${numChunks} chunks (~${estimatedDurationMs}ms duration)`);

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

        // === ECHO FILTERING: Schedule end of TTS playback window ===
        ttsAudioEndTime = Date.now() + estimatedDurationMs + TTS_ECHO_GRACE_PERIOD_MS;
        console.log(`[ECHO-FILTER] Cached audio playback window: now + ${estimatedDurationMs + TTS_ECHO_GRACE_PERIOD_MS}ms`);
        
        // Schedule turning off the flag after audio finishes + grace period
        setTimeout(() => {
          if (isSendingTtsAudio && Date.now() >= ttsAudioEndTime - 50) {
            isSendingTtsAudio = false;
            console.log(`[ECHO-FILTER] Cached audio playback window ended`);
          }
        }, estimatedDurationMs + TTS_ECHO_GRACE_PERIOD_MS);

        console.log(`[CACHED-AUDIO] ✅ Sent ${numChunks} chunks`);
      } catch (error) {
        console.error('[CACHED-AUDIO] Error playing cached audio:', error);
      }
    }

    // Initialize filler manager with TTS function
    fillerManager = new SmartFillerManager((text) => {
      if (ttsProvider === 'elevenlabs') {
        sendElevenLabsTTS(text);
      } else {
        // For OpenAI TTS, inject as assistant message and trigger response
        injectAssistantMessage(text, 'FILLER');
        createResponse('FILLER_INJECTION', `filler: "${text}"`);
      }
    });

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
            
            // Check for pre-connected session
            const sessionId = customParams.sessionId;
            const greetingCached = customParams.greetingCached === 'true';
            const cachedGreetingText = customParams.greetingText || '';
            
            console.log(`[TWILIO-STREAM] ✅ Stream START received - streamSid: ${streamSid}`);
            console.log(`[TWILIO-STREAM] Custom params:`, JSON.stringify(customParams));
            console.log(`[TWILIO-STREAM] Pre-connected session: ${sessionId || 'none'}, greetingCached: ${greetingCached}`);
            
            // === PRE-CONNECTED SESSION HANDLING ===
            // For scheduled calls: PLAY GREETING IMMEDIATELY, then connect to OpenAI in parallel
            // This eliminates the 3-second delay waiting for OpenAI connection
            if (sessionId) {
              t_twilioStart = Date.now();
              console.log(`[BRIDGE] Version: ${BRIDGE_VERSION}`);
              console.log(`[TWILIO-STREAM] ⚡ Pre-connected mode: fetching session...`);
              console.log(`[PRE-CONNECT-DEBUG] sessionId="${sessionId}", greetingCached="${greetingCached}"`);
              console.log(`[PRE-CONNECT-DEBUG] All custom params: ${JSON.stringify(customParams)}`);
              
              // Retrieve session data
              getPreConnectSession(supabase, sessionId).then((session) => {
                console.log(`[PRE-CONNECT-DEBUG] Session lookup result: ${session ? 'FOUND' : 'NULL'}`);
                if (session) {
                  console.log(`[PRE-CONNECT-DEBUG] Session has: audioBase64=${session.audioBase64?.length || 0} chars, greetingText="${session.greetingText?.substring(0, 50)}..."`);
                  console.log(`[TWILIO-STREAM] ✅ Pre-connected session loaded in ${Date.now() - t_twilioStart}ms`);
                  
                  // CRITICAL: Set ALL session data
                  preConnectedSession = session;
                  userId = session.userId;
                  callContext = session.context;
                  userTimezone = session.timezone;
                  userProfile = session.profile;
                  ttsProvider = session.ttsProvider;
                  elevenlabsVoiceId = session.voiceId;
                  cachedAudioBase64 = session.audioBase64;
                  preConnectedGreetingText = session.greetingText;
                  threadId = session.threadId;
                  
                  if (session.agenda && session.agenda.length > 0) {
                    agendaManager = new AgendaManager(session.agenda);
                    agendaManager.startItem(0);
                  }
                  
                  // Direction-based greeting logic:
                  // - OUTBOUND: Wait for user audio (or 2s timeout) before AI speaks
                  // - INBOUND: AI speaks immediately (user called in, they're ready)
                  const isOutboundCall = callDirection === 'outbound';
                  console.log(`[PRE-CONNECT-DEBUG] callDirection=${callDirection}, isOutbound=${isOutboundCall}, hasAudio=${!!cachedAudioBase64}, streamSid=${streamSid}`);
                  
                  if (isOutboundCall && streamSid) {
                    // OUTBOUND: Wait for user to answer and greet (or 2s timeout)
                    // Works with OR without cached audio
                    console.log(`[HELLO-WAIT] 🎧 Outbound call - waiting for user audio (max ${HELLO_FALLBACK_MS}ms)`);
                    waitingForUserHello = true;
                    pendingGreetingMode = cachedAudioBase64 ? 'cached' : 'openai';
                    pendingCachedGreeting = cachedAudioBase64 || '';
                    console.log(`[HELLO-WAIT] mode=${pendingGreetingMode}, hasCachedAudio=${!!cachedAudioBase64}`);
                    
                    helloTriggerTimer = setTimeout(() => {
                      if (waitingForUserHello) {
                        console.log(`[HELLO-TRIGGER] ⏱️ No audio after ${HELLO_FALLBACK_MS}ms - triggering greeting (mode=${pendingGreetingMode})`);
                        triggerPendingGreeting('timer');
                      }
                    }, HELLO_FALLBACK_MS) as unknown as number;
                  } else if (cachedAudioBase64 && streamSid) {
                    // INBOUND with cached audio: AI speaks immediately (user called in)
                    console.log(`[HELLO-TRIGGER] 🎤 Inbound call - playing greeting immediately`);
                    t_cachedGreetingPlayed = Date.now();
                    playCachedAudio(cachedAudioBase64);
                    greetingSent = true;
                    firstOutboundLogged = true;
                    waitingForUserHello = false;
                    console.log(`[TIMING] twilioStart→greetingPlayed: ${t_cachedGreetingPlayed - t_twilioStart}ms (immediate-inbound)`);
                  }
                  
                  const csp = customParams.callSid || data.start.callSid || `call_${Date.now()}`;
                  createCallSession(csp, customParams.fromNumber, customParams.toNumber);
                  
                  // Connect to OpenAI in parallel (for handling conversation after greeting)
                  console.log(`[TWILIO-STREAM] 🚀 Connecting to OpenAI in parallel`);
                  connectToOpenAI();
                } else {
                  console.warn(`[TWILIO-STREAM] ⚠️ Pre-connected session ${sessionId} not found - using slow path`);
                  const csp = customParams.callSid || data.start.callSid || `call_${Date.now()}`;
                  createCallSession(csp, customParams.fromNumber, customParams.toNumber);
                  connectToOpenAI();
                }
              }).catch((err) => {
                console.error(`[TWILIO-STREAM] Session retrieval error:`, err);
                const csp = customParams.callSid || data.start.callSid || `call_${Date.now()}`;
                createCallSession(csp, customParams.fromNumber, customParams.toNumber);
                connectToOpenAI();
              });
              break; // Async handler manages session data
            }
            
            console.log(`[TWILIO-STREAM] Call direction: ${callDirection}, userId: ${userId}, timezone: ${userTimezone}`);
            const callSidFromParams = customParams.callSid || data.start.callSid || `call_${Date.now()}`;
            createCallSession(callSidFromParams, customParams.fromNumber, customParams.toNumber);
            connectToOpenAI();
            break;

          case "media":
            twilioMediaFramesIn++;
            
            // Decode μ-law → PCM16 (always needed for buffering or forwarding)
            const mulawBytes = Uint8Array.from(atob(data.media.payload), (c) => c.charCodeAt(0));
            const pcm8k = decodeMulaw(mulawBytes);
            
            // === EARLY AUDIO BUFFERING ===
            // Buffer audio while OpenAI WS is connecting so we don't lose user's "hello"
            if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN || !sessionConfigured) {
              // Buffer the audio - OpenAI not ready yet
              audioRingBuffer.push(pcm8k);
              if (audioRingBuffer.length > MAX_BUFFER_FRAMES) {
                audioRingBuffer.shift(); // Keep last ~3 seconds
              }
              if (audioRingBuffer.length === 1) {
                t_firstAudioBuffered = Date.now();
                console.log(`[AUDIO-BUFFER] 📥 Started buffering audio (OpenAI WS state: ${openaiWs?.readyState}, configured: ${sessionConfigured})`);
              }
              if (audioRingBuffer.length % 50 === 0) {
                console.log(`[AUDIO-BUFFER] 📥 Buffered ${audioRingBuffer.length} frames (~${(audioRingBuffer.length * 20)}ms)`);
              }
              break;
            }
            
            if (!firstInboundLogged) {
              console.log(`[AUDIO-IN] 📥 First Twilio inbound frame received (streamSid: ${streamSid})`);
              firstInboundLogged = true;
            }
            
            // === AMPLITUDE-BASED ECHO FILTERING ===
            // When we're actively sending TTS audio, the phone line will echo it back
            // OpenAI's VAD picks this up as "user speech" and interrupts itself
            // Solution: Check amplitude to distinguish echo (low) from real speech (high)
            
            const amplitude = calculateRMSAmplitude(pcm8k);
            amplitudeDebugCounter++;
            
            // Periodic amplitude debugging (every 100 chunks = ~2 seconds)
            if (amplitudeDebugCounter % 100 === 0) {
              console.log(`[AMPLITUDE-DEBUG] chunk=${amplitudeDebugCounter} amp=${amplitude.toFixed(0)} isTTS=${isSendingTtsAudio}`);
            }
            
            // Check if we're in TTS echo window (actively playing or grace period)
            const inEchoWindow = isSendingTtsAudio || Date.now() < ttsAudioEndTime;
            
            if (inEchoWindow && ttsProvider === 'elevenlabs') {
              if (DISABLE_ECHO_FILTER) {
                // === BYPASS MODE: Send all audio to OpenAI, let semantic VAD decide ===
                const pcm24k = upsample8to24(pcm8k);
                const audioBase64 = int16ToBase64(pcm24k);
                openaiAppendCount++;
                
                // Log occasionally to confirm audio is flowing during TTS
                if (amplitudeDebugCounter % 100 === 0) {
                  console.log(`[ECHO-BYPASS] 🔊 Audio forwarded during TTS (chunk=${amplitudeDebugCounter}, amp=${amplitude.toFixed(0)})`);
                }
                
                openaiWs.send(JSON.stringify({
                  type: "input_audio_buffer.append",
                  audio: audioBase64,
                }));
              } else {
                // === ORIGINAL AMPLITUDE-BASED FILTERING ===
                // During TTS playback - use amplitude to detect real interrupts
                recentAmplitudes.push(amplitude);
                if (recentAmplitudes.length > AMPLITUDE_WINDOW) {
                  recentAmplitudes.shift();
                }
                
                const avgAmplitude = recentAmplitudes.length > 0 
                  ? recentAmplitudes.reduce((a, b) => a + b, 0) / recentAmplitudes.length 
                  : 0;
                
                if (avgAmplitude > INTERRUPT_AMPLITUDE_THRESHOLD) {
                  // Real interrupt detected - loud enough to be actual speech
                  console.log(`[BARGE-IN] 🎤 REAL INTERRUPT! avgAmp=${avgAmplitude.toFixed(0)} > ${INTERRUPT_AMPLITUDE_THRESHOLD}`);
                  
                  // Stop TTS playback tracking
                  isSendingTtsAudio = false;
                  ttsAudioEndTime = 0;
                  recentAmplitudes = [];
                  
                  // Clear sentence buffer to stop pending TTS
                  sentenceBuffer = '';
                  
                  // Clear Twilio's audio buffer to stop playback
                  if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
                    twilioWs.send(JSON.stringify({
                      event: "clear",
                      streamSid: streamSid
                    }));
                    console.log(`[BARGE-IN] Cleared Twilio buffer`);
                  }
                  
                  // NOW forward this audio to OpenAI - it's a real interrupt
                  const pcm24k = upsample8to24(pcm8k);
                  const audioBase64 = int16ToBase64(pcm24k);
                  openaiAppendCount++;
                  openaiWs.send(JSON.stringify({
                    type: "input_audio_buffer.append",
                    audio: audioBase64,
                  }));
                } else if (avgAmplitude < ECHO_AMPLITUDE_THRESHOLD) {
                  // Echo detected - too quiet to be real speech, ignore it
                  // Log occasionally for debugging
                  if (amplitudeDebugCounter % 50 === 0) {
                    console.log(`[ECHO-FILTER] Ignoring echo: avgAmp=${avgAmplitude.toFixed(0)} < ${ECHO_AMPLITUDE_THRESHOLD}`);
                  }
                  // DON'T forward to OpenAI - this prevents VAD from triggering on echo
                } else {
                  // Ambiguous zone - forward with caution (OpenAI VAD will decide)
                  const pcm24k = upsample8to24(pcm8k);
                  const audioBase64 = int16ToBase64(pcm24k);
                  openaiAppendCount++;
                  openaiWs.send(JSON.stringify({
                    type: "input_audio_buffer.append",
                    audio: audioBase64,
                  }));
                }
              }
            } else {
              // Not in TTS echo window - send all audio to OpenAI normally
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

    twilioWs.onclose = async () => {
      const callDuration = Math.floor((Date.now() - callStartTime) / 1000);
      console.log("[TWILIO-WS] WebSocket closed");
      console.log(`[CALL-SUMMARY] =============================================`);
      console.log(`[CALL-SUMMARY] Duration: ${callDuration}s`);
      console.log(`[CALL-SUMMARY] Greeting latency: ${greetingLatencyMs ?? 'N/A'}ms`);
      console.log(`[CALL-SUMMARY] Total response.create calls: ${responseCreateCount}`);
      console.log(`[CALL-SUMMARY] Last trigger: ${lastResponseTrigger}`);
      console.log(`[CALL-SUMMARY] TTS Provider: ${ttsProvider}`);
      console.log(`[CALL-SUMMARY] Audio - Twilio IN: ${twilioMediaFramesIn}, OpenAI appends: ${openaiAppendCount}`);
      console.log(`[CALL-SUMMARY] Audio - OpenAI deltas: ${openaiAudioDeltaCount}, Twilio OUT: ${twilioMediaFramesOut}`);
      console.log(`[CALL-SUMMARY] OpenAI event types:`, JSON.stringify(openaiEventCounts));
      console.log(`[CALL-SUMMARY] =============================================`);
      
      // Close call session for tracking
      await closeCallSession();
      
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
      const connectStart = Date.now();
      console.log("[OPENAI] Connecting...");

      // === FAST PATH: Pre-connected sessions have all data pre-computed ===
      let instructions: string;
      let ragContext = "";
      
      if (preConnectedSession && preConnectedSession.instructions) {
        // ⚡ FAST PATH: Skip ALL database queries - use pre-computed data
        console.log(`[OPENAI] ⚡ FAST PATH: Using pre-connected session data (skipping ~5 DB queries)`);
        instructions = preConnectedSession.instructions;
        ragContext = preConnectedSession.ragContext;
        threadId = preConnectedSession.threadId;
        // userProfile, ttsProvider, elevenlabsVoiceId already set in start handler
        console.log(`[OPENAI] ⚡ Pre-loaded: instructions=${instructions.length} chars, ragContext=${ragContext.length} chars, threadId=${threadId}`);
      } else {
        // === SLOW PATH: Standard inbound calls - load everything from DB ===
        console.log("[OPENAI] 🐢 SLOW PATH: Loading context from database...");
        
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
        instructions = await loadUserInstructions(userId, ragContext, userProfile, userTimezone);
        console.log(`[OPENAI] 🐢 SLOW PATH completed in ${Date.now() - connectStart}ms`);
      }
      
      t_openaiWsConstructed = Date.now();
      console.log(`[TIMING] connectToOpenAI pre-WS work: ${t_openaiWsConstructed - connectStart}ms`);

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
                    type: "semantic_vad",  // Uses AI to detect when user is ACTUALLY done speaking
                    eagerness: "low",       // Let user take their time (prevents cutting off)
                    create_response: false, // CRITICAL: Disable auto-response on VAD detection
                    interrupt_response: true, // Still allow user to interrupt AI
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
              t_sessionConfigured = Date.now();
              console.log(`[TIMING] twilioStart→sessionConfigured: ${t_sessionConfigured - t_twilioStart}ms`);
              
              // === FLUSH AUDIO BUFFER WITH SPEECH DETECTION ===
              // Analyze buffer for speech BEFORE flushing - this is key to detecting buffered "hello"
              let bufferHadSpeech = false;
              if (audioRingBuffer.length > 0) {
                t_bufferFlushed = Date.now();
                
                // Check if buffer contains actual speech (not just noise)
                // Use amplitude analysis since OpenAI VAD doesn't work well on bulk-flushed audio
                const SPEECH_THRESHOLD = 500; // RMS amplitude threshold
                let speechFrames = 0;
                for (const frame of audioRingBuffer) {
                  const rms = calculateRMSAmplitude(frame);
                  if (rms > SPEECH_THRESHOLD) {
                    speechFrames++;
                  }
                }
                bufferHadSpeech = audioRingBuffer.length >= 10 && (speechFrames / audioRingBuffer.length) > 0.15;
                console.log(`[AUDIO-BUFFER] 🔄 Flushing ${audioRingBuffer.length} frames, speechFrames=${speechFrames}, containsSpeech=${bufferHadSpeech}`);
                
                // Flush all buffered audio to OpenAI
                for (const frame of audioRingBuffer) {
                  const pcm24k = upsample8to24(frame);
                  const audioBase64 = int16ToBase64(pcm24k);
                  openaiAppendCount++;
                  openaiWs!.send(JSON.stringify({
                    type: "input_audio_buffer.append",
                    audio: audioBase64
                  }));
                }
                console.log(`[AUDIO-BUFFER] ✅ Flushed ${audioRingBuffer.length} frames in ${Date.now() - t_bufferFlushed}ms`);
                audioRingBuffer.length = 0; // Clear buffer
                audioBufferFlushed = true;
              }
              
              // === PROACTIVE HELLO TRIGGER ===
              // If buffer contained speech AND we're waiting for hello, trigger greeting NOW
              // This bypasses OpenAI's VAD which doesn't work well on bulk-flushed audio
              if (bufferHadSpeech && waitingForUserHello) {
                console.log("[HELLO-TRIGGER] 🎤 Speech detected in buffer - triggering greeting NOW (bypassing VAD)");
                triggerPendingGreeting('buffer');
                
                // Commit the buffered audio so OpenAI transcribes it
                openaiWs!.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
                
                console.log(`[TIMING] twilioStart→greetingPlayed: ${t_cachedGreetingPlayed - t_twilioStart}ms (buffer-speech-detected)`);
                return; // Don't fall through to waiting logic
              }
              
              // === HANDLE SCHEDULED CALLS (greeting already sent) ===
              // For scheduled calls, greeting was played immediately on stream start
              // Now inject context so OpenAI knows what was said
              if (preConnectedSession && greetingSent && !waitingForUserHello) {
                console.log("[OPENAI-SESSION] Scheduled call - greeting already sent, injecting context");
                
                // Tell OpenAI what greeting was already said
                injectAssistantMessage(preConnectedGreetingText, 'PRE_CONNECT_GREETING_HISTORY');
                
                const userName = userProfile?.first_name || 'sir';
                const contextMsg = `[System: SCHEDULED CALL - You just said: "${preConnectedGreetingText}"
The user is listening. Current time: ${getCurrentTimeString(userTimezone)}.
${callContext || ''}
Cover ALL agenda items naturally before ending. Use hang_up only after all items covered.]`;
                injectSystemMessage(contextMsg, 'PRE_CONNECT_CONTEXT_SCHEDULED');
                console.log("[OPENAI-SESSION] ✅ Context injected for scheduled call - ready for user response");
                return;
              }
              
              // Handle pre-connected sessions - greeting will be played on user speech (VAD fallback)
              if (preConnectedSession && waitingForUserHello) {
                // No speech detected in buffer yet - wait for real-time VAD
                console.log("[OPENAI-SESSION] Pre-connected session - no speech in buffer, waiting for VAD");
                
                // Inject the call context/agenda for AI to follow (but don't mark greeting as sent yet)
                const userName = userProfile?.first_name || 'sir';
                const contextMsg = `[System: PRE-CONNECTED CALL - You are about to greet ${userName}. Current time: ${getCurrentTimeString(userTimezone)}.

${callContext || ''}

IMPORTANT: Your greeting audio is ready. When the user says hello, you will greet them.
After greeting, cover ALL agenda items naturally before ending.
Use hang_up only after all agenda items are covered.]`;
                
                injectSystemMessage(contextMsg, 'PRE_CONNECT_WAITING_CONTEXT');
                console.log("[OPENAI-SESSION] ✅ Pre-connected context injected - waiting for user speech to trigger greeting");
                return;
              }
              
              // Handle pre-connected sessions where greeting already played (fallback timer)
              if (preConnectedSession && greetingSent) {
                // Greeting already played from cache - just update OpenAI context
                console.log("[OPENAI-SESSION] Pre-connected session - updating AI context with greeting");
                
                // Inject the pre-spoken greeting into OpenAI's conversation context
                injectAssistantMessage(preConnectedGreetingText, 'PRE_CONNECT_GREETING_HISTORY');
                
                // Inject the call context/agenda for AI to follow
                const userName = userProfile?.first_name || 'sir';
                const contextMsg = `[System: PRE-CONNECTED CALL - Greeting already delivered. You just said: "${preConnectedGreetingText}"

The user has answered the phone and heard your greeting. Current time: ${getCurrentTimeString(userTimezone)}.

${callContext || ''}

CRITICAL INSTRUCTIONS:
1. You've already greeted them - do NOT repeat the greeting
2. Wait for their response, then continue with the agenda
3. Cover ALL agenda items naturally before ending
4. If they go off-topic, address briefly then redirect: "Now, back to..."
5. Use hang_up only after all agenda items are covered]`;
                
                injectSystemMessage(contextMsg, 'PRE_CONNECT_CONTEXT');
                
                // NOTE: Do NOT call createResponse here - we wait for user speech
                console.log("[OPENAI-SESSION] ✅ Pre-connected context injected - waiting for user response (NO response.create)");
                return;
              }
              
              // Standard flow: Send greeting based on call direction
              if (!greetingSent) {
                if (callDirection === 'inbound') {
                  sendInboundGreeting();
                } else if (!waitingForUserHello) {
                  // Only send outbound greeting if NOT waiting for user hello
                  sendOutboundGreeting();
                } else {
                  console.log(`[OPENAI-SESSION] Outbound call waiting for user hello (mode=${pendingGreetingMode}) - NOT sending greeting yet`);
                }
              }
              break;

            case "response.created":
              // Track that AI is generating a response
              currentResponseId = msg.response?.id || null;
              isAiSpeaking = true;
              responseStartTime = Date.now();
              if (!firstAudioTime) firstAudioTime = Date.now();
              console.log(`[RESPONSE-LIFECYCLE] CREATED id=${currentResponseId} trigger=${lastResponseTrigger} #${responseCreateCount}`);
              break;

            case "response.done":
              // AI finished speaking
              const responseDuration = responseStartTime > 0 ? Date.now() - responseStartTime : 0;
              console.log(`[RESPONSE-LIFECYCLE] DONE id=${currentResponseId} duration=${responseDuration}ms trigger=${lastResponseTrigger}`);
              isAiSpeaking = false;
              currentResponseId = null;
              currentResponseItemId = null;
              audioSamplesPlayed = 0;
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
                    audioSentDuringResponse = true;  // Track that audio was sent
                    sendElevenLabsTTS(sentence);
                  }
                }
              }
              break;
              
            // ElevenLabs text-to-speech: Flush remaining buffer on completion + LOG ASSISTANT MESSAGE
            case "response.text.done":
              if (ttsProvider === 'elevenlabs') {
                const fullText = msg.text || sentenceBuffer;
                
                // CRITICAL FIX: Save assistant message to database for ElevenLabs mode
                if (fullText) {
                  const latency = responseStartTime > 0 ? Date.now() - responseStartTime : undefined;
                  console.log(`[TRANSCRIPT-AI] 🤖 "${fullText.substring(0, 80)}..." (${latency}ms)`);
                  saveCallMessage('assistant', fullText, latency);
                }
                
                // Flush any remaining buffered text (e.g., text without sentence-ending punctuation)
                if (sentenceBuffer.trim()) {
                  console.log(`[ELEVENLABS] 📝 Flushing remaining: "${sentenceBuffer.substring(0, 40)}..."`);
                  audioSentDuringResponse = true;
                  sendElevenLabsTTS(sentenceBuffer.trim());
                  sentenceBuffer = '';
                } else if (!audioSentDuringResponse && msg.text) {
                  // SAFETY FALLBACK: Only send full text if NO audio was sent via streaming
                  // This handles edge cases where streaming didn't trigger (e.g., no sentence enders)
                  console.log(`[ELEVENLABS] ⚠️ No audio sent via streaming, sending full text as fallback`);
                  sendElevenLabsTTS(msg.text);
                }
                
                // Reset flag for next response
                audioSentDuringResponse = false;
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
              
              // === HELLO-TRIGGERED GREETING ===
              // If waiting for user hello, play cached greeting immediately
              if (waitingForUserHello) {
                console.log("[HELLO-TRIGGER] 🎤 VAD detected user speech - triggering greeting");
                triggerPendingGreeting('vad');
                // Don't treat this as a barge-in - let OpenAI continue listening
                break;
              }
              
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
              // Since we disabled auto-response (create_response: false), manually trigger response
              // Only if AI isn't currently speaking (prevents interrupting itself or double responses)
              if (!isAiSpeaking && !isSendingTtsAudio) {
                createResponse('USER_SPEECH_ENDED', 'VAD detected user finished speaking');
              } else {
                console.log("[OPENAI] Skipping response - AI is speaking or TTS in progress");
              }
              break;

            case "conversation.item.input_audio_transcription.completed":
              // === VERBATIM TRANSCRIPTION LOGGING ===
              // Log EXACTLY what OpenAI transcribed - no modifications
              const rawTranscript = msg.transcript || '';
              const trimmedTranscript = rawTranscript.trim();
              
              console.log(`[TRANSCRIPT-USER] 📢 VERBATIM: "${rawTranscript}"`);
              console.log(`[TRANSCRIPT-USER] 📊 Length: ${rawTranscript.length} chars, trimmed: "${trimmedTranscript}"`);
              
              // Track for verbatim web_search override
              lastUserTranscript = rawTranscript;
              
              // Save user message to conversation history (verbatim, no modifications)
              if (trimmedTranscript.length > 0) {
                saveConversationMessage('user', rawTranscript);
                console.log(`[TRANSCRIPT-USER] ✅ Saved to conversation history`);
              } else {
                console.log(`[TRANSCRIPT-USER] ⚠️ Empty transcript - not saving`);
              }
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
                  injectSystemMessage(
                    `[System: IMPORTANT CORRECTION NEEDED. You just said something inaccurate. ${validation.correction} Please briefly acknowledge this correction to the user.]`,
                    'VALIDATION_CORRECTION'
                  );
                  createResponse('VALIDATION_CORRECTION', validation.correction);
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

    // === CALL SESSION MANAGEMENT ===
    async function createCallSession(callSid: string, fromNumber?: string, toNumber?: string) {
      if (!userId) return;
      
      try {
        const { data, error } = await supabase.from('call_sessions').insert({
          user_id: userId,
          call_sid: callSid,
          stream_sid: streamSid,
          direction: callDirection,
          from_number: fromNumber || null,
          to_number: toNumber || null,
          call_context: callContext,
          tts_provider: ttsProvider,
          started_at: new Date().toISOString()
        }).select('id').single();
        
        if (data) {
          callSessionId = data.id;
          console.log(`[CALL-TRACK] ✅ Created call session: ${callSessionId}`);
        } else if (error) {
          console.warn('[CALL-TRACK] Failed to create call session:', error);
        }
      } catch (error) {
        console.warn('[CALL-TRACK] Error creating call session:', error);
      }
    }

    async function closeCallSession() {
      if (!callSessionId) return;
      
      try {
        const durationSeconds = Math.floor((Date.now() - callStartTime) / 1000);
        await supabase.from('call_sessions').update({
          ended_at: new Date().toISOString(),
          duration_seconds: durationSeconds,
          first_audio_at: firstAudioTime ? new Date(firstAudioTime).toISOString() : null,
          greeting_latency_ms: greetingLatencyMs
        }).eq('id', callSessionId);
        console.log(`[CALL-TRACK] ✅ Closed call session: ${durationSeconds}s duration`);
      } catch (error) {
        console.warn('[CALL-TRACK] Error closing call session:', error);
      }
    }

    // === UNIFIED MESSAGE SAVING ===
    async function saveCallMessage(
      role: string, 
      content: string, 
      latencyMs?: number,
      toolInfo?: { name: string; input?: any; output?: any }
    ) {
      if (!userId || !content) return;
      
      messageIndex++;
      const startTime = new Date().toISOString();
      
      try {
        // Save to call_messages for full call review
        if (callSessionId) {
          await supabase.from('call_messages').insert({
            call_session_id: callSessionId,
            user_id: userId,
            role: role,
            content: content,
            message_index: messageIndex,
            started_at: startTime,
            latency_ms: latencyMs,
            tool_name: toolInfo?.name || null,
            tool_input: toolInfo?.input || null,
            tool_output: toolInfo?.output || null,
            word_count: content.split(/\s+/).length
          });
        }
        
        // Also save to conversation_messages for RAG continuity
        if (threadId && role !== 'tool') {
          await supabase.from('conversation_messages').insert({
            user_id: userId,
            thread_id: threadId,
            role: role,
            content: content,
            voice_session_id: streamSid,
            audio_transcript: content,
            metadata: { latency_ms: latencyMs, call_session_id: callSessionId }
          });
        }
        
        console.log(`[CALL-TRACK] 💬 ${role.toUpperCase()} [#${messageIndex}] ${latencyMs ? `(${latencyMs}ms)` : ''}`);
      } catch (error) {
        console.warn('[CALL-TRACK] Failed to save message:', error);
      }
    }

    async function saveConversationMessage(role: string, content: string) {
      // Delegate to unified saveCallMessage
      const latency = role === 'assistant' && responseStartTime > 0 
        ? Date.now() - responseStartTime 
        : undefined;
      await saveCallMessage(role, content, latency);
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
      
      console.log(`[GREETING] 🎤 Triggering INBOUND greeting for ${userName} with "${greeting}" (timezone: ${userTimezone})`);
      
      // OPEN-ENDED greeting - don't assume they want schedule info
      const greetingContext = `[System: This is an inbound phone call from ${userName}. Current time is ${currentTime}. Greet them with "${greeting}, ${userName}. What can I help you with?" Keep it brief and WAIT for them to tell you what they need. Do NOT assume they want schedule information - they might ask about anything. You can help with general questions, tasks, or whatever they need.]`;
      
      injectSystemMessage(greetingContext, 'INBOUND_GREETING_CONTEXT');
      createResponse('INBOUND_GREETING', `inbound call from ${userName}`);
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
      
      console.log(`[GREETING] Outbound call for ${userName}, scheduled: ${isScheduledCall}`);
      console.log(`[GREETING] Call context preview: ${callContext?.substring(0, 150)}...`);
      
      if (isScheduledCall && callContext) {
        // SCHEDULED CALL: Use the context to drive the entire conversation
        const scheduledContext = `[System: This is a SCHEDULED outbound call to ${userName}. Current time: ${getCurrentTimeString(userTimezone)}.

${callContext}

CRITICAL INSTRUCTIONS FOR THIS CALL:
1. GREETING: Start with "${greeting}, ${userName}!" followed by a brief intro matching the call type above
2. AGENDA-DRIVEN: You MUST cover ALL items listed in the agenda before ending the call
3. PIVOT HANDLING: If the user goes off-topic, address their question briefly, then say "Now, back to..." or "One more thing I wanted to cover..."
4. COMPLETION CHECK: Before using hang_up, mentally verify you've addressed every agenda item
5. NATURAL FLOW: Cover items conversationally, not as a checklist - weave them into dialogue
6. END SIGNAL: Only end the call when ALL agenda items are addressed OR the user explicitly wants to end early

Start speaking IMMEDIATELY with your greeting - the user has just answered the phone!]`;
        
        injectSystemMessage(scheduledContext, 'OUTBOUND_SCHEDULED_CONTEXT');
        createResponse('OUTBOUND_SCHEDULED_GREETING', `scheduled call to ${userName}`);
        
      } else {
        // MANUAL OUTBOUND CALL: Wait for user response first
        const contextInfo = callContext || 'your daily briefing';
        const manualContext = `[System: This is an outbound call YOU initiated to ${userName} for ${contextInfo}. Wait silently for them to answer with "hello" or similar. When they do, briefly introduce yourself as Iris and explain why you're calling in one sentence. You have their schedule loaded.]`;
        
        injectSystemMessage(manualContext, 'OUTBOUND_MANUAL_CONTEXT');
        // Manual calls: Wait for user audio before responding (NO createResponse here)
        console.log(`[GREETING] Manual outbound - waiting for user audio (NO response.create)`);
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

      // Start filler timer for natural conversation during tool calls
      if (fillerManager) {
        fillerManager.startTool(msg.name);
      }

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

        // Cancel pending fillers since we have the result
        if (fillerManager) {
          fillerManager.endTool();
        }

        console.log(`[BRIDGE] Function result:`, result);
        
        // Log tool call to call_messages for review
        await saveCallMessage('tool', `Called ${functionName}`, undefined, {
          name: functionName,
          input: args,
          output: result
        });
        
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
        console.log(`[FUNCTION-OUTPUT] Sent result for ${functionName}`);

        // Trigger response generation using wrapper
        createResponse('FUNCTION_RESULT', functionName);

      } catch (error) {
        // Cancel pending fillers on error
        if (fillerManager) {
          fillerManager.endTool();
        }
        
        console.error("[BRIDGE] Function call error:", error);
        
        openaiWs.send(JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: msg.call_id,
            output: JSON.stringify({ success: false, error: String(error) })
          }
        }));
        createResponse('FUNCTION_RESULT', `${functionName} (error)`);
      }
    }

    return response;
  }

  // Non-WebSocket request
  return new Response("Twilio-OpenAI Realtime Bridge v7 - Pre-Connect Architecture with AgendaManager", { status: 200 });
});
