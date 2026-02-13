import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildCallContext } from '../_shared/call-context-builder.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Communication mode for recurring calls
type CommsMode = 'phone' | 'app_message' | 'slack' | 'email';

interface ScheduledCall {
  id: string;
  name: string;
  time: string; // HH:mm format
  enabled: boolean;
  callType: 'morning_standup' | 'midday_checkin' | 'eod_wrapup' | 'custom';
  context: string;
  commsMode?: CommsMode;
  fallbackMode?: CommsMode;
}
interface ScheduledCallConfig {
  userId?: string;
  callType: 'morning_briefing' | 'task_reminder' | 'custom';
  context?: string;
  trigger?: string;
  checkRecurring?: boolean;
}

// Get today's tasks for briefing context
async function getTodaysBriefing(userId: string): Promise<string> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const today = new Date();
  const startOfDay = new Date(today.setHours(0, 0, 0, 0)).toISOString();
  const endOfDay = new Date(today.setHours(23, 59, 59, 999)).toISOString();

  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('title, start_time, priority, category, status')
    .eq('user_id', userId)
    .gte('start_time', startOfDay)
    .lte('start_time', endOfDay)
    .order('start_time', { ascending: true });

  if (error || !tasks || tasks.length === 0) {
    return 'your daily schedule';
  }

  const taskCount = tasks.length;
  const highPriorityCount = tasks.filter(t => t.priority === 'HIGH' || t.priority === 'URGENT').length;
  const completedCount = tasks.filter(t => t.status === 'DONE').length;
  
  let briefing = `${taskCount} task${taskCount > 1 ? 's' : ''} scheduled for today`;
  if (highPriorityCount > 0) {
    briefing += `, including ${highPriorityCount} high priority item${highPriorityCount > 1 ? 's' : ''}`;
  }
  if (completedCount > 0) {
    briefing += `. ${completedCount} already completed`;
  }
  
  return briefing;
}

// Check if current time matches scheduled time (±1 minute tolerance)
function isTimeMatch(currentHHMM: string, scheduledTime: string): boolean {
  const [currentH, currentM] = currentHHMM.split(':').map(Number);
  const [scheduledH, scheduledM] = scheduledTime.split(':').map(Number);
  
  const currentMinutes = currentH * 60 + currentM;
  const scheduledMinutes = scheduledH * 60 + scheduledM;
  
  return Math.abs(currentMinutes - scheduledMinutes) <= 1;
}

// Format time in user's timezone
function getTimeInTimezone(date: Date, timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone,
    });
    return formatter.format(date);
  } catch {
    return date.toISOString().slice(11, 16);
  }
}

