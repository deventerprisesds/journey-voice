import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Import from shared modules
import { GLOBAL_VERSION, FUNCTION_IDS, corsHeaders, VOICE_CONFIG, FILLER_CONFIG, SENTENCE_ENDERS } from "../_shared/config.ts";
import { decodeMulaw, encodeMulaw, upsample8to24, downsample24to8, int16ToBase64, base64ToInt16, calculateRMSAmplitude, chunkMulawForTwilio } from "../_shared/audio-codec.ts";
import { getToolDefinitions } from "../_shared/tool-definitions.ts";
import { DEFAULT_IRIS_PERSONA, PHONE_CONVERSATION_STYLE, getTimeBasedGreeting, getCurrentTimeString, generateGreetingForCallType, loadUserProfile, loadRAGContext, loadUserInstructions } from "../_shared/persona.ts";
import { PreConnectSession, storePreConnectSession, getPreConnectSession } from "../_shared/session-manager.ts";
import { SharedAgendaManager, AgendaManager } from "../_shared/agenda-wrapper.ts";

// Version derived from centralized config
const BRIDGE_VERSION = `${GLOBAL_VERSION}-${FUNCTION_IDS.BRIDGE}`;

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");

// Error logging helper - persists errors to error_log for unified debugging
async function logError(
  supabase: any,
  errorType: string,
  errorMessage: string,
  context: Record<string, any> = {}
): Promise<void> {
  try {
    await supabase.from('error_log').insert({
      source: 'edge_function',
      component: 'twilio-realtime-bridge',
      session_id: context.sessionId || null,
      user_id: context.userId || null,
      error_type: errorType,
      error_message: errorMessage,
      context: {
        version: BRIDGE_VERSION,
        stage: context.stage,
        stack: context.stack,
        ...context
      }
    });
    console.log(`[ERROR_LOG] ✅ ${errorType}: ${errorMessage.substring(0, 50)}...`);
  } catch (e) {
    console.error('[ERROR_LOG] Failed to persist error:', e, { errorType, errorMessage });
  }
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
    
    if (context.twilioWs) {
      setTimeout(() => {
        if (context.twilioWs && context.twilioWs.readyState === WebSocket.OPEN) {
          context.twilioWs.close();
        }
      }, VOICE_CONFIG.FAREWELL_DELAY_MS);
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

// Smart Filler Manager - inserts natural fillers during long tool calls
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
    short: 1500,
    medium: 3500,
    long: 6000
  };

  constructor(sendFiller: (text: string) => void) {
    this.sendFiller = sendFiller;
  }

  startTool(toolName: string) {
    this.toolStartTime = Date.now();
    console.log(`[FILLER] Starting timer for tool: ${toolName}`);

    this.fillerTimeouts.push(
      setTimeout(() => this.insertFiller('short'), this.DELAYS.short) as unknown as number,
      setTimeout(() => this.insertFiller('medium'), this.DELAYS.medium) as unknown as number,
      setTimeout(() => this.insertFiller('long'), this.DELAYS.long) as unknown as number
    );
  }

  endTool() {
    this.fillerTimeouts.forEach(clearTimeout);
    this.fillerTimeouts = [];
    const elapsed = Date.now() - this.toolStartTime;
    console.log(`[FILLER] Tool completed in ${elapsed}ms`);
  }

  private insertFiller(tier: 'short' | 'medium' | 'long') {
    const phrases = this.FILLERS[tier];
    let phrase = phrases[Math.floor(Math.random() * phrases.length)];
    while (phrase === this.lastFillerUsed && phrases.length > 1) {
      phrase = phrases[Math.floor(Math.random() * phrases.length)];
    }
    this.lastFillerUsed = phrase;
    console.log(`[FILLER] Inserting ${tier} filler: "${phrase}"`);
    this.sendFiller(phrase);
  }
}

