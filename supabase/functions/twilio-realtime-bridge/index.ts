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

// Load user profile - MINIMAL version for fast-start
async function loadUserProfileMinimal(supabase: any, userId: string): Promise<any> {
  try {
    const { data } = await supabase
      .from('profiles')
      .select('first_name, full_name')
      .eq('user_id', userId)
      .maybeSingle();
    return data || {};
  } catch (error) {
    console.warn('[BRIDGE] Failed to load minimal profile:', error);
    return {};
  }
}

// Load TTS provider settings - fast query
async function loadTTSSettings(supabase: any, userId: string): Promise<{ ttsProvider: 'openai' | 'elevenlabs'; voiceId: string; timezone: string }> {
  try {
    const { data } = await supabase
      .from('user_scheduling_prefs')
      .select('tts_provider, elevenlabs_voice_id, timezone')
      .eq('user_id', userId)
      .maybeSingle();
    return {
      ttsProvider: (data?.tts_provider as 'openai' | 'elevenlabs') || 'openai',
      voiceId: data?.elevenlabs_voice_id || 'EXAVITQu4vr4xnSDxMaL',
      timezone: data?.timezone || 'America/New_York'
    };
  } catch (error) {
    console.warn('[BRIDGE] Failed to load TTS settings:', error);
    return { ttsProvider: 'openai', voiceId: 'EXAVITQu4vr4xnSDxMaL', timezone: 'America/New_York' };
  }
}

// Load RAG context - DEFERRED (runs after greeting)
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

// FAST-START INSTRUCTIONS - Minimal for immediate greeting
function getFastStartInstructions(userName: string, timezone: string, ttsProvider: string): string {
  const currentTime = getCurrentTimeString(timezone);
  
  return `You are Iris, a warm and efficient executive assistant on a phone call.

CURRENT TIME: ${currentTime}
TIMEZONE: ${timezone}
USER: ${userName}

CRITICAL PHONE RULES:
1. START IMMEDIATELY with a SHORT greeting: "${getTimeBasedGreeting(timezone)}, ${userName}." - END WITH A PERIOD.
2. Then ask briefly: "What can I help you with?" - SHORT sentences get spoken faster.
3. Keep responses conversational and CONCISE - this is a phone call.
4. When the user says goodbye, use the hang_up function.

HONESTY RULE: Never fabricate data. If uncertain, say so.

Available functions: get_tasks, get_today_tasks, create_task, update_task, reschedule_task, schedule_task, unschedule_task, web_search, send_email, send_slack_message, create_calendar_event, hang_up`;
}

// ENRICHED INSTRUCTIONS - Full context loaded after greeting
function getEnrichedInstructions(userName: string, timezone: string, ragContext: string, coreInstructions?: string, realtimeExtensions?: string, customAIInstructions?: string): string {
  const currentTime = getCurrentTimeString(timezone);
  
  const baseInstructions = coreInstructions || `You are Iris, a knowledgeable and proactive executive assistant.

HONESTY - ABSOLUTE RULE (NEVER VIOLATE):
- NEVER fabricate, invent, or assume factual data (scores, weather, news, prices, dates, statistics)
- If a web_search fails or returns no results, say "I couldn't find that information"
- If uncertain about real-world facts, explicitly state uncertainty
- ALWAYS report exactly what web_search returns - do not embellish or add information

PERSONALITY:
- Warm, efficient, and naturally conversational
- Action-first: Execute tasks immediately with brief confirmations
- Proactive: Offer helpful follow-up suggestions after completing tasks
- Time-aware: Use appropriate greetings based on time of day

TOOL USAGE - CRITICAL:
- ALWAYS use tools to get current data (get_tasks, get_today_tasks, web_search)
- Never rely on pre-loaded context for dynamic information
- For weather, sports, news, stocks, current events - use web_search immediately`;

  let instructions = `${baseInstructions}

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

3. NATURAL VARIATION:
   - Never repeat the same phrase twice in a row
   - Match user energy - casual user = casual responses
   - Keep fillers SHORT (2-4 words)

4. INSTANT ANSWERS = NO FILLER:
   - If you can answer immediately, skip the acknowledgment
   - Only use fillers when actual tool calls are needed

NEVER: Stay silent while processing, sound robotic, or over-explain what you're doing`;

  // Add voice-specific extensions if configured
  if (realtimeExtensions) {
    instructions += `\n\n${realtimeExtensions}`;
  }
  
  // Add scheduling philosophy if configured
  if (customAIInstructions) {
    instructions += `\n\nScheduling Philosophy:\n${customAIInstructions}`;
  }
  
  return instructions;
}

