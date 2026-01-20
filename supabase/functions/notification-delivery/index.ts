import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Build structured context with clear agenda items the AI must cover
async function buildCallContext(callConfig: any, userId: string, supabaseClient: any): Promise<string> {
  // Get today's tasks for briefing
  const today = new Date();
  const startOfDay = new Date(today.setHours(0, 0, 0, 0)).toISOString();
  const endOfDay = new Date(today.setHours(23, 59, 59, 999)).toISOString();

  const { data: tasks } = await supabaseClient
    .from('tasks')
    .select('title, start_time, priority, category, status')
    .eq('user_id', userId)
    .gte('start_time', startOfDay)
    .lte('start_time', endOfDay)
    .order('start_time', { ascending: true });

  let briefing = 'your daily schedule';
  if (tasks && tasks.length > 0) {
    const taskCount = tasks.length;
    const highPriorityCount = tasks.filter((t: any) => t.priority === 'HIGH' || t.priority === 'URGENT').length;
    const completedCount = tasks.filter((t: any) => t.status === 'DONE').length;
    
    briefing = `${taskCount} task${taskCount > 1 ? 's' : ''} scheduled for today`;
    if (highPriorityCount > 0) {
      briefing += `, including ${highPriorityCount} high priority item${highPriorityCount > 1 ? 's' : ''}`;
    }
    if (completedCount > 0) {
      briefing += `. ${completedCount} already completed`;
    }
  }

  const userContext = callConfig.context || '';
  const callId = callConfig.call_id || 'custom';

  switch (callId) {
    case 'morning_standup':
      return `CALL TYPE: Morning Stand-up
      
[CALL AGENDA - MUST COVER ALL]
1. Greet warmly and mention it's the morning check-in
2. Share today's schedule overview: ${briefing}
3. Highlight any high-priority or urgent tasks
4. Ask if there's anything they want to add to today's schedule
5. Ask if there are any blockers or concerns for today
6. Offer encouragement and wish them a productive day

USER NOTES: ${userContext}

Remember: Cover ALL 6 agenda items naturally before ending the call.`;

    case 'midday_checkin':
      return `CALL TYPE: Midday Check-in

[CALL AGENDA - MUST COVER ALL]
1. Greet and mention it's the midday check-in
2. Ask how the day is going so far
3. Check on progress: ${briefing}
4. Ask if anything is blocking progress or needs rescheduling
5. Ask if they need any help or want to reprioritize
6. Offer a quick motivational note before ending

USER NOTES: ${userContext}

Remember: Cover ALL 6 agenda items naturally before ending the call.`;

    case 'eod_wrapup':
      return `CALL TYPE: End of Day Wrap-up

[CALL AGENDA - MUST COVER ALL]
1. Greet and acknowledge the end of the workday
2. Summarize what was accomplished today: ${briefing}
3. Note any tasks that weren't completed and ask if they should be rescheduled
4. Ask what the top priorities should be for tomorrow
5. Ask if there's anything specific they want to tackle tonight or first thing tomorrow
6. Wish them a good evening and encourage rest/downtime

USER NOTES: ${userContext}

Remember: Cover ALL 6 agenda items naturally before ending the call.`;

    default:
      if (!userContext) {
        return 'CALL TYPE: Custom Scheduled Call\n\n[CALL AGENDA]\n1. Greet the user\n2. Ask what they need help with\n\nThis is a user-scheduled call - follow their lead.';
      }
      
      return `CALL TYPE: Custom Scheduled Call

[CALL AGENDA - FROM USER CONFIGURATION]
${userContext}

Interpret the user notes above as your agenda. Cover all mentioned topics before ending the call.`;
  }
}

// Parse agenda items from context for tracking during the call
function parseAgendaFromContext(context: string): Array<{ index: number; text: string; status: string }> {
  const agenda: Array<{ index: number; text: string; status: string }> = [];
  
  // Find lines that look like numbered agenda items
  const lines = context.split('\n');
  let itemIndex = 0;
  
  for (const line of lines) {
    const trimmed = line.trim();
    // Match patterns like "1. Greet warmly" or "1) Greet warmly"
    const match = trimmed.match(/^(\d+)[.)\s]+(.+)$/);
    if (match) {
      agenda.push({
        index: itemIndex++,
        text: match[2].trim(),
        status: 'pending'
      });
    }
  }
  
  console.log(`📋 Parsed ${agenda.length} agenda items from context`);
  return agenda;
}

