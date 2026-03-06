import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { getToolDefinitions, getToolNamesList } from "../_shared/tool-definitions.ts";
import { getDefaultIrisPersona, PHONE_CONVERSATION_STYLE, getCurrentTimeString, loadUserProfile } from "../_shared/persona.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set');
    }

    // Get user ID from request
    const authHeader = req.headers.get('Authorization');
    let userId: string | null = null;
    
    if (authHeader) {
      try {
        const token = authHeader.replace('Bearer ', '');
        const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        const { data: { user } } = await supabase.auth.getUser(token);
        userId = user?.id || null;
      } catch (error) {
        console.warn('Failed to get user from token:', error);
      }
    }

    // Use demo user ID if no authenticated user (for demo mode)
    if (!userId) {
      userId = '00000000-0000-0000-0000-000000000001';
      console.log('Using demo user for preferences');
    }

    console.log('Generating ephemeral token for user:', userId);

    // Load user's AI instructions and TTS preferences from scheduling preferences
    // Use shared persona as default (single source of truth with persona.ts)
    let coreInstructions = getDefaultIrisPersona();

    let realtimeExtensions = '';
    let schedulingPhilosophy = '';
    let personalizationContext = '';  // Will be populated from profile
    let ttsProvider: 'openai' | 'elevenlabs' = 'openai';
    let openaiVoice = 'alloy';
    let elevenlabsVoiceId = 'EXAVITQu4vr4xnSDxMaL';

    if (userId) {
      try {
        const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        
        // Load user preferences and profile in parallel
        const [prefsResult, profileResult] = await Promise.all([
          supabase
            .from('user_scheduling_prefs')
            .select('core_instructions, realtime_extensions, config, tts_provider, openai_voice, elevenlabs_voice_id, timezone')
            .eq('user_id', userId)
            .maybeSingle(),
          supabase
            .from('profiles')
            .select('first_name, full_name, preferred_greeting')
            .eq('user_id', userId)
            .maybeSingle()
        ]);

        const prefs = prefsResult.data;
        const profile = profileResult.data;

        // Extract user name with fallback to "sir" - preferred_greeting takes priority
        const userName = profile?.preferred_greeting || profile?.first_name || profile?.full_name?.split(' ')[0] || 'sir';
        const userTimezone = prefs?.timezone || 'America/New_York';
        const currentTime = new Date().toLocaleString('en-US', {
          timeZone: userTimezone,
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit'
        });

        // Build personalization context (matches Twilio bridge)
        // NOTE: Assigning to outer 'let' variable, not declaring new const
        personalizationContext = `
CURRENT TIME: ${currentTime}
TIMEZONE: ${userTimezone}
USER: ${userName}`;

        if (prefs) {
          if (prefs.core_instructions) coreInstructions = prefs.core_instructions;
          if (prefs.realtime_extensions) realtimeExtensions = prefs.realtime_extensions;
          if (prefs.config?.customAIInstructions) {
            schedulingPhilosophy = `\n\nScheduling Philosophy:\n${prefs.config.customAIInstructions}`;
          }
          if (prefs.tts_provider) ttsProvider = prefs.tts_provider as 'openai' | 'elevenlabs';
          if (prefs.openai_voice) openaiVoice = prefs.openai_voice;
          if (prefs.elevenlabs_voice_id) elevenlabsVoiceId = prefs.elevenlabs_voice_id;
        }
      } catch (error) {
        console.warn('Failed to load user instructions, using defaults:', error);
      }
    }

    // Combine instructions with personalization context
    const fullInstructions = [
      coreInstructions,
      personalizationContext,
      realtimeExtensions,
      schedulingPhilosophy
    ].filter(Boolean).join('\n\n');

    // Determine modalities based on TTS provider
    // If ElevenLabs is selected, we need text-only output from OpenAI
    // The client will then send text to ElevenLabs TTS
    const modalities = ttsProvider === 'elevenlabs' ? ['text'] : ['text', 'audio'];

    console.log(`TTS Provider: ${ttsProvider}, OpenAI Voice: ${openaiVoice}, Modalities: ${JSON.stringify(modalities)}`);

    // Request an ephemeral token from OpenAI
    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview-2025-06-03",
        voice: openaiVoice,  // Use user's selected OpenAI voice
        modalities: modalities,  // Dynamic based on TTS provider
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        // Enable transcription for user speech - required for transcript persistence
        input_audio_transcription: {
          model: "gpt-4o-mini-transcribe",
          language: "en",
          prompt: "tasks, schedule, calendar, reschedule, today, tomorrow, priorities"
        },
        // Use semantic VAD (AI-based) instead of server_vad (amplitude-based)
        // "medium" eagerness balances responsiveness with letting user finish thoughts
        turn_detection: {
          type: "semantic_vad",
          eagerness: "medium",
          create_response: true,
          interrupt_response: true
        },
        tool_choice: "auto",
        tools: getToolDefinitions(),
        instructions: fullInstructions
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);

      // Parse OpenAI error details
      let errorDetails = { type: 'unknown', message: errorText };
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error) {
          errorDetails = {
            type: errorJson.error.type || 'unknown',
            message: errorJson.error.message || errorText
          };
        }
      } catch (parseError) {
        console.warn('Could not parse OpenAI error response:', parseError);
      }

      // Log quota errors for banner visibility
      if (response.status === 429 || errorText.includes('quota') || errorText.includes('rate_limit')) {
        try {
          const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
          const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
          await supabaseAdmin.from('error_log').insert({
            source: 'edge_function',
            component: 'generate-realtime-token',
            error_type: 'quota_exceeded_openai',
            error_message: 'OpenAI API quota exceeded - AI features unavailable',
            user_id: userId || null,
            context: { details: errorDetails, status: response.status }
          });
          console.log('[OPENAI] Logged quota error to error_log');
        } catch (logError) {
          console.error('[OPENAI] Failed to log quota error:', logError);
        }
      }

      // Return structured error for client handling
      return new Response(JSON.stringify({ 
        error: 'openai_api_error',
        details: errorDetails,
        status: response.status,
        timestamp: new Date().toISOString()
      }), {
        status: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    console.log("Ephemeral token generated successfully");

    // Extract userName for greeting personalization (matches Twilio bridge pattern)
    // This was already computed earlier as 'userName' variable around line 102
    const { createClient: createClientForProfile } = await import('https://esm.sh/@supabase/supabase-js@2');
    const supabaseForProfile = createClientForProfile(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: profileData } = await supabaseForProfile
      .from('profiles')
      .select('first_name, full_name')
      .eq('user_id', userId)
      .maybeSingle();
    
    const userNameForGreeting = profileData?.first_name || profileData?.full_name?.split(' ')[0] || 'sir';

    // Return token along with TTS config and userName for client
    return new Response(JSON.stringify({
      ...data,
      tts_config: {
        provider: ttsProvider,
        openai_voice: openaiVoice,
        elevenlabs_voice_id: elevenlabsVoiceId,
      },
      userName: userNameForGreeting,  // For personalized greetings
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error("Error generating token:", error);
    
    // Persist error to error_log for debugging visibility
    try {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );
      
      await supabaseAdmin.from('error_log').insert({
        source: 'edge_function',
        component: 'generate-realtime-token',
        user_id: userId || null,
        error_type: 'token_generation_failed',
        error_message: error instanceof Error ? error.message : String(error),
        context: {
          ttsProvider: ttsProvider || 'unknown',
          stack: error instanceof Error ? error.stack : undefined
        }
      });
    } catch (logError) {
      console.error('Failed to log error to database:', logError);
    }
    
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