// Process recurring calls for all users
async function processRecurringCalls(): Promise<{ processed: number; triggered: number; errors: string[] }> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const now = new Date();
  const errors: string[] = [];
  let processed = 0;
  let triggered = 0;

  console.log('[RECURRING] Starting recurring calls check at:', now.toISOString());

  const { data: users, error: usersError } = await supabase
    .from('user_scheduling_prefs')
    .select(`
      user_id,
      timezone,
      scheduled_calls,
      recurring_calls_enabled
    `)
    .not('scheduled_calls', 'is', null);

  if (usersError) {
    console.error('[RECURRING] Error fetching users:', usersError);
    return { processed: 0, triggered: 0, errors: [usersError.message] };
  }

  if (!users || users.length === 0) {
    console.log('[RECURRING] No users with scheduled calls found');
    return { processed: 0, triggered: 0, errors: [] };
  }

  console.log(`[RECURRING] Found ${users.length} users with scheduled calls`);

  for (const user of users) {
    const userId = user.user_id;
    const timezone = user.timezone || 'America/New_York';
    const scheduledCalls = (user.scheduled_calls as ScheduledCall[]) || [];

    if (user.recurring_calls_enabled === false) {
      console.log(`[RECURRING] User ${userId}: Master toggle OFF, skipping all calls`);
      continue;
    }

    if (scheduledCalls.length === 0) continue;

    const currentHHMM = getTimeInTimezone(now, timezone);
    console.log(`[RECURRING] User ${userId}: timezone=${timezone}, current time=${currentHHMM}`);

    const { data: profile } = await supabase
      .from('profiles')
      .select('phone, preferred_greeting')
      .eq('user_id', userId)
      .maybeSingle();

    const phoneNumber = profile?.phone;
    const preferredGreeting = profile?.preferred_greeting || 'Sir';
    if (!phoneNumber) {
      console.log(`[RECURRING] User ${userId}: No phone number configured, skipping`);
      continue;
    }

    for (const call of scheduledCalls) {
      if (!call.enabled) continue;

      // Weekend day-of-week guard
      const isWeekendCall = call.context?.includes('[WINDOW:weekends]');
      if (isWeekendCall) {
        const dayOfWeek = new Date().toLocaleDateString('en-US', { 
          weekday: 'long', timeZone: timezone 
        });
        if (dayOfWeek !== 'Saturday' && dayOfWeek !== 'Sunday') {
          console.log(`[RECURRING] Skipping weekend call "${call.name}" on ${dayOfWeek}`);
          continue;
        }
      }

      processed++;

      if (isTimeMatch(currentHHMM, call.time)) {
        const commsMode = call.commsMode || 'phone';
        console.log(`[RECURRING] User ${userId}: Triggering ${call.name} at ${call.time} via ${commsMode}`);
        
        try {
          if (commsMode === 'app_message') {
            const response = await fetch(`${supabaseUrl}/functions/v1/send-chat-message`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${supabaseServiceKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                userId,
                generateFromContext: {
                  callType: call.callType,
                  context: call.context
                },
                sendPush: true
              }),
            });

            const result = await response.json();
            
            if (result.success) {
              triggered++;
              console.log(`[RECURRING] User ${userId}: Chat message sent for ${call.name}`);
            } else {
              errors.push(`User ${userId}: Failed to send chat message for ${call.name} - ${result.error}`);
              console.error(`[RECURRING] User ${userId}: Failed to send chat for ${call.name}:`, result.error);
            }
          } else if (commsMode === 'slack' || commsMode === 'email') {
            const response = await fetch(`${supabaseUrl}/functions/v1/send-unified-notification`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${supabaseServiceKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                userId,
                taskId: null,
                title: call.name,
                body: `Time for your ${call.name.toLowerCase()}. ${call.context || ''}`,
                channels: [commsMode],
                metadata: { callType: call.callType }
              }),
            });

            const result = await response.json();
            
            if (result.success) {
              triggered++;
              console.log(`[RECURRING] User ${userId}: ${commsMode} notification sent for ${call.name}`);
            } else {
              errors.push(`User ${userId}: Failed to send ${commsMode} for ${call.name} - ${result.error}`);
            }
          } else {
            // Phone call — use shared buildCallContext
            const context = await buildCallContext(
              { callType: call.callType, context: call.context, name: call.name },
              userId,
              supabaseUrl,
              supabaseServiceKey,
              preferredGreeting
            );
            console.log(`[RECURRING] User ${userId}: Built context for ${call.name}, length=${context.length}`);

            let callTriggered = false;

            try {
              const preConnectResponse = await fetch(`${supabaseUrl}/functions/v1/twilio-realtime-bridge`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${supabaseServiceKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  mode: 'pre-connect',
                  userId,
                  context,
                  timezone,
                }),
              });

              const preConnectResult = await preConnectResponse.json();

              if (preConnectResult.sessionId) {
                console.log(`[RECURRING] User ${userId}: Pre-connect session created: ${preConnectResult.sessionId}`);

                const callResponse = await fetch(`${supabaseUrl}/functions/v1/twilio-voice-handler`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${supabaseServiceKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    action: 'trigger-call-with-session',
                    userId,
                    phoneNumber,
                    sessionId: preConnectResult.sessionId,
                    greetingText: preConnectResult.greetingText || '',
                  }),
                });

                const callResult = await callResponse.json();

                if (callResult.success) {
                  callTriggered = true;
                  triggered++;
                  console.log(`[RECURRING] User ${userId}: Call triggered via pre-connect session for ${call.name}`);
                } else {
                  console.warn(`[RECURRING] User ${userId}: trigger-call-with-session failed for ${call.name}: ${callResult.error}`);
                }
              } else {
                console.warn(`[RECURRING] User ${userId}: Pre-connect failed for ${call.name}: ${preConnectResult.error || 'no sessionId'}`);
              }
            } catch (preConnectError) {
              console.warn(`[RECURRING] User ${userId}: Pre-connect exception for ${call.name}:`, preConnectError);
            }

            // Fallback: use legacy trigger-call if pre-connect path failed
            if (!callTriggered) {
              console.log(`[RECURRING] User ${userId}: Falling back to trigger-call for ${call.name}`);
              const response = await fetch(`${supabaseUrl}/functions/v1/twilio-voice-handler`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${supabaseServiceKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  action: 'trigger-call',
                  userId,
                  context,
                  phoneNumber,
                }),
              });

              const result = await response.json();
              
              if (result.success) {
                triggered++;
                console.log(`[RECURRING] User ${userId}: Call triggered via fallback for ${call.name}`);
              } else {
                errors.push(`User ${userId}: Failed to trigger ${call.name} - ${result.error}`);
                console.error(`[RECURRING] User ${userId}: Failed to trigger ${call.name}:`, result.error);
              }
            }
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          errors.push(`User ${userId}: Error triggering ${call.name} - ${errorMsg}`);
          console.error(`[RECURRING] User ${userId}: Error triggering ${call.name}:`, error);
        }
      }
    }
  }

  console.log(`[RECURRING] Completed: processed=${processed}, triggered=${triggered}, errors=${errors.length}`);
  return { processed, triggered, errors };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let config: ScheduledCallConfig = { callType: 'morning_briefing' };
    
    try {
      const body = await req.json();
      config = { ...config, ...body };
    } catch {
      // No body or invalid JSON, use defaults
    }

    // Check if this is a recurring calls check (triggered by cron)
    if (config.trigger === 'cron' && config.checkRecurring) {
      console.log('[CRON] Processing recurring calls...');
      const result = await processRecurringCalls();
      
      return new Response(JSON.stringify({
        success: true,
        type: 'recurring_check',
        ...result
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // For manual/direct calls, use the legacy behavior
    const phoneNumber = Deno.env.get('MY_PHONE_NUMBER');
    if (!phoneNumber) {
      console.log('No phone number configured for scheduled calls');
      return new Response(JSON.stringify({
        success: false,
        error: 'MY_PHONE_NUMBER not configured'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let context = config.context || '';
    
    if (config.callType === 'morning_briefing' && config.userId) {
      context = await getTodaysBriefing(config.userId);
    } else if (config.callType === 'morning_briefing') {
      context = 'your morning schedule briefing';
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/twilio-voice-handler`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'trigger-call',
        userId: config.userId,
        context,
        phoneNumber,
      }),
    });

    const result = await response.json();
    
    console.log('Scheduled call result:', result);

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in twilio-scheduled-call:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
