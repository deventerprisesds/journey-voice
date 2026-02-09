import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Preset ElevenLabs voices
const PRESET_VOICES: Record<string, string> = {
  sarah: "EXAVITQu4vr4xnSDxMaL",
  george: "JBFqnCBsd6RMkjVDRZzb",
  roger: "CwhRBWXzGAHq8TQ4Fs17",
  lily: "pFZP5JQG7iQjIQuC4Bku",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
    
    if (!ELEVENLABS_API_KEY) {
      console.error("[ELEVENLABS-TTS] Missing ELEVENLABS_API_KEY");
      return new Response(
        JSON.stringify({ error: "ElevenLabs API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { text, voiceId, format = "ulaw" } = await req.json();

    if (!text) {
      return new Response(
        JSON.stringify({ error: "Text is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve voice ID (support both preset names and raw IDs)
    const resolvedVoiceId = PRESET_VOICES[voiceId?.toLowerCase()] || voiceId || PRESET_VOICES.sarah;

    // Determine output format
    // ulaw_8000 for telephony (Twilio), mp3_44100_128 for browser playback
    const outputFormat = format === "mp3" ? "mp3_44100_128" : "ulaw_8000";
    
    console.log(`[ELEVENLABS-TTS] Generating TTS: voice=${resolvedVoiceId}, format=${outputFormat}, text="${text.substring(0, 50)}..."`);

    const startTime = Date.now();
    
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${resolvedVoiceId}?output_format=${outputFormat}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_turbo_v2_5", // Low latency model for real-time
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.3, // Slightly conversational
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[ELEVENLABS-TTS] API error: ${response.status} - ${errorText}`);
      
      // Log quota errors for banner visibility
      if (errorText.includes('quota_exceeded') || response.status === 401) {
        try {
          const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
          await supabase.from('error_log').insert({
            source: 'edge_function',
            component: 'elevenlabs-tts',
            error_type: 'quota_exceeded_elevenlabs',
            error_message: 'ElevenLabs quota exhausted - voice features unavailable',
            context: { details: errorText, status: response.status }
          });
          console.log('[ELEVENLABS-TTS] Logged quota error to error_log table');
        } catch (logError) {
          console.error('[ELEVENLABS-TTS] Failed to log quota error:', logError);
        }
      }
      
      return new Response(
        JSON.stringify({ error: `ElevenLabs API error: ${response.status}`, details: errorText }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const audioBuffer = await response.arrayBuffer();
    const latency = Date.now() - startTime;
    
    console.log(`[ELEVENLABS-TTS] ✅ Generated audio: ${audioBuffer.byteLength} bytes in ${latency}ms`);

    // For telephony (Twilio), return base64-encoded μ-law audio in JSON
    // This allows the bridge to easily extract and forward to Twilio
    if (format === "ulaw") {
      const audioBase64 = base64Encode(audioBuffer);
      return new Response(
        JSON.stringify({ 
          audio: audioBase64, 
          format: "ulaw_8000",
          bytes: audioBuffer.byteLength,
          latencyMs: latency
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // For browser playback, return raw MP3 binary
    return new Response(audioBuffer, {
      headers: {
        ...corsHeaders,
        "Content-Type": "audio/mpeg",
        "X-Latency-Ms": latency.toString(),
      },
    });

  } catch (error) {
    console.error("[ELEVENLABS-TTS] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
