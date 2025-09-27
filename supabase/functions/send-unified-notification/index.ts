import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NotificationPayload {
  userId: string;
  title: string;
  body: string;
  data?: any;
  channels: string[];
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

    const payload: NotificationPayload = await req.json();
    console.log('Sending notification to all channels:', payload);

    const targetUserId = payload.userId;
    console.log('Sending unified notification:', payload);

    // Get user's profile data for webhook
    const { data: profile, error: profileError } = await supabaseClient
      .from('profiles')
      .select('email, phone')
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (profileError) {
      console.error('Error fetching user profile:', profileError);
    }

    // Get user's notification preferences
    const { data: prefs, error: prefsError } = await supabaseClient
      .from('notification_prefs')
      .select('channels')
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (prefsError && prefsError.code !== 'PGRST116') {
      console.error('Error fetching notification preferences:', prefsError);
    }

    const userChannels = prefs?.channels || ['EMAIL', 'PUSH'];
    
    // Call unified webhook with all notification data
    try {
      const result = await callUnifiedWebhook(targetUserId, payload, userChannels, profile);
      
      console.log('Unified webhook result:', result);
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Notification sent to unified webhook',
          channels: userChannels,
          result
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } catch (error) {
      console.error('Unified webhook failed:', error);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to send notification', 
          details: error instanceof Error ? error.message : 'Unknown error' 
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

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

async function callUnifiedWebhook(userId: string, payload: NotificationPayload, channels: string[], profile: any) {
  const webhookUrl = Deno.env.get('UNIFIED_WEBHOOK_URL');
  
  if (!webhookUrl) {
    console.log('No unified webhook URL configured');
    return { status: 'no_webhook_configured' };
  }

  // Get Slack webhook URL from localStorage equivalent (environment variable for now)
  const slackWebhookUrl = Deno.env.get('SLACK_WEBHOOK_URL') || '';

  const webhookPayload = {
    userId,
    title: payload.title,
    body: payload.body,
    channels: channels.filter(c => c !== 'SLACK'), // Remove SLACK from unified webhook channels
    userProfile: {
      email: profile?.email,
      phone: profile?.phone
    },
    taskData: payload.data,
    slackWebhook: slackWebhookUrl
  };

  // Handle Slack separately if it's in the channels and we have a webhook URL
  if (channels.includes('SLACK') && slackWebhookUrl) {
    try {
      console.log('Sending Slack notification to:', slackWebhookUrl);
      const slackResponse = await fetch(slackWebhookUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        }
      });
      
      if (!slackResponse.ok) {
        console.error('Slack webhook failed:', slackResponse.status, await slackResponse.text());
      } else {
        console.log('Slack notification sent successfully');
      }
    } catch (error) {
      console.error('Error sending Slack notification:', error);
    }
  }

  console.log('Calling unified webhook:', webhookUrl, webhookPayload);

  // Convert payload to URL query parameters for GET request
  const queryParams = new URLSearchParams();
  queryParams.append('userId', webhookPayload.userId);
  queryParams.append('title', webhookPayload.title);
  queryParams.append('body', webhookPayload.body);
  queryParams.append('channels', JSON.stringify(webhookPayload.channels));
  queryParams.append('userProfile', JSON.stringify(webhookPayload.userProfile));
  queryParams.append('taskData', JSON.stringify(webhookPayload.taskData));
  queryParams.append('slackWebhook', webhookPayload.slackWebhook);

  const fullUrl = `${webhookUrl}?${queryParams.toString()}`;
  console.log('Calling unified webhook with GET:', fullUrl);

  const response = await fetch(fullUrl, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Webhook failed: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  
  // Store notification record for tracking
  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const notificationRecord = {
    user_id: userId,
    title: payload.title,
    body: payload.body,
    notification_type: payload.data?.type || 'general',
    scheduled_for: new Date().toISOString(),
    delivered_at: new Date().toISOString(),
    task_id: payload.data?.taskId || null
  };

  // Don't fail the whole request if notification storage fails
  try {
    await supabaseClient
      .from('scheduled_notifications')
      .insert(notificationRecord);
  } catch (error) {
    console.error('Error storing notification record:', error);
  }

  return result;
}