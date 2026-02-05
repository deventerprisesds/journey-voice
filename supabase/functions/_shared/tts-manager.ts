/**
 * TTS Manager - Handles ElevenLabs and OpenAI text-to-speech
 * 
 * Manages audio generation, caching, and Twilio streaming.
 */

import { VOICE_CONFIG, SENTENCE_ENDERS } from "./config.ts";
import { chunkMulawForTwilio } from "./audio-codec.ts";

const ELEVENLABS_TIMEOUT_MS = 5000;

/**
 * Send text to ElevenLabs TTS and stream to Twilio
 */
export async function sendElevenLabsTTS(
  text: string,
  params: {
    streamSid: string | null;
    twilioWs: WebSocket;
    elevenlabsVoiceId: string;
    supabaseUrl: string;
    supabaseServiceKey: string;
    openaiWs?: WebSocket | null;
  },
  state: {
    isProcessingElevenLabsTTS: boolean;
    pendingTextBuffer: string;
    isSendingTtsAudio: boolean;
    ttsAudioEndTime: number;
    recentAmplitudes: number[];
    twilioMediaFramesOut: number;
    firstOutboundLogged: boolean;
  },
  callbacks: {
    onStateUpdate: (updates: Partial<typeof state>) => void;
    onEchoFilterEnd: () => void;
  }
): Promise<void> {
  const { streamSid, twilioWs, elevenlabsVoiceId, supabaseUrl, supabaseServiceKey, openaiWs } = params;
  const TTS_ECHO_GRACE_PERIOD_MS = 500;
  
  if (!streamSid || twilioWs.readyState !== WebSocket.OPEN) {
    console.warn('[ELEVENLABS] Cannot send TTS - missing streamSid or closed WS');
    return;
  }
  
  if (state.isProcessingElevenLabsTTS) {
    console.log('[ELEVENLABS] Already processing TTS, queueing text');
    callbacks.onStateUpdate({ pendingTextBuffer: state.pendingTextBuffer + ' ' + text });
    return;
  }
  
  callbacks.onStateUpdate({ isProcessingElevenLabsTTS: true });
  const fullText = text;
  callbacks.onStateUpdate({ pendingTextBuffer: '' });
  
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
      response = await fetch(`${supabaseUrl}/functions/v1/elevenlabs-tts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
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
        callbacks.onStateUpdate({ isProcessingElevenLabsTTS: false });
        
        // Fallback to OpenAI TTS
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
      callbacks.onStateUpdate({ isProcessingElevenLabsTTS: false });
      return;
    }
    
    const data = await response.json();
    const latency = Date.now() - startTime;
    
    if (latency > 3000) {
      console.warn(`[ELEVENLABS] ⚠️ HIGH LATENCY: ${latency}ms (threshold: 3000ms)`);
    }
    
    console.log(`[ELEVENLABS] ✅ Generated ${data.bytes} bytes of μ-law audio in ${latency}ms`);
    
    if (data.audio && streamSid && twilioWs.readyState === WebSocket.OPEN) {
      callbacks.onStateUpdate({ 
        isSendingTtsAudio: true,
        recentAmplitudes: []
      });
      
      const chunks = chunkMulawForTwilio(data.audio);
      const estimatedDurationMs = chunks.length * 20;
      
      console.log(`[ELEVENLABS] 🔊 Sending ${chunks.length} chunks (~${estimatedDurationMs}ms duration)`);
      
      let framesOut = state.twilioMediaFramesOut;
      for (const chunkBase64 of chunks) {
        framesOut++;
        twilioWs.send(JSON.stringify({
          event: "media",
          streamSid: streamSid,
          media: { payload: chunkBase64 }
        }));
      }
      
      const newTtsEndTime = Date.now() + estimatedDurationMs + TTS_ECHO_GRACE_PERIOD_MS;
      callbacks.onStateUpdate({ 
        twilioMediaFramesOut: framesOut,
        ttsAudioEndTime: newTtsEndTime
      });
      
      console.log(`[ECHO-FILTER] TTS playback window: now + ${estimatedDurationMs + TTS_ECHO_GRACE_PERIOD_MS}ms`);
      
      setTimeout(() => {
        callbacks.onEchoFilterEnd();
      }, estimatedDurationMs + TTS_ECHO_GRACE_PERIOD_MS);
      
      if (!state.firstOutboundLogged) {
        console.log(`[ELEVENLABS-OUT] ⬅️ First ElevenLabs audio sent to Twilio`);
        callbacks.onStateUpdate({ firstOutboundLogged: true });
      }
    }
    
  } catch (error) {
    console.error('[ELEVENLABS] TTS error:', error);
  } finally {
    callbacks.onStateUpdate({ isProcessingElevenLabsTTS: false });
    
    if (state.pendingTextBuffer.trim()) {
      const queuedText = state.pendingTextBuffer;
      callbacks.onStateUpdate({ pendingTextBuffer: '' });
      setTimeout(() => sendElevenLabsTTS(queuedText, params, state, callbacks), 50);
    }
  }
}

/**
 * Play pre-cached μ-law audio directly to Twilio
 */
export function playCachedAudio(
  audioBase64: string,
  params: {
    streamSid: string | null;
    twilioWs: WebSocket;
  },
  state: {
    twilioMediaFramesOut: number;
    isSendingTtsAudio: boolean;
    ttsAudioEndTime: number;
    recentAmplitudes: number[];
  },
  callbacks: {
    onStateUpdate: (updates: Partial<typeof state>) => void;
    onEchoFilterEnd: () => void;
  }
): void {
  const { streamSid, twilioWs } = params;
  const TTS_ECHO_GRACE_PERIOD_MS = 500;
  
  if (!streamSid || twilioWs.readyState !== WebSocket.OPEN || !audioBase64) {
    console.warn('[CACHED-AUDIO] Cannot play - missing streamSid, closed WS, or no audio');
    return;
  }

  console.log(`[CACHED-AUDIO] 🎙️ Playing ${audioBase64.length} chars of cached audio`);

  try {
    callbacks.onStateUpdate({
      isSendingTtsAudio: true,
      recentAmplitudes: []
    });
    
    const chunks = chunkMulawForTwilio(audioBase64);
    const estimatedDurationMs = chunks.length * 20;

    console.log(`[CACHED-AUDIO] 🔊 Sending ${chunks.length} chunks (~${estimatedDurationMs}ms duration)`);

    let framesOut = state.twilioMediaFramesOut;
    for (const chunkBase64 of chunks) {
      framesOut++;
      twilioWs.send(JSON.stringify({
        event: "media",
        streamSid: streamSid,
        media: { payload: chunkBase64 }
      }));
    }

    const newTtsEndTime = Date.now() + estimatedDurationMs + TTS_ECHO_GRACE_PERIOD_MS;
    callbacks.onStateUpdate({
      twilioMediaFramesOut: framesOut,
      ttsAudioEndTime: newTtsEndTime
    });
    
    console.log(`[ECHO-FILTER] Cached audio playback window: now + ${estimatedDurationMs + TTS_ECHO_GRACE_PERIOD_MS}ms`);
    
    setTimeout(() => {
      callbacks.onEchoFilterEnd();
    }, estimatedDurationMs + TTS_ECHO_GRACE_PERIOD_MS);

    console.log(`[CACHED-AUDIO] ✅ Sent ${chunks.length} chunks`);
  } catch (error) {
    console.error('[CACHED-AUDIO] Error playing cached audio:', error);
  }
}

/**
 * Process text delta for sentence-based TTS streaming
 */
export function processSentenceBuffer(
  delta: string,
  sentenceBuffer: string,
  onSentenceComplete: (sentence: string) => void
): string {
  let buffer = sentenceBuffer + delta;
  
  if (SENTENCE_ENDERS.test(buffer)) {
    const textToSpeak = buffer.trim();
    buffer = '';
    
    if (textToSpeak.length > 0) {
      onSentenceComplete(textToSpeak);
    }
  }
  
  return buffer;
}
