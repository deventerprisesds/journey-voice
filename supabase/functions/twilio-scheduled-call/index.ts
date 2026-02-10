import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
  commsMode?: CommsMode; // NEW: Delivery method (default: 'phone')
}

interface ScheduledCallConfig {
  userId?: string;
  callType: 'morning_briefing' | 'task_reminder' | 'custom';
  context?: string;
  trigger?: string;
  checkRecurring?: boolean;
}

// Map categories to window affinities (from schedulingRules.ts)
const CATEGORY_WINDOW_MAPPING: Record<string, string[]> = {
  'CAREER': ['business_hours'],
  'PROF_EDUCATION': ['after_work', 'evening', 'weekends'],
  'EDUCATION': ['business_hours', 'after_work'],
  'VENTURES': ['after_work', 'evening', 'weekends'],
  'LIFE': ['morning', 'after_work', 'evening', 'weekends'],
  'PERSONAL': ['morning', 'after_work', 'evening', 'weekends'],
};

// Window time ranges
const WINDOW_RANGES: Record<string, { start: number; end: number }> = {
  morning: { start: 6, end: 9 },
  business_hours: { start: 9, end: 17 },
  after_work: { start: 17, end: 19 },
  evening: { start: 19, end: 22 },
  weekends: { start: 10, end: 20 }
};

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

// Get tasks for a specific time window (excluding test and blocked)
async function getTasksForWindow(
  supabase: any, 
  userId: string, 
  window: string,
  timezone: string
): Promise<any[]> {
  const now = new Date();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  // Query tasks that are not test/blocked
  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, start_time, priority, category, status, due_date')
    .eq('user_id', userId)
    .neq('status', 'BLOCKED')
    .neq('status', 'DONE')
    .not('title', 'ilike', '%test%')
    .or(`start_time.gte.${today.toISOString()},due_date.gte.${today.toISOString().split('T')[0]}`)
    .order('start_time', { ascending: true, nullsFirst: false });

  if (error || !data) {
    console.error('[WINDOW-CONTEXT] Error fetching tasks:', error);
    return [];
  }

  // Filter by window affinity based on category
  const windowRange = WINDOW_RANGES[window];
  if (!windowRange) return data;

  return data.filter((task: any) => {
    const category = task.category || 'LIFE';
    const categoryWindows = CATEGORY_WINDOW_MAPPING[category] || ['flexible'];
    
    // Check if category matches window
    if (!categoryWindows.includes(window) && !categoryWindows.includes('flexible')) {
      return false;
    }

    // If task has start_time, check if it falls within window
    if (task.start_time) {
      const taskTime = new Date(task.start_time);
      const taskHour = taskTime.getHours();
      return taskHour >= windowRange.start && taskHour < windowRange.end;
    }

    return true;
  });
}

// Get topics for "memory jog" fallback
async function getTopicsForWindow(
  supabase: any, 
  userId: string, 
  window: string
): Promise<any[]> {
  const { data, error } = await supabase
    .from('task_topic_index')
    .select('topic_name, topic_summary, example_tasks')
    .eq('user_id', userId)
    .contains('window_affinity', [window])
    .order('task_count', { ascending: false })
    .limit(5);
  
  if (error) {
    console.error('[WINDOW-CONTEXT] Error fetching topics:', error);
    return [];
  }

  return data || [];
}

// Format task list for context
function formatTaskList(tasks: any[]): string {
  if (tasks.length === 0) return 'No tasks scheduled';
  
  return tasks.slice(0, 10).map((t: any, i: number) => {
    const time = t.start_time ? new Date(t.start_time).toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    }) : 'Unscheduled';
    const priority = t.priority === 'HIGH' || t.priority === 'URGENT' ? ' [HIGH]' : '';
    return `${i + 1}. ${t.title} (${time})${priority}`;
  }).join('\n');
}

// Build window transition context with branching
async function buildWindowTransitionContext(
  call: ScheduledCall, 
  userId: string, 
  window: string,
  preferredGreeting: string = 'Sir'
): Promise<string> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  // Get user timezone
  const { data: prefs } = await supabase
    .from('user_scheduling_prefs')
    .select('timezone')
    .eq('user_id', userId)
    .maybeSingle();
  const timezone = prefs?.timezone || 'America/New_York';
  
  // Get tasks for this window
  const windowTasks = await getTasksForWindow(supabase, userId, window, timezone);
  
  console.log(`[WINDOW-CONTEXT] Window: ${window}, Found ${windowTasks.length} tasks for user ${userId}`);
  
  // Special handling for morning window: get all tasks for rest of day
  let allDayTasks: any[] = [];
  if (window === 'morning') {
    const { data: dayTasks } = await supabase
      .from('tasks')
      .select('id, title, start_time, priority, category, status')
      .eq('user_id', userId)
      .neq('status', 'BLOCKED')
      .neq('status', 'DONE')
      .not('title', 'ilike', '%test%')
      .gte('start_time', new Date().toISOString())
      .order('start_time', { ascending: true });
    
    allDayTasks = (dayTasks || []).filter((t: any) => {
      if (!t.start_time) return false;
      const taskHour = new Date(t.start_time).getHours();
      return taskHour >= 9; // After morning window
    });
  }
  
  if (windowTasks.length > 0 || (window === 'morning' && allDayTasks.length > 0)) {
    // BRANCH 1: Tasks exist
    return buildBranch1Context(call.name, windowTasks, allDayTasks, window, preferredGreeting);
  } else {
    // BRANCH 2: No tasks - topic jog fallback
    const topics = await getTopicsForWindow(supabase, userId, window);
    return buildBranch2Context(call.name, topics, window, preferredGreeting);
  }
}

