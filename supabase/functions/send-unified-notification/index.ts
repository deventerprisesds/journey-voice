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
  notificationId?: string; // Optional: link to existing scheduled_notification
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

interface ChannelResult {
  success: boolean;
  error?: string;
  details?: any;
}

interface NotificationResult {
  success: boolean;
  notificationId?: string;
  channelResults: {
    email?: ChannelResult;
    slack?: ChannelResult;
    outlook?: ChannelResult;
    google?: ChannelResult;
    push?: ChannelResult;
  };
  webhookResponse?: any;
  errors: string[];
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  const result: NotificationResult = {
    success: false,
    channelResults: {},
    errors: []
  };

  try {
    const { 
      userId, 
      title, 
      body, 
      channels, 
      data = {}, 
      slackWebhook,
      notificationId,
      userProfile,
      outlookEvent,
      googleEvent
    }: NotificationPayload = await req.json();

    console.log('Sending unified notification:', {
      userId,
      title,
      body,
      channels,
      notificationId,
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
        result.errors.push(`Profile fetch error: ${profileError.message}`);
      }
      
      profile = dbProfile || profile || {};
    }

    // Call the unified webhook and capture detailed results
    const webhookResult = await callUnifiedWebhook({
      userId,
      title,
      body,
      channels,
      userProfile: userProfile || profile,
      taskData: data,
      slackWebhook: slackWebhook || Deno.env.get('SLACK_WEBHOOK_URL') || '',
      outlookEvent,
      googleEvent
    }, supabaseClient, notificationId);

    result.channelResults = webhookResult.channelResults;
    result.webhookResponse = webhookResult.webhookResponse;
    result.notificationId = webhookResult.notificationId;
    result.errors = [...result.errors, ...webhookResult.errors];
    
    // Determine overall success - at least one channel succeeded
    const channelSuccesses = Object.values(result.channelResults).filter(r => r?.success);
    result.success = channelSuccesses.length > 0 || result.errors.length === 0;

    // Update the notification record with results
    if (result.notificationId) {
      await updateNotificationStatus(supabaseClient, result.notificationId, result);
    }

    return new Response(
      JSON.stringify(result),
      {
        status: result.success ? 200 : 207, // 207 Multi-Status for partial success
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in send-unified-notification function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    result.errors.push(errorMessage);
    
    return new Response(
      JSON.stringify({ 
        ...result,
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

interface WebhookResult {
  channelResults: NotificationResult['channelResults'];
  webhookResponse?: any;
  notificationId?: string;
  errors: string[];
}

async function updateNotificationStatus(
  supabaseClient: any, 
  notificationId: string, 
  result: NotificationResult
) {
  try {
    const hasErrors = result.errors.length > 0 || 
      Object.values(result.channelResults).some(r => r && !r.success);
    
    const failedChannels = Object.entries(result.channelResults)
      .filter(([_, r]) => r && !r.success)
      .map(([channel, r]) => `${channel}: ${r?.error || 'Unknown error'}`)
      .join('; ');
    
    const allErrors = [...result.errors, failedChannels].filter(Boolean).join('; ');

    if (hasErrors && allErrors) {
      await supabaseClient
        .from('scheduled_notifications')
        .update({
          failed_at: new Date().toISOString(),
          failure_reason: allErrors.substring(0, 500) // Limit length
        })
        .eq('id', notificationId);
    } else {
      await supabaseClient
        .from('scheduled_notifications')
        .update({
          delivered_at: new Date().toISOString(),
          failed_at: null,
          failure_reason: null
        })
        .eq('id', notificationId);
    }
  } catch (error) {
    console.error('Error updating notification status:', error);
  }
}

async function callUnifiedWebhook(
  payload: UnifiedWebhookPayload,
  supabaseClient: any,
  existingNotificationId?: string
): Promise<WebhookResult> {
  const result: WebhookResult = {
    channelResults: {},
    errors: []
  };

  const webhookUrl = Deno.env.get('UNIFIED_WEBHOOK_URL');
  
  if (!webhookUrl) {
    console.error('UNIFIED_WEBHOOK_URL environment variable is not configured!');
    console.log('Available environment variables:', Object.keys(Deno.env.toObject()).join(', '));
    result.errors.push('UNIFIED_WEBHOOK_URL not configured - notifications cannot be delivered');
    
    // Still create a notification record to track the failure
    if (!existingNotificationId) {
      const notificationRecord = {
        user_id: payload.userId,
        title: payload.title || 'Notification',
        body: payload.body || '',
        notification_type: payload.taskData?.type || 'general',
        scheduled_for: new Date().toISOString(),
        failed_at: new Date().toISOString(),
        failure_reason: 'UNIFIED_WEBHOOK_URL not configured',
        task_id: payload.taskData?.taskId || null
      };
      
      try {
        const { data } = await supabaseClient
          .from('scheduled_notifications')
          .insert(notificationRecord)
          .select('id')
          .single();
        result.notificationId = data?.id;
      } catch (error) {
        console.error('Error storing notification record:', error);
      }
    } else {
      result.notificationId = existingNotificationId;
    }
    
    return result;
  }

  console.log('Using webhook URL:', webhookUrl.substring(0, 50) + '...');

  // Generate AI-powered calendar events for calendar channels
  let dynamicOutlookEvent, dynamicGoogleEvent;
  
  if (payload.channels.includes('OUTLOOK_EVENT') || payload.channels.includes('GOOGLE_EVENT')) {
    const taskData = payload.taskData;
    const currentTime = new Date();
    
    // Create intelligent event details based on task data
    const eventTitle = taskData?.taskTitle || payload.title || 'Task Event';
    const eventDescription = taskData?.taskDescription || payload.body || 'AI-generated calendar event from task scheduling';
    const startTime = taskData?.startTime ? new Date(taskData.startTime) : new Date(currentTime.getTime() + 60 * 60 * 1000);
    const duration = taskData?.estimateMinutes || 60;
    const endTime = new Date(startTime.getTime() + duration * 60 * 1000);
    
    if (payload.channels.includes('OUTLOOK_EVENT')) {
      dynamicOutlookEvent = {
        title: eventTitle,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        description: eventDescription,
        reminder: '15'
      };
    }
    
    if (payload.channels.includes('GOOGLE_EVENT')) {
      dynamicGoogleEvent = {
        title: eventTitle,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        description: eventDescription,
        reminder: '15'
      };
    }
  }

  const queryParams = new URLSearchParams({
    userId: payload.userId,
    ...(payload.title && { title: payload.title }),
    ...(payload.body && { body: payload.body }),
    channels: JSON.stringify(payload.channels),
    userProfile: JSON.stringify(payload.userProfile),
    taskData: JSON.stringify(payload.taskData),
    ...(dynamicOutlookEvent && { outlookEvent: JSON.stringify(dynamicOutlookEvent) }),
    ...(dynamicGoogleEvent && { googleEvent: JSON.stringify(dynamicGoogleEvent) })
  });

  if (payload.slackWebhook) {
    queryParams.append('slackWebhook', payload.slackWebhook);
  }

  const fullUrl = `${webhookUrl}?${queryParams.toString()}`;
  console.log('Calling unified webhook with GET:', fullUrl.substring(0, 200) + '...');

  try {
    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      }
    });

    const responseText = await response.text();
    let responseJson: any;
    
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      responseJson = { raw: responseText };
    }

    result.webhookResponse = responseJson;

    if (!response.ok) {
      const errorMsg = `Webhook failed: ${response.status} - ${responseText.substring(0, 200)}`;
      result.errors.push(errorMsg);
      
      // Try to extract per-channel errors from response
      if (responseJson?.errors) {
        for (const [channel, error] of Object.entries(responseJson.errors)) {
          result.channelResults[channel.toLowerCase() as keyof typeof result.channelResults] = {
            success: false,
            error: String(error)
          };
        }
      }
    } else {
      console.log('Unified webhook result:', responseJson);
      
      // Parse n8n response for channel-specific results
      // n8n may return: { message: "Workflow was started" } or channel-specific status
      if (responseJson?.message === 'Workflow was started') {
        // Workflow started but we don't know individual results yet
        // Mark channels as pending/unknown
        for (const channel of payload.channels) {
          result.channelResults[channel.toLowerCase() as keyof typeof result.channelResults] = {
            success: true, // Optimistically assume success since workflow started
            details: 'Workflow started - check n8n for final status'
          };
        }
      } else if (responseJson?.channelResults) {
        // If n8n returns structured channel results, use them
        result.channelResults = responseJson.channelResults;
      } else if (responseJson?.results) {
        // Alternative structure
        for (const [channel, channelResult] of Object.entries(responseJson.results)) {
          const cr = channelResult as any;
          result.channelResults[channel.toLowerCase() as keyof typeof result.channelResults] = {
            success: cr?.success ?? true,
            error: cr?.error,
            details: cr
          };
        }
      } else {
        // Default: mark all requested channels as success
        for (const channel of payload.channels) {
          result.channelResults[channel.toLowerCase() as keyof typeof result.channelResults] = {
            success: true,
            details: responseJson
          };
        }
      }
    }
  } catch (fetchError) {
    const errorMsg = fetchError instanceof Error ? fetchError.message : 'Network error calling webhook';
    console.error('Webhook fetch error:', errorMsg);
    result.errors.push(`Webhook network error: ${errorMsg}`);
  }

  // Store notification record for tracking
  const notificationRecord = {
    user_id: payload.userId,
    title: payload.title || 'Event Notification',
    body: payload.body || JSON.stringify(payload.outlookEvent || payload.googleEvent || {}),
    notification_type: payload.taskData?.type || 'general',
    scheduled_for: new Date().toISOString(),
    delivered_at: result.errors.length === 0 ? new Date().toISOString() : null,
    failed_at: result.errors.length > 0 ? new Date().toISOString() : null,
    failure_reason: result.errors.length > 0 ? result.errors.join('; ').substring(0, 500) : null,
    task_id: payload.taskData?.taskId || null
  };

  if (!existingNotificationId) {
    try {
      const { data } = await supabaseClient
        .from('scheduled_notifications')
        .insert(notificationRecord)
        .select('id')
        .single();
      result.notificationId = data?.id;
    } catch (error) {
      console.error('Error storing notification record:', error);
    }
  } else {
    result.notificationId = existingNotificationId;
  }

  return result;
}
