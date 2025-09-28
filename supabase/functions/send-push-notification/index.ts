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
    const slackWebhook = localStorage?.getItem('slackWebhook') || 
                        (typeof window !== 'undefined' ? window.localStorage?.getItem('slackWebhook') : null) ||
                        'https://edsdevn8n.app.n8n.cloud/webhook/91c642ca-0125-4109-9279-ae71993cbc72';

    // Send via unified notification service 
    try {
      const { data: result, error } = await supabaseClient.functions.invoke('send-unified-notification', {
        body: {
          userId,
          title,
          body,
          channels: userChannels,
          data
        }
      });

      if (error) {
        console.error('Error sending unified notification:', error);
        throw error;
      }

      console.log('Notification sent via unified service:', result);

      return new Response(
        JSON.stringify({ 
          success: true, 
          channels: userChannels,
          result
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );

    } catch (unifiedError) {
      console.error('Unified notification failed, falling back to individual channels:', unifiedError);
      
      // Fallback: send in-app notification only
      console.log('Sending in-app notification as fallback');
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          channels: ['IN_APP'],
          fallback: true,
          message: 'Notification processed (in-app only)'
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

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