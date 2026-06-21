import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

interface RequestBody {
  action: 'subscribe' | 'unsubscribe' | 'subscribe_fcm';
  subscription?: PushSubscription;
  fcmToken?: string;
  userId: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { action, subscription, fcmToken, userId }: RequestBody = await req.json();

    // Validate userId is provided
    if (!userId) {
      console.error('[manage-push-subscription] Missing userId in request body');
      return new Response(
        JSON.stringify({ error: 'userId required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log(`[manage-push-subscription] Processing ${action} request for user:`, userId);

    // Android bridge: store FCM token for native notification routing
    if (action === 'subscribe_fcm') {
      if (!fcmToken) {
        return new Response(JSON.stringify({ error: 'fcmToken required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const { error: upsertError } = await supabaseClient
        .from('push_subscriptions')
        .upsert({
          user_id: userId,
          endpoint: `fcm:${userId}`,
          p256dh_key: '',
          auth_key: '',
          fcm_token: fcmToken,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,endpoint' });

      if (upsertError) {
        console.error('[manage-push-subscription] Error storing FCM token:', upsertError);
        return new Response(JSON.stringify({ error: 'Failed to store FCM token', details: upsertError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      console.log('[manage-push-subscription] FCM token stored for user:', userId);
      return new Response(JSON.stringify({ success: true, message: 'FCM token saved' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'subscribe') {
      if (!subscription) {
        return new Response(
          JSON.stringify({ error: 'Subscription data required' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // Store push subscription in database
      const { error: insertError } = await supabaseClient
        .from('push_subscriptions')
        .upsert({
          user_id: userId,
          endpoint: subscription.endpoint,
          p256dh_key: subscription.keys.p256dh,
          auth_key: subscription.keys.auth,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id,endpoint'
        });

      if (insertError) {
        console.error('[manage-push-subscription] Error storing subscription:', insertError);
        return new Response(
          JSON.stringify({ error: 'Failed to store subscription', details: insertError.message }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // Fire-and-forget activity logging
      supabaseClient.from('activity_log').insert({
        user_id: userId,
        activity_type: 'push_subscription_created',
        status: 'completed',
        metadata: { 
          endpoint_prefix: subscription.endpoint.substring(0, 50),
          action: 'subscribe'
        }
      }).then(() => {
        console.log('[manage-push-subscription] Activity logged: push_subscription_created');
      }).catch((logErr) => {
        console.warn('[manage-push-subscription] Activity log failed (non-blocking):', logErr);
      });

      console.log('[manage-push-subscription] Push subscription stored successfully');
      return new Response(
        JSON.stringify({ success: true, message: 'Subscription saved' }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (action === 'unsubscribe') {
      // Remove push subscription from database
      const { error: deleteError } = await supabaseClient
        .from('push_subscriptions')
        .delete()
        .eq('user_id', userId);

      if (deleteError) {
        console.error('[manage-push-subscription] Error deleting subscription:', deleteError);
        return new Response(
          JSON.stringify({ error: 'Failed to remove subscription', details: deleteError.message }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // Fire-and-forget activity logging
      supabaseClient.from('activity_log').insert({
        user_id: userId,
        activity_type: 'push_subscription_removed',
        status: 'completed',
        metadata: { action: 'unsubscribe' }
      }).then(() => {
        console.log('[manage-push-subscription] Activity logged: push_subscription_removed');
      }).catch((logErr) => {
        console.warn('[manage-push-subscription] Activity log failed (non-blocking):', logErr);
      });

      console.log('[manage-push-subscription] Push subscription removed successfully');
      return new Response(
        JSON.stringify({ success: true, message: 'Subscription removed' }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[manage-push-subscription] Error in function:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
