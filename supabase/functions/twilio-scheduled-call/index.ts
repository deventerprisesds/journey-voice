import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface ScheduledCall {
  id: string;
  name: string;
  time: string; // HH:mm format
  enabled: boolean;
  callType: 'morning_standup' | 'midday_checkin' | 'eod_wrapup' | 'custom';
  context: string;
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

// Build structured context with clear agenda items the AI must cover
async function buildCallContext(call: ScheduledCall, userId: string): Promise<string> {
  const briefing = await getTodaysBriefing(userId);
  
  // Base context from user's custom configuration
  const userContext = call.context || '';
  
  switch (call.callType) {
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

    case 'custom':
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

// Check if current time matches scheduled time (±1 minute tolerance)
function isTimeMatch(currentHHMM: string, scheduledTime: string): boolean {
  const [currentH, currentM] = currentHHMM.split(':').map(Number);
  const [scheduledH, scheduledM] = scheduledTime.split(':').map(Number);
  
  const currentMinutes = currentH * 60 + currentM;
  const scheduledMinutes = scheduledH * 60 + scheduledM;
  
  // Allow ±1 minute tolerance
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
    // Fallback to UTC
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

  // Get all users with scheduled calls and their phone numbers
  const { data: users, error: usersError } = await supabase
    .from('user_scheduling_prefs')
    .select(`
      user_id,
      timezone,
      scheduled_calls
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

    if (scheduledCalls.length === 0) continue;

    // Get current time in user's timezone
    const currentHHMM = getTimeInTimezone(now, timezone);
    console.log(`[RECURRING] User ${userId}: timezone=${timezone}, current time=${currentHHMM}`);

    // Get user's phone number from profiles
    const { data: profile } = await supabase
      .from('profiles')
      .select('phone')
      .eq('user_id', userId)
      .maybeSingle();

    const phoneNumber = profile?.phone;
    if (!phoneNumber) {
      console.log(`[RECURRING] User ${userId}: No phone number configured, skipping`);
      continue;
    }

    // Check each scheduled call
    for (const call of scheduledCalls) {
      if (!call.enabled) continue;
      processed++;

      if (isTimeMatch(currentHHMM, call.time)) {
        console.log(`[RECURRING] User ${userId}: Triggering ${call.name} at ${call.time}`);
        
        try {
          // Build context based on call type
          const context = await buildCallContext(call, userId);

          // Trigger the call via twilio-voice-handler
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
            console.log(`[RECURRING] User ${userId}: Call triggered successfully for ${call.name}`);
          } else {
            errors.push(`User ${userId}: Failed to trigger ${call.name} - ${result.error}`);
            console.error(`[RECURRING] User ${userId}: Failed to trigger ${call.name}:`, result.error);
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
    
    // Try to parse body if present
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

    // Build context based on call type
    let context = config.context || '';
    
    if (config.callType === 'morning_briefing' && config.userId) {
      context = await getTodaysBriefing(config.userId);
    } else if (config.callType === 'morning_briefing') {
      context = 'your morning schedule briefing';
    }

    // Trigger the call via twilio-voice-handler
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
