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

// Get topic groups built FROM actual window-aligned tasks (not static window_affinity)
async function getTopicGroupsFromWindowTasks(
  supabase: any,
  userId: string,
  window: string
): Promise<any[]> {
  // Get categories that map to this window
  const windowCategories = Object.entries(CATEGORY_WINDOW_MAPPING)
    .filter(([_, windows]) => windows.includes(window))
    .map(([cat]) => cat);

  if (windowCategories.length === 0) return [];

  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase.rpc('get_topic_groups_for_tasks', {
    p_user_id: userId,
    p_categories: windowCategories,
    p_recency_cutoff: fourteenDaysAgo
  }).limit(5);

  // Fallback: if RPC doesn't exist, do it manually with multiple queries
  if (error) {
    console.log('[TOPIC-GROUPS] RPC not available, using manual join approach');
    return getTopicGroupsManual(supabase, userId, windowCategories);
  }

  return data || [];
}

// Get topic groups from ALL open tasks (fallback when window-specific is empty)
async function getTopicGroupsFromAllTasks(
  supabase: any,
  userId: string
): Promise<any[]> {
  return getTopicGroupsManual(supabase, userId, null);
}

// Manual topic grouping: query tasks → mappings → topics
async function getTopicGroupsManual(
  supabase: any,
  userId: string,
  categories: string[] | null
): Promise<any[]> {
  // Step 1: Get open tasks (optionally filtered by category)
  let query = supabase
    .from('tasks')
    .select('id, title, category, priority, updated_at')
    .eq('user_id', userId)
    .neq('status', 'BLOCKED')
    .neq('status', 'DONE')
    .not('title', 'ilike', '%test%');

  if (categories && categories.length > 0) {
    query = query.in('category', categories);
  }

  const { data: tasks, error: tasksErr } = await query;
  if (tasksErr || !tasks || tasks.length === 0) return [];

  const taskIds = tasks.map((t: any) => t.id);

  // Step 2: Get topic mappings for these tasks
  const { data: mappings, error: mapErr } = await supabase
    .from('task_topic_mappings')
    .select('task_id, topic_id')
    .in('task_id', taskIds);

  if (mapErr || !mappings || mappings.length === 0) return [];

  const topicIds = [...new Set(mappings.map((m: any) => m.topic_id))];

  // Step 3: Get topic details
  const { data: topics, error: topErr } = await supabase
    .from('task_topic_index')
    .select('id, topic_name, topic_summary')
    .in('id', topicIds);

  if (topErr || !topics || topics.length === 0) return [];

  // Step 4: Build grouped + ranked results
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const taskMap = new Map(tasks.map((t: any) => [t.id, t]));
  const topicTaskMap = new Map<string, string[]>();

  for (const m of mappings) {
    if (!topicTaskMap.has(m.topic_id)) topicTaskMap.set(m.topic_id, []);
    topicTaskMap.get(m.topic_id)!.push(m.task_id);
  }

  const results = topics.map((topic: any) => {
    const tIds = topicTaskMap.get(topic.id) || [];
    const topicTasks = tIds.map((id: string) => taskMap.get(id)).filter(Boolean);
    const taskCount = topicTasks.length;
    const recency = topicTasks.filter((t: any) => new Date(t.updated_at) >= fourteenDaysAgo).length;
    const priorityDensity = topicTasks.filter((t: any) => t.priority === 'HIGH' || t.priority === 'URGENT').length;

    return {
      topic_name: topic.topic_name,
      topic_summary: topic.topic_summary,
      task_count: taskCount,
      recency,
      priority_density: priorityDensity
    };
  });

  // Sort: recency DESC, priority_density DESC, task_count DESC
  results.sort((a: any, b: any) =>
    b.recency - a.recency || b.priority_density - a.priority_density || b.task_count - a.task_count
  );

  return results.slice(0, 5);
}

// Format topic groups for context
function formatTopicGroups(topics: any[]): string {
  if (topics.length === 0) return '';
  return topics.map((t: any, i: number) => {
    const suffix = t.priority_density > 0 ? ` [${t.priority_density} high-priority]` : '';
    return `${i + 1}. ${t.topic_name} (${t.task_count} tasks)${suffix}`;
  }).join('\n');
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

// Context header instructing AI to drive naturally
const AGENDA_HEADER = `IMPORTANT: The items below are your agenda queue in priority order.
Cover them in sequence but drive the conversation naturally.
Do NOT read these items verbatim -- use your own words.
Use your available tools for any changes the user requests.`;

// Build window transition context with per-window scripts
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
  
  // Get tier 1 topic groups (from window-aligned tasks) and tier 2 fallback (all tasks)
  const [tier1Topics, tier2Topics] = await Promise.all([
    getTopicGroupsFromWindowTasks(supabase, userId, window),
    getTopicGroupsFromAllTasks(supabase, userId)
  ]);

  console.log(`[WINDOW-CONTEXT] Tier 1 topics: ${tier1Topics.length}, Tier 2 topics: ${tier2Topics.length}`);

  // Detect weekend day name
  const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  return buildWindowContext(
    window, windowTasks, tier1Topics, tier2Topics, preferredGreeting, dayName
  );
}

