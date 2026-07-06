import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { GLOBAL_VERSION, FUNCTION_IDS, corsHeaders, createHealthResponse } from "../_shared/config.ts";
import { buildCallContext } from "../_shared/call-context-builder.ts";

// Version derived from centralized config
const DELIVERY_VERSION = `${GLOBAL_VERSION}-${FUNCTION_IDS.DELIVERY}`;

// Parse agenda items from context for tracking during the call
function parseAgendaFromContext(context: string): Array<{ index: number; text: string; status: string }> {
  const agenda: Array<{ index: number; text: string; status: string }> = [];
  
  const lines = context.split('\n');
  let itemIndex = 0;
  
  for (const line of lines) {
    const trimmed = line.trim();
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
    const callTime = callConfig.call_time;
    const timezone = callConfig.timezone || 'America/New_York';
    const commsMode = callConfig.comms_mode || 'phone';
    const daysOfWeek = callConfig.days_of_week || null;

    const { error } = await supabaseClient.rpc('schedule_next_call', {
      p_user_id: userId,
      p_call_id: callConfig.call_id,
      p_call_name: callConfig.call_name,
      p_call_time: callTime,
      p_call_context: callConfig.context || '',
      p_timezone: timezone,
      p_comms_mode: commsMode,
      p_days_of_week: daysOfWeek
    });

    if (error) {
      console.error(`Failed to schedule next occurrence for ${callConfig.call_name}:`, error);
    } else {
      console.log(`📅 Scheduled next occurrence of ${callConfig.call_name} (mode: ${commsMode}, days: ${daysOfWeek ? JSON.stringify(daysOfWeek) : 'all'})`);
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

  const url = new URL(req.url);
  
  // === HEALTH CHECK ENDPOINT ===
  if (url.searchParams.get('health') === '1') {
    return new Response(JSON.stringify({
      name: 'notification-delivery',
      version: DELIVERY_VERSION,
      timestamp: new Date().toISOString(),
      status: 'healthy'
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log(`[DELIVERY] Version: ${DELIVERY_VERSION}`);
    console.log('Processing pending notifications...');
    
    const now = new Date();
    const instanceId = crypto.randomUUID();
    
    console.log(`Claiming notifications with instance ID: ${instanceId}`);
    
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
    
    console.log('📋 Claimed notifications:');
    for (const notif of pendingNotifications) {
      console.log(`  - ID: ${notif.id}, Type: ${notif.notification_type}, Scheduled: ${notif.scheduled_for}, Title: "${notif.title}"`);
    }
    
    const scheduledCallNotifications = pendingNotifications.filter(
      (n: any) => n.notification_type === 'scheduled_call'
    );
    const scheduledChatNotifications = pendingNotifications.filter(
      (n: any) => n.notification_type === 'scheduled_chat'
    );
    const regularNotifications = pendingNotifications.filter(
      (n: any) => n.notification_type !== 'scheduled_call' && n.notification_type !== 'scheduled_chat'
    );

    let delivered = 0;
    let failed = 0;

    // Process scheduled_call notifications separately
    for (const callNotification of scheduledCallNotifications) {
      try {
        const userId = callNotification.user_id;
        console.log(`📞 Processing scheduled call for user ${userId}: "${callNotification.title}"`);

        let callConfig: any;
        try {
          callConfig = JSON.parse(callNotification.body);
        } catch {
          callConfig = { call_id: 'custom', context: callNotification.body };
        }

        // Live lookup: read commsMode from user_scheduling_prefs, not the stale notification body
        const { data: userPrefs } = await supabaseClient
          .from('user_scheduling_prefs')
          .select('timezone, scheduled_calls')
          .eq('user_id', userId)
          .maybeSingle();

        const liveCall = (userPrefs?.scheduled_calls ?? [])
          .find((c: any) => c.id === callConfig.call_id);
        const commsMode = liveCall?.commsMode ?? callConfig.comms_mode ?? 'phone';
        console.log(`📞 Scheduled call commsMode (live): ${commsMode} (body had: ${callConfig.comms_mode || '?'})`);

        // Day-of-week guard: skip if today is not in the allowed days
        if (callConfig.days_of_week && Array.isArray(callConfig.days_of_week) && callConfig.days_of_week.length > 0) {
          const tz = callConfig.timezone || 'America/New_York';
          const nowStr = new Date().toLocaleDateString('en-US', { weekday: 'short', timeZone: tz });
          const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
          const todayNum = dayMap[nowStr.slice(0, 3)];

          if (todayNum !== undefined && !callConfig.days_of_week.includes(todayNum)) {
            console.log(`⏭️ Skipping "${callConfig.call_name}": today is day ${todayNum}, allowed: [${callConfig.days_of_week}]`);
            await supabaseClient
              .from('scheduled_notifications')
              .update({
                delivered_at: new Date().toISOString(),
                failure_reason: 'wrong_day_of_week'
              })
              .eq('id', callNotification.id);
            await scheduleNextOccurrence(supabaseClient, userId, callConfig);
            continue;
          }
        }

        let deliverySuccess = false;
        let deliveryError: any = null;

        if (commsMode === 'app_message') {
          console.log(`💬 Routing scheduled call to app chat for user ${userId}`);
          
          const { data: chatResult, error: chatError } = await supabaseClient.functions.invoke('send-chat-message', {
            body: {
              userId,
              generateFromContext: {
                callType: callConfig.call_id || 'custom',
                context: callConfig.context || ''
              },
              sendPush: true
            }
          });

          if (chatError) {
            console.error(`💬 App chat delivery failed for user ${userId}:`, chatError);
            deliveryError = chatError;
          } else {
            console.log(`✅ App chat delivered successfully for user ${userId}: ${callNotification.title}`);
            deliverySuccess = true;
          }

        } else if (commsMode === 'slack' || commsMode === 'email') {
          console.log(`📧 Routing scheduled call to ${commsMode} for user ${userId}`);
          
          const { data: unifiedResult, error: unifiedError } = await supabaseClient.functions.invoke('send-unified-notification', {
            body: {
              userId,
              taskId: null,
              title: callConfig.call_name || callNotification.title,
              body: `Time for your ${(callConfig.call_name || callNotification.title).toLowerCase()}. ${callConfig.context || ''}`,
              channels: [commsMode]
            }
          });

          if (unifiedError) {
            console.error(`📧 ${commsMode} delivery failed for user ${userId}:`, unifiedError);
            deliveryError = unifiedError;
          } else {
            console.log(`✅ ${commsMode} notification delivered for user ${userId}: ${callNotification.title}`);
            deliverySuccess = true;
          }

        } else {
          // === PHONE CALL DELIVERY (default) ===
          const { data: profile } = await supabaseClient
            .from('profiles')
            .select('phone, preferred_greeting')
            .eq('user_id', userId)
            .maybeSingle();

          const FALLBACK_PHONE = '+14434150606';
          let phoneNumber = profile?.phone;
          
          if (!phoneNumber) {
            console.log(`📞 User ${userId}: No phone in profile, using fallback: ${FALLBACK_PHONE}`);
            phoneNumber = FALLBACK_PHONE;
          }

          // Use shared buildCallContext — full window-aware context with task lists + topic groups
          const context = await buildCallContext(
            { callType: callConfig.call_id, context: callConfig.context, name: callConfig.call_name },
            userId,
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
            profile?.preferred_greeting || 'Sir'
          );
          
          const agenda = parseAgendaFromContext(context);

          // === PRE-CONNECT ARCHITECTURE ===
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
            
            console.log(`📞 [INVOKE] twilio-voice-handler with action=trigger-call (fallback)`);
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
            
            console.log(`📞 [INVOKE] twilio-voice-handler with action=trigger-call-with-session, sessionId=${preConnectResult.sessionId}`);
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
            deliveryError = callError;
          } else {
            deliverySuccess = true;
          }
        }

        // Update notification status based on delivery result
        if (deliveryError) {
          console.error(`📞 Delivery failed for user ${userId}:`, deliveryError);
          
          await supabaseClient
            .from('scheduled_notifications')
            .update({
              failed_at: new Date().toISOString(),
              failure_reason: deliveryError.message || 'Delivery failed'
            })
            .eq('id', callNotification.id);
          
          failed++;
        } else {
          console.log(`✅ Delivery successful for user ${userId}: ${callNotification.title} (mode: ${commsMode})`);
          
          await supabaseClient
            .from('scheduled_notifications')
            .update({
              delivered_at: new Date().toISOString(),
              failure_reason: null
            })
            .eq('id', callNotification.id);
          
          delivered++;
        }

        // Schedule the next occurrence for tomorrow (preserves comms_mode)
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

    // Process scheduled_chat notifications
    for (const chatNotification of scheduledChatNotifications) {
      try {
        const userId = chatNotification.user_id;
        console.log(`💬 Processing scheduled chat for user ${userId}: "${chatNotification.title}"`);
        
        const metadata = chatNotification.metadata || {};
        
        const { data: chatResult, error: chatError } = await supabaseClient.functions.invoke('send-chat-message', {
          body: {
            userId,
            message: metadata.message,
            generateFromContext: metadata.message 
              ? undefined 
              : { callType: 'custom', context: metadata.context || 'scheduled check-in' },
            sendPush: true,
            assistantId: metadata.assistantId
          }
        });
        
        if (chatError) {
          console.error(`💬 Chat failed for user ${userId}:`, chatError);
          
          await supabaseClient
            .from('scheduled_notifications')
            .update({
              failed_at: new Date().toISOString(),
              failure_reason: chatError.message || 'Chat delivery failed'
            })
            .eq('id', chatNotification.id);
          
          failed++;
        } else {
          console.log(`✅ Chat delivered successfully for user ${userId}`);
          
          await supabaseClient
            .from('scheduled_notifications')
            .update({
              delivered_at: new Date().toISOString(),
              failure_reason: null
            })
            .eq('id', chatNotification.id);
          
          delivered++;
        }
      } catch (error) {
        console.error(`Failed to process scheduled chat ${chatNotification.id}:`, error);
        
        await supabaseClient
          .from('scheduled_notifications')
          .update({
            failed_at: new Date().toISOString(),
            failure_reason: error instanceof Error ? error.message : 'Unknown error'
          })
          .eq('id', chatNotification.id);
        
        failed++;
      }
    }

    // Process regular notifications (existing logic)
    if (regularNotifications.length > 0) {
      // Group notifications by user and check for quiet hours batching
      const userBatches = new Map();
      
      for (const notification of regularNotifications) {
        const userId = notification.user_id;
        
        if (notification.queued_during_quiet) {
          const summaryKey = `${userId}_daily_summary`;
          if (!userBatches.has(summaryKey)) {
            userBatches.set(summaryKey, []);
          }
          userBatches.get(summaryKey).push(notification);
        } else {
          const batchKey = `${userId}_${Math.floor(new Date(notification.scheduled_for).getTime() / (2 * 60 * 1000))}`;
          if (!userBatches.has(batchKey)) {
            userBatches.set(batchKey, []);
          }
          userBatches.get(batchKey).push(notification);
        }
      }

      console.log(`Grouped into ${userBatches.size} batches`);

      for (const [batchKey, batchNotifications] of userBatches) {
        try {
          const userId = batchNotifications[0].user_id;
          const notificationIds = batchNotifications.map((n: any) => n.id);
          
          console.log(`📦 Processing batch for user ${userId} with ${batchNotifications.length} notifications:`);
          for (const notif of batchNotifications) {
            console.log(`  - ${notif.notification_type} @ ${notif.scheduled_for}: "${notif.title}"`);
          }
          
          const tasksToCheck = batchNotifications
            .filter((n: any) => n.task_id)
            .map((n: any) => n.task_id);
          
          let taskDetails: Record<string, { start_time: string | null; end_time: string | null; estimate_minutes: number | null; title: string }> = {};
          
          if (tasksToCheck.length > 0) {
            const { data: tasks } = await supabaseClient
              .from('tasks')
              .select('id, status, completed_at, start_time, end_time, estimate_minutes, title, due_date')
              .in('id', tasksToCheck);

            if (tasks) {
              for (const task of tasks) {
                taskDetails[task.id] = {
                  start_time: task.start_time,
                  end_time: task.end_time,
                  estimate_minutes: task.estimate_minutes,
                  title: task.title
                };
              }
            }

            // Drop completed tasks
            const completedTaskIds = new Set(
              tasks?.filter((t: any) => t.status === 'DONE' || t.completed_at)
                .map((t: any) => t.id) || []
            );

            // Drop ANCIENT tasks: due_date < today AND start_time IS NULL
            // (these are stale assignments the nightly builder skipped — don't ping the user about them)
            let userTzForFilter = 'America/New_York';
            try {
              const { data: prefRow } = await supabaseClient
                .from('user_scheduling_prefs')
                .select('timezone')
                .eq('user_id', userId)
                .maybeSingle();
              if (prefRow?.timezone) userTzForFilter = prefRow.timezone;
            } catch {}
            const todayStrTz = new Date().toLocaleDateString('en-CA', { timeZone: userTzForFilter });
            const ancientTaskIds = new Set(
              tasks?.filter((t: any) => !t.start_time && t.due_date && String(t.due_date).slice(0, 10) < todayStrTz)
                .map((t: any) => t.id) || []
            );

            const validNotifications = batchNotifications.filter((n: any) => {
              if (n.task_id && completedTaskIds.has(n.task_id)) {
                console.log(`⏭️ Skipping notification ${n.id} - task ${n.task_id} is completed`);
                return false;
              }
              if (n.task_id && ancientTaskIds.has(n.task_id)) {
                console.log(`⏭️ Skipping notification ${n.id} - task ${n.task_id} is ancient (overdue, unscheduled)`);
                return false;
              }
              return true;
            });

            const skippedIds = batchNotifications
              .filter((n: any) => n.task_id && (completedTaskIds.has(n.task_id) || ancientTaskIds.has(n.task_id)))
              .map((n: any) => n.id);

            if (skippedIds.length > 0) {
              await supabaseClient
                .from('scheduled_notifications')
                .update({
                  failed_at: new Date().toISOString(),
                  failure_reason: 'Task completed or ancient'
                })
                .in('id', skippedIds);

              console.log(`❌ Marked ${skippedIds.length} notifications as failed (completed/ancient tasks)`);
              failed += skippedIds.length;
            }

            if (validNotifications.length === 0) {
              console.log('All notifications in batch were for completed/ancient tasks, skipping');
              continue;
            }

            batchNotifications.length = 0;
            batchNotifications.push(...validNotifications);
          }
          
          let title, body;
          
          const isDailySummary = batchKey.includes('daily_summary');
          
          if (batchNotifications.length === 1 && !isDailySummary) {
            title = batchNotifications[0].title;
            body = batchNotifications[0].body;
          } else {
            if (isDailySummary) {
              title = 'Daily Summary';
              body = `You have ${batchNotifications.length} reminders:\n• `;
            } else {
              title = `${batchNotifications.length} Reminders`;
              body = '• ';
            }
            
            const reminderTexts = batchNotifications.map((n: any) => {
              if (n.notification_type === 'scheduled_reminder') return `${n.title}: ${n.body}`;
              if (n.notification_type === 'scheduled_start_now') return `"${n.body.match(/"([^"]+)"/)?.[1] || 'Task'}" is starting now`;
              if (n.notification_type.includes('due_reminder')) return `"${n.body.match(/"([^"]+)"/)?.[1] || 'Task'}" is due`;
              if (n.notification_type.includes('overdue_reminder')) return `"${n.body.match(/"([^"]+)"/)?.[1] || 'Task'}" is overdue`;
              return n.body;
            });
            body += reminderTexts.join('\n• ');
          }

          const { data: userPrefs, error: prefsError } = await supabaseClient
            .from('notification_prefs')
            .select('channels')
            .eq('user_id', userId)
            .maybeSingle();

          const enabledChannels = userPrefs?.channels || ['PUSH'];

          // Determine the Android notification channel based on notification type
          const primaryType = batchNotifications.length === 1 ? batchNotifications[0].notification_type : 'batched_reminders';
          let androidChannel = 'task-reminders';
          if (['calendar_event_reminder', 'task_start_now', 'task_start_reminder'].includes(primaryType)) androidChannel = 'calendar_events';
          else if (primaryType === 'daily_digest' || primaryType === 'batched_reminders') androidChannel = 'messages';

          // Server-side trace for alarm-channel dispatches
          if (androidChannel === 'calendar_events') {
            supabaseClient.from('activity_log').insert({
              user_id: userId,
              activity_type: 'alarm_notification_dispatched',
              status: 'started',
              metadata: {
                primaryType,
                androidChannel,
                fcmTag: 'fcm',
                taskId: batchNotifications.length === 1 ? batchNotifications[0].task_id : null,
                notificationIds,
                batchSize: batchNotifications.length,
                title,
                timestamp: new Date().toISOString()
              }
            }).then(() => {}).catch(() => {});
          }

          const { error: pushError } = await supabaseClient.functions.invoke('send-push-notification', {
            body: {
              userId: userId,
              title: title,
              body: body,
              channel: androidChannel,
              data: {
                type: primaryType,
                taskId: batchNotifications.length === 1 ? batchNotifications[0].task_id : null,
                notificationIds: notificationIds,
                batchSize: batchNotifications.length
              }
            }
          });

          if (pushError) {
            console.error(`Push notification failed: ${pushError.message}`);
          }

          const channelsForDelivery = enabledChannels.filter((channel: string) => {
            return !['PUSH', 'OUTLOOK_EVENT', 'GOOGLE_EVENT'].includes(channel);
          });
          
          if (channelsForDelivery.length > 0) {
            const singleTaskId = batchNotifications.length === 1 ? batchNotifications[0].task_id : null;
            const taskInfo = singleTaskId ? taskDetails[singleTaskId] : null;
            
            const notificationData: Record<string, any> = {
              type: batchNotifications.length === 1 ? batchNotifications[0].notification_type : 'batched_reminders',
              taskId: singleTaskId,
              notificationIds: notificationIds,
              batchSize: batchNotifications.length
            };
            
            if (taskInfo) {
              console.log(`📋 Including task info: start=${taskInfo.start_time}, end=${taskInfo.end_time}`);
              notificationData.startTime = taskInfo.start_time;
              notificationData.endTime = taskInfo.end_time;
              notificationData.estimateMinutes = taskInfo.estimate_minutes;
              notificationData.taskTitle = taskInfo.title;
            }
            
            // TRACE: Pre-handoff to send-unified-notification
            const handoffCorrelation = notificationIds[0] || crypto.randomUUID();
            supabaseClient.from('activity_log').insert({
              user_id: userId,
              activity_type: 'notification_handoff_start',
              session_id: handoffCorrelation,
              status: 'started',
              stage: 'delivery_to_unified',
              metadata: {
                channels: channelsForDelivery,
                notificationIds,
                batchSize: batchNotifications.length,
                title,
                timestamp: new Date().toISOString()
              }
            }).then(() => {}).catch(() => {});

            const { data: unifiedResult, error: unifiedError } = await supabaseClient.functions.invoke('send-unified-notification', {
              body: {
                userId: userId,
                title: title,
                body: body,
                channels: channelsForDelivery,
                data: notificationData,
                notificationId: notificationIds[0]
              }
            });

            // TRACE: Post-handoff result
            supabaseClient.from('activity_log').insert({
              user_id: userId,
              activity_type: 'notification_handoff_end',
              session_id: handoffCorrelation,
              status: unifiedError ? 'error' : 'completed',
              stage: 'delivery_to_unified',
              error_message: unifiedError?.message || null,
              metadata: {
                channels: channelsForDelivery,
                success: !unifiedError,
                resultSummary: unifiedResult ? JSON.stringify(unifiedResult).substring(0, 300) : null,
                timestamp: new Date().toISOString()
              }
            }).then(() => {}).catch(() => {});

            if (unifiedError) {
              console.error(`Unified notification failed: ${unifiedError.message}`);
            }
          }

          if (pushError && enabledChannels.some((channel: string) => ['SLACK', 'EMAIL', 'OUTLOOK_EVENT', 'GOOGLE_EVENT'].includes(channel))) {
            throw new Error(`All notification delivery methods failed`);
          }

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
            
            for (const notif of batchNotifications) {
              supabaseClient.from('activity_log').insert({
                user_id: userId,
                activity_type: 'notification_delivered',
                session_id: notif.id,
                status: 'completed',
                stage: notif.notification_type,
                metadata: { 
                  task_id: notif.task_id,
                  channels: enabledChannels,
                  title: notif.title,
                  notification_type: notif.notification_type
                }
              }).then(() => {
                console.log(`[DELIVERY] Activity logged: notification_delivered for ${notif.notification_type}`);
              }).catch(() => {
                // Silently ignore logging failures
              });
            }
          }

        } catch (error) {
          console.error(`Failed to deliver batch ${batchKey}:`, error);
          
          const notificationIds = batchNotifications.map((n: any) => n.id);
          
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