// Fallback tool definitions
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
          message: { type: "string", description: "Message content" },
          channel: { type: "string", description: "Slack channel or DM" }
        },
        required: ["message"]
      }
    },
    {
      type: "function",
      name: "send_email",
      description: "Send an email via Microsoft Graph.",
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
  console.log(`[BRIDGE v7] Request: ${req.method} ${url.pathname}`);

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
    let pendingTextBuffer: string = '';
    let isProcessingElevenLabsTTS = false;
    
    // === SENTENCE STREAMING FOR ELEVENLABS (IMPROVED) ===
    let sentenceBuffer: string = '';
    const SENTENCE_ENDERS = /[.!?]\s*$/;
    const MAX_BUFFER_CHARS = 140;  // Force flush if buffer gets too long
    const MAX_BUFFER_TIME_MS = 700;  // Force flush after 700ms
    let lastSentenceFlushTime = 0;
    
    // === SPEECH EVENT DEBOUNCE ===
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
    const openaiEventCounts: Record<string, number> = {};
    
    // === LATENCY TELEMETRY ===
    let t0_twilioStart = 0;
    let t1_openaiOpen = 0;
    let t2_sessionCreated = 0;
    let t3_sessionUpdated = 0;
    let t4_firstTextDelta = 0;
    let t5_firstAudioOut = 0;
    let latencyLogged = false;
    
    // === TWO-PHASE CONTEXT LOADING ===
    let enrichmentComplete = false;
    
    // KEEP-ALIVE: Prevent idle timeout
    let keepAliveInterval: number | null = null;
    
    // ElevenLabs TTS function
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
        
        console.log(`[ELEVENLABS] ✅ Generated ${data.bytes} bytes in ${latency}ms`);
        
        // Track first audio out for latency telemetry
        if (t5_firstAudioOut === 0) {
          t5_firstAudioOut = Date.now();
          logLatencySummary();
        }
        
        // Send the μ-law audio directly to Twilio
        if (data.audio && streamSid && twilioWs.readyState === WebSocket.OPEN) {
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
    
    // Latency summary logging
    function logLatencySummary() {
      if (latencyLogged) return;
      latencyLogged = true;
      
      const startToOpen = t1_openaiOpen - t0_twilioStart;
      const openToCreated = t2_sessionCreated - t1_openaiOpen;
      const createdToUpdated = t3_sessionUpdated - t2_sessionCreated;
      const updatedToText = t4_firstTextDelta > 0 ? t4_firstTextDelta - t3_sessionUpdated : 0;
      const textToAudio = t5_firstAudioOut > 0 && t4_firstTextDelta > 0 ? t5_firstAudioOut - t4_firstTextDelta : 0;
      const totalToFirstAudio = t5_firstAudioOut - t0_twilioStart;
      
      console.log(`[LATENCY] === TIMING BREAKDOWN ===`);
      console.log(`[LATENCY] twilio_start → openai_open: ${startToOpen}ms`);
      console.log(`[LATENCY] openai_open → session.created: ${openToCreated}ms`);
      console.log(`[LATENCY] session.created → session.updated: ${createdToUpdated}ms`);
      console.log(`[LATENCY] session.updated → first_text_delta: ${updatedToText}ms`);
      console.log(`[LATENCY] first_text_delta → first_audio_out: ${textToAudio}ms`);
      console.log(`[LATENCY] TOTAL (twilio_start → first_audio_out): ${totalToFirstAudio}ms`);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    twilioWs.onopen = () => {
      console.log("[TWILIO-WS] ✅ WebSocket OPEN - ready to receive stream");
      
      // Keep-alive ping every 30 seconds
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
            t0_twilioStart = Date.now();
            streamSid = data.start.streamSid;
            const customParams = data.start.customParameters || {};
            userId = customParams.userId || null;
            userPhone = customParams.phone || null;
            callContext = customParams.context || null;
            callDirection = customParams.direction || 'inbound';
            userTimezone = customParams.timezone || 'America/New_York';
            
            console.log(`[TWILIO-STREAM] ✅ Stream START received - streamSid: ${streamSid}`);
            console.log(`[TWILIO-STREAM] Call direction: ${callDirection}, userId: ${userId}`);
            
            // FAST-START: Connect to OpenAI immediately with minimal data
            connectToOpenAIFastStart();
            break;

          case "media":
            twilioMediaFramesIn++;
            if (!firstInboundLogged) {
              console.log(`[AUDIO-IN] 📥 First Twilio inbound frame received (streamSid: ${streamSid})`);
              firstInboundLogged = true;
            }
            
            if (openaiWs?.readyState === WebSocket.OPEN) {
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
      
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
      }
      openaiWs?.close();
    };

    twilioWs.onerror = (err) => {
      console.error("[TWILIO] WebSocket error:", err);
    };

    // PHASE 1: FAST-START - Open OpenAI immediately with minimal data
    async function connectToOpenAIFastStart() {
      console.log("[OPENAI] FAST-START: Connecting immediately...");

      // Only fetch minimal data needed for greeting - in parallel
      let fastProfile: any = {};
      let fastTTS = { ttsProvider: 'openai' as const, voiceId: 'EXAVITQu4vr4xnSDxMaL', timezone: 'America/New_York' };
      
      if (userId) {
        const startFetch = Date.now();
        [fastProfile, fastTTS] = await Promise.all([
          loadUserProfileMinimal(supabase, userId),
          loadTTSSettings(supabase, userId)
        ]);
        console.log(`[OPENAI] Fast fetch completed in ${Date.now() - startFetch}ms`);
        
        userProfile = fastProfile;
        ttsProvider = fastTTS.ttsProvider;
        elevenlabsVoiceId = fastTTS.voiceId;
        userTimezone = fastTTS.timezone;
        
        console.log(`[BRIDGE] TTS Provider: ${ttsProvider}, Voice: ${elevenlabsVoiceId}`);
      }

      // Open OpenAI WebSocket IMMEDIATELY - don't wait for RAG/thread
      openaiWs = new WebSocket(
        "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17",
        ["realtime", `openai-insecure-api-key.${OPENAI_API_KEY}`, "openai-beta.realtime-v1"]
      );

      openaiWs.onopen = () => {
        t1_openaiOpen = Date.now();
        console.log(`[OPENAI] ✅ WebSocket OPEN (${t1_openaiOpen - t0_twilioStart}ms since Twilio start)`);
      };

      openaiWs.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          
          // Track event counts
          openaiEventCounts[msg.type] = (openaiEventCounts[msg.type] || 0) + 1;

          switch (msg.type) {
            case "session.created":
              t2_sessionCreated = Date.now();
              console.log(`[OPENAI-SESSION] Session created (${t2_sessionCreated - t0_twilioStart}ms since start)`);
              
              // FAST-START: Configure with minimal instructions for immediate greeting
              const userName = userProfile?.first_name || userProfile?.full_name?.split(' ')[0] || 'sir';
              const fastInstructions = getFastStartInstructions(userName, userTimezone, ttsProvider);
              const modalities = ttsProvider === 'elevenlabs' ? ["text"] : ["text", "audio"];
              
              console.log(`[OPENAI-SESSION] Configuring FAST-START session (modalities: ${JSON.stringify(modalities)})`);
              
              openaiWs!.send(JSON.stringify({
                type: "session.update",
                session: {
                  modalities: modalities,
                  instructions: fastInstructions,
                  voice: "alloy",
                  input_audio_format: "pcm16",
                  output_audio_format: "pcm16",
                  input_audio_transcription: { model: "whisper-1" },
                  turn_detection: {
                    type: "server_vad",
                    threshold: 0.3,
                    prefix_padding_ms: 400,
                    silence_duration_ms: 600,
                  },
                  tools: getInlineToolDefinitions(),
                  tool_choice: "auto"
                },
              }));
              
              // PHASE 2: Start enrichment in background (after session is configured)
              startEnrichmentPhase();
              break;

            case "session.updated":
              t3_sessionUpdated = Date.now();
              console.log(`[OPENAI-SESSION] ✅ Session CONFIGURED (${t3_sessionUpdated - t0_twilioStart}ms since start)`);
              sessionConfigured = true;
              
              // Send greeting IMMEDIATELY
              if (!greetingSent) {
                if (callDirection === 'inbound') {
                  sendInboundGreeting();
                } else {
                  sendOutboundGreeting();
                }
              }
              break;

            case "response.created":
              currentResponseId = msg.response?.id || null;
              isAiSpeaking = true;
              console.log("[OPENAI] Response started:", currentResponseId);
              break;

            case "response.done":
              isAiSpeaking = false;
              currentResponseId = null;
              currentResponseItemId = null;
              audioSamplesPlayed = 0;
              console.log("[OPENAI] Response completed");
              break;

            case "response.output_item.added":
              if (msg.item?.type === "message") {
                currentResponseItemId = msg.item.id;
                audioSamplesPlayed = 0;
              }
              break;

            case "response.audio.delta":
              if (ttsProvider === 'elevenlabs') break;
              
              openaiAudioDeltaCount++;
              
              // Track first audio out for latency
              if (t5_firstAudioOut === 0) {
                t5_firstAudioOut = Date.now();
                logLatencySummary();
              }
              
              if (!firstDeltaLogged) {
                console.log(`[AUDIO-DELTA] 🔊 First audio delta from OpenAI`);
                firstDeltaLogged = true;
              }
              
              if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
                const pcm24k = base64ToInt16(msg.delta);
                const pcm8k = downsample24to8(pcm24k);
                const mulaw = encodeMulaw(pcm8k);
                const mulawBase64 = btoa(String.fromCharCode(...mulaw));

                audioSamplesPlayed += pcm24k.length;
                twilioMediaFramesOut++;
                
                if (!firstOutboundLogged) {
                  console.log(`[AUDIO-OUT] ⬅️ First audio frame sent to Twilio`);
                  firstOutboundLogged = true;
                }

                twilioWs.send(JSON.stringify({
                  event: "media",
                  streamSid: streamSid,
                  media: { payload: mulawBase64 },
                }));
              }
              break;

            // ElevenLabs sentence streaming with improved buffer management
            case "response.text.delta":
              // Track first text delta for latency
              if (t4_firstTextDelta === 0) {
                t4_firstTextDelta = Date.now();
                console.log(`[LATENCY] First text delta at ${t4_firstTextDelta - t0_twilioStart}ms since start`);
              }
              
              if (ttsProvider === 'elevenlabs' && msg.delta) {
                sentenceBuffer += msg.delta;
                const now = Date.now();
                
                // Check for complete sentence
                if (SENTENCE_ENDERS.test(sentenceBuffer)) {
                  const sentence = sentenceBuffer.trim();
                  sentenceBuffer = '';
                  lastSentenceFlushTime = now;
                  
                  if (sentence.length > 5) {
                    console.log(`[ELEVENLABS] 📝 Sentence: "${sentence.substring(0, 50)}..."`);
                    sendElevenLabsTTS(sentence);
                  }
                }
                // Force flush if buffer is too long (no sentence enders)
                else if (sentenceBuffer.length >= MAX_BUFFER_CHARS) {
                  // Find last comma or space for natural break
                  const lastBreak = Math.max(
                    sentenceBuffer.lastIndexOf(', '),
                    sentenceBuffer.lastIndexOf(' ', MAX_BUFFER_CHARS - 20)
                  );
                  
                  if (lastBreak > 20) {
                    const chunk = sentenceBuffer.substring(0, lastBreak + 1).trim();
                    sentenceBuffer = sentenceBuffer.substring(lastBreak + 1);
                    lastSentenceFlushTime = now;
                    
                    if (chunk.length > 10) {
                      console.log(`[ELEVENLABS] 📝 Force-flush chunk: "${chunk.substring(0, 50)}..."`);
                      sendElevenLabsTTS(chunk);
                    }
                  }
                }
                // Time-based flush for long pauses without punctuation
                else if (now - lastSentenceFlushTime > MAX_BUFFER_TIME_MS && sentenceBuffer.length > 40) {
                  const chunk = sentenceBuffer.trim();
                  sentenceBuffer = '';
                  lastSentenceFlushTime = now;
                  
                  console.log(`[ELEVENLABS] 📝 Time-flush: "${chunk.substring(0, 50)}..."`);
                  sendElevenLabsTTS(chunk);
                }
              }
              break;
              
            case "response.text.done":
              if (ttsProvider === 'elevenlabs') {
                if (sentenceBuffer.trim()) {
                  console.log(`[ELEVENLABS] 📝 Final flush: "${sentenceBuffer.substring(0, 50)}..."`);
                  sendElevenLabsTTS(sentenceBuffer.trim());
                  sentenceBuffer = '';
                } else if (msg.text && !sentenceBuffer) {
                  console.log(`[ELEVENLABS] Fallback complete text`);
                  sendElevenLabsTTS(msg.text);
                }
              }
              break;

            case "input_audio_buffer.speech_started":
              const now = Date.now();
              if (now - lastSpeechStartTime < SPEECH_DEBOUNCE_MS) {
                console.log("[OPENAI] Debounced rapid speech event");
                break;
              }
              lastSpeechStartTime = now;
              
              console.log("[OPENAI] User started speaking");
              
              // ElevenLabs mode: No OpenAI audio to truncate
              if (ttsProvider === 'elevenlabs') {
                console.log("[OPENAI] BARGE-IN: ElevenLabs mode - clearing Twilio buffer only");
                if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
                  twilioWs.send(JSON.stringify({
                    event: "clear",
                    streamSid: streamSid
                  }));
                }
                sentenceBuffer = '';
                isAiSpeaking = false;
                break;
              }
              
              // OpenAI audio mode: Use truncation
              if (isAiSpeaking && openaiWs?.readyState === WebSocket.OPEN) {
                if (currentResponseItemId) {
                  const audioEndMs = Math.floor(audioSamplesPlayed / 24);
                  console.log(`[OPENAI] BARGE-IN: Truncating at ${audioSamplesPlayed} samples (${audioEndMs}ms)`);
                  
                  openaiWs.send(JSON.stringify({
                    type: "conversation.item.truncate",
                    item_id: currentResponseItemId,
                    content_index: 0,
                    audio_end_ms: audioEndMs
                  }));
                } else {
                  console.log("[OPENAI] BARGE-IN: Cancelling (no item ID)");
                  openaiWs.send(JSON.stringify({ type: "response.cancel" }));
                }
                
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
              lastUserTranscript = msg.transcript;
              saveConversationMessage('user', msg.transcript);
              break;

            case "response.audio_transcript.done":
              console.log(`[TRANSCRIPT-AI] 🤖 "${msg.transcript}"`);
              saveConversationMessage('assistant', msg.transcript);
              
              // POST-VALIDATION
              if (lastToolOutput?.extractedFacts) {
                const validation = validateVoiceResponse(msg.transcript, lastToolOutput);
                if (!validation.valid && validation.correction) {
                  console.log('[BRIDGE] ⚠️ Discrepancy detected, injecting correction');
                  
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
                }
                lastToolOutput = null;
              }
              break;

            case "response.function_call_arguments.done":
              console.log(`[OPENAI] Function call: ${msg.name}`, msg.arguments);
              handleFunctionCall(msg);
              break;

            case "error":
              console.error("[OPENAI] ❌ ERROR:", JSON.stringify(msg.error, null, 2));
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
    
    // PHASE 2: ENRICHMENT - Load RAG context and update session in background
    async function startEnrichmentPhase() {
      if (!userId || enrichmentComplete) return;
      
      console.log("[ENRICHMENT] Starting background enrichment...");
      const enrichStart = Date.now();
      
      try {
        // Load full context in parallel
        const [ragContext, fullPrefs, thread] = await Promise.all([
          loadRAGContext(supabase, userId),
          supabase
            .from('user_scheduling_prefs')
            .select('core_instructions, realtime_extensions, config')
            .eq('user_id', userId)
            .maybeSingle(),
          // Thread management
          (async () => {
            const { data: existingThread } = await supabase
              .from('ai_threads')
              .select('id, openai_thread_id')
              .eq('user_id', userId)
              .order('updated_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (existingThread) {
              return existingThread.id;
            } else {
              const { data: newThread } = await supabase
                .from('ai_threads')
                .insert({ 
                  user_id: userId, 
                  openai_thread_id: `phone_${Date.now()}` 
                })
                .select('id')
                .single();
              return newThread?.id || null;
            }
          })()
        ]);
        
        threadId = thread;
        
        console.log(`[ENRICHMENT] Background fetch completed in ${Date.now() - enrichStart}ms`);
        
        // Build enriched instructions
        const userName = userProfile?.first_name || userProfile?.full_name?.split(' ')[0] || 'sir';
        const enrichedInstructions = getEnrichedInstructions(
          userName,
          userTimezone,
          ragContext,
          fullPrefs.data?.core_instructions,
          fullPrefs.data?.realtime_extensions,
          fullPrefs.data?.config?.customAIInstructions
        );
        
        // Update session with enriched context (if still connected)
        if (openaiWs?.readyState === WebSocket.OPEN) {
          const modalities = ttsProvider === 'elevenlabs' ? ["text"] : ["text", "audio"];
          
          openaiWs.send(JSON.stringify({
            type: "session.update",
            session: {
              modalities: modalities,
              instructions: enrichedInstructions,
            },
          }));
          
          console.log(`[ENRICHMENT] ✅ Session updated with full context`);
        }
        
        enrichmentComplete = true;
        
      } catch (error) {
        console.warn('[ENRICHMENT] Error during enrichment:', error);
        enrichmentComplete = true; // Mark complete to avoid retries
      }
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
      } catch (error) {
        console.warn('[BRIDGE] Failed to save conversation message:', error);
      }
    }

    function sendInboundGreeting() {
      if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN || greetingSent) return;
      
      greetingSent = true;
      lastSentenceFlushTime = Date.now(); // Initialize for ElevenLabs timing
      
      const greeting = getTimeBasedGreeting(userTimezone);
      const userName = userProfile?.first_name || 'sir';
      
      console.log(`[GREETING] 🎤 Triggering inbound greeting for ${userName}`);
      
      // SHORT greeting prompt for faster first audio
      openaiWs.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{
            type: "input_text",
            text: `[System: Inbound call from ${userName}. Say EXACTLY: "${greeting}, ${userName}." Then wait for their response. Keep it SHORT.]`
          }]
        }
      }));

      const greetingModalities = ttsProvider === 'elevenlabs' ? ["text"] : ["text", "audio"];
      openaiWs.send(JSON.stringify({ 
        type: "response.create",
        response: { modalities: greetingModalities }
      }));
      
      console.log(`[GREETING] ✅ response.create sent (ttsProvider: ${ttsProvider})`);
    }

    function sendOutboundGreeting() {
      if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN || greetingSent) return;
      
      greetingSent = true;
      lastSentenceFlushTime = Date.now();
      
      const greeting = getTimeBasedGreeting(userTimezone);
      const userName = userProfile?.first_name || 'sir';
      
      const isScheduledCall = callContext && (
        callContext.includes('[CALL AGENDA]') || 
        callContext.includes('CALL TYPE:') ||
        callContext.includes('Morning Stand-up') ||
        callContext.includes('Midday Check-in') ||
        callContext.includes('End of Day Wrap-up')
      );
      
      console.log(`[BRIDGE] Outbound call for ${userName}, scheduled: ${isScheduledCall}`);
      
      if (isScheduledCall && callContext) {
        openaiWs.send(JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [{
              type: "input_text",
              text: `[System: SCHEDULED outbound call to ${userName}. Current time: ${getCurrentTimeString(userTimezone)}.

${callContext}

Start with: "${greeting}, ${userName}." (SHORT sentence - ends with period). Then briefly explain the call purpose. Cover all agenda items before hanging up.]`
            }]
          }
        }));
        
        const outboundModalities = ttsProvider === 'elevenlabs' ? ["text"] : ["text", "audio"];
        openaiWs.send(JSON.stringify({ 
          type: "response.create",
          response: { modalities: outboundModalities }
        }));
        console.log(`[GREETING] ✅ SCHEDULED CALL triggered`);
        
      } else {
        // Manual outbound: Wait for user to speak first
        openaiWs.send(JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [{
              type: "input_text",
              text: `[System: Manual outbound call to ${userName}. Wait for them to say "hello" first, then introduce yourself briefly as Iris.]`
            }]
          }
        }));
      }
    }

    function validateVoiceResponse(
      aiResponse: string, 
      toolOutput: { toolName: string; extractedFacts?: any }
    ): { valid: boolean; correction?: string } {
      if (!toolOutput.extractedFacts) return { valid: true };
      
      const facts = toolOutput.extractedFacts;
      
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
        
        // Verbatim web_search override
        if (functionName === 'web_search' && lastUserTranscript) {
          console.log(`[BRIDGE] web_search override: "${lastUserTranscript}"`);
          args = { ...args, query: lastUserTranscript };
        }
        
        console.log(`[BRIDGE] Executing: ${functionName}`, args);

        const result = await executeTool(functionName, args, userId, {
          timezone: userTimezone,
          userProfile,
          twilioWs,
          streamSid
        });

        console.log(`[BRIDGE] Result:`, result);
        
        if (result.extractedFacts) {
          lastToolOutput = { toolName: functionName, extractedFacts: result.extractedFacts };
        }

        openaiWs.send(JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: msg.call_id,
            output: JSON.stringify(result)
          }
        }));

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
  return new Response("Twilio-OpenAI Realtime Bridge v7 - Two-Phase Fast-Start", { status: 200 });
});
