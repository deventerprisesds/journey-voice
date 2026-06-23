import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { normalizeDateTime } from "../_shared/timezone.ts";

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
  notificationId?: string;
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

// ============== DIRECT OUTLOOK INTEGRATION ==============

interface OutlookEventData {
  title: string;
  startTime: string;
  endTime: string;
  description?: string;
  reminderMinutes?: number;
  timezone?: string;
}

async function getOutlookConnection(supabaseClient: any, userId: string): Promise<{
  id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  provider_account_email: string;
} | null> {
  try {
    // Use the secure RPC that decrypts tokens for the authenticated user
    // We need to use service role to get tokens for any user (notification system)
    const { data, error } = await supabaseClient
      .rpc('get_office365_connection_secure')
      .single();

    if (error || !data) {
      console.log('[Outlook] No Office 365 connection found for user:', userId, error?.message);
      return null;
    }

    return data;
  } catch (err) {
    console.error('[Outlook] Error fetching connection:', err);
    return null;
  }
}

async function getOutlookConnectionForUser(supabaseClient: any, userId: string): Promise<{
  id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  provider_account_email: string;
} | null> {
  try {
    // Direct query for service-level access (notification system needs to access user's tokens)
    // Accept both 'outlook' and 'office365' as valid provider names
    // Use "pick best connection" logic: prefer non-expired, then most recently updated

    const nowISO = new Date().toISOString();

    // Query A: Try to find a valid (non-expired) connection first
    const { data: validConnection, error: validError } = await supabaseClient
      .from('calendar_connections')
      .select('id, access_token, refresh_token, expires_at, provider_account_email, user_id, updated_at')
      .eq('user_id', userId)
      .in('provider', ['office365', 'outlook'])
      .eq('is_active', true)
      .or(`expires_at.is.null,expires_at.gt.${nowISO}`)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let connection = validConnection;

    // Query B: Fallback - if no valid connection, get most recently updated (may be expired)
    if (!connection && !validError) {
      console.log('[Outlook] No valid (non-expired) connection, trying fallback...');
      const { data: fallbackConnection, error: fallbackError } = await supabaseClient
        .from('calendar_connections')
        .select('id, access_token, refresh_token, expires_at, provider_account_email, user_id, updated_at')
        .eq('user_id', userId)
        .in('provider', ['office365', 'outlook'])
        .eq('is_active', true)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fallbackError) {
        console.error('[Outlook] Fallback query error:', fallbackError);
      }
      connection = fallbackConnection;
    }

    if (validError) {
      console.error('[Outlook] Valid connection query error:', validError);
    }

    if (!connection) {
      console.log('[Outlook] No active Office 365 connection for user:', userId);
      return null;
    }

    console.log('[Outlook] Selected connection:', connection.id, 'expires_at:', connection.expires_at);

    // Decrypt tokens using the database function
    const { data: decrypted, error: decryptError } = await supabaseClient.rpc(
      'decrypt_token',
      { encrypted_token: connection.access_token, p_user_id: userId }
    );

    if (decryptError) {
      console.error('[Outlook] Token decryption failed:', decryptError);
      return null;
    }

    let decryptedRefresh = null;
    if (connection.refresh_token) {
      const { data: refreshDecrypted } = await supabaseClient.rpc(
        'decrypt_token',
        { encrypted_token: connection.refresh_token, p_user_id: userId }
      );
      decryptedRefresh = refreshDecrypted;
    }

    return {
      id: connection.id,
      access_token: decrypted,
      refresh_token: decryptedRefresh,
      expires_at: connection.expires_at,
      provider_account_email: connection.provider_account_email
    };
  } catch (err) {
    console.error('[Outlook] Error in getOutlookConnectionForUser:', err);
    return null;
  }
}