// Build Branch 1 context (tasks exist)
function buildBranch1Context(
  callName: string, 
  windowTasks: any[], 
  allDayTasks: any[],
  window: string,
  preferredGreeting: string = 'Sir'
): string {
  const windowTaskList = formatTaskList(windowTasks);
  const restOfDayList = allDayTasks.length > 0 ? formatTaskList(allDayTasks) : '';
  
  const windowLabel = window === 'morning' ? 'Morning'
    : window === 'business_hours' ? 'Business Hours'
    : window === 'after_work' ? 'After Work'
    : window === 'evening' ? 'Evening'
    : 'Weekend';

  let context = `CALL TYPE: ${callName} (Tasks Available)

[CALL AGENDA - MUST COVER ALL]
1. Greet: "Hello ${preferredGreeting}."
2. Share ${windowLabel.toLowerCase()} tasks:
${windowTaskList}
`;

  if (window === 'morning' && restOfDayList) {
    context += `
3. Share rest of day overview:
${restOfDayList}
4. Ask: "Would you like to confirm these for today, adjust them, or skip?"
5. If confirm: "Understood. I will call you back later. Goodbye."
6. If adjust: Capture edits, confirm changes.`;
  } else {
    context += `
3. Ask: "Which one do you want to start with?" or "Would you like to confirm, adjust, or skip?"
4. If confirm: Acknowledge and close.
5. If adjust: Capture edits, confirm changes.`;
  }

  context += `

Remember: Keep it natural and conversational. Cover all agenda items before ending.`;

  return context;
}

// Build Branch 2 context (no tasks - topic jog)
function buildBranch2Context(
  callName: string,
  topics: any[],
  window: string,
  preferredGreeting: string = 'Sir'
): string {
  const windowLabel = window === 'morning' ? 'Morning'
    : window === 'business_hours' ? 'Business Hours'
    : window === 'after_work' ? 'After Work'
    : window === 'evening' ? 'Evening'
    : 'Weekend';

  if (window === 'morning') {
    // Morning with no tasks: brief wake-up nudge
    return `CALL TYPE: ${callName} (No Tasks)

[CALL AGENDA]
1. Greet: "Hello ${preferredGreeting}."
2. Say: "I am just calling to help you get started with your day. I will call you back in a few hours to go over plans. Goodbye."

Remember: Keep it brief and encouraging.`;
  }

  if (topics.length === 0) {
    return `CALL TYPE: ${callName} (Open Schedule)

[CALL AGENDA - CONVERSATIONAL, DO NOT RUSH]
1. Greet: "Hello ${preferredGreeting}."
2. Say: "Your schedule is open for the ${windowLabel.toLowerCase()} window. What are you thinking about working on? I can help you get something scheduled."
3. Have a natural conversation about what they might want to focus on. Ask follow-up questions. Explore priorities.
4. If they mention something specific: Help them think through timing and next steps. Offer to create a task or schedule it.
5. If they genuinely want to keep it open: "Sounds good. Enjoy the free time. I will check back at the next scheduled call."

IMPORTANT: Do NOT rush to end the call. This is a planning conversation, not a notification. Take your time. Ask questions. Be curious about their plans.`;
  }

  const topicList = topics.map((t: any) => 
    `- ${t.topic_name}: ${t.topic_summary || 'Various tasks'}`
  ).join('\n');

  return `CALL TYPE: ${callName} (Topic Jog)

[CALL AGENDA - MUST COVER ALL]
1. Greet: "Hello ${preferredGreeting}."
2. Topic jog: "You have no scheduled items for the ${windowLabel.toLowerCase()} window. To jog your memory, here are the main topics you have been working on:
${topicList}
Do you want to work on any of these right now?"
3. If yes to a topic: List real tasks under that topic, ask which to include, push to scheduler.
4. If no: "Understood. I will check back at the next scheduled call. Goodbye."

Remember: Let the user lead the selection. Keep it conversational.`;
}

// Build structured context with clear agenda items the AI must cover
async function buildCallContext(call: ScheduledCall, userId: string, preferredGreeting: string = 'Sir'): Promise<string> {
  // Check for window marker in context
  const windowMatch = call.context?.match(/\[WINDOW:(\w+)\]/);
  
  if (windowMatch) {
    const window = windowMatch[1];
    console.log(`[BUILD-CONTEXT] Detected window transition call: ${window}`);
    return buildWindowTransitionContext(call, userId, window, preferredGreeting);
  }

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

    // Check master toggle - skip if disabled
    if (user.recurring_calls_enabled === false) {
      console.log(`[RECURRING] User ${userId}: Master toggle OFF, skipping all calls`);
      continue;
    }

    if (scheduledCalls.length === 0) continue;

    // Get current time in user's timezone
    const currentHHMM = getTimeInTimezone(now, timezone);
    console.log(`[RECURRING] User ${userId}: timezone=${timezone}, current time=${currentHHMM}`);

    // Get user's phone number and preferred greeting from profiles
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

    // Check each scheduled call
    for (const call of scheduledCalls) {
      if (!call.enabled) continue;
      processed++;

      if (isTimeMatch(currentHHMM, call.time)) {
        const commsMode = call.commsMode || 'phone';
        console.log(`[RECURRING] User ${userId}: Triggering ${call.name} at ${call.time} via ${commsMode}`);
        
        try {
          // Route based on communication mode
          if (commsMode === 'app_message') {
            // NEW: Send via in-app chat + push notification
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
            // Route via send-unified-notification
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
            // Default: phone call via twilio-voice-handler
            const context = await buildCallContext(call, userId, preferredGreeting);

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
