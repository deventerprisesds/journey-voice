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
  action: 'subscribe' | 'unsubscribe';
  subscription?: PushSubscription;
  userId: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Use service role key for server-side operations (matches other notification functions)
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { action, subscription, userId }: RequestBody = await req.json();

    // Validate userId is provided
    if (!userId) {
      console.error('Missing userId in request body');
      return new Response(
        JSON.stringify({ error: 'userId required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log(`Processing ${action} request for user:`, userId);

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

      // Store/update push subscription
      const { error: insertError } = await supabaseClient
        .from('push_subscriptions')
        .upsert({
          user_id: userId,
          endpoint: subscription.endpoint,
          p256dh_key: subscription.keys.p256dh,
          auth_key: subscription.keys.auth,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

      if (insertError) {
        console.error('Error storing subscription:', insertError);
        
        // If the table doesn't exist, we'll create a simple storage mechanism
        // For now, we'll just log and continue
        console.log('Push subscriptions table may not exist, storing in user metadata');
        
        // Store in user metadata as fallback
        const { error: metaError } = await supabaseClient.auth.updateUser({
          data: {
            push_subscription: subscription,
            push_subscription_updated: new Date().toISOString()
          }
        });

        if (metaError) {
          console.error('Error storing subscription in metadata:', metaError);
          return new Response(
            JSON.stringify({ error: 'Failed to store subscription' }),
            {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }
      }

      console.log('Push subscription stored successfully');
      return new Response(
        JSON.stringify({ success: true, message: 'Subscription saved' }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (action === 'unsubscribe') {
      // Remove push subscription
      const { error: deleteError } = await supabaseClient
        .from('push_subscriptions')
        .delete()
        .eq('user_id', userId);

      if (deleteError) {
        console.error('Error deleting subscription:', deleteError);
        
        // Fallback: remove from user metadata
        const { error: metaError } = await supabaseClient.auth.updateUser({
          data: {
            push_subscription: null,
            push_subscription_updated: new Date().toISOString()
          }
        });

        if (metaError) {
          console.error('Error removing subscription from metadata:', metaError);
          return new Response(
            JSON.stringify({ error: 'Failed to remove subscription' }),
            {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }
      }

      console.log('Push subscription removed successfully');
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
    console.error('Error in manage-push-subscription function:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});