async function refreshOutlookToken(
  supabaseClient: any,
  connectionId: string,
  refreshToken: string,
  userId: string
): Promise<{ access_token: string; expires_at: string } | null> {
  try {
    console.log('[Outlook] Refreshing expired token...');

    const clientId = Deno.env.get('MICROSOFT_CLIENT_ID') || Deno.env.get('AZURE_AD_CLIENT_ID');
    const clientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET') || Deno.env.get('AZURE_AD_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      console.error('[Outlook] Missing Azure AD credentials for token refresh');
      return null;
    }

    const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: 'https://graph.microsoft.com/Calendars.ReadWrite offline_access'
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Outlook] Token refresh failed:', response.status, errorText);
      return null;
    }

    const tokens = await response.json();
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Update the connection with new encrypted tokens
    const { data: encryptedAccess } = await supabaseClient.rpc(
      'encrypt_token',
      { token_value: tokens.access_token, p_user_id: userId }
    );

    const updateData: any = {
      access_token: encryptedAccess,
      expires_at: expiresAt,
      updated_at: new Date().toISOString()
    };

    if (tokens.refresh_token) {
      const { data: encryptedRefresh } = await supabaseClient.rpc(
        'encrypt_token',
        { token_value: tokens.refresh_token, p_user_id: userId }
      );
      updateData.refresh_token = encryptedRefresh;
    }

    await supabaseClient
      .from('calendar_connections')
      .update(updateData)
      .eq('id', connectionId);

    console.log('[Outlook] Token refreshed successfully');
    return { access_token: tokens.access_token, expires_at: expiresAt };
  } catch (err) {
    console.error('[Outlook] Token refresh error:', err);
    return null;
  }
}

