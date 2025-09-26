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
    console.log('Sending notification to all channels:', payload);

    // Determine target user (use provided userId or current user)
    const targetUserId = payload.userId || user.id;

    // Get user's notification preferences
    const { data: prefs, error: prefsError } = await supabaseClient
      .from('notification_prefs')
      .select('*')
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (prefsError && prefsError.code !== 'PGRST116') {
      console.error('Error fetching notification preferences:', prefsError);
    }

    const userChannels = prefs?.channels || ['WEB_PUSH', 'IN_APP'];
    const results: any = {
      push: null,
      slack: null,
      email: null,
      inApp: null
    };

    // Send push notification if enabled
    if (userChannels.includes('WEB_PUSH')) {
      try {
        results.push = await sendPushNotification(supabaseClient, targetUserId, payload);
      } catch (error) {
        console.error('Push notification failed:', error);
        results.push = { error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }

    // Send Slack notification if enabled
    if (userChannels.includes('SLACK')) {
      try {
        results.slack = await sendSlackNotification(supabaseClient, targetUserId, payload);
      } catch (error) {
        console.error('Slack notification failed:', error);
        results.slack = { error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }

    // Store in-app notification if enabled
    if (userChannels.includes('IN_APP')) {
      try {
        results.inApp = await storeInAppNotification(supabaseClient, targetUserId, payload);
      } catch (error) {
        console.error('In-app notification failed:', error);
        results.inApp = { error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }

    // TODO: Implement email notifications
    if (userChannels.includes('EMAIL')) {
      results.email = { status: 'not_implemented' };
    }

    console.log('Multi-channel notification results:', results);
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Notifications sent to all enabled channels',
        channels: userChannels,
        results
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

async function sendPushNotification(supabaseClient: any, userId: string, payload: NotificationPayload) {
  // Get user's push subscription
  const { data: subData, error: subError } = await supabaseClient
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (subError && subError.code !== 'PGRST116') {
    console.error('Error fetching subscription:', subError);
    return { error: 'Failed to fetch subscription' };
  }

  if (!subData) {
    console.log('No push subscription found for user:', userId);
    return { status: 'no_subscription' };
  }

  // For demo purposes, simulate push notification
  console.log('Simulating push notification send to:', subData.endpoint);
  
  // Store notification record
  const notificationRecord = {
    user_id: userId,
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
  }

  return { status: 'sent', demo: true };
}

async function sendSlackNotification(supabaseClient: any, userId: string, payload: NotificationPayload) {
  // In edge functions, we can't access localStorage. 
  // For now, we'll use environment variable or skip.
  // In production, you'd store webhook URLs in the database securely
  const slackWebhookUrl = Deno.env.get('SLACK_WEBHOOK_URL') || '';
  
  if (!slackWebhookUrl) {
    console.log('No Slack webhook URL configured for user:', userId);
    return { status: 'no_webhook_configured' };
  }
  
  const { data, error } = await supabaseClient.functions.invoke('send-slack-notification', {
    body: {
      webhook_url: slackWebhookUrl,
      message: `${payload.title}: ${payload.body}`,
      output: payload.data?.type || 'notification',
      type: payload.data?.type || 'general'
    }
  });

  if (error) {
    console.error('Slack notification error:', error);
    return { error: error.message };
  }

  return { status: 'sent', data };
}

async function storeInAppNotification(supabaseClient: any, userId: string, payload: NotificationPayload) {
  // Store in-app notification in the database for later retrieval
  const notificationRecord = {
    user_id: userId,
    title: payload.title,
    body: payload.body,
    notification_type: payload.data?.type || 'general',
    scheduled_for: new Date().toISOString(),
    delivered_at: new Date().toISOString(),
    task_id: payload.data?.taskId || null
  };

  const { error } = await supabaseClient
    .from('scheduled_notifications')
    .insert(notificationRecord);

  if (error) {
    console.error('Error storing in-app notification:', error);
    return { error: error.message };
  }

  return { status: 'stored' };
}