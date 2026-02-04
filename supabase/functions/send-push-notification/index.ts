import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import webpush from "npm:web-push@3.6.7";

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

    console.log('[send-push-notification] Processing push notification:', { userId, title, body, data });

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get VAPID keys from environment
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');

    if (!vapidPublicKey || !vapidPrivateKey) {
      console.error('[send-push-notification] VAPID keys not configured');
      return new Response(
        JSON.stringify({ error: 'Push notifications not configured - missing VAPID keys' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Configure web-push with VAPID details
    webpush.setVapidDetails(
      'mailto:support@journey-voice.lovable.app',
      vapidPublicKey,
      vapidPrivateKey
    );

    // Fetch user's push subscriptions from database
    const { data: subscriptions, error: fetchError } = await supabaseClient
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', userId);

    if (fetchError) {
      console.error('[send-push-notification] Error fetching subscriptions:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch push subscriptions', details: fetchError.message }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!subscriptions || subscriptions.length === 0) {
      console.log('[send-push-notification] No push subscriptions found for user:', userId);
      
      // Fire-and-forget activity logging
      supabaseClient.from('activity_log').insert({
        user_id: userId,
        activity_type: 'browser_push_skipped',
        status: 'completed',
        metadata: { reason: 'no_subscriptions', title }
      }).then(() => {}).catch(() => {});

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No push subscriptions found',
          delivered: 0 
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log(`[send-push-notification] Found ${subscriptions.length} subscription(s) for user`);

    // Prepare notification payload
    const payload = JSON.stringify({
      title,
      body,
      data,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: data?.notificationId || 'default',
      requireInteraction: true,
    });

    // Send to each subscription
    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh_key,
            auth: sub.auth_key,
          },
        };

        try {
          await webpush.sendNotification(pushSubscription, payload);
          console.log('[send-push-notification] Successfully sent to endpoint:', sub.endpoint.substring(0, 50));
          return { success: true, endpoint: sub.endpoint };
        } catch (pushError: any) {
          console.error('[send-push-notification] Failed to send to endpoint:', sub.endpoint.substring(0, 50), pushError.message);
          
          // If subscription is expired/invalid (410 Gone or 404), remove it
          if (pushError.statusCode === 410 || pushError.statusCode === 404) {
            console.log('[send-push-notification] Removing expired subscription');
            await supabaseClient
              .from('push_subscriptions')
              .delete()
              .eq('id', sub.id);
          }
          
          return { success: false, endpoint: sub.endpoint, error: pushError.message };
        }
      })
    );

    const successCount = results.filter(r => r.status === 'fulfilled' && (r.value as any).success).length;
    const failureCount = results.length - successCount;

    console.log(`[send-push-notification] Delivery complete: ${successCount} success, ${failureCount} failed`);

    // Fire-and-forget activity logging
    supabaseClient.from('activity_log').insert({
      user_id: userId,
      activity_type: failureCount > 0 && successCount === 0 ? 'browser_push_failed' : 'browser_push_sent',
      status: successCount > 0 ? 'completed' : 'error',
      metadata: { 
        title, 
        subscriptionCount: subscriptions.length,
        successCount,
        failureCount,
        taskId: data?.taskId,
        notificationId: data?.notificationId
      }
    }).then(() => {
      console.log('[send-push-notification] Activity logged');
    }).catch((logErr) => {
      console.warn('[send-push-notification] Activity log failed (non-blocking):', logErr);
    });

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Push notification delivered to ${successCount} of ${subscriptions.length} subscriptions`,
        delivered: successCount,
        failed: failureCount
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('[send-push-notification] Error in push notification handler:', error);
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
