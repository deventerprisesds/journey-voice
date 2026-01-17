// Twilio-OpenAI Realtime Bridge v6 - Unified with shared assistant-core
// Bridges Twilio Media Streams (μ-law 8kHz) ↔ OpenAI Realtime API (PCM16 24kHz)
// Uses shared assistant-core for 1:1 parity with in-app assistant

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  toolDefinitions,
  buildFullContext,
  executeTool,
  getTimeBasedGreeting,
  getCurrentTimeString,
  loadUserProfile,
  type ChannelConfig,
  type UserContext
} from "../_shared/assistant-core.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ============ Audio Conversion Utilities ============

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

function decodeMulaw(mulawData: Uint8Array): Int16Array {
  const pcm = new Int16Array(mulawData.length);
  for (let i = 0; i < mulawData.length; i++) {
    pcm[i] = mulawToLinearTable[mulawData[i]];
  }
  return pcm;
}

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

function downsample24to8(pcm24k: Int16Array): Int16Array {
  const pcm8k = new Int16Array(Math.floor(pcm24k.length / 3));
  for (let i = 0; i < pcm8k.length; i++) {
    const idx = i * 3;
    pcm8k[i] = Math.round((pcm24k[idx] + pcm24k[idx + 1] + pcm24k[idx + 2]) / 3);
  }
  return pcm8k;
}

function int16ToBase64(pcmData: Int16Array): string {
  const uint8 = new Uint8Array(pcmData.buffer);
  let binary = "";
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary);
}