// Schedule the next occurrence of a call after it's been delivered
async function scheduleNextOccurrence(supabaseClient: any, userId: string, callConfig: any): Promise<void> {
  try {
    const callTime = callConfig.call_time; // e.g., "11:00:00"
    const timezone = callConfig.timezone || 'America/New_York';

    // Call the database function to schedule next occurrence
    const { error } = await supabaseClient.rpc('schedule_next_call', {
      p_user_id: userId,
      p_call_id: callConfig.call_id,
      p_call_name: callConfig.call_name,
      p_call_time: callTime,
      p_call_context: callConfig.context || '',
      p_timezone: timezone
    });

    if (error) {
      console.error(`Failed to schedule next occurrence for ${callConfig.call_name}:`, error);
    } else {
      console.log(`📅 Scheduled next occurrence of ${callConfig.call_name} for tomorrow`);
    }
  } catch (error) {
    console.error('Error scheduling next call occurrence:', error);
  }
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
    
    // Log each notification for observability
    console.log('📋 Claimed notifications:');
    for (const notif of pendingNotifications) {
      console.log(`  - ID: ${notif.id}, Type: ${notif.notification_type}, Scheduled: ${notif.scheduled_for}, Title: "${notif.title}"`);
    }
    
    // Separate scheduled_call notifications from regular notifications
    const scheduledCallNotifications = pendingNotifications.filter(
      (n: any) => n.notification_type === 'scheduled_call'
    );
    const regularNotifications = pendingNotifications.filter(
      (n: any) => n.notification_type !== 'scheduled_call'
    );

    let delivered = 0;
    let failed = 0;

    // Demo user ID - skip scheduled calls for this user to prevent duplicate calls
    const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';

    // Process scheduled_call notifications separately
    for (const callNotification of scheduledCallNotifications) {
      try {
        const userId = callNotification.user_id;
        
        // CRITICAL: Skip calls for demo user to prevent duplicate calls to fallback phone
        if (userId === DEMO_USER_ID) {
          console.log(`📞 Skipping scheduled call for DEMO user: "${callNotification.title}"`);
          // Mark as delivered to prevent re-processing
          await supabaseClient
            .from('scheduled_notifications')
            .update({ delivered_at: new Date().toISOString() })
            .eq('id', callNotification.id);
          continue;
        }
        
        console.log(`📞 Processing scheduled call for user ${userId}: "${callNotification.title}"`);

        // Parse call configuration from body
        let callConfig: any;
        try {
          callConfig = JSON.parse(callNotification.body);
        } catch {
          callConfig = { call_id: 'custom', context: callNotification.body };
        }

        // Get user's phone number from profiles
        const { data: profile } = await supabaseClient
          .from('profiles')
          .select('phone')
          .eq('user_id', userId)
          .maybeSingle();

        // Fallback phone number for demo/testing when user has no phone configured
        const FALLBACK_PHONE = '+14434150606';
        let phoneNumber = profile?.phone;
        
        if (!phoneNumber) {
          console.log(`📞 User ${userId}: No phone in profile, using fallback: ${FALLBACK_PHONE}`);
          phoneNumber = FALLBACK_PHONE;
        }

        // Build context based on call type
        const context = await buildCallContext(callConfig, userId, supabaseClient);
        
        // Parse agenda items from context for tracking
        const agenda = parseAgendaFromContext(context);

        // Get user preferences for timezone
        const { data: userPrefs } = await supabaseClient
          .from('user_scheduling_prefs')
          .select('timezone')
          .eq('user_id', userId)
          .maybeSingle();

        // === PRE-CONNECT ARCHITECTURE ===
        // Step 1: Establish OpenAI session BEFORE placing call to eliminate greeting latency
        console.log(`📞 Pre-connecting OpenAI session for user ${userId}...`);
        
        const { data: preConnectResult, error: preConnectError } = await supabaseClient.functions.invoke(
          'twilio-realtime-bridge',
          {
            body: {
              mode: 'pre-connect',
              userId,
              context,
              agenda,
              timezone: userPrefs?.timezone || 'America/New_York',
              phoneNumber
            }
          }
        );

        let callResult: any;
        let callError: any;

        if (preConnectError || !preConnectResult?.sessionId) {
          console.error(`⚠️ Pre-connect failed, falling back to live greeting:`, preConnectError);
          
          // Fallback to existing behavior - call triggers greeting live
          const fallbackResult = await supabaseClient.functions.invoke('twilio-voice-handler', {
            body: {
              action: 'trigger-call',
              userId,
              context,
              phoneNumber,
            }
          });
          callResult = fallbackResult.data;
          callError = fallbackResult.error;
        } else {
          console.log(`✅ Pre-connected session: ${preConnectResult.sessionId}`);
          console.log(`🎙️ Greeting cached (${preConnectResult.audioBytes || 0} bytes): "${(preConnectResult.greetingText || '').substring(0, 50)}..."`);
          
          // Step 2: Place call with reference to existing session
          const sessionCallResult = await supabaseClient.functions.invoke('twilio-voice-handler', {
            body: {
              action: 'trigger-call-with-session',
              userId,
              phoneNumber,
              sessionId: preConnectResult.sessionId,
              cachedAudioBase64: preConnectResult.audioBase64,
              greetingText: preConnectResult.greetingText,
              agenda: preConnectResult.agenda,
              context,
              timezone: userPrefs?.timezone || 'America/New_York'
            }
          });
          callResult = sessionCallResult.data;
          callError = sessionCallResult.error;
        }

        if (callError) {
          console.error(`📞 Call failed for user ${userId}:`, callError);
          
          await supabaseClient
            .from('scheduled_notifications')
            .update({
              failed_at: new Date().toISOString(),
              failure_reason: callError.message || 'Call failed'
            })
            .eq('id', callNotification.id);
          
          failed++;
        } else {
          console.log(`✅ Call triggered successfully for user ${userId}: ${callNotification.title}`);
          
          await supabaseClient
            .from('scheduled_notifications')
            .update({
              delivered_at: new Date().toISOString(),
              failure_reason: null
            })
            .eq('id', callNotification.id);
          
          delivered++;
        }

        // Schedule the next occurrence for tomorrow
        await scheduleNextOccurrence(supabaseClient, userId, callConfig);

      } catch (error) {
        console.error(`Failed to process scheduled call ${callNotification.id}:`, error);
        
        await supabaseClient
          .from('scheduled_notifications')
          .update({
            failed_at: new Date().toISOString(),
            failure_reason: error instanceof Error ? error.message : 'Unknown error'
          })
          .eq('id', callNotification.id);
        
        failed++;
      }
    }

    // Process regular notifications (existing logic)
    if (regularNotifications.length > 0) {
      // Group notifications by user and check for quiet hours batching
      const userBatches = new Map();
      
      for (const notification of regularNotifications) {
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

      // Process each batch
      for (const [batchKey, batchNotifications] of userBatches) {
        try {
          const userId = batchNotifications[0].user_id;
          const notificationIds = batchNotifications.map((n: any) => n.id);
          
          console.log(`📦 Processing batch for user ${userId} with ${batchNotifications.length} notifications:`);
          for (const notif of batchNotifications) {
            console.log(`  - ${notif.notification_type} @ ${notif.scheduled_for}: "${notif.title}"`);
          }
          
          // Check if tasks are completed before sending notifications
          const tasksToCheck = batchNotifications
            .filter((n: any) => n.task_id)
            .map((n: any) => n.task_id);
          
          if (tasksToCheck.length > 0) {
            const { data: tasks } = await supabaseClient
              .from('tasks')
              .select('id, status, completed_at')
              .in('id', tasksToCheck);
            
            const completedTaskIds = new Set(
              tasks?.filter((t: any) => t.status === 'DONE' || t.completed_at)
                .map((t: any) => t.id) || []
            );
            
            // Filter out notifications for completed tasks
            const validNotifications = batchNotifications.filter((n: any) => {
              if (n.task_id && completedTaskIds.has(n.task_id)) {
                console.log(`⏭️ Skipping notification ${n.id} - task ${n.task_id} is completed`);
                return false;
              }
              return true;
            });
            
            // Mark skipped notifications as failed
            const skippedIds = batchNotifications
              .filter((n: any) => n.task_id && completedTaskIds.has(n.task_id))
              .map((n: any) => n.id);
            
            if (skippedIds.length > 0) {
              await supabaseClient
                .from('scheduled_notifications')
                .update({
                  failed_at: new Date().toISOString(),
                  failure_reason: 'Task completed'
                })
                .in('id', skippedIds);
              
              console.log(`❌ Marked ${skippedIds.length} notifications as failed (completed tasks)`);
              failed += skippedIds.length;
            }
            
            // If all notifications were skipped, continue to next batch
            if (validNotifications.length === 0) {
              console.log('All notifications in batch were for completed tasks, skipping');
              continue;
            }
            
            // Update to only process valid notifications
            batchNotifications.length = 0;
            batchNotifications.push(...validNotifications);
          }
          
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