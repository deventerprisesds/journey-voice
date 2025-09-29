import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    console.log('Processing pending notifications...');
    
    const now = new Date();
    const instanceId = crypto.randomUUID();
    
    console.log(`Claiming notifications with instance ID: ${instanceId}`);
    
    // Claim notifications safely to prevent double processing
    const { data: pendingNotifications, error: fetchError } = await supabaseClient
      .rpc('claim_due_notifications', {
        claim_limit: 50,
        instance_id: instanceId
      });

    if (fetchError) {
      console.error('Error fetching pending notifications:', fetchError);
      throw fetchError;
    }

    if (!pendingNotifications || pendingNotifications.length === 0) {
      console.log('No pending notifications to process');
      return new Response(
        JSON.stringify({ success: true, processed: 0, message: 'No pending notifications' }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`Claimed ${pendingNotifications.length} notifications for processing`);
    
    // Group notifications by user and check for quiet hours batching
    const userBatches = new Map();
    
    for (const notification of pendingNotifications) {
      const userId = notification.user_id;
      
      // If this is queued during quiet hours, create a daily summary batch
      if (notification.queued_during_quiet) {
        const summaryKey = `${userId}_daily_summary`;
        if (!userBatches.has(summaryKey)) {
          userBatches.set(summaryKey, []);
        }
        userBatches.get(summaryKey).push(notification);
      } else {
        // Regular batching by 2-minute time windows
        const batchKey = `${userId}_${Math.floor(new Date(notification.scheduled_for).getTime() / (2 * 60 * 1000))}`;
        if (!userBatches.has(batchKey)) {
          userBatches.set(batchKey, []);
        }
        userBatches.get(batchKey).push(notification);
      }
    }

    console.log(`Grouped into ${userBatches.size} batches`);
    
    let delivered = 0;
    let failed = 0;

    // Process each batch
    for (const [batchKey, batchNotifications] of userBatches) {
      try {
        const userId = batchNotifications[0].user_id;
        const notificationIds = batchNotifications.map((n: any) => n.id);
        
        console.log(`Processing batch for user ${userId} with ${batchNotifications.length} notifications`);
        
        let title, body;
        
        // Check if this is a daily summary batch (quiet hours)
        const isDailySummary = batchKey.includes('daily_summary');
        
        if (batchNotifications.length === 1 && !isDailySummary) {
          // Single notification
          title = batchNotifications[0].title;
          body = batchNotifications[0].body;
        } else {
          // Multiple notifications or daily summary - batch them
          if (isDailySummary) {
            title = 'Daily Summary';
            body = `You have ${batchNotifications.length} reminders:\n• `;
          } else {
            title = `${batchNotifications.length} Reminders`;
            body = '• ';
          }
          
          const reminderTexts = batchNotifications.map((n: any) => {
            // Simplify the reminder text for batching
            if (n.notification_type === 'scheduled_reminder') return `${n.title}: ${n.body}`;
            if (n.notification_type === 'scheduled_start_now') return `"${n.body.match(/"([^"]+)"/)?.[1] || 'Task'}" is starting now`;
            if (n.notification_type.includes('due_reminder')) return `"${n.body.match(/"([^"]+)"/)?.[1] || 'Task'}" is due`;
            if (n.notification_type.includes('overdue_reminder')) return `"${n.body.match(/"([^"]+)"/)?.[1] || 'Task'}" is overdue`;
            return n.body;
          });
          body += reminderTexts.join('\n• ');
        }

        // Get user's notification preferences to determine which channels to use
        const { data: userPrefs, error: prefsError } = await supabaseClient
          .from('notification_prefs')
          .select('channels')
          .eq('user_id', userId)
          .maybeSingle();

        // Default to push notifications, but also send to configured channels
        const enabledChannels = userPrefs?.channels || ['PUSH'];

        // Send push notification (existing behavior)
        const { data: pushResult, error: pushError } = await supabaseClient.functions.invoke('send-push-notification', {
          body: {
            userId: userId,
            title: title,
            body: body,
            data: {
              type: batchNotifications.length === 1 ? batchNotifications[0].notification_type : 'batched_reminders',
              taskId: batchNotifications.length === 1 ? batchNotifications[0].task_id : null,
              notificationIds: notificationIds,
              batchSize: batchNotifications.length
            }
          }
        });

        if (pushError) {
          console.error(`Push notification failed: ${pushError.message}`);
        }

        // Send unified notification for other channels (Slack, Email, etc.)
        if (enabledChannels.some((channel: string) => ['SLACK', 'EMAIL', 'OUTLOOK_EVENT', 'GOOGLE_EVENT'].includes(channel))) {
          const { data: unifiedResult, error: unifiedError } = await supabaseClient.functions.invoke('send-unified-notification', {
            body: {
              userId: userId,
              title: title,
              body: body,
              channels: enabledChannels.filter((channel: string) => ['SLACK', 'EMAIL', 'OUTLOOK_EVENT', 'GOOGLE_EVENT'].includes(channel)),
              data: {
                type: batchNotifications.length === 1 ? batchNotifications[0].notification_type : 'batched_reminders',
                taskId: batchNotifications.length === 1 ? batchNotifications[0].task_id : null,
                notificationIds: notificationIds,
                batchSize: batchNotifications.length
              }
            }
          });

          if (unifiedError) {
            console.error(`Unified notification failed: ${unifiedError.message}`);
          }
        }

        // Continue if at least one notification method succeeded
        if (pushError && enabledChannels.some((channel: string) => ['SLACK', 'EMAIL', 'OUTLOOK_EVENT', 'GOOGLE_EVENT'].includes(channel))) {
          throw new Error(`All notification delivery methods failed`);
        }

        // Mark all in batch as delivered
        const { error: updateError } = await supabaseClient
          .from('scheduled_notifications')
          .update({ 
            delivered_at: new Date().toISOString(),
            failure_reason: null
          })
          .in('id', notificationIds);

        if (updateError) {
          console.error('Error updating notification status:', updateError);
          failed += batchNotifications.length;
        } else {
          console.log(`Successfully delivered batch for user ${userId} (${batchNotifications.length} notifications)`);
          delivered += batchNotifications.length;
        }

      } catch (error) {
        console.error(`Failed to deliver batch ${batchKey}:`, error);
        
        const notificationIds = batchNotifications.map((n: any) => n.id);
        
        // Mark all in batch as failed
        const { error: failError } = await supabaseClient
          .from('scheduled_notifications')
          .update({ 
            failed_at: new Date().toISOString(),
            failure_reason: error instanceof Error ? error.message : String(error) || 'Unknown error'
          })
          .in('id', notificationIds);

        if (failError) {
          console.error('Error updating notification failure status:', failError);
        }
        
        failed += batchNotifications.length;
      }
    }

    console.log(`Notification processing complete: ${delivered} delivered, ${failed} failed`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        processed: pendingNotifications.length,
        delivered,
        failed,
        message: `Processed ${pendingNotifications.length} notifications: ${delivered} delivered, ${failed} failed`
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error: any) {
    console.error('Error in notification delivery function:', error);
    
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});