function base64ToInt16(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

// ============ Main Server ============

serve(async (req) => {
  const url = new URL(req.url);
  console.log(`[BRIDGE v6] Request: ${req.method} ${url.pathname}`);

  // Health check
  if (url.pathname.endsWith("/health")) {
    return new Response(JSON.stringify({ status: "ok", version: 6 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // WebSocket upgrade for Twilio Media Streams
  if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
    const { socket: twilioWs, response } = Deno.upgradeWebSocket(req);

    let openaiWs: WebSocket | null = null;
    let streamSid: string | null = null;
    let callDirection: string = 'inbound';
    let userId: string | null = null;
    let userTimezone: string = 'America/New_York';
    let sessionConfigured = false;
    let greetingSent = false;
    let userContext: UserContext | null = null;
    let threadId: string | null = null;
    
    // Barge-in handling
    let isAiSpeaking = false;

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
            callDirection = customParams.direction || 'inbound';
            userTimezone = customParams.timezone || 'America/New_York';
            
            console.log(`[TWILIO] Stream: ${streamSid}, direction: ${callDirection}, user: ${userId}`);
            
            connectToOpenAI();
            break;

          case "media":
            if (openaiWs?.readyState === WebSocket.OPEN) {
              // μ-law → PCM16 → Upsample 8kHz→24kHz → Base64
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
        console.error("[TWILIO] Error:", err);
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

      // Build unified context using shared core
      const channelConfig: ChannelConfig = {
        type: 'phone',
        voiceOptimized: true,
        interruptionHandling: true
      };

      const { instructions, context } = await buildFullContext(supabase, userId, channelConfig);
      userContext = context;
      userTimezone = context.timezone;

      // Create or get thread for conversation persistence
      if (userId) {
        try {
          const { data: existingThread } = await supabase
            .from('ai_threads')
            .select('id')
            .eq('user_id', userId)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (existingThread) {
            threadId = existingThread.id;
          } else {
            const { data: newThread } = await supabase
              .from('ai_threads')
              .insert({ user_id: userId, openai_thread_id: `phone_${Date.now()}` })
              .select('id')
              .single();
            threadId = newThread?.id || null;
          }
        } catch (error) {
          console.warn('[BRIDGE] Thread error:', error);
        }
      }

      openaiWs = new WebSocket(
        "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17",
        ["realtime", `openai-insecure-api-key.${OPENAI_API_KEY}`, "openai-beta.realtime-v1"]
      );

      openaiWs.onopen = () => {
        console.log("[OPENAI] Connected");
      };

      openaiWs.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          switch (msg.type) {
            case "session.created":
              console.log("[OPENAI] Session created, configuring...");
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
                    threshold: 0.2,  // Lower for phone audio
                    prefix_padding_ms: 300,
                    silence_duration_ms: 800,  // Faster response
                  },
                  tools: toolDefinitions,  // Shared tool definitions
                  tool_choice: "auto"
                },
              }));
              break;

            case "session.updated":
              console.log("[OPENAI] Session configured");
              sessionConfigured = true;
              
              if (!greetingSent) {
                if (callDirection === 'inbound') {
                  sendInboundGreeting();
                } else {
                  sendOutboundGreeting();
                }
              }
              break;

            case "response.created":
              isAiSpeaking = true;
              break;

            case "response.done":
              isAiSpeaking = false;
              break;

            case "response.audio.delta":
              if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
                // PCM16 24kHz → Downsample to 8kHz → μ-law → Base64
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
              console.log("[OPENAI] User speaking - barge-in check");
              
              // Barge-in: Cancel AI response if speaking
              if (isAiSpeaking && openaiWs?.readyState === WebSocket.OPEN) {
                console.log("[OPENAI] BARGE-IN: Cancelling response");
                openaiWs.send(JSON.stringify({ type: "response.cancel" }));
                
                // Clear Twilio audio buffer
                if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
                  twilioWs.send(JSON.stringify({ event: "clear", streamSid }));
                }
                isAiSpeaking = false;
              }
              break;

            case "conversation.item.input_audio_transcription.completed":
              console.log(`[USER] "${msg.transcript}"`);
              saveMessage('user', msg.transcript);
              break;

            case "response.audio_transcript.done":
              console.log(`[IRIS] "${msg.transcript}"`);
              saveMessage('assistant', msg.transcript);
              break;

            case "response.function_call_arguments.done":
              console.log(`[TOOL] ${msg.name}`, msg.arguments);
              handleFunctionCall(msg);
              break;

            case "error":
              console.error("[OPENAI] Error:", msg.error);
              break;
          }
        } catch (err) {
          console.error("[OPENAI] Message error:", err);
        }
      };

      openaiWs.onclose = () => console.log("[OPENAI] Closed");
      openaiWs.onerror = (err) => console.error("[OPENAI] Error:", err);
    }

    async function saveMessage(role: string, content: string) {
      if (!userId || !threadId || !content) return;
      
      try {
        await supabase.from('conversation_messages').insert({
          user_id: userId,
          thread_id: threadId,
          role,
          content,
          voice_session_id: streamSid,
          audio_transcript: content
        });
      } catch (error) {
        console.warn('[BRIDGE] Save message error:', error);
      }
    }

    function sendInboundGreeting() {
      if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN || greetingSent) return;
      
      greetingSent = true;
      const greeting = getTimeBasedGreeting(userTimezone);
      const userName = userContext?.userName || 'sir';
      const currentTime = getCurrentTimeString(userTimezone);
      
      console.log(`[BRIDGE] Inbound greeting for ${userName}`);
      
      // Open-ended greeting - same as in-app assistant
      openaiWs.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{
            type: "input_text",
            text: `[System: Inbound call from ${userName}. Time: ${currentTime}. Greet with "${greeting}, ${userName}. What can I help you with?" Be brief, wait for them to speak. You can help with ANYTHING - tasks, general questions, etc.]`
          }]
        }
      }));

      openaiWs.send(JSON.stringify({ type: "response.create" }));
    }

    function sendOutboundGreeting() {
      if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN || greetingSent) return;
      
      greetingSent = true;
      const userName = userContext?.userName || 'sir';
      
      console.log(`[BRIDGE] Outbound call - waiting for user`);
      
      // Wait for user to say hello first
      openaiWs.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{
            type: "input_text",
            text: `[System: Outbound call to ${userName}. Wait silently for them to answer. When they say "hello", introduce yourself as Iris briefly and explain why you're calling.]`
          }]
        }
      }));
    }

    async function handleFunctionCall(msg: any) {
      if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN || !userContext) return;

      try {
        const args = JSON.parse(msg.arguments);
        const functionName = msg.name;
        
        console.log(`[BRIDGE] Executing: ${functionName}`);

        // Use shared tool execution from assistant-core
        let result = await executeTool(supabase, functionName, args, userContext);

        // Handle disconnect/hang_up specially for phone
        if (functionName === 'disconnect' || result.action === 'disconnect') {
          console.log("[BRIDGE] Hang up requested");
          
          // Send farewell audio first, then hang up
          openaiWs.send(JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: msg.call_id,
              output: JSON.stringify({ success: true, message: "Ending call" })
            }
          }));
          openaiWs.send(JSON.stringify({ type: "response.create" }));
          
          // Schedule hang up after response plays
          setTimeout(() => {
            if (twilioWs.readyState === WebSocket.OPEN) {
              twilioWs.close();
            }
          }, 3000);
          return;
        }

        // Send result back to OpenAI
        openaiWs.send(JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: msg.call_id,
            output: JSON.stringify(result)
          }
        }));

        openaiWs.send(JSON.stringify({ type: "response.create" }));

      } catch (error) {
        console.error("[BRIDGE] Function error:", error);
        
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

  return new Response("Twilio-OpenAI Realtime Bridge v6 - Unified Assistant Core", { status: 200 });
});