async function createOutlookEventDirect(
  supabaseClient: any,
  userId: string,
  eventData: OutlookEventData
): Promise<ChannelResult> {
  console.log('[Outlook] Creating event directly via Microsoft Graph API for user:', userId);

  // Get user's Office 365 connection with decrypted tokens
  const connection = await getOutlookConnectionForUser(supabaseClient, userId);

  if (!connection) {
    return {
      success: false,
      error: 'No Office 365 connection found. Please connect your Outlook account in Calendar settings.'
    };
  }

  let accessToken = connection.access_token;

  // Check if token needs refresh (with 5 min buffer)
  const expiresAt = new Date(connection.expires_at);
  const now = new Date();
  const bufferMs = 5 * 60 * 1000; // 5 minutes

  if (expiresAt.getTime() - bufferMs < now.getTime()) {
    console.log('[Outlook] Token expired or expiring soon, refreshing...');

    if (!connection.refresh_token) {
      return { success: false, error: 'Token expired and no refresh token available. Please reconnect your Outlook account.' };
    }

    const refreshed = await refreshOutlookToken(
      supabaseClient,
      connection.id,
      connection.refresh_token,
      userId
    );

    if (!refreshed) {
      return { success: false, error: 'Failed to refresh expired token. Please reconnect your Outlook account.' };
    }

    accessToken = refreshed.access_token;
  }

  // Build the calendar event
  const event = {
    subject: eventData.title,
    body: {
      contentType: 'text',
      content: eventData.description || `Task reminder from Journey Voice`,
    },
    start: {
      dateTime: eventData.startTime,
      timeZone: eventData.timezone || 'UTC',
    },
    end: {
      dateTime: eventData.endTime,
      timeZone: eventData.timezone || 'UTC',
    },
    isReminderOn: true,
    reminderMinutesBeforeStart: eventData.reminderMinutes || 15,
  };

  console.log('[Outlook] Creating event:', JSON.stringify(event, null, 2));

  try {
    const response = await fetch(
      'https://graph.microsoft.com/v1.0/me/calendar/events',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      }
    );

    const responseText = await response.text();

    if (!response.ok) {
      console.error('[Outlook] Graph API error:', response.status, responseText);
      return {
        success: false,
        error: `Microsoft Graph API error: ${response.status} - ${responseText.substring(0, 200)}`
      };
    }

    const result = JSON.parse(responseText);
    console.log('[Outlook] Event created successfully:', result.id);

    return {
      success: true,
      details: {
        eventId: result.id,
        webLink: result.webLink,
        account: connection.provider_account_email
      }
    };
  } catch (fetchError) {
    const errorMsg = fetchError instanceof Error ? fetchError.message : 'Network error calling Microsoft Graph API';
    console.error('[Outlook] Fetch error:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

// ============== END DIRECT OUTLOOK INTEGRATION ==============

function toLocalDateTimeString(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(date);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
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

    const correlationId = notificationId || crypto.randomUUID();

    console.log('Sending unified notification:', {
      userId,
      title,
      body,
      channels,
      notificationId,
      correlationId,
      data,
      ...(outlookEvent && { outlookEvent }),
      ...(googleEvent && { googleEvent })
    });

    // TRACE 1: Entry point
    supabaseClient.from('activity_log').insert({
      user_id: userId,
      activity_type: 'notification_unified_entry',
      session_id: correlationId,
      status: 'started',
      stage: 'entry',
      metadata: {
        channels,
        notificationId,
        title,
        hasSlackWebhook: !!slackWebhook,
        hasOutlookEvent: !!outlookEvent,
        hasGoogleEvent: !!googleEvent,
        timestamp: new Date().toISOString()
      }
    }).then(() => {}).catch(() => {});

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

    const { data: schedPrefs } = await supabaseClient
      .from('user_scheduling_prefs')
      .select('timezone')
      .eq('user_id', userId)
      .maybeSingle();
    const userTimezone = schedPrefs?.timezone || 'UTC';

    // ============== HANDLE OUTLOOK DIRECTLY ==============
    // Process Outlook events directly via Graph API instead of external webhook
    let remainingChannels = [...channels];

    if (channels.includes('OUTLOOK_EVENT')) {
      console.log('[Notification] Processing OUTLOOK_EVENT channel directly...');

      // Build event data from task data or provided event
      // CRITICAL: Use task's actual start_time passed from notification-delivery
      const taskData = data;

      supabaseClient.from('activity_log').insert({
        user_id: userId,
        activity_type: 'calendar_event_creation_attempt',
        session_id: correlationId,
        status: 'started',
        stage: 'outlook_pre_create',
        metadata: {
          channel: 'OUTLOOK_EVENT',
          channelsRequested: channels,
          notificationId: notificationId || null,
          taskId: taskData?.taskId || null,
          startTimeSource: taskData?.startTime
            ? 'task_start_time'
            : (taskData?.dueDate || taskData?.due_date)
              ? 'task_due_date'
              : 'fallback_now_plus_1h',
          rawStartTime: taskData?.startTime || null,
          rawDueDate: taskData?.dueDate || taskData?.due_date || null,
          notificationType: taskData?.type || null,
          timestamp: new Date().toISOString()
        }
      }).then(() => {}).catch(() => {});

      // IDEMPOTENCY CHECK: Skip if Outlook event already exists for this task today
      if (taskData?.taskId) {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: existingEvent } = await supabaseClient
          .from('external_calendar_events')
          .select('id')
          .eq('source_task_id', taskData.taskId)
          .gte('created_at', oneDayAgo)
          .maybeSingle();

        if (existingEvent) {
          console.log('[Notification] Outlook event already exists for task, skipping duplicate creation');
          result.channelResults.outlook = { success: true, details: 'Skipped - event already exists' };
          remainingChannels = remainingChannels.filter(c => c !== 'OUTLOOK_EVENT');
          // Skip the rest of Outlook processing
        }
      }

      // Only proceed if we haven't skipped due to existing event
      if (remainingChannels.includes('OUTLOOK_EVENT')) {
        const currentTime = new Date();
        const eventTitle = taskData?.taskTitle || title || 'Task Reminder';
        const eventDescription = taskData?.taskDescription || body || 'Reminder from Journey Voice';

        // Prioritize passed start_time from notification-delivery over fallback
        let startTime: Date;
        let endTime: Date;

        if (taskData?.startTime) {
          // Use the task's actual scheduled time
          startTime = new Date(taskData.startTime);
          console.log('[Notification] Using task start_time:', taskData.startTime);

          if (taskData?.endTime) {
            endTime = new Date(taskData.endTime);
          } else {
            // Calculate end time based on estimate or default 60 mins
            const duration = taskData?.estimateMinutes || 60;
            endTime = new Date(startTime.getTime() + duration * 60 * 1000);
          }
        } else if (taskData?.dueDate || taskData?.due_date) {
          const rawDue = taskData.dueDate || taskData.due_date;
          startTime = new Date(normalizeDateTime(rawDue, userTimezone) || rawDue);
          const duration = taskData?.estimateMinutes || 60;
          endTime = new Date(startTime.getTime() + duration * 60 * 1000);
          console.log('[Notification] Using task dueDate as start_time:', startTime.toISOString());
        } else {
          // No startTime and no dueDate — last resort
          console.log('[Notification] ⚠️ No startTime or dueDate — using fallback now+1h');
          startTime = new Date(currentTime.getTime() + 60 * 60 * 1000);
          const duration = taskData?.estimateMinutes || 60;
          endTime = new Date(startTime.getTime() + duration * 60 * 1000);
        }

        console.log('[Notification] Creating Outlook event:', {
          title: eventTitle,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString()
        });

        const outlookResult = await createOutlookEventDirect(
          supabaseClient,
          userId,
          {
            title: eventTitle,
            startTime: toLocalDateTimeString(startTime, userTimezone),
            endTime: toLocalDateTimeString(endTime, userTimezone),
            description: eventDescription,
            reminderMinutes: 15,
            timezone: userTimezone,
          }
        );

        result.channelResults.outlook = outlookResult;

        // Remove OUTLOOK_EVENT from channels going to external webhook
        remainingChannels = remainingChannels.filter(c => c !== 'OUTLOOK_EVENT');

        if (outlookResult.success) {
          console.log('[Notification] Outlook event created successfully');

          // Record the event in external_calendar_events for deduplication and tracing
          if (outlookResult.details?.eventId && taskData?.taskId) {
            try {
              const connection = await getOutlookConnectionForUser(supabaseClient, userId);
              const calendarId = connection?.provider_account_email || 'primary';

              await supabaseClient.from('external_calendar_events').insert({
                user_id: userId,
                connection_id: connection?.id || null,
                calendar_id: calendarId,
                external_event_id: outlookResult.details.eventId,
                source_task_id: taskData.taskId,
                title: eventTitle,
                start_time: startTime.toISOString(),
                end_time: endTime.toISOString(),
                last_synced_at: new Date().toISOString()
              });
              console.log('[Notification] Recorded Outlook event in external_calendar_events for task:', taskData.taskId);
            } catch (recordError) {
              console.error('[Notification] Failed to record event in external_calendar_events:', recordError);
              // Don't fail the notification - event was created successfully
            }
          }

          // Log to activity_log for tracing (fire and forget)
          supabaseClient.from('activity_log').insert({
            user_id: userId,
            activity_type: 'calendar_event_created',
            session_id: outlookResult.details?.eventId || 'unknown',
            status: 'completed',
            stage: 'outlook_event',
            metadata: {
              task_id: taskData?.taskId,
              start_time: startTime.toISOString(),
              event_id: outlookResult.details?.eventId,
              account: outlookResult.details?.account
            }
          }).then(() => {
            console.log(`[Notification] Activity logged: calendar_event_created`);
          }).catch(() => {
            // Silently ignore logging failures
          });
        } else {
          console.error('[Notification] Outlook event creation failed:', outlookResult.error);
          result.errors.push(`Outlook: ${outlookResult.error}`);

          // Log failure for tracing (fire and forget)
          supabaseClient.from('activity_log').insert({
            user_id: userId,
            activity_type: 'calendar_event_failed',
            session_id: taskData?.taskId || 'unknown',
            status: 'error',
            stage: 'outlook_event',
            error_message: outlookResult.error,
            metadata: { task_id: taskData?.taskId }
          }).then(() => {
            console.log(`[Notification] Activity logged: calendar_event_failed`);
          }).catch(() => {
            // Silently ignore logging failures
          });
        }
      }
    }
    // ============== END OUTLOOK HANDLING ==============

    // Strip PUSH from webhook channels — handled separately below after webhook
    if (channels.includes('PUSH')) {
      remainingChannels = remainingChannels.filter(c => c !== 'PUSH');
    }

    // Only call external webhook for remaining channels
    if (remainingChannels.length > 0) {
      const webhookResult = await callUnifiedWebhook({
        userId,
        title,
        body,
        channels: remainingChannels,
        userProfile: userProfile || profile,
        taskData: data,
        slackWebhook: slackWebhook || Deno.env.get('SLACK_WEBHOOK_URL') || '',
        outlookEvent,
        googleEvent,
        userTimezone
      }, supabaseClient, notificationId);

      // Merge channel results
      result.channelResults = { ...result.channelResults, ...webhookResult.channelResults };
      result.webhookResponse = webhookResult.webhookResponse;
      result.notificationId = webhookResult.notificationId;
      result.errors = [...result.errors, ...webhookResult.errors];
    } else if (!notificationId) {
      // Don't create duplicate notification records - notification-delivery owns the lifecycle
      // The original notification was created by the database trigger (schedule_task_reminders)
      // and notification-delivery will mark it as delivered
      console.log('[Notification] No notificationId provided - skipping record creation (notification-delivery handles status)');
    }

    // ============== HANDLE PUSH (fire after Slack/Email so it never blocks them) ==============
    if (channels.includes('PUSH')) {
      const notifType = data?.type || '';
      let androidChannel = 'task-reminders';
      if (['calendar_event_reminder', 'task_start_now', 'task_start_reminder'].includes(notifType)) androidChannel = 'calendar_events';
      else if (['daily_digest', 'batched_reminders', 'task_created', 'test_task_created'].includes(notifType)) androidChannel = 'messages';

      supabaseClient.functions.invoke('send-push-notification', {
        body: {
          userId, title, body,
          channel: androidChannel,
          data: { type: notifType, taskId: data?.taskId, notificationId: data?.notificationId || notificationId }
        }
      }).then(({ error: pushError }) => {
        if (pushError) console.error('[Notification] Push failed:', pushError.message);
        else console.log('[Notification] Push fired successfully, channel:', androidChannel);
      }).catch((e: any) => console.error('[Notification] Push invoke error:', e.message));
    }
    // ============== END PUSH HANDLING ==============

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
  userTimezone?: string;
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

    // Don't create duplicate notification records - notification-delivery owns the lifecycle
    if (existingNotificationId) {
      result.notificationId = existingNotificationId;
    } else {
      console.log('[Webhook] No notificationId provided - skipping record creation (notification-delivery handles status)');
    }

    return result;
  }

  console.log('Using webhook URL:', webhookUrl.substring(0, 50) + '...');

  // Generate AI-powered calendar events for calendar channels (Google only now, Outlook handled directly)
  let dynamicGoogleEvent;

  if (payload.channels.includes('GOOGLE_EVENT')) {
    const taskData = payload.taskData;
    const currentTime = new Date();

    supabaseClient.from('activity_log').insert({
      user_id: payload.userId,
      activity_type: 'calendar_event_creation_attempt',
      session_id: existingNotificationId || 'no-id',
      status: 'started',
      stage: 'google_pre_create',
      metadata: {
        channel: 'GOOGLE_EVENT',
        channelsRequested: payload.channels,
        notificationId: existingNotificationId || null,
        taskId: payload.taskData?.taskId || null,
        startTimeSource: payload.taskData?.startTime
          ? 'task_start_time'
          : (payload.taskData?.dueDate || payload.taskData?.due_date)
            ? 'task_due_date'
            : 'fallback_now_plus_1h',
        rawStartTime: payload.taskData?.startTime || null,
        rawDueDate: payload.taskData?.dueDate || payload.taskData?.due_date || null,
        notificationType: payload.taskData?.type || null,
        timestamp: new Date().toISOString()
      }
    }).then(() => {}).catch(() => {});

    // Create intelligent event details based on task data
    const eventTitle = taskData?.taskTitle || payload.title || 'Task Event';
    const eventDescription = taskData?.taskDescription || payload.body || 'AI-generated calendar event from task scheduling';
    let startTime: Date;
    if (taskData?.startTime) {
      startTime = new Date(taskData.startTime);
    } else if (taskData?.dueDate || taskData?.due_date) {
      const rawDue = taskData.dueDate || taskData.due_date;
      startTime = new Date(normalizeDateTime(rawDue, payload.userTimezone || 'UTC') || rawDue);
      console.log('[Webhook] Using task dueDate as Google event start_time:', startTime.toISOString());
    } else {
      console.log('[Webhook] ⚠️ No startTime or dueDate — using fallback now+1h');
      startTime = new Date(currentTime.getTime() + 60 * 60 * 1000);
    }
    const duration = taskData?.estimateMinutes || 60;
    const endTime = new Date(startTime.getTime() + duration * 60 * 1000);

    const googleTz = payload.userTimezone || 'UTC';
    dynamicGoogleEvent = {
      title: eventTitle,
      startTime: toLocalDateTimeString(startTime, googleTz),
      endTime: toLocalDateTimeString(endTime, googleTz),
      timezone: googleTz,
      description: eventDescription,
      reminder: '15'
    };
  }

  const queryParams = new URLSearchParams({
    userId: payload.userId,
    ...(payload.title && { title: payload.title }),
    ...(payload.body && { body: payload.body }),
    channels: JSON.stringify(payload.channels),
    userProfile: JSON.stringify(payload.userProfile),
    taskData: JSON.stringify(payload.taskData),
    ...(dynamicGoogleEvent && { googleEvent: JSON.stringify(dynamicGoogleEvent) })
  });

  if (payload.slackWebhook) {
    queryParams.append('slackWebhook', payload.slackWebhook);
  }

  const fullUrl = `${webhookUrl}?${queryParams.toString()}`;
  console.log('Calling unified webhook with GET:', fullUrl.substring(0, 200) + '...');

  // TRACE 2: Pre-webhook dispatch
  const traceCorrelationId = existingNotificationId || 'no-id';
  supabaseClient.from('activity_log').insert({
    user_id: payload.userId,
    activity_type: 'notification_webhook_sent',
    session_id: traceCorrelationId,
    status: 'started',
    stage: 'pre_webhook',
    metadata: {
      webhookUrlPrefix: webhookUrl.substring(0, 60),
      channels: payload.channels,
      hasSlack: payload.channels.includes('SLACK') || payload.channels.includes('slack'),
      slackWebhookPrefix: payload.slackWebhook ? payload.slackWebhook.substring(0, 50) : null,
      method: 'GET',
      timestamp: new Date().toISOString()
    }
  }).then(() => {}).catch(() => {});

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

      // TRACE 4: Post-webhook response (error)
      supabaseClient.from('activity_log').insert({
        user_id: payload.userId,
        activity_type: 'notification_webhook_response',
        session_id: traceCorrelationId,
        status: 'error',
        stage: 'post_webhook',
        error_message: errorMsg.substring(0, 400),
        metadata: {
          httpStatus: response.status,
          channels: payload.channels,
          responsePreview: responseText.substring(0, 200),
          timestamp: new Date().toISOString()
        }
      }).then(() => {}).catch(() => {});

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

      // TRACE 3: Post-webhook response (success)
      supabaseClient.from('activity_log').insert({
        user_id: payload.userId,
        activity_type: 'notification_webhook_response',
        session_id: traceCorrelationId,
        status: 'completed',
        stage: 'post_webhook',
        metadata: {
          httpStatus: response.status,
          channels: payload.channels,
          responseMessage: responseJson?.message || null,
          hasChannelResults: !!responseJson?.channelResults,
          timestamp: new Date().toISOString()
        }
      }).then(() => {}).catch(() => {});

      // Parse n8n response for channel-specific results
      if (responseJson?.message === 'Workflow was started') {
        for (const channel of payload.channels) {
          result.channelResults[channel.toLowerCase() as keyof typeof result.channelResults] = {
            success: true,
            details: 'Workflow started - check n8n for final status'
          };
        }
      } else if (responseJson?.channelResults) {
        result.channelResults = responseJson.channelResults;
      } else if (responseJson?.results) {
        for (const [channel, channelResult] of Object.entries(responseJson.results)) {
          const cr = channelResult as any;
          result.channelResults[channel.toLowerCase() as keyof typeof result.channelResults] = {
            success: cr?.success ?? true,
            error: cr?.error,
            details: cr
          };
        }
      } else {
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

  // Don't insert new notification records here - notification-delivery owns the lifecycle
  // Just reference existing notification if provided
  if (existingNotificationId) {
    result.notificationId = existingNotificationId;
  } else {
    console.log('[Webhook] No existingNotificationId provided - skipping record creation');
  }

  return result;
}
