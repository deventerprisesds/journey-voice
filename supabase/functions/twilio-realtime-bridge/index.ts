/**
 * Twilio ↔ OpenAI Realtime Bridge (Modular v9)
 * 
 * Slimmed to ~650 lines - imports utilities from shared modules.
 * Handles WebSocket orchestration between Twilio Media Streams and OpenAI Realtime API.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Shared modules
import { GLOBAL_VERSION, FUNCTION_IDS, VOICE_CONFIG, SENTENCE_ENDERS } from "../_shared/config.ts";
import { decodeMulaw, encodeMulaw, upsample8to24, downsample24to8, int16ToBase64, base64ToInt16, calculateRMSAmplitude, chunkMulawForTwilio } from "../_shared/audio-codec.ts";
import { getToolDefinitions } from "../_shared/tool-definitions.ts";
import { getTimeBasedGreeting, getCurrentTimeString, generateGreetingForCallType, loadUserProfile, loadRAGContext, loadUserInstructions } from "../_shared/persona.ts";
import { PreConnectSession, storePreConnectSession, getPreConnectSession } from "../_shared/session-manager.ts";
import { SharedAgendaManager, AgendaManager } from "../_shared/agenda-wrapper.ts";
import { logError, createCallSession, closeCallSession, saveCallMessage, SmartFillerManager, validateVoiceResponse } from "../_shared/call-session.ts";
import { executeTool } from "../_shared/tool-executor.ts";
import { playCachedAudio } from "../_shared/tts-manager.ts";

const BRIDGE_VERSION = `${GLOBAL_VERSION}-${FUNCTION_IDS.BRIDGE}`;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");

// Handle pre-connect mode
async function handlePreConnect(params: {
  userId: string;
  context: string;
  agenda: Array<{ index: number; text: string; status: string }>;
  timezone: string;
  phoneNumber: string;
}): Promise<Response> {
  const { userId, context, agenda, timezone } = params;
  const startTime = Date.now();
  console.log(`[PRE-CONNECT] Starting for user ${userId}`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const [profile, ttsPrefs, ragContext, defaultAssistantResult] = await Promise.all([
    loadUserProfile(supabase, userId),
    supabase.from('user_scheduling_prefs').select('tts_provider, elevenlabs_voice_id, openai_voice, phone_call_mode').eq('user_id', userId).maybeSingle(),
    loadRAGContext(SUPABASE_URL, SUPABASE_SERVICE_KEY, userId),
    supabase.from('assistants').select('id').eq('user_id', userId).eq('is_default', true).maybeSingle()
  ]);

  const ttsProvider = (ttsPrefs.data?.tts_provider as 'openai' | 'elevenlabs') || 'elevenlabs';
  const voiceId = ttsPrefs.data?.elevenlabs_voice_id || 'EXAVITQu4vr4xnSDxMaL';
  const openaiVoice = ttsPrefs.data?.openai_voice || 'alloy';
  const phoneCallMode = ttsPrefs.data?.phone_call_mode || 'media_streams';
  const assistantId = defaultAssistantResult.data?.id || null;
  
  let threadId: string | null = null;
  if (assistantId) {
    const { data: existingThread } = await supabase.from('ai_threads').select('id').eq('user_id', userId).eq('assistant_id', assistantId).order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (existingThread) {
      threadId = existingThread.id;
      await supabase.from('ai_threads').update({ updated_at: new Date().toISOString() }).eq('id', threadId);
    }
  }
  if (!threadId) {
    const { data: newThread } = await supabase.from('ai_threads').insert({ user_id: userId, assistant_id: assistantId, openai_thread_id: `phone_${Date.now()}`, mode: 'unified' }).select('id').single();
    threadId = newThread?.id || null;
  }

  const timeGreeting = getTimeBasedGreeting(timezone);
  const userName = profile?.preferred_greeting || profile?.first_name || 'sir';
  const greetingText = generateGreetingForCallType(context, timeGreeting, userName);
  const instructions = await loadUserInstructions(SUPABASE_URL, SUPABASE_SERVICE_KEY, userId, ragContext, profile, timezone);

  let audioBase64 = '';
  if (ttsProvider === 'elevenlabs' && ELEVENLABS_API_KEY) {
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/elevenlabs-tts`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: greetingText, voiceId: voiceId, format: 'ulaw' })
      });
      if (response.ok) {
        const data = await response.json();
        audioBase64 = data.audio || '';
      }
    } catch (error) {
      console.error('[PRE-CONNECT] TTS error:', error);
    }
  }

  const sessionId = crypto.randomUUID();
  await storePreConnectSession(supabase, sessionId, {
    userId, context, agenda, timezone, profile, greetingText, audioBase64,
    ttsProvider, voiceId, openaiVoice, phoneCallMode, createdAt: Date.now(),
    ragContext, instructions, threadId
  });

  return new Response(JSON.stringify({
    sessionId, greetingText, audioBase64, audioBytes: audioBase64.length,
    agenda, ttsProvider, preConnectTimeMs: Date.now() - startTime
  }), { headers: { 'Content-Type': 'application/json' } });
}

serve(async (req) => {
  const url = new URL(req.url);
  console.log(`[BRIDGE] Version: ${BRIDGE_VERSION}, ${req.method} ${url.pathname}`);

  if (req.method === 'POST') {
    try {
      const body = await req.json();
      if (body.mode === 'pre-connect') return handlePreConnect(body);
    } catch (e) { /* not pre-connect */ }
  }

  if (url.pathname.endsWith("/health") || url.searchParams.get('health') === '1') {
    return new Response(JSON.stringify({ name: 'twilio-realtime-bridge', version: BRIDGE_VERSION, status: 'healthy' }), { headers: { "Content-Type": "application/json" } });
  }

  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Twilio-OpenAI Realtime Bridge v9 - Modular", { status: 200 });
  }

  const { socket: twilioWs, response } = Deno.upgradeWebSocket(req);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Session state
  let openaiWs: WebSocket | null = null;
  let streamSid: string | null = null;
  let userId: string | null = null;
  let callDirection = 'inbound';
  let callContext: string | null = null;
  let userTimezone = 'America/New_York';
  let userProfile: any = {};
  let threadId: string | null = null;
  let sessionConfigured = false;
  let greetingSent = false;
  
  // TTS settings
  let ttsProvider: 'openai' | 'elevenlabs' = 'openai';
  let elevenlabsVoiceId = 'EXAVITQu4vr4xnSDxMaL';
  let openaiVoice = 'alloy';
  
  // Pre-connect state
  let preConnectedSession: PreConnectSession | null = null;
  let cachedAudioBase64 = '';
  let preConnectedGreetingText = '';
  
  // Audio state
  let isAiSpeaking = false;
  let currentResponseItemId: string | null = null;
  let audioSamplesPlayed = 0;
  let sentenceBuffer = '';
  let isProcessingElevenLabsTTS = false;
  let pendingTextBuffer = '';
  let isSendingTtsAudio = false;
  let ttsAudioEndTime = 0;
  let recentAmplitudes: number[] = [];
  let bargeInActive = false;
  let bargeInRecoveryPending = false;
  let greetingContextInjected = false;
  
  // Telemetry
  let twilioMediaFramesIn = 0;
  let openaiAppendCount = 0;
  let twilioMediaFramesOut = 0;
  let firstInboundLogged = false;
  let firstOutboundLogged = false;
  let callStartTime = Date.now();
  let responseStartTime = 0;
  let firstAudioTime: number | null = null;
  let greetingLatencyMs: number | null = null;
  let callSessionId: string | null = null;
  let messageIndex = 0;
  let responseCreateCount = 0;
  
  // Audio buffer
  const audioRingBuffer: Int16Array[] = [];
  const MAX_BUFFER_FRAMES = 150;
  
  // Hello-trigger state
  let waitingForUserHello = false;
  let pendingCachedGreeting = '';
  let pendingGreetingMode: 'cached' | 'openai' | null = null;
  let helloTriggerTimer: number | null = null;
  
  // Managers
  let fillerManager: SmartFillerManager | null = null;
  let sharedAgendaManager: SharedAgendaManager | null = null;
  let agendaManager: AgendaManager | null = null;
  let keepAliveInterval: number | null = null;
  
  // Tool output tracking
  let lastToolOutput: { toolName: string; extractedFacts?: any } | null = null;
  let lastUserTranscript: string | null = null;
  let currentResponseText = '';
  let currentResponseTrigger = '';

  const SPEECH_DEBOUNCE_MS = 300;
  let lastSpeechStartTime = 0;
  const INTERRUPT_AMPLITUDE_THRESHOLD = 3000;

  // Helper: Create response
  function createResponse(trigger: string) {
    if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;
    responseCreateCount++;
    responseStartTime = Date.now();
    currentResponseText = '';
    currentResponseTrigger = trigger;
    console.log(`[RESPONSE] #${responseCreateCount} triggered by: ${trigger}`);
    openaiWs.send(JSON.stringify({ type: "response.create" }));
  }

  // Helper: Inject messages
  function injectSystemMessage(content: string) {
    if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;
    openaiWs.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: content }] } }));
  }

  function injectAssistantMessage(content: string) {
    if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;
    openaiWs.send(JSON.stringify({ type: "conversation.item.create", item: { type: "message", role: "assistant", content: [{ type: "text", text: content }] } }));
  }

  // Helper: Trigger pending greeting
  function triggerPendingGreeting(source: string) {
    if (!waitingForUserHello) return;
    waitingForUserHello = false;
    if (helloTriggerTimer) { clearTimeout(helloTriggerTimer); helloTriggerTimer = null; }
    console.log(`[HELLO-TRIGGER] Triggered by ${source}, mode=${pendingGreetingMode}`);
    
    if (pendingGreetingMode === 'cached' && pendingCachedGreeting) {
      const ttsState = { twilioMediaFramesOut, isSendingTtsAudio, ttsAudioEndTime, recentAmplitudes };
      playCachedAudio(pendingCachedGreeting, { streamSid, twilioWs }, ttsState, {
        onStateUpdate: (u) => { if (u.twilioMediaFramesOut !== undefined) twilioMediaFramesOut = u.twilioMediaFramesOut; if (u.isSendingTtsAudio !== undefined) isSendingTtsAudio = u.isSendingTtsAudio; },
        onEchoFilterEnd: () => { isSendingTtsAudio = false; }
      });
      greetingSent = true;
      firstOutboundLogged = true;
      injectAssistantMessage(preConnectedGreetingText);
      const contextMsg = `[System: PRE-CONNECTED CALL - You already greeted the user with: "${preConnectedGreetingText}". SKIP the greeting step (step 1) in the agenda -- it is already done. ${callContext || ''}. Continue from step 2 onward. Cover ALL remaining agenda items before ending.]`;
      injectSystemMessage(contextMsg);
      greetingContextInjected = true;
      console.log(`[GREETING-TRACE] triggerPendingGreeting(${source}): injected greeting context. greetingSent=${greetingSent}, greetingContextInjected=true`);
      // Persist the cached greeting so it appears in transcripts
      if (callSessionId && userId) {
        saveCallMessage(supabase, {
          callSessionId, userId, threadId, streamSid,
          role: 'assistant', content: preConnectedGreetingText,
          messageIndex, latencyMs: 0
        }).then(idx => { if (idx !== undefined) messageIndex = idx; })
          .catch(e => console.error('[PERSIST] cached greeting save failed:', e));
      }
    } else if (pendingGreetingMode === 'openai') {
      sendOutboundGreeting();
    }
    pendingCachedGreeting = '';
    pendingGreetingMode = null;
  }

  // ElevenLabs TTS
  async function sendElevenLabsTTS(text: string) {
    if (bargeInActive) { console.log('[ELEVENLABS] Barge-in active, discarding TTS chunk'); return; }
    if (!streamSid || twilioWs.readyState !== WebSocket.OPEN || isProcessingElevenLabsTTS) {
      if (isProcessingElevenLabsTTS) pendingTextBuffer += ' ' + text;
      return;
    }
    isProcessingElevenLabsTTS = true;
    const fullText = text;
    pendingTextBuffer = '';
    
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/elevenlabs-tts`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: fullText, voiceId: elevenlabsVoiceId, format: 'ulaw' })
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.audio && streamSid) {
          isSendingTtsAudio = true;
          const chunks = chunkMulawForTwilio(data.audio);
          for (const chunk of chunks) {
            twilioMediaFramesOut++;
            twilioWs.send(JSON.stringify({ event: "media", streamSid, media: { payload: chunk } }));
          }
          ttsAudioEndTime = Date.now() + chunks.length * 20 + 500;
          setTimeout(() => { isSendingTtsAudio = false; }, chunks.length * 20 + 500);
          if (!firstOutboundLogged) { firstOutboundLogged = true; }
        }
      } else {
        const errorText = await response.text();
        console.error(`[ELEVENLABS] TTS API error: ${response.status} - ${errorText}`);
        
        // Log quota errors for banner visibility
        if (errorText.includes('quota_exceeded') || response.status === 401) {
          try {
            await supabase.from('error_log').insert({
              source: 'edge_function',
              component: 'twilio-realtime-bridge',
              error_type: 'quota_exceeded_elevenlabs',
              error_message: 'ElevenLabs quota exhausted during phone call',
              user_id: userId,
              context: { details: errorText, status: response.status }
            });
            console.log('[ELEVENLABS] Logged quota error to error_log');
          } catch (logError) {
            console.error('[ELEVENLABS] Failed to log quota error:', logError);
          }
        }
        
        // ANNOUNCE the error to the user — never be silent
        if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
          let errorDescription: string;
          if (errorText.includes('quota_exceeded')) {
            errorDescription = 'ElevenLabs voice quota is exhausted. Voice features are unavailable until credits are added.';
          } else if (response.status === 401) {
            errorDescription = 'ElevenLabs authentication failed. The API key may be invalid or expired.';
          } else {
            errorDescription = `ElevenLabs voice service returned error ${response.status}. Voice output is temporarily unavailable.`;
          }
          
          console.warn(`[ELEVENLABS-ERROR-ANNOUNCE] Speaking error to user: ${errorDescription}`);
          openaiWs.send(JSON.stringify({
            type: "response.create",
            response: {
              modalities: ["audio"],
              instructions: `Tell the user exactly this: "${errorDescription}"`
            }
          }));
        }
      }
    } catch (error) {
      console.error('[ELEVENLABS] TTS error:', error);
      // Announce unexpected errors too — never be silent
      if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
        const errMsg = error instanceof Error ? error.message : 'unknown error';
        console.warn(`[ELEVENLABS-ERROR-ANNOUNCE] Speaking unexpected error to user: ${errMsg}`);
        openaiWs.send(JSON.stringify({
          type: "response.create",
          response: {
            modalities: ["audio"],
            instructions: `Tell the user: "I encountered a voice system error: ${errMsg}. Voice output may be affected."`
          }
        }));
      }
    } finally {
      isProcessingElevenLabsTTS = false;
      if (pendingTextBuffer.trim()) {
        const q = pendingTextBuffer; pendingTextBuffer = '';
        setTimeout(() => sendElevenLabsTTS(q), 50);
      }
    }
  }

  // Initialize filler manager
  fillerManager = new SmartFillerManager((text) => {
    if (ttsProvider === 'elevenlabs') sendElevenLabsTTS(text);
    else { injectAssistantMessage(text); createResponse('FILLER'); }
  });

  // Greetings
  function sendInboundGreeting() {
    if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN || greetingSent) return;
    greetingSent = true;
    const greeting = getTimeBasedGreeting(userTimezone);
    const userName = userProfile?.preferred_greeting || userProfile?.first_name || 'sir';
    injectSystemMessage(`[System: Inbound call from ${userName}. Current time: ${getCurrentTimeString(userTimezone)}. Greet with "${greeting}, ${userName}. What can I help you with?"]`);
    createResponse('INBOUND_GREETING');
  }

  function sendOutboundGreeting() {
    if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN || greetingSent) return;
    greetingSent = true;
    const userName = userProfile?.preferred_greeting || userProfile?.first_name || 'sir';
    const isScheduled = callContext && (callContext.includes('[CALL AGENDA]') || callContext.includes('CALL TYPE:'));
    if (isScheduled && callContext) {
      injectSystemMessage(`[System: SCHEDULED CALL to ${userName}. ${callContext}. Start with greeting, cover ALL agenda items before ending.]`);
      createResponse('SCHEDULED_GREETING');
    }
  }

  // Connect to OpenAI
  async function connectToOpenAI() {
    let instructions = '';
    let ragContext = '';
    
    if (preConnectedSession) {
      instructions = preConnectedSession.instructions;
      ragContext = preConnectedSession.ragContext;
      threadId = preConnectedSession.threadId;
    } else if (userId) {
      const [profile, rag, ttsPrefs] = await Promise.all([
        loadUserProfile(supabase, userId),
        loadRAGContext(SUPABASE_URL, SUPABASE_SERVICE_KEY, userId),
        supabase.from('user_scheduling_prefs').select('tts_provider, elevenlabs_voice_id, openai_voice').eq('user_id', userId).maybeSingle()
      ]);
      userProfile = profile;
      ragContext = rag;
      if (ttsPrefs.data) {
        ttsProvider = (ttsPrefs.data.tts_provider as 'openai' | 'elevenlabs') || 'openai';
        elevenlabsVoiceId = ttsPrefs.data.elevenlabs_voice_id || 'EXAVITQu4vr4xnSDxMaL';
        openaiVoice = ttsPrefs.data.openai_voice || 'alloy';
      }
      instructions = await loadUserInstructions(SUPABASE_URL, SUPABASE_SERVICE_KEY, userId, ragContext, userProfile, userTimezone);
    }

    openaiWs = new WebSocket("wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17", ["realtime", `openai-insecure-api-key.${OPENAI_API_KEY}`, "openai-beta.realtime-v1"]);

    openaiWs.onopen = () => console.log("[OPENAI] Connected");

    openaiWs.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      
      switch (msg.type) {
        case "session.created":
          const modalities = ttsProvider === 'elevenlabs' ? ["text"] : ["text", "audio"];
          const turnDetection = { type: "semantic_vad", eagerness: "low", create_response: true, interrupt_response: true };
          console.log(`[OPENAI-SESSION] Configuring: modalities=${JSON.stringify(modalities)}, turn_detection=${JSON.stringify(turnDetection)}, ttsProvider=${ttsProvider}`);
          openaiWs!.send(JSON.stringify({
            type: "session.update",
            session: {
              modalities, instructions, voice: openaiVoice,
              input_audio_format: "pcm16", output_audio_format: "pcm16",
              input_audio_transcription: { model: "gpt-4o-mini-transcribe", language: "en" },
              turn_detection: turnDetection,
              tools: getToolDefinitions(), tool_choice: "auto"
            }
          }));
          break;

        case "session.updated":
          sessionConfigured = true;
          // Flush audio buffer
          if (audioRingBuffer.length > 0) {
            for (const frame of audioRingBuffer) {
              const pcm24k = upsample8to24(frame);
              openaiAppendCount++;
              openaiWs!.send(JSON.stringify({ type: "input_audio_buffer.append", audio: int16ToBase64(pcm24k) }));
            }
            audioRingBuffer.length = 0;
          }
          
          console.log(`[GREETING-TRACE] session.updated: preConnectedSession=${!!preConnectedSession}, greetingSent=${greetingSent}, waitingForUserHello=${waitingForUserHello}, greetingContextInjected=${greetingContextInjected}, cachedAudioBase64=${!!cachedAudioBase64}`);
          // Only inject greeting context here for pre-connected sessions WITHOUT cached audio (OpenAI-voice calls).
          // When cached audio exists, greeting context is injected by triggerPendingGreeting (outbound) or stream start (inbound).
          if (preConnectedSession && greetingSent && !greetingContextInjected && !waitingForUserHello && !cachedAudioBase64) {
            injectAssistantMessage(preConnectedGreetingText);
            injectSystemMessage(`[System: Scheduled call - greeting already sent: "${preConnectedGreetingText}". SKIP the greeting step (step 1). ${callContext || ''}. Continue from step 2 onward. Cover ALL remaining agenda items.]`);
            greetingContextInjected = true;
            console.log(`[GREETING-TRACE] session.updated: injected greeting context (second path), greetingContextInjected=true`);
          } else if (!waitingForUserHello) {
            if (callDirection === 'inbound') sendInboundGreeting();
            else sendOutboundGreeting();
          }
          break;

        case "response.audio.delta":
          isAiSpeaking = true;
          if (ttsProvider === 'elevenlabs') return;
          if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
            const pcm24k = base64ToInt16(msg.delta);
            audioSamplesPlayed += pcm24k.length;
            const pcm8k = downsample24to8(pcm24k);
            const mulaw = encodeMulaw(pcm8k);
            const chunks = chunkMulawForTwilio(btoa(String.fromCharCode(...mulaw)));
            for (const chunk of chunks) { twilioMediaFramesOut++; twilioWs.send(JSON.stringify({ event: "media", streamSid, media: { payload: chunk } })); }
            if (!firstOutboundLogged) { firstOutboundLogged = true; if (!firstAudioTime) { firstAudioTime = Date.now(); greetingLatencyMs = firstAudioTime - callStartTime; } }
          }
          break;

        case "response.audio.done":
          break;
        case "response.done": {
          isAiSpeaking = false;
          currentResponseItemId = null;
          audioSamplesPlayed = 0;
          sentenceBuffer = '';
          const latencyMs = responseStartTime ? Date.now() - responseStartTime : null;
          console.log(`[RESPONSE-DONE] #${responseCreateCount} trigger=${currentResponseTrigger} latency=${latencyMs}ms text="${currentResponseText.substring(0, 200)}"`);
          // PERSIST AI response to call_messages + conversation_messages
          if (currentResponseText.trim() && callSessionId && userId) {
            try {
              messageIndex = await saveCallMessage(supabase, {
                callSessionId, userId, threadId, streamSid,
                role: 'assistant', content: currentResponseText.trim(),
                messageIndex, latencyMs: latencyMs ?? undefined
              });
            } catch (e) { console.error('[PERSIST] assistant save error:', e); }
          }
          
          // AGENDA TANGENT RECOVERY: After AI responds to a tangent, nudge back to agenda
          if (sharedAgendaManager && bargeInRecoveryPending) {
            try {
              const hint = await sharedAgendaManager.getResumeHint();
              if (hint) {
                console.log(`[AGENDA-RESUME] Injecting resume hint: ${hint}`);
                injectSystemMessage(`[RESUME] ${hint}. Continue with this agenda item naturally. Remember to cover ALL remaining agenda items before ending the call.`);
                createResponse('AGENDA_RESUME');
              }
              await sharedAgendaManager.resume();
            } catch (e) { console.error('[AGENDA-RESUME] Error:', e); }
            bargeInRecoveryPending = false;
          }
          
          currentResponseText = '';
          currentResponseTrigger = '';
          break;
        }

        case "response.audio_transcript.delta":
          if (msg.delta) currentResponseText += msg.delta;
          break;

        case "response.text.delta":
          if (msg.delta) currentResponseText += msg.delta;
          if (ttsProvider === 'elevenlabs' && msg.delta) {
            sentenceBuffer += msg.delta;
            if (SENTENCE_ENDERS.test(sentenceBuffer)) {
              const text = sentenceBuffer.trim();
              sentenceBuffer = '';
              if (text.length > 0) sendElevenLabsTTS(text);
            }
          }
          break;

        case "response.text.done":
          if (ttsProvider === 'elevenlabs' && sentenceBuffer.trim()) {
            sendElevenLabsTTS(sentenceBuffer.trim());
            sentenceBuffer = '';
          }
          break;

        case "response.output_item.added":
          if (msg.item?.type === 'message') currentResponseItemId = msg.item.id;
          break;

        case "input_audio_buffer.speech_started":
          const now = Date.now();
          console.log(`[VAD-TRACE] speech_started at ${now - callStartTime}ms into call, responseCreateCount=${responseCreateCount}, greetingSent=${greetingSent}, isAiSpeaking=${isAiSpeaking}`);
          if (now - lastSpeechStartTime < SPEECH_DEBOUNCE_MS) break;
          lastSpeechStartTime = now;
          
          if (waitingForUserHello) { triggerPendingGreeting('vad'); break; }
          
          if (isAiSpeaking || isSendingTtsAudio) {
            // Clear Twilio audio buffer immediately
            if (streamSid) twilioWs.send(JSON.stringify({ event: "clear", streamSid }));
            
            // Cancel OpenAI response generation (works for both TTS providers)
            if (openaiWs?.readyState === WebSocket.OPEN) {
              openaiWs.send(JSON.stringify({ type: "response.cancel" }));
              console.log(`[BARGE-IN] Sent response.cancel to OpenAI`);
            }
            
            // For OpenAI native audio, also truncate for clean VAD state
            if (ttsProvider !== 'elevenlabs' && currentResponseItemId && openaiWs?.readyState === WebSocket.OPEN) {
              openaiWs.send(JSON.stringify({ type: "conversation.item.truncate", item_id: currentResponseItemId, content_index: 0, audio_end_ms: Math.floor(audioSamplesPlayed / 24) }));
            }
            
            // For ElevenLabs: set barge-in flag to discard late-arriving TTS chunks
            if (ttsProvider === 'elevenlabs') {
              bargeInActive = true;
              sentenceBuffer = '';
              pendingTextBuffer = '';
              isProcessingElevenLabsTTS = false;
              console.log(`[BARGE-IN] ElevenLabs: bargeInActive=true, cleared sentence/pending buffers`);
              // Delayed second clear to catch late audio chunks, then reset flag
              setTimeout(() => {
                if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
                  twilioWs.send(JSON.stringify({ event: "clear", streamSid }));
                }
                bargeInActive = false;
                console.log(`[BARGE-IN] bargeInActive reset to false after 300ms`);
              }, 300);
            }
            
            isAiSpeaking = false;
            sentenceBuffer = '';
            
            // Track tangent in agenda manager
            if (sharedAgendaManager && lastUserTranscript) {
              sharedAgendaManager.pauseForQuery(lastUserTranscript).catch(e => console.error('[AGENDA] pauseForQuery error:', e));
              bargeInRecoveryPending = true;
              console.log(`[AGENDA] Paused for tangent: "${lastUserTranscript?.substring(0, 50)}..."`);
            }
          }
          break;

        case "input_audio_buffer.speech_stopped":
          console.log(`[VAD-TRACE] speech_stopped at ${Date.now() - callStartTime}ms into call`);
          break;

        case "conversation.item.input_audio_transcription.completed":
          const transcript = (msg.transcript || '').trim();
          if (transcript) {
            lastUserTranscript = transcript;
            // messageIndex = messageIndex + 1; // NOTE: commented out - saveCallMessage increments internally. Restore if rolling back persistence.
            console.log(`[USER] "${transcript}"`);
            if (callSessionId && userId) {
              try {
                messageIndex = await saveCallMessage(supabase, {
                  callSessionId, userId, threadId, streamSid,
                  role: 'user', content: transcript, messageIndex
                });
              } catch (e) { console.error('[PERSIST] user save error:', e); }
            }
          }
          break;

        case "response.function_call_arguments.done":
          handleFunctionCall(msg);
          break;

        case "error":
          console.error("[OPENAI] Error:", msg.error);
          logError(supabase, 'openai_error', msg.error?.message || 'Unknown', { userId, sessionId: callSessionId });
          break;
      }
    };

    openaiWs.onclose = () => console.log("[OPENAI] Disconnected");
    openaiWs.onerror = (e) => console.error("[OPENAI] Error:", e);
  }

  // Handle function calls
  async function handleFunctionCall(msg: any) {
    if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;
    fillerManager?.startTool(msg.name);

    try {
      let args = JSON.parse(msg.arguments);
      if (msg.name === 'web_search' && lastUserTranscript) args = { ...args, query: lastUserTranscript };

      const result = await executeTool(msg.name, args, userId, { timezone: userTimezone, userProfile, twilioWs, streamSid, supabaseUrl: SUPABASE_URL, supabaseServiceKey: SUPABASE_SERVICE_KEY });
      fillerManager?.endTool();

      if (result.extractedFacts) lastToolOutput = { toolName: msg.name, extractedFacts: result.extractedFacts };

      // PERSIST tool call to call_messages
      if (callSessionId && userId) {
        try {
          messageIndex = await saveCallMessage(supabase, {
            callSessionId, userId, threadId, streamSid,
            role: 'tool', content: JSON.stringify(result).substring(0, 1000),
            messageIndex, toolInfo: { name: msg.name, input: args, output: result }
          });
        } catch (e) { console.error('[PERSIST] tool save error:', e); }
      }

      openaiWs.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: msg.call_id, output: JSON.stringify(result) } }));
      createResponse('FUNCTION_RESULT');
    } catch (error) {
      fillerManager?.endTool();
      console.error("[BRIDGE] Function error:", error);
      openaiWs.send(JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: msg.call_id, output: JSON.stringify({ success: false, error: String(error) }) } }));
      createResponse('FUNCTION_ERROR');
    }
  }

  // Twilio WebSocket handlers
  twilioWs.onopen = () => {
    console.log("[TWILIO] Connected");
    keepAliveInterval = setInterval(() => { if (twilioWs.readyState === WebSocket.OPEN) twilioWs.send(JSON.stringify({ event: "ping" })); }, 30000);
  };

  twilioWs.onmessage = async (event) => {
    const data = JSON.parse(event.data);

    switch (data.event) {
      case "start":
        streamSid = data.start.streamSid;
        const customParams = data.start.customParameters || {};
        userId = customParams.userId || null;
        callDirection = customParams.direction || 'inbound';
        callContext = customParams.context || null;
        userTimezone = customParams.timezone || 'America/New_York';
        const sessionId = customParams.sessionId;

        console.log(`[TWILIO] Stream started: ${streamSid}, session: ${sessionId || 'none'}`);

        if (sessionId) {
          const session = await getPreConnectSession(supabase, sessionId);
          if (session) {
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

            if (threadId && userId) {
              sharedAgendaManager = new SharedAgendaManager(threadId, userId, SUPABASE_URL, SUPABASE_SERVICE_KEY);
              if (session.agenda?.length) sharedAgendaManager.initialize(session.context || '', session.agenda, 'scheduled_call');
            }

            if (callDirection === 'outbound') {
              waitingForUserHello = true;
              pendingGreetingMode = cachedAudioBase64 ? 'cached' : 'openai';
              pendingCachedGreeting = cachedAudioBase64;
              helloTriggerTimer = setTimeout(() => triggerPendingGreeting('timer'), VOICE_CONFIG.OUTBOUND_HELLO_WAIT_MS) as unknown as number;
            } else if (cachedAudioBase64) {
              const ttsState = { twilioMediaFramesOut, isSendingTtsAudio, ttsAudioEndTime, recentAmplitudes };
              playCachedAudio(cachedAudioBase64, { streamSid, twilioWs }, ttsState, {
                onStateUpdate: (u) => { if (u.twilioMediaFramesOut !== undefined) twilioMediaFramesOut = u.twilioMediaFramesOut; },
                onEchoFilterEnd: () => { isSendingTtsAudio = false; }
              });
              greetingSent = true;
              firstOutboundLogged = true;
              // Inject greeting context for inbound pre-connected calls with cached audio
              injectAssistantMessage(preConnectedGreetingText);
              injectSystemMessage(`[System: PRE-CONNECTED CALL - greeting already sent: "${preConnectedGreetingText}". SKIP step 1. ${callContext || ''}. Continue from step 2.]`);
              greetingContextInjected = true;
              console.log(`[GREETING-TRACE] inbound cached audio: injected greeting context, greetingContextInjected=true`);
              // Persist the cached greeting to transcripts
              if (callSessionId && userId) {
                saveCallMessage(supabase, {
                  callSessionId, userId, threadId, streamSid,
                  role: 'assistant', content: preConnectedGreetingText,
                  messageIndex, latencyMs: 0
                }).then(idx => { if (idx !== undefined) messageIndex = idx; })
                  .catch(e => console.error('[PERSIST] inbound cached greeting save failed:', e));
              }
            }
          }
        }

        if (userId) {
          callSessionId = await createCallSession(supabase, {
            userId, callSid: data.start.callSid || streamSid || 'unknown', streamSid, callDirection,
            fromNumber: customParams.from || null, toNumber: customParams.to || null, callContext, ttsProvider
          });
        }

        connectToOpenAI();
        break;

      case "media":
        twilioMediaFramesIn++;
        if (!firstInboundLogged) { firstInboundLogged = true; }
        
        const rawBytes = Uint8Array.from(atob(data.media.payload), c => c.charCodeAt(0));
        const pcm8k = decodeMulaw(rawBytes);

        if (!sessionConfigured) {
          if (audioRingBuffer.length < MAX_BUFFER_FRAMES) audioRingBuffer.push(pcm8k);
          else { audioRingBuffer.shift(); audioRingBuffer.push(pcm8k); }
          return;
        }

        if (waitingForUserHello) {
          const rms = calculateRMSAmplitude(pcm8k);
          if (rms > INTERRUPT_AMPLITUDE_THRESHOLD) triggerPendingGreeting('vad');
        }

        if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
          const pcm24k = upsample8to24(pcm8k);
          openaiAppendCount++;
          openaiWs.send(JSON.stringify({ type: "input_audio_buffer.append", audio: int16ToBase64(pcm24k) }));
        }
        break;

      case "stop":
        console.log("[TWILIO] Stream stopped");
        if (keepAliveInterval) clearInterval(keepAliveInterval);
        if (openaiWs) openaiWs.close();
        await closeCallSession(supabase, {
          callSessionId, streamSid, userId, callDirection, callStartTime, messageIndex,
          greetingLatencyMs, firstAudioTime, ttsProvider, responseCreateCount, twilioMediaFramesIn, twilioMediaFramesOut
        });
        break;
    }
  };

  twilioWs.onclose = async () => {
    console.log("[TWILIO] Closed");
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    if (openaiWs) openaiWs.close();
    await closeCallSession(supabase, {
      callSessionId, streamSid, userId, callDirection, callStartTime, messageIndex,
      greetingLatencyMs, firstAudioTime, ttsProvider, responseCreateCount, twilioMediaFramesIn, twilioMediaFramesOut
    });
  };

  twilioWs.onerror = (e) => console.error("[TWILIO] Error:", e);

  return response;
});