// Handle pre-connect mode - establish session before call
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

  // Load ALL context in parallel
  const [profile, ttsPrefs, ragContext, defaultAssistantResult] = await Promise.all([
    loadUserProfile(supabase, userId),
    supabase
      .from('user_scheduling_prefs')
      .select('tts_provider, elevenlabs_voice_id, openai_voice, phone_call_mode')
      .eq('user_id', userId)
      .maybeSingle(),
    loadRAGContext(SUPABASE_URL, SUPABASE_SERVICE_KEY, userId),
    supabase
      .from('assistants')
      .select('id')
      .eq('user_id', userId)
      .eq('is_default', true)
      .maybeSingle()
  ]);

  const ttsProvider = (ttsPrefs.data?.tts_provider as 'openai' | 'elevenlabs') || 'elevenlabs';
  const voiceId = ttsPrefs.data?.elevenlabs_voice_id || 'EXAVITQu4vr4xnSDxMaL';
  const openaiVoice = ttsPrefs.data?.openai_voice || 'alloy';
  const phoneCallMode = ttsPrefs.data?.phone_call_mode || 'media_streams';
  
  const assistantId = defaultAssistantResult.data?.id || null;
  
  // UNIFIED THREAD LOOKUP
  let threadId: string | null = null;
  
  if (assistantId) {
    const { data: existingThread } = await supabase
      .from('ai_threads')
      .select('id')
      .eq('user_id', userId)
      .eq('assistant_id', assistantId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (existingThread) {
      threadId = existingThread.id;
      console.log(`[PRE-CONNECT] [UNIFIED_THREAD] Using existing thread: ${threadId}`);
      await supabase
        .from('ai_threads')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', threadId);
    }
  }
  
  if (!threadId) {
    const { data: newThread } = await supabase
      .from('ai_threads')
      .insert({ 
        user_id: userId, 
        assistant_id: assistantId,
        openai_thread_id: `phone_${Date.now()}`,
        mode: 'unified'
      })
      .select('id')
      .single();
    threadId = newThread?.id || null;
    console.log(`[PRE-CONNECT] [UNIFIED_THREAD] Created new thread: ${threadId}`);
  }

  console.log(`[PRE-CONNECT] TTS Provider: ${ttsProvider}, Voice ID: ${voiceId}, RAG: ${ragContext.length} chars`);

  // Generate greeting text
  const timeGreeting = getTimeBasedGreeting(timezone);
  const userName = profile?.first_name || 'sir';
  const greetingText = generateGreetingForCallType(context, timeGreeting, userName);

  console.log(`[PRE-CONNECT] Generated greeting: "${greetingText}"`);

  // Pre-generate full instructions
  const instructions = await loadUserInstructions(SUPABASE_URL, SUPABASE_SERVICE_KEY, userId, ragContext, profile, timezone);
  console.log(`[PRE-CONNECT] Pre-generated instructions: ${instructions.length} chars`);

  // Generate audio via ElevenLabs TTS
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

  // Store session in database
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
    openaiVoice,
    phoneCallMode,
    createdAt: Date.now(),
    ragContext,
    instructions,
    threadId
  });

  console.log(`[PRE-CONNECT] ✅ FULL session stored in ${totalTime}ms: ${sessionId}`);

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
      console.log('[BRIDGE] POST request not pre-connect mode');
    }
  }

  // Health check endpoint
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
    
    // BARGE-IN tracking
    let isAiSpeaking = false;
    let currentResponseId: string | null = null;
    let currentResponseItemId: string | null = null;
    let audioSamplesPlayed: number = 0;
    
    // Tool output tracking
    let lastToolOutput: { toolName: string; extractedFacts?: any } | null = null;
    let lastUserTranscript: string | null = null;
    
    // Call session tracking
    let callSessionId: string | null = null;
    let messageIndex = 0;
    let callStartTime = Date.now();
    let responseStartTime = 0;
    let firstAudioTime: number | null = null;
    let greetingLatencyMs: number | null = null;
    
    // TTS settings
    let ttsProvider: 'openai' | 'elevenlabs' = 'openai';
    let elevenlabsVoiceId: string = 'EXAVITQu4vr4xnSDxMaL';
    let openaiVoice: string = 'alloy';
    
    // ElevenLabs text buffer
    let pendingTextBuffer: string = '';
    let isProcessingElevenLabsTTS = false;
    let sentenceBuffer: string = '';
    let audioSentDuringResponse: boolean = false;
    
    // Speech event debounce
    let lastSpeechStartTime = 0;
    const SPEECH_DEBOUNCE_MS = 300;
    
    // Echo filtering
    let isSendingTtsAudio = false;
    let ttsAudioEndTime = 0;
    const TTS_ECHO_GRACE_PERIOD_MS = 500;
    const DISABLE_ECHO_FILTER = true;
    const ECHO_AMPLITUDE_THRESHOLD = 1500;
    const INTERRUPT_AMPLITUDE_THRESHOLD = 3000;
    let recentAmplitudes: number[] = [];
    const AMPLITUDE_WINDOW = 5;
    let amplitudeDebugCounter = 0;
    
    // Audio pipeline telemetry
    let twilioMediaFramesIn = 0;
    let openaiAppendCount = 0;
    let openaiAudioDeltaCount = 0;
    let twilioMediaFramesOut = 0;
    let firstInboundLogged = false;
    let firstAppendLogged = false;
    let firstDeltaLogged = false;
    let firstOutboundLogged = false;
    const openaiEventCounts: Record<string, number> = {};
    
    // Keep-alive
    let keepAliveInterval: number | null = null;
    
    // Agenda managers
    let sharedAgendaManager: SharedAgendaManager | null = null;
    let agendaManager: AgendaManager | null = null;
    
    // Filler manager
    let fillerManager: SmartFillerManager | null = null;
    
    // Pre-connected session state
    let preConnectedSession: PreConnectSession | null = null;
    let cachedAudioBase64: string = '';
    let preConnectedGreetingText: string = '';
    
    // Hello-triggered greeting
    let waitingForUserHello = false;
    let pendingCachedGreeting: string = '';
    let pendingGreetingMode: 'cached' | 'openai' | null = null;
    let helloTriggerTimer: number | null = null;
    const HELLO_FALLBACK_MS = VOICE_CONFIG.OUTBOUND_HELLO_WAIT_MS;
    
    // Audio buffering
    const audioRingBuffer: Int16Array[] = [];
    const MAX_BUFFER_FRAMES = 150;
    let audioBufferFlushed = false;
    
    // Telemetry timestamps
    let t_twilioStart = 0;
    let t_openaiWsConstructed = 0;
    let t_sessionConfigured = 0;
    let t_firstAudioBuffered = 0;
    let t_bufferFlushed = 0;
    let t_cachedGreetingPlayed = 0;
    
    // Response tracking
    let responseCreateCount = 0;
    let lastResponseTrigger = '';
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Unified trigger for pending greeting
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
        
        injectAssistantMessage(preConnectedGreetingText, 'PRE_CONNECT_GREETING_HISTORY');
        const userName = userProfile?.first_name || 'sir';
        const contextMsg = `[System: PRE-CONNECTED CALL - You just said: "${preConnectedGreetingText}"
The user answered with hello/speech. Current time: ${getCurrentTimeString(userTimezone)}.
${callContext || ''}
Cover ALL agenda items naturally before ending. Use hang_up only after all items covered.]`;
        injectSystemMessage(contextMsg, 'PRE_CONNECT_CONTEXT_AFTER_HELLO');
      } else if (pendingGreetingMode === 'openai') {
        console.log(`[HELLO-TRIGGER] 📡 Mode=openai - will trigger sendOutboundGreeting()`);
        sendOutboundGreeting();
      }
      
      pendingCachedGreeting = '';
      pendingGreetingMode = null;
    }
    
    // Wrapper for response.create - logs trigger source
    function createResponse(trigger: string, details?: string) {
      if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) {
        console.warn(`[RESPONSE] ⚠️ Cannot create - OpenAI WS not open`);
        return;
      }
      
      responseCreateCount++;
      lastResponseTrigger = trigger;
      responseStartTime = Date.now();
      
      console.log(`[RESPONSE] #${responseCreateCount} triggered by: ${trigger}${details ? ` (${details})` : ''}`);
      
      openaiWs.send(JSON.stringify({ type: "response.create" }));
    }
    
    // Wrapper for conversation.item.create
    function injectSystemMessage(content: string, logTag: string) {
      if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) {
        console.warn(`[INJECT-MSG] ⚠️ Cannot send - OpenAI WS not open`);
        return;
      }
      
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
    
    // ElevenLabs TTS timeout
    const ELEVENLABS_TIMEOUT_MS = 5000;
    
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
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          console.warn(`[ELEVENLABS] ⚠️ TIMEOUT after ${ELEVENLABS_TIMEOUT_MS}ms - aborting request`);
          controller.abort();
        }, ELEVENLABS_TIMEOUT_MS);
        
        let response: Response;
        try {
          response = await fetch(`${SUPABASE_URL}/functions/v1/elevenlabs-tts`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              text: fullText,
              voiceId: elevenlabsVoiceId,
              format: 'ulaw'
            }),
            signal: controller.signal
          });
        } catch (fetchError: any) {
          clearTimeout(timeoutId);
          
          if (fetchError.name === 'AbortError') {
            console.warn(`[ELEVENLABS] ⚠️ Request timed out, falling back to OpenAI voice`);
            isProcessingElevenLabsTTS = false;
            
            if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
              console.log(`[ELEVENLABS-FALLBACK] Triggering OpenAI audio for: "${fullText.substring(0, 50)}..."`);
              
              openaiWs.send(JSON.stringify({
                type: "conversation.item.create",
                item: {
                  type: "message",
                  role: "assistant",
                  content: [{ type: "text", text: fullText }]
                }
              }));
              
              openaiWs.send(JSON.stringify({
                type: "response.create",
                response: { 
                  modalities: ["audio"],
                  instructions: `Speak the following text naturally: "${fullText}"`
                }
              }));
            }
            return;
          }
          throw fetchError;
        }
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[ELEVENLABS] TTS API error: ${response.status} - ${errorText}`);
          isProcessingElevenLabsTTS = false;
          return;
        }
        
        const data = await response.json();
        const latency = Date.now() - startTime;
        
        if (latency > 3000) {
          console.warn(`[ELEVENLABS] ⚠️ HIGH LATENCY: ${latency}ms (threshold: 3000ms)`);
        }
        
        console.log(`[ELEVENLABS] ✅ Generated ${data.bytes} bytes of μ-law audio in ${latency}ms`);
        
        if (data.audio && streamSid && twilioWs.readyState === WebSocket.OPEN) {
          isSendingTtsAudio = true;
          recentAmplitudes = [];
          
          const chunks = chunkMulawForTwilio(data.audio);
          const estimatedDurationMs = chunks.length * 20;
          
          console.log(`[ELEVENLABS] 🔊 Sending ${chunks.length} chunks (~${estimatedDurationMs}ms duration)`);
          
          for (const chunkBase64 of chunks) {
            twilioMediaFramesOut++;
            twilioWs.send(JSON.stringify({
              event: "media",
              streamSid: streamSid,
              media: { payload: chunkBase64 }
            }));
          }
          
          ttsAudioEndTime = Date.now() + estimatedDurationMs + TTS_ECHO_GRACE_PERIOD_MS;
          console.log(`[ECHO-FILTER] TTS playback window: now + ${estimatedDurationMs + TTS_ECHO_GRACE_PERIOD_MS}ms`);
          
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
        
        if (pendingTextBuffer.trim()) {
          const queuedText = pendingTextBuffer;
          pendingTextBuffer = '';
          setTimeout(() => sendElevenLabsTTS(queuedText), 50);
        }
      }
    }

    // Play pre-cached audio directly to Twilio
    function playCachedAudio(audioBase64: string) {
      if (!streamSid || twilioWs.readyState !== WebSocket.OPEN || !audioBase64) {
        console.warn('[CACHED-AUDIO] Cannot play - missing streamSid, closed WS, or no audio');
        return;
      }

      console.log(`[CACHED-AUDIO] 🎙️ Playing ${audioBase64.length} chars of cached audio`);

      try {
        isSendingTtsAudio = true;
        recentAmplitudes = [];
        
        const chunks = chunkMulawForTwilio(audioBase64);
        const estimatedDurationMs = chunks.length * 20;

        console.log(`[CACHED-AUDIO] 🔊 Sending ${chunks.length} chunks (~${estimatedDurationMs}ms duration)`);

        for (const chunkBase64 of chunks) {
          twilioMediaFramesOut++;
          twilioWs.send(JSON.stringify({
            event: "media",
            streamSid: streamSid,
            media: { payload: chunkBase64 }
          }));
        }

        ttsAudioEndTime = Date.now() + estimatedDurationMs + TTS_ECHO_GRACE_PERIOD_MS;
        console.log(`[ECHO-FILTER] Cached audio playback window: now + ${estimatedDurationMs + TTS_ECHO_GRACE_PERIOD_MS}ms`);
        
        setTimeout(() => {
          if (isSendingTtsAudio && Date.now() >= ttsAudioEndTime - 50) {
            isSendingTtsAudio = false;
            console.log(`[ECHO-FILTER] Cached audio playback window ended`);
          }
        }, estimatedDurationMs + TTS_ECHO_GRACE_PERIOD_MS);

        console.log(`[CACHED-AUDIO] ✅ Sent ${chunks.length} chunks`);
      } catch (error) {
        console.error('[CACHED-AUDIO] Error playing cached audio:', error);
      }
    }

    // Initialize filler manager with TTS function
    fillerManager = new SmartFillerManager((text) => {
      if (ttsProvider === 'elevenlabs') {
        sendElevenLabsTTS(text);
      } else {
        injectAssistantMessage(text, 'FILLER');
        createResponse('FILLER_INJECTION', `filler: "${text}"`);
      }
    });

    twilioWs.onopen = () => {
      console.log("[TWILIO-WS] ✅ WebSocket OPEN - ready to receive stream");
      
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
            
            const sessionId = customParams.sessionId;
            const greetingCached = customParams.greetingCached === 'true';
            
            console.log(`[TWILIO-STREAM] ✅ Stream START received - streamSid: ${streamSid}`);
            console.log(`[TWILIO-STREAM] Custom params:`, JSON.stringify(customParams));
            console.log(`[TWILIO-STREAM] Pre-connected session: ${sessionId || 'none'}`);
            
            if (sessionId) {
              t_twilioStart = Date.now();
              console.log(`[TWILIO-STREAM] ⚡ Pre-connected mode: fetching session...`);
              
              getPreConnectSession(supabase, sessionId).then((session) => {
                if (session) {
                  console.log(`[TWILIO-STREAM] ✅ Pre-connected session loaded in ${Date.now() - t_twilioStart}ms`);
                  
                  preConnectedSession = session;
                  userId = session.userId;
                  callContext = session.context;
                  userTimezone = session.timezone;
                  userProfile = session.profile;
                  ttsProvider = session.ttsProvider;
                  elevenlabsVoiceId = session.voiceId;
                  openaiVoice = session.openaiVoice || 'alloy';
                  cachedAudioBase64 = session.audioBase64;
                  preConnectedGreetingText = session.greetingText;
                  threadId = session.threadId;
                  console.log(`[PRE-CONNECT] Voice settings: ttsProvider=${ttsProvider}, openaiVoice=${openaiVoice}`);
                  
                  // Initialize agenda manager
                  if (threadId && userId) {
                    sharedAgendaManager = new SharedAgendaManager(threadId, userId, SUPABASE_URL, SUPABASE_SERVICE_KEY);
                    if (session.agenda && session.agenda.length > 0) {
                      sharedAgendaManager.initialize(session.context || '', session.agenda, 'scheduled_call');
                    }
                  } else if (session.agenda && session.agenda.length > 0) {
                    agendaManager = new AgendaManager(session.agenda);
                    agendaManager.startItem(0);
                  }
                  
                  const isOutboundCall = callDirection === 'outbound';
                  
                  if (isOutboundCall && streamSid) {
                    console.log(`[HELLO-WAIT] 🎧 Outbound call - waiting for user audio (max ${HELLO_FALLBACK_MS}ms)`);
                    waitingForUserHello = true;
                    pendingGreetingMode = cachedAudioBase64 ? 'cached' : 'openai';
                    pendingCachedGreeting = cachedAudioBase64 || '';
                    
                    helloTriggerTimer = setTimeout(() => {
                      if (waitingForUserHello) {
                        console.log(`[HELLO-TRIGGER] ⏱️ No audio after ${HELLO_FALLBACK_MS}ms - triggering greeting`);
                        triggerPendingGreeting('timer');
                      }
                    }, HELLO_FALLBACK_MS) as unknown as number;
                  } else if (cachedAudioBase64 && streamSid) {
                    console.log(`[HELLO-TRIGGER] 🎤 Inbound call - playing greeting immediately`);
                    t_cachedGreetingPlayed = Date.now();
                    playCachedAudio(cachedAudioBase64);
                    greetingSent = true;
                    firstOutboundLogged = true;
                    waitingForUserHello = false;
                    console.log(`[TIMING] twilioStart→greetingPlayed: ${t_cachedGreetingPlayed - t_twilioStart}ms (immediate-inbound)`);
                  }
                  
                  connectToOpenAI();
                  
                } else {
                  console.log(`[TWILIO-STREAM] ⚠️ Pre-connected session not found, falling back to standard flow`);
                  connectToOpenAI();
                }
              });
              
            } else {
              t_twilioStart = Date.now();
              connectToOpenAI();
            }
            break;

          case "media":
            twilioMediaFramesIn++;
            if (!firstInboundLogged) {
              console.log(`[TWILIO-IN] ➡️ First inbound audio from Twilio`);
              firstInboundLogged = true;
            }
            
            // Decode μ-law to PCM16
            const rawBytes = Uint8Array.from(atob(data.media.payload), c => c.charCodeAt(0));
            const pcm8k = decodeMulaw(rawBytes);
            
            if (!t_firstAudioBuffered && audioRingBuffer.length === 0) {
              t_firstAudioBuffered = Date.now();
              console.log(`[TIMING] twilioStart→firstAudioBuffered: ${t_firstAudioBuffered - t_twilioStart}ms`);
            }
            
            // Buffer audio while OpenAI WS is connecting
            if (!sessionConfigured) {
              if (audioRingBuffer.length < MAX_BUFFER_FRAMES) {
                audioRingBuffer.push(pcm8k);
              } else {
                audioRingBuffer.shift();
                audioRingBuffer.push(pcm8k);
              }
              return;
            }
            
            // Check if waiting for hello trigger
            if (waitingForUserHello) {
              const rms = calculateRMSAmplitude(pcm8k);
              if (rms > INTERRUPT_AMPLITUDE_THRESHOLD) {
                console.log(`[HELLO-TRIGGER] 🎤 Detected speech in media (RMS=${rms.toFixed(0)})`);
                triggerPendingGreeting('vad');
              }
            }
            
            // Send to OpenAI if connected
            if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
              amplitudeDebugCounter++;
              
              // Echo filtering
              if (!DISABLE_ECHO_FILTER && isSendingTtsAudio) {
                const avgAmplitude = calculateRMSAmplitude(pcm8k);
                recentAmplitudes.push(avgAmplitude);
                if (recentAmplitudes.length > AMPLITUDE_WINDOW) {
                  recentAmplitudes.shift();
                }
                
                const smoothedAmplitude = recentAmplitudes.reduce((a, b) => a + b, 0) / recentAmplitudes.length;
                
                if (smoothedAmplitude > INTERRUPT_AMPLITUDE_THRESHOLD) {
                  console.log(`[BARGE-IN] Real speech detected (amp=${smoothedAmplitude.toFixed(0)} > ${INTERRUPT_AMPLITUDE_THRESHOLD})`);
                  isAiSpeaking = false;
                  
                  if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
                    twilioWs.send(JSON.stringify({
                      event: "clear",
                      streamSid: streamSid
                    }));
                    console.log(`[BARGE-IN] Cleared Twilio buffer`);
                  }
                  
                  const pcm24k = upsample8to24(pcm8k);
                  const audioBase64 = int16ToBase64(pcm24k);
                  openaiAppendCount++;
                  openaiWs.send(JSON.stringify({
                    type: "input_audio_buffer.append",
                    audio: audioBase64,
                  }));
                } else if (avgAmplitude < ECHO_AMPLITUDE_THRESHOLD) {
                  if (amplitudeDebugCounter % 50 === 0) {
                    console.log(`[ECHO-FILTER] Ignoring echo: avgAmp=${avgAmplitude.toFixed(0)} < ${ECHO_AMPLITUDE_THRESHOLD}`);
                  }
                } else {
                  const pcm24k = upsample8to24(pcm8k);
                  const audioBase64 = int16ToBase64(pcm24k);
                  openaiAppendCount++;
                  openaiWs.send(JSON.stringify({
                    type: "input_audio_buffer.append",
                    audio: audioBase64,
                  }));
                }
              } else {
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
      
      await closeCallSession();
      
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

      let instructions: string;
      let ragContext = "";
      
      if (preConnectedSession && preConnectedSession.instructions) {
        console.log(`[OPENAI] ⚡ FAST PATH: Using pre-connected session data`);
        instructions = preConnectedSession.instructions;
        ragContext = preConnectedSession.ragContext;
        threadId = preConnectedSession.threadId;
        console.log(`[OPENAI] ⚡ Pre-loaded: instructions=${instructions.length} chars, ragContext=${ragContext.length} chars, threadId=${threadId}`);
      } else {
        console.log("[OPENAI] 🐢 SLOW PATH: Loading context from database...");
        
        if (userId) {
          const [profile, rag, ttsPrefs] = await Promise.all([
            loadUserProfile(supabase, userId),
            loadRAGContext(SUPABASE_URL, SUPABASE_SERVICE_KEY, userId),
            supabase
              .from('user_scheduling_prefs')
              .select('tts_provider, elevenlabs_voice_id, openai_voice')
              .eq('user_id', userId)
              .maybeSingle()
          ]);
          userProfile = profile;
          ragContext = rag;
          
          if (ttsPrefs.data) {
            ttsProvider = (ttsPrefs.data.tts_provider as 'openai' | 'elevenlabs') || 'openai';
            elevenlabsVoiceId = ttsPrefs.data.elevenlabs_voice_id || 'EXAVITQu4vr4xnSDxMaL';
            openaiVoice = ttsPrefs.data.openai_voice || 'alloy';
            console.log(`[BRIDGE] TTS Provider: ${ttsProvider}, ElevenLabs Voice: ${elevenlabsVoiceId}`);
          }

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
              const { data: defaultAssistant } = await supabase
                .from('assistants')
                .select('id')
                .eq('user_id', userId)
                .eq('is_default', true)
                .maybeSingle();
              
              const assistantId = defaultAssistant?.id || null;
              
              const { data: newThread } = await supabase
                .from('ai_threads')
                .insert({ 
                  user_id: userId,
                  assistant_id: assistantId,
                  openai_thread_id: `phone_${Date.now()}` 
                })
                .select('id')
                .single();
              threadId = newThread?.id || null;
              console.log('[BRIDGE] Created new thread:', threadId, 'for assistant:', assistantId);
            }
          } catch (error) {
            console.warn('[BRIDGE] Thread management error:', error);
          }
        }

        instructions = await loadUserInstructions(SUPABASE_URL, SUPABASE_SERVICE_KEY, userId, ragContext, userProfile, userTimezone);
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
          
          openaiEventCounts[msg.type] = (openaiEventCounts[msg.type] || 0) + 1;
          
          if (!['response.audio.delta', 'input_audio_buffer.speech_started'].includes(msg.type)) {
            console.log(`[OPENAI-MSG] ${msg.type}`);
          }

          switch (msg.type) {
            case "session.created":
              console.log("[OPENAI-SESSION] ✅ Session CREATED - configuring...");
              
              const modalities = ttsProvider === 'elevenlabs' 
                ? ["text"] 
                : ["text", "audio"];
              
              console.log(`[OPENAI-SESSION] Sending config: modalities=${JSON.stringify(modalities)}, ttsProvider=${ttsProvider}, openaiVoice=${openaiVoice}`);
              
              openaiWs!.send(JSON.stringify({
                type: "session.update",
                session: {
                  modalities: modalities,
                  instructions: instructions,
                  voice: openaiVoice,
                  input_audio_format: "pcm16",
                  output_audio_format: "pcm16",
                  input_audio_transcription: { 
                    model: "gpt-4o-mini-transcribe",
                    language: "en",
                    prompt: "tasks, schedule, calendar, reschedule, today, tomorrow, priorities, assignments, meetings, due date, deadline, work session, focus time"
                  },
                  turn_detection: {
                    type: "semantic_vad",
                    eagerness: "low",
                    create_response: true,
                    interrupt_response: true,
                  },
                  tools: getToolDefinitions(),
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
              
              // Flush audio buffer
              let bufferHadSpeech = false;
              if (audioRingBuffer.length > 0) {
                t_bufferFlushed = Date.now();
                
                const SPEECH_THRESHOLD = 500;
                let speechFrames = 0;
                for (const frame of audioRingBuffer) {
                  const rms = calculateRMSAmplitude(frame);
                  if (rms > SPEECH_THRESHOLD) {
                    speechFrames++;
                  }
                }
                bufferHadSpeech = audioRingBuffer.length >= 10 && (speechFrames / audioRingBuffer.length) > 0.15;
                console.log(`[AUDIO-BUFFER] 🔄 Flushing ${audioRingBuffer.length} frames, speechFrames=${speechFrames}, containsSpeech=${bufferHadSpeech}`);
                
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
                audioRingBuffer.length = 0;
                audioBufferFlushed = true;
              }
              
              // Proactive hello trigger
              if (bufferHadSpeech && waitingForUserHello) {
                console.log("[HELLO-TRIGGER] 🎤 Speech detected in buffer - triggering greeting NOW");
                triggerPendingGreeting('buffer');
                openaiWs!.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
                console.log(`[TIMING] twilioStart→greetingPlayed: ${t_cachedGreetingPlayed - t_twilioStart}ms (buffer-speech-detected)`);
                return;
              }
              
              // Handle scheduled calls
              if (preConnectedSession && greetingSent && !waitingForUserHello) {
                console.log("[OPENAI-SESSION] Scheduled call - greeting already sent, injecting context");
                injectAssistantMessage(preConnectedGreetingText, 'PRE_CONNECT_GREETING_HISTORY');
                
                const userName = userProfile?.first_name || 'sir';
                const contextMsg = `[System: SCHEDULED CALL - You just said: "${preConnectedGreetingText}"
The user is listening. Current time: ${getCurrentTimeString(userTimezone)}.
${callContext || ''}
Cover ALL agenda items naturally before ending. Use hang_up only after all items covered.]`;
                injectSystemMessage(contextMsg, 'PRE_CONNECT_CONTEXT_SCHEDULED');
                console.log("[OPENAI-SESSION] ✅ Context injected for scheduled call");
                return;
              }
              
              // Handle pre-connected sessions waiting for VAD
              if (preConnectedSession && waitingForUserHello) {
                console.log("[OPENAI-SESSION] Pre-connected session - waiting for VAD");
                
                const userName = userProfile?.first_name || 'sir';
                const contextMsg = `[System: PRE-CONNECTED CALL - You are about to greet ${userName}. Current time: ${getCurrentTimeString(userTimezone)}.

${callContext || ''}

IMPORTANT: Your greeting audio is ready. When the user says hello, you will greet them.
After greeting, cover ALL agenda items naturally before ending.
Use hang_up only after all agenda items are covered.]`;
                
                injectSystemMessage(contextMsg, 'PRE_CONNECT_WAITING_CONTEXT');
                console.log("[OPENAI-SESSION] ✅ Pre-connected context injected - waiting for user speech");
                return;
              }
              
              // Handle pre-connected sessions with greeting already played
              if (preConnectedSession && greetingSent) {
                console.log("[OPENAI-SESSION] Pre-connected session - updating AI context with greeting");
                
                injectAssistantMessage(preConnectedGreetingText, 'PRE_CONNECT_GREETING_HISTORY');
                
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
                console.log("[OPENAI-SESSION] ✅ Pre-connected session context injected - waiting for user response");
                return;
              }
              
              // Standard flow - send greeting
              if (callDirection === 'inbound') {
                sendInboundGreeting();
              } else {
                sendOutboundGreeting();
              }
              break;

            case "response.audio.delta":
              openaiAudioDeltaCount++;
              if (!firstDeltaLogged) {
                console.log(`[AUDIO-DELTA] ⬅️ First audio delta from OpenAI`);
                firstDeltaLogged = true;
                if (!firstAudioTime) {
                  firstAudioTime = Date.now();
                  greetingLatencyMs = firstAudioTime - callStartTime;
                  console.log(`[TIMING] Call greeting latency: ${greetingLatencyMs}ms`);
                }
              }
              
              isAiSpeaking = true;
              
              if (ttsProvider === 'elevenlabs') {
                return;
              }
              
              // Forward OpenAI audio to Twilio
              if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
                const pcm24k = base64ToInt16(msg.delta);
                audioSamplesPlayed += pcm24k.length;
                
                const pcm8k = downsample24to8(pcm24k);
                const mulaw = encodeMulaw(pcm8k);
                
                const chunks = chunkMulawForTwilio(btoa(String.fromCharCode(...mulaw)));
                
                for (const chunkBase64 of chunks) {
                  twilioMediaFramesOut++;
                  twilioWs.send(JSON.stringify({
                    event: "media",
                    streamSid: streamSid,
                    media: { payload: chunkBase64 }
                  }));
                }
                
                if (!firstOutboundLogged) {
                  console.log(`[AUDIO-OUT] ⬅️ First audio sent to Twilio`);
                  firstOutboundLogged = true;
                }
              }
              break;

            case "response.audio.done":
              console.log("[OPENAI] Audio response complete");
              isAiSpeaking = false;
              currentResponseItemId = null;
              audioSamplesPlayed = 0;
              break;

            case "response.text.delta":
              if (ttsProvider === 'elevenlabs' && msg.delta) {
                sentenceBuffer += msg.delta;
                
                if (SENTENCE_ENDERS.test(sentenceBuffer)) {
                  const textToSpeak = sentenceBuffer.trim();
                  sentenceBuffer = '';
                  
                  if (textToSpeak.length > 0) {
                    sendElevenLabsTTS(textToSpeak);
                    audioSentDuringResponse = true;
                  }
                }
              }
              break;

            case "response.text.done":
              if (ttsProvider === 'elevenlabs' && sentenceBuffer.trim().length > 0) {
                const remainingText = sentenceBuffer.trim();
                sentenceBuffer = '';
                if (remainingText.length > 0) {
                  sendElevenLabsTTS(remainingText);
                  audioSentDuringResponse = true;
                }
              }
              break;

            case "response.done":
              console.log("[OPENAI] Response complete");
              isAiSpeaking = false;
              sentenceBuffer = '';
              audioSentDuringResponse = false;
              break;

            case "response.output_item.added":
              if (msg.item?.type === 'message') {
                currentResponseItemId = msg.item.id;
                console.log(`[OPENAI] Response item added: ${currentResponseItemId}`);
              }
              break;

            case "input_audio_buffer.speech_started":
              const now = Date.now();
              if (now - lastSpeechStartTime < SPEECH_DEBOUNCE_MS) {
                console.log(`[OPENAI] Debounced speech_started (${now - lastSpeechStartTime}ms since last)`);
                break;
              }
              lastSpeechStartTime = now;
              
              console.log("[OPENAI] User started speaking");
              
              // Hello trigger
              if (waitingForUserHello) {
                console.log("[HELLO-TRIGGER] 🎤 VAD detected user speech - triggering greeting");
                triggerPendingGreeting('vad');
                break;
              }
              
              // Barge-in handling
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
              console.log("[OPENAI] Auto-response enabled - OpenAI will trigger response when ready");
              break;

            case "conversation.item.input_audio_transcription.completed":
              const rawTranscript = msg.transcript || '';
              const trimmedTranscript = rawTranscript.trim();
              
              console.log(`[TRANSCRIPT-USER] 📢 VERBATIM: "${rawTranscript}"`);
              console.log(`[TRANSCRIPT-USER] 📊 Length: ${rawTranscript.length} chars, trimmed: "${trimmedTranscript}"`);
              
              lastUserTranscript = rawTranscript;
              
              if (trimmedTranscript.length > 0) {
                saveConversationMessage('user', rawTranscript);
                console.log(`[TRANSCRIPT-USER] ✅ Saved to conversation history`);
              } else {
                console.log(`[TRANSCRIPT-USER] ⚠️ Empty transcript - not saving`);
              }
              break;

            case "response.audio_transcript.done":
              console.log(`[TRANSCRIPT-AI] 🤖 "${msg.transcript}"`);
              saveConversationMessage('assistant', msg.transcript);
              
              if (lastToolOutput?.extractedFacts) {
                const validation = validateVoiceResponse(msg.transcript, lastToolOutput);
                if (!validation.valid && validation.correction) {
                  console.log('[BRIDGE] ⚠️ Discrepancy detected, injecting correction');
                  
                  injectSystemMessage(
                    `[System: IMPORTANT CORRECTION NEEDED. You just said something inaccurate. ${validation.correction} Please briefly acknowledge this correction to the user.]`,
                    'VALIDATION_CORRECTION'
                  );
                  createResponse('VALIDATION_CORRECTION', validation.correction);
                } else {
                  console.log('[BRIDGE] ✅ Response validated - no discrepancies');
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
              const errorCode = msg.error?.code;
              const errorMessage = msg.error?.message || '';
              if (errorCode === 'insufficient_quota' || errorMessage.includes('quota') || errorMessage.includes('billing')) {
                console.error("[OPENAI] 💳 BILLING ERROR: OpenAI API credits exhausted!");
              } else if (errorCode === 'rate_limit_exceeded' || errorMessage.includes('rate limit')) {
                console.error("[OPENAI] ⏱️ RATE LIMIT: Too many requests!");
              } else if (errorCode === 'invalid_api_key' || errorMessage.includes('api_key')) {
                console.error("[OPENAI] 🔑 API KEY ERROR: Invalid or expired!");
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

      openaiWs.onerror = async (err) => {
        console.error("[OPENAI] Connection error:", err);
        
        if (userId && streamSid) {
          try {
            await supabase.from('activity_log').update({
              status: 'error',
              stage: 'openai_websocket',
              error_message: 'OpenAI WebSocket connection error',
              metadata: {
                call_direction: callDirection,
                tts_provider: ttsProvider,
                session_configured: sessionConfigured
              }
            }).eq('session_id', streamSid);
            console.log(`[ACTIVITY_LOG] ❌ phone_${callDirection} error logged`);
          } catch (logError) {
            console.warn('[ACTIVITY_LOG] Failed to log OpenAI error:', logError);
          }
        }
      };
    }

    // Call session management
    async function createCallSession(callSid: string, fromNumber?: string, toNumber?: string) {
      if (!userId) return;
      
      try {
        await supabase.from('activity_log').insert({
          user_id: userId,
          activity_type: callDirection === 'inbound' ? 'phone_inbound' : 'phone_outbound',
          session_id: streamSid || callSid,
          status: 'started',
          stage: 'webhook',
          metadata: { 
            call_sid: callSid,
            direction: callDirection,
            from_number: fromNumber,
            to_number: toNumber,
            tts_provider: ttsProvider
          },
          started_at: new Date().toISOString()
        });
        console.log(`[ACTIVITY_LOG] ✅ phone_${callDirection} started (${streamSid || callSid})`);
        
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
        
        if (streamSid && userId) {
          await supabase.from('activity_log').update({
            status: 'completed',
            duration_seconds: durationSeconds,
            message_count: messageIndex,
            ended_at: new Date().toISOString(),
            metadata: {
              greeting_latency_ms: greetingLatencyMs,
              tts_provider: ttsProvider,
              response_create_count: responseCreateCount,
              audio_frames_in: twilioMediaFramesIn,
              audio_frames_out: twilioMediaFramesOut
            }
          }).eq('session_id', streamSid);
          console.log(`[ACTIVITY_LOG] ✅ phone_${callDirection} completed (${durationSeconds}s)`);
        }
        
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

    // Unified message saving
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
        
        if (threadId && role !== 'tool') {
          await supabase.from('conversation_messages').insert({
            user_id: userId,
            thread_id: threadId,
            role: role,
            content: content,
            source: 'phone',
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
      const latency = role === 'assistant' && responseStartTime > 0 
        ? Date.now() - responseStartTime 
        : undefined;
      await saveCallMessage(role, content, latency);
    }

    // Greeting functions
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
      
      const greetingContext = `[System: This is an inbound phone call from ${userName}. Current time is ${currentTime}. Greet them with "${greeting}, ${userName}. What can I help you with?" Keep it brief and WAIT for them to tell you what they need. Do NOT assume they want schedule information - they might ask about anything.]`;
      
      injectSystemMessage(greetingContext, 'INBOUND_GREETING_CONTEXT');
      createResponse('INBOUND_GREETING', `inbound call from ${userName}`);
    }

    function sendOutboundGreeting() {
      if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN || greetingSent) return;
      
      greetingSent = true;
      const greeting = getTimeBasedGreeting(userTimezone);
      const userName = userProfile?.first_name || 'sir';
      
      const isScheduledCall = callContext && (
        callContext.includes('[CALL AGENDA]') || 
        callContext.includes('CALL TYPE:') ||
        callContext.includes('Morning Stand-up') ||
        callContext.includes('Midday Check-in') ||
        callContext.includes('End of Day Wrap-up')
      );
      
      console.log(`[GREETING] Outbound call for ${userName}, scheduled: ${isScheduledCall}`);
      
      if (isScheduledCall && callContext) {
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
        const contextInfo = callContext || 'your daily briefing';
        const manualContext = `[System: This is an outbound call YOU initiated to ${userName} for ${contextInfo}. Wait silently for them to answer with "hello" or similar. When they do, briefly introduce yourself as Iris and explain why you're calling in one sentence.]`;
        
        injectSystemMessage(manualContext, 'OUTBOUND_MANUAL_CONTEXT');
        console.log(`[GREETING] Manual outbound - waiting for user audio (NO response.create)`);
      }
    }

    // Validation function
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

      if (fillerManager) {
        fillerManager.startTool(msg.name);
      }

      try {
        let args = JSON.parse(msg.arguments);
        const functionName = msg.name;
        
        if (functionName === 'web_search' && lastUserTranscript) {
          console.log(`[BRIDGE] web_search - OpenAI query: "${args.query}"`);
          console.log(`[BRIDGE] web_search - Overriding with verbatim: "${lastUserTranscript}"`);
          args = { ...args, query: lastUserTranscript };
        }
        
        console.log(`[BRIDGE] Executing function via execute-tool: ${functionName}`, args);

        const result = await executeTool(functionName, args, userId, {
          timezone: userTimezone,
          userProfile,
          twilioWs,
          streamSid
        });

        if (fillerManager) {
          fillerManager.endTool();
        }

        console.log(`[BRIDGE] Function result:`, result);
        
        await saveCallMessage('tool', `Called ${functionName}`, undefined, {
          name: functionName,
          input: args,
          output: result
        });
        
        if (result.extractedFacts) {
          lastToolOutput = { toolName: functionName, extractedFacts: result.extractedFacts };
          console.log(`[BRIDGE] Stored extracted facts for validation:`, result.extractedFacts);
        }

        openaiWs.send(JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: msg.call_id,
            output: JSON.stringify(result)
          }
        }));
        console.log(`[FUNCTION-OUTPUT] Sent result for ${functionName}`);

        createResponse('FUNCTION_RESULT', functionName);

      } catch (error) {
        if (fillerManager) {
          fillerManager.endTool();
        }
        
        console.error("[BRIDGE] Function call error:", error);
        
        await logError(supabase, 'function_call_failed', String(error), {
          sessionId: callSessionId,
          userId,
          stage: 'function_execution',
          functionName: msg.name,
          stack: error instanceof Error ? error.stack : undefined
        });
        
        openaiWs.send(JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: msg.call_id,
            output: JSON.stringify({ success: false, error: String(error) })
          }
        }));
        createResponse('FUNCTION_RESULT', `${msg.name} (error)`);
      }
    }

    return response;
  }

  // Non-WebSocket request
  return new Response("Twilio-OpenAI Realtime Bridge v8 - Modular Architecture", { status: 200 });
});
