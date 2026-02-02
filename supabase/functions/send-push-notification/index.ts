import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NotificationRequest {
  userId: string;
  title: string;
  body: string;
  data?: {
    type: string;
    taskId?: string;
    notificationId?: string;
  };
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId, title, body, data }: NotificationRequest = await req.json();

    console.log('Processing push notification:', { userId, title, body, data });

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get user preferences and profile
    const { data: prefs } = await supabaseClient
      .from('notification_prefs')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('email, phone')
      .eq('user_id', userId)
      .maybeSingle();

    const userChannels = prefs?.channels || ['EMAIL'];

    // IMPORTANT: Do NOT call send-unified-notification here!
    // notification-delivery already calls it directly with proper task data (start_time, end_time, notificationId).
    // Calling it here would create duplicate Outlook events with fallback times.
    // This function should only handle browser push subscriptions in the future.
    
    console.log('[send-push-notification] Processed for user. Channels available:', userChannels);
    console.log('[send-push-notification] Note: Calendar/Slack/Email handled by notification-delivery directly');

    return new Response(
      JSON.stringify({ 
        success: true, 
        channels: userChannels,
        message: 'Push notification processed (unified delivery handled by caller)'
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in push notification handler:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: errorMessage 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});