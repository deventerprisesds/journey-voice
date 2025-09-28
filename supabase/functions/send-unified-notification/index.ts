import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface NotificationPayload {
  userId: string;
  title?: string;
  body?: string;
  channels: string[];
  data?: any;
  slackWebhook?: string;
  userProfile?: {
    email?: string;
    phone?: string;
  };
  outlookEvent?: {
    title: string;
    startTime: string;
    endTime: string;
    reminder: string;
  };
  googleEvent?: {
    title: string;
    startTime: string;
    endTime: string;
    reminder: string;
  };
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

    const { 
      userId, 
      title, 
      body, 
      channels, 
      data = {}, 
      slackWebhook,
      userProfile,
      outlookEvent,
      googleEvent
    }: NotificationPayload = await req.json();

    console.log('Sending unified notification:', {
      userId,
      title,
      body,
      channels,
      data,
      ...(outlookEvent && { outlookEvent }),
      ...(googleEvent && { googleEvent })
    });

    // Use provided user profile if available, otherwise fetch from database
    let profile = userProfile;
    if (!profile || (!profile.email && !profile.phone)) {
      console.log('Fetching user profile from database...');
      const { data: dbProfile, error: profileError } = await supabaseClient
        .from('profiles')
        .select('email, phone')
        .eq('user_id', userId)
        .maybeSingle();

      if (profileError) {
        console.error('Error fetching user profile:', profileError);
      }
      
      profile = dbProfile || profile || {};
    }

    await callUnifiedWebhook({
      userId,
      title,
      body,
      channels,
      userProfile: userProfile || profile,
      taskData: data,
      slackWebhook: slackWebhook || Deno.env.get('SLACK_WEBHOOK_URL') || '',
      outlookEvent,
      googleEvent
    });

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Notification sent to unified webhook'
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in send-unified-notification function:', error);
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

interface UnifiedWebhookPayload {
  userId: string;
  title?: string;
  body?: string;
  channels: string[];
  userProfile: any;
  taskData: any;
  slackWebhook?: string;
  outlookEvent?: {
    title: string;
    startTime: string;
    endTime: string;
    reminder: string;
  };
  googleEvent?: {
    title: string;
    startTime: string;
    endTime: string;
    reminder: string;
  };
}

async function callUnifiedWebhook(payload: UnifiedWebhookPayload) {
  const webhookUrl = Deno.env.get('UNIFIED_WEBHOOK_URL');
  
  if (!webhookUrl) {
    console.log('No unified webhook URL configured');
    return { status: 'no_webhook_configured' };
  }

  console.log('Calling unified webhook with payload:', payload);

  const queryParams = new URLSearchParams({
    userId: payload.userId,
    ...(payload.title && { title: payload.title }),
    ...(payload.body && { body: payload.body }),
    channels: JSON.stringify(payload.channels),
    userProfile: JSON.stringify(payload.userProfile),
    taskData: JSON.stringify(payload.taskData),
    ...(payload.outlookEvent && { outlookEvent: JSON.stringify(payload.outlookEvent) }),
    ...(payload.googleEvent && { googleEvent: JSON.stringify(payload.googleEvent) })
  });

  if (payload.slackWebhook) {
    queryParams.append('slackWebhook', payload.slackWebhook);
  }

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
  console.log('Unified webhook result:', result);
  
  // Store notification record for tracking
  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const notificationRecord = {
    user_id: payload.userId,
    title: payload.title || 'Event Notification',
    body: payload.body || JSON.stringify(payload.outlookEvent || payload.googleEvent || {}),
    notification_type: payload.taskData?.type || 'general',
    scheduled_for: new Date().toISOString(),
    delivered_at: new Date().toISOString(),
    task_id: payload.taskData?.taskId || null
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