// Single function that produces per-window agenda context
function buildWindowContext(
  window: string,
  tasks: any[],
  tier1Topics: any[],
  tier2Topics: any[],
  preferredGreeting: string,
  dayName: string
): string {
  const hasTasks = tasks.length > 0;
  const taskList = formatTaskList(tasks);
  const tier1List = formatTopicGroups(tier1Topics);
  const tier2List = formatTopicGroups(tier2Topics);

  switch (window) {
    // ─── 6:00 AM — Morning Kickstart ─────────────────────────
    case 'morning':
      if (hasTasks) {
        return `${AGENDA_HEADER}

CALL: Morning Kickstart (Tasks Available)
GREETING: Address user as "${preferredGreeting}"

AGENDA QUEUE:
1. Greet user
2. Remind them of their morning tasks:
${taskList}
3. Ask: confirm these for this morning, adjust, or skip?
4. If CONFIRM → Acknowledge, mention you will call back later to go over plans. Close.
5. If ADJUST → Capture edits using reschedule_task or update_task. Confirm changes. Close.`;
      } else {
        return `${AGENDA_HEADER}

CALL: Morning Kickstart (No Tasks)
GREETING: Address user as "${preferredGreeting}"

AGENDA QUEUE:
1. Greet user
2. Brief nudge: the day is starting, you will call back in a few hours to go over plans. Close.

NOTE: No topic jog for morning. Keep this call lightweight.`;
      }

    // ─── 9:00 AM — Business Hours Execution ──────────────────
    case 'business_hours':
      if (hasTasks) {
        return `${AGENDA_HEADER}

CALL: Business Hours Execution (Tasks Available)
GREETING: Address user as "${preferredGreeting}"

AGENDA QUEUE:
1. Greet user
2. If user goes on a tangent, handle it, then return to the plan
3. Present business-hours tasks:
${taskList}
4. Ask: "Which one do you want to start with?"
5. If they pick one → mark in progress via update_task`;
      } else {
        return `${AGENDA_HEADER}

CALL: Business Hours Execution (No Tasks — Topic Jog)
GREETING: Address user as "${preferredGreeting}"

AGENDA QUEUE:
1. Greet user
2. Tell them they have no scheduled items for the next few hours
${tier1List ? `3. Present these business-hour topic groups to jog memory:
${tier1List}
4. Ask if they want to work on any of these right now
5. If YES → Use get_tasks to drill into that topic. Help them select tasks. Use parse_and_create_tasks to schedule into available slots. Confirm.
6. If NO → Acknowledge, mention next check-in. Close.` : `3. Say: "I don't see any potential items for business hours. Do you want to look for items across the entire board?"
4. If YES → Present these broader topic groups:
${tier2List || '(No topics found across the board either)'}
   Use get_tasks to drill into selected topic. Help select tasks. Use parse_and_create_tasks to schedule. Confirm.
5. If NO → Acknowledge, mention next check-in. Close.`}`;
      }

    // ─── 5:00 PM — Daily Wrap + After-Work ───────────────────
    case 'after_work':
      const phase2 = hasTasks
        ? `PHASE 2 — After-Work Items:
5. Present after-work tasks:
${taskList}
6. Ask: keep as-is, adjust, or skip?
7. If ADJUST → Capture edits via tools. Confirm.`
        : tier1List
        ? `PHASE 2 — After-Work Topic Jog:
5. Tell them they have no scheduled after-work items
6. Present these after-work topic groups to jog memory:
${tier1List}
7. Ask if they want to work on any of these during this time window
8. If YES → Use get_tasks to drill in. Help select. Use parse_and_create_tasks to schedule. Confirm.
9. If NO → Acknowledge. Close.`
        : `PHASE 2 — After-Work Topic Jog (Broadened):
5. Say: "I don't see any potential items for after work. Do you want to look for items across the entire board?"
6. If YES → Present these broader topic groups:
${tier2List || '(No topics found)'}
   Use get_tasks to drill in. Help select. Use parse_and_create_tasks to schedule. Confirm.
7. If NO → Acknowledge. Close.`;

      return `${AGENDA_HEADER}

CALL: Daily Wrap + After-Work (Two Phases)
GREETING: Address user as "${preferredGreeting}"

PHASE 1 — Status Wrapup:
1. Greet user
2. Say you want to review how today went and capture status updates
3. Ask: any tasks completed today to mark done? → Use update_task with status DONE
4. Ask: any tasks blocked or to move to another day? → Use update_task or reschedule_task

${phase2}

CLOSE: Confirm you captured their updates.`;

    // ─── 7:00 PM — Evening Work Items ────────────────────────
    case 'evening':
      if (hasTasks) {
        return `${AGENDA_HEADER}

CALL: Evening Work Items (Tasks Available)
GREETING: Address user as "${preferredGreeting}" — warm evening tone

AGENDA QUEUE:
1. Greet user warmly (evening tone)
2. Present evening tasks:
${taskList}
3. Ask: confirm, adjust, or skip?
4. If ADJUST → Capture edits via tools. Confirm.

CLOSE: Wish them a good evening.`;
      } else {
        return `${AGENDA_HEADER}

CALL: Evening Work Items (No Tasks — Topic Jog)
GREETING: Address user as "${preferredGreeting}" — warm evening tone

AGENDA QUEUE:
1. Greet user warmly (evening tone)
2. Tell them they have no scheduled evening items
${tier1List ? `3. Present these evening topic groups to jog memory:
${tier1List}
4. Ask if they want to work on any of these tonight
5. If YES → Use get_tasks to drill in. Help select. Use parse_and_create_tasks to schedule. Confirm.
6. If NO → Acknowledge.` : `3. Say: "I don't see any potential items for this evening. Do you want to look for items across the entire board?"
4. If YES → Present these broader topic groups:
${tier2List || '(No topics found)'}
   Use get_tasks to drill in. Help select. Use parse_and_create_tasks to schedule. Confirm.
5. If NO → Acknowledge.`}

CLOSE: Wish them a good evening.`;
      }

    // ─── Weekend 10:00 AM — Saturday/Sunday ──────────────────
    case 'weekends':
      if (hasTasks) {
        return `${AGENDA_HEADER}

CALL: Weekend Check-in — ${dayName} (Tasks Available)
GREETING: Address user as "${preferredGreeting}" — relaxed weekend tone

AGENDA QUEUE:
1. Greet user (weekend tone, reference ${dayName})
2. Present weekend tasks for today:
${taskList}
3. Ask: confirm, adjust, or skip?
4. If ADJUST → Capture edits via tools. Confirm.

CLOSE: Wish them an enjoyable weekend.`;
      } else {
        return `${AGENDA_HEADER}

CALL: Weekend Check-in — ${dayName} (No Tasks — Topic Jog)
GREETING: Address user as "${preferredGreeting}" — relaxed weekend tone

AGENDA QUEUE:
1. Greet user (weekend tone, reference ${dayName})
2. Tell them they have no scheduled items for today
${tier1List ? `3. Present these life/weekend topic groups to jog memory:
${tier1List}
4. Ask if they want to work on any of these today
5. If YES → Use get_tasks to drill in. Help select. Use parse_and_create_tasks to schedule. Confirm.
6. If NO → Acknowledge.` : `3. Say: "I don't see any potential items for today. Do you want to look for items across the entire board?"
4. If YES → Present these broader topic groups:
${tier2List || '(No topics found)'}
   Use get_tasks to drill in. Help select. Use parse_and_create_tasks to schedule. Confirm.
5. If NO → Acknowledge.`}

CLOSE: Wish them an enjoyable weekend.`;
      }

    default:
      return `${AGENDA_HEADER}

CALL: Scheduled Check-in
GREETING: Address user as "${preferredGreeting}"

AGENDA QUEUE:
1. Greet user
2. Ask what they would like to focus on
3. Help them plan and schedule using available tools

CLOSE: Confirm any updates captured.`;
  }
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

  // Legacy call types → map to windows and use the same per-window logic
  const legacyWindowMap: Record<string, string> = {
    'morning_standup': 'morning',
    'midday_checkin': 'business_hours',
    'eod_wrapup': 'after_work'
  };

  const mappedWindow = legacyWindowMap[call.callType];
  if (mappedWindow) {
    console.log(`[BUILD-CONTEXT] Legacy callType ${call.callType} → window ${mappedWindow}`);
    return buildWindowTransitionContext(call, userId, mappedWindow, preferredGreeting);
  }

  // Custom calls remain unchanged
  const userContext = call.context || '';
  if (!userContext) {
    return `${AGENDA_HEADER}\n\nCALL: Custom Scheduled Call\n\nAGENDA QUEUE:\n1. Greet the user\n2. Ask what they need help with\n\nThis is a user-scheduled call — follow their lead.`;
  }
  
  return `${AGENDA_HEADER}\n\nCALL: Custom Scheduled Call\n\n[AGENDA FROM USER CONFIGURATION]\n${userContext}\n\nInterpret the user notes above as your agenda. Cover all mentioned topics before ending the call.`;
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
