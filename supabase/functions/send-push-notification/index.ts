import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NotificationPayload {
  userId?: string;
  title: string;
  body: string;
  data?: any;
  actions?: Array<{
    action: string;
    title: string;
    icon?: string;
  }>;
  requireInteraction?: boolean;
  tag?: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    // Get the user from the request
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      console.error('Authentication error:', userError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const payload: NotificationPayload = await req.json();
    console.log('Sending push notification:', payload);

    // Determine target user (use provided userId or current user)
    const targetUserId = payload.userId || user.id;

    // Get user's push subscription
    let subscription = null;
    
    // Try to get from push_subscriptions table first
    const { data: subData, error: subError } = await supabaseClient
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (subError && subError.code !== 'PGRST116') {
      console.error('Error fetching subscription:', subError);
    }

    if (subData) {
      subscription = {
        endpoint: subData.endpoint,
        keys: {
          p256dh: subData.p256dh_key,
          auth: subData.auth_key
        }
      };
    } else {
      // Fallback: try to get from user metadata
      const { data: userData, error: userDataError } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('user_id', targetUserId)
        .maybeSingle();

      if (userDataError) {
        console.error('Error fetching user data:', userDataError);
      }

      // For demo purposes, we'll simulate a successful send if no subscription exists
      if (!userData) {
        console.log('No push subscription found, simulating send for demo');
        return new Response(
          JSON.stringify({ 
            success: true, 
            message: 'Notification queued (demo mode - no subscription found)' 
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    }

    if (!subscription) {
      console.log('No push subscription found for user:', targetUserId);
      return new Response(
        JSON.stringify({ error: 'No push subscription found' }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // In a real implementation, you would use a proper push service like:
    // - Web Push Protocol with VAPID keys
    // - Firebase Cloud Messaging
    // - OneSignal, Pusher, etc.
    
    // For demo purposes, we'll simulate the push notification send
    console.log('Simulating push notification send to:', subscription.endpoint);
    
    // Store notification in database for tracking
    const notificationRecord = {
      user_id: targetUserId,
      title: payload.title,
      body: payload.body,
      notification_type: payload.data?.type || 'general',
      scheduled_for: new Date().toISOString(),
      delivered_at: new Date().toISOString(),
      task_id: payload.data?.taskId || null
    };

    const { error: notificationError } = await supabaseClient
      .from('scheduled_notifications')
      .insert(notificationRecord);

    if (notificationError) {
      console.error('Error storing notification record:', notificationError);
      // Continue anyway for demo purposes
    }

    // In a real implementation, this is where you would:
    // 1. Use VAPID keys to authenticate with the push service
    // 2. Send the actual push message to the subscription endpoint
    // 3. Handle any delivery failures or subscription updates

    /*
    Example of real push notification sending (commented out for demo):
    
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
    
    if (!vapidPrivateKey || !vapidPublicKey) {
      throw new Error('VAPID keys not configured');
    }

    const webpush = await import('https://esm.sh/web-push@3.6.6');
    
    webpush.setVapidDetails(
      'mailto:your-email@example.com',
      vapidPublicKey,
      vapidPrivateKey
    );

    const notificationPayloadString = JSON.stringify({
      title: payload.title,
      body: payload.body,
      data: payload.data || {},
      actions: payload.actions || [],
      requireInteraction: payload.requireInteraction || false,
      tag: payload.tag || 'default'
    });

    await webpush.sendNotification(subscription, notificationPayloadString);
    */

    console.log('Push notification sent successfully (simulated)');
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Push notification sent successfully',
        demo: true // Indicates this was a simulated send
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in send-push-notification function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});