/**
 * Shared Call Context Builder
 * 
 * Extracted from twilio-scheduled-call — the single source of truth for
 * window-aware call context generation. Used by both notification-delivery
 * and twilio-scheduled-call pipelines.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── Generic call descriptor accepted by both pipelines ──────────────
export interface CallDescriptor {
  callType?: string;   // 'morning_standup' | 'midday_checkin' | 'eod_wrapup' | 'custom'
  context?: string;    // User-configured context (may contain [WINDOW:xxx])
  name?: string;       // Call name for logging
}

// ── Constants ───────────────────────────────────────────────────────

// Map categories to window affinities (from schedulingRules.ts)
export const CATEGORY_WINDOW_MAPPING: Record<string, string[]> = {
  'CAREER': ['business_hours'],
  'PROF_EDUCATION': ['after_work', 'evening', 'weekends'],
  'EDUCATION': ['business_hours', 'after_work'],
  'VENTURES': ['after_work', 'evening', 'weekends'],
  'LIFE': ['morning', 'after_work', 'evening', 'weekends'],
  'PERSONAL': ['morning', 'after_work', 'evening', 'weekends'],
};

// Window time ranges
export const WINDOW_RANGES: Record<string, { start: number; end: number }> = {
  morning: { start: 6, end: 9 },
  business_hours: { start: 9, end: 17 },
  after_work: { start: 17, end: 19 },
  evening: { start: 19, end: 22 },
  weekends: { start: 10, end: 20 }
};

// Context header instructing AI to drive naturally
export const AGENDA_HEADER = `IMPORTANT: The items below are your agenda queue in priority order.
Cover them in sequence but drive the conversation naturally.
Do NOT read these items verbatim -- use your own words.
Use your available tools for any changes the user requests.

NOTE: On pre-connected calls, a cached audio greeting plays automatically before
you receive this context. A system message will confirm this happened. When you see
that confirmation, step 1 (greeting) is already done -- skip it entirely and start
from the next item. Do NOT greet the user again.

CRITICAL: NEVER invent, assume, or fabricate task names or details.
Only present tasks that are either:
  (a) explicitly listed in this context as data, OR
  (b) returned by the get_tasks or get_tasks_by_topic tool at runtime.
If you do not have task data, you MUST call the appropriate tool before describing any tasks to the user.

TOPIC DRILL-DOWN RULE:
Topic group names are for memory jogging only -- do NOT guess what tasks are in them.
When the user selects a topic group, you MUST call get_tasks_by_topic with that topic name.
If get_tasks_by_topic returns 0 tasks, tell the user "I don't have any active tasks under that topic right now" — do NOT invent tasks.`;

// ── Today's Briefing ────────────────────────────────────────────────

export async function getTodaysBriefing(
  supabase: any,
  userId: string
): Promise<string> {
  const today = new Date();
  const startOfDay = new Date(today);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(today);
  endOfDay.setHours(23, 59, 59, 999);

  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('title, start_time, priority, category, status')
    .eq('user_id', userId)
    .gte('start_time', startOfDay.toISOString())
    .lte('start_time', endOfDay.toISOString())
    .order('start_time', { ascending: true });

  if (error || !tasks || tasks.length === 0) {
    return 'your daily schedule';
  }

  const taskCount = tasks.length;
  const highPriorityCount = tasks.filter((t: any) =>
    t.priority === 'HIGH' || t.priority === 'URGENT'
  ).length;
  const completedCount = tasks.filter((t: any) => t.status === 'DONE').length;

  let briefing = `${taskCount} task${taskCount > 1 ? 's' : ''} scheduled for today`;
  if (highPriorityCount > 0) {
    briefing += `, including ${highPriorityCount} high priority item${highPriorityCount > 1 ? 's' : ''}`;
  }
  if (completedCount > 0) {
    briefing += `. ${completedCount} already completed`;
  }
  return briefing;
}

// ── Task & Topic Fetchers ───────────────────────────────────────────

// Get tasks for a specific time window (excluding test and blocked)
export async function getTasksForWindow(
  supabase: any,
  userId: string,
  window: string,
  timezone: string
): Promise<any[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

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

  const windowRange = WINDOW_RANGES[window];
  if (!windowRange) return data;

  return data.filter((task: any) => {
    const category = task.category || 'LIFE';
    const categoryWindows = CATEGORY_WINDOW_MAPPING[category] || ['flexible'];

    if (!categoryWindows.includes(window) && !categoryWindows.includes('flexible')) {
      return false;
    }

    if (task.start_time) {
      const taskTime = new Date(task.start_time);
      const taskHour = taskTime.getHours();
      return taskHour >= windowRange.start && taskHour < windowRange.end;
    }

    return true;
  });
}

// Get topic groups built FROM actual window-aligned tasks
export async function getTopicGroupsFromWindowTasks(
  supabase: any,
  userId: string,
  window: string
): Promise<any[]> {
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

  if (error) {
    console.log('[TOPIC-GROUPS] RPC not available, using manual join approach');
    return getTopicGroupsManual(supabase, userId, windowCategories);
  }

  return data || [];
}

// Get topic groups from ALL open tasks (fallback when window-specific is empty)
export async function getTopicGroupsFromAllTasks(
  supabase: any,
  userId: string
): Promise<any[]> {
  return getTopicGroupsManual(supabase, userId, null);
}

// Manual topic grouping: query tasks → mappings → topics
export async function getTopicGroupsManual(
  supabase: any,
  userId: string,
  categories: string[] | null
): Promise<any[]> {
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

  const { data: mappings, error: mapErr } = await supabase
    .from('task_topic_mappings')
    .select('task_id, topic_id')
    .in('task_id', taskIds);

  if (mapErr || !mappings || mappings.length === 0) return [];

  const topicIds = [...new Set(mappings.map((m: any) => m.topic_id))];

  const { data: topics, error: topErr } = await supabase
    .from('task_topic_index')
    .select('id, topic_name, topic_summary')
    .in('id', topicIds);

  if (topErr || !topics || topics.length === 0) return [];

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

  results.sort((a: any, b: any) =>
    b.recency - a.recency || b.priority_density - a.priority_density || b.task_count - a.task_count
  );

  return results.slice(0, 5);
}

// ── Formatters ──────────────────────────────────────────────────────

export function formatTopicGroups(topics: any[]): string {
  if (topics.length === 0) return '';
  return topics.map((t: any, i: number) => {
    const suffix = t.priority_density > 0 ? ` [${t.priority_density} high-priority]` : '';
    return `${i + 1}. ${t.topic_name} (${t.task_count} tasks)${suffix}`;
  }).join('\\n');
}

export function formatTaskList(tasks: any[]): string {
  if (tasks.length === 0) return 'No tasks scheduled';

  return tasks.slice(0, 10).map((t: any, i: number) => {
    const time = t.start_time ? new Date(t.start_time).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }) : 'Unscheduled';
    const priority = t.priority === 'HIGH' || t.priority === 'URGENT' ? ' [HIGH]' : '';
    return `${i + 1}. ${t.title} (${time})${priority}`;
  }).join('\\n');
}

// ── Per-Window Context Builder ──────────────────────────────────────

export function buildWindowContext(
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
        return `${AGENDA_HEADER}\n
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
        return `${AGENDA_HEADER}\n
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
        return `${AGENDA_HEADER}\n
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
        return `${AGENDA_HEADER}\n
CALL: Business Hours Execution (No Tasks — Topic Jog)
GREETING: Address user as "${preferredGreeting}"

AGENDA QUEUE:
1. Greet user
2. Tell them they have no scheduled items for the next few hours
${tier1List ? `3. Present these business-hour topic groups to jog memory:
${tier1List}
4. Ask if they want to work on any of these right now
5. If YES → Use get_tasks_by_topic to drill into that topic. Help them select tasks. Use parse_and_create_tasks to schedule into available slots. Confirm.
6. If NO → Acknowledge, mention next check-in. Close.` : `3. Say: "I don't see any potential items for business hours. Do you want to look for items across the entire board?"
4. If YES → Present these broader topic groups:
${tier2List || '(No topics found across the board either)'}
   Use get_tasks_by_topic to drill into selected topic. Help select tasks. Use parse_and_create_tasks to schedule. Confirm.
5. If NO → Acknowledge, mention next check-in. Close.`}`;
      }

    // ─── 5:00 PM — Daily Wrap + After-Work ───────────────────
    case 'after_work': {
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
8. If YES → Use get_tasks_by_topic to drill in. Help select. Use parse_and_create_tasks to schedule. Confirm.
9. If NO → Acknowledge. Close.`
        : `PHASE 2 — After-Work Topic Jog (Broadened):
5. Say: "I don't see any potential items for after work. Do you want to look for items across the entire board?"
6. If YES → Present these broader topic groups:
${tier2List || '(No topics found)'}
   Use get_tasks_by_topic to drill in. Help select. Use parse_and_create_tasks to schedule. Confirm.
7. If NO → Acknowledge. Close.`;

      return `${AGENDA_HEADER}\n
CALL: Daily Wrap + After-Work (Two Phases)
GREETING: Address user as "${preferredGreeting}"

PHASE 1 — Status Wrapup:
1. Greet user
2. Say you want to review how today went and capture status updates
3. Ask: any tasks completed today to mark done? → Use update_task with status DONE
4. Ask: any tasks blocked or to move to another day? → Use update_task or reschedule_task

${phase2}

CLOSE: Confirm you captured their updates.`;
    }

    // ─── 7:00 PM — Evening Work Items ────────────────────────
    case 'evening':
      if (hasTasks) {
        return `${AGENDA_HEADER}\n
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
        return `${AGENDA_HEADER}\n
CALL: Evening Work Items (No Tasks — Topic Jog)
GREETING: Address user as "${preferredGreeting}" — warm evening tone

AGENDA QUEUE:
1. Greet user warmly (evening tone)
2. Tell them they have no scheduled evening items
${tier1List ? `3. Present these evening topic groups to jog memory:
${tier1List}
4. Ask if they want to work on any of these tonight
5. If YES → Use get_tasks_by_topic to drill in. Help select. Use parse_and_create_tasks to schedule. Confirm.
6. If NO → Acknowledge.` : `3. Say: "I don't see any potential items for this evening. Do you want to look for items across the entire board?"
4. If YES → Present these broader topic groups:
${tier2List || '(No topics found)'}
   Use get_tasks_by_topic to drill in. Help select. Use parse_and_create_tasks to schedule. Confirm.
5. If NO → Acknowledge.`}

CLOSE: Wish them a good evening.`;
      }

    // ─── Weekend 10:00 AM — Saturday/Sunday ──────────────────
    case 'weekends':
      if (hasTasks) {
        return `${AGENDA_HEADER}\n
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
        return `${AGENDA_HEADER}\n
CALL: Weekend Check-in — ${dayName} (No Tasks — Topic Jog)
GREETING: Address user as "${preferredGreeting}" — relaxed weekend tone

AGENDA QUEUE:
1. Greet user (weekend tone, reference ${dayName})
2. Tell them they have no scheduled items for today
${tier1List ? `3. Present these life/weekend topic groups to jog memory:
${tier1List}
4. Ask if they want to work on any of these today
5. If YES → Use get_tasks_by_topic to drill in. Help select. Use parse_and_create_tasks to schedule. Confirm.
6. If NO → Acknowledge.` : `3. Say: "I don't see any potential items for today. Do you want to look for items across the entire board?"
4. If YES → Present these broader topic groups:
${tier2List || '(No topics found)'}
   Use get_tasks_by_topic to drill in. Help select. Use parse_and_create_tasks to schedule. Confirm.
5. If NO → Acknowledge.`}

CLOSE: Wish them an enjoyable weekend.`;
      }

    default:
      return `${AGENDA_HEADER}\n
CALL: Scheduled Check-in
GREETING: Address user as "${preferredGreeting}"

AGENDA QUEUE:
1. Greet user
2. Ask what they would like to focus on
3. Help them plan and schedule using available tools

CLOSE: Confirm any updates captured.`;
  }
}

// ── Window Transition Context (queries DB, builds context) ──────────

export async function buildWindowTransitionContext(
  call: CallDescriptor,
  userId: string,
  window: string,
  supabaseUrl: string,
  supabaseServiceKey: string,
  preferredGreeting: string = 'Sir'
): Promise<string> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { data: prefs } = await supabase
    .from('user_scheduling_prefs')
    .select('timezone')
    .eq('user_id', userId)
    .maybeSingle();
  const timezone = prefs?.timezone || 'America/New_York';

  const windowTasks = await getTasksForWindow(supabase, userId, window, timezone);

  console.log(`[WINDOW-CONTEXT] Window: ${window}, Found ${windowTasks.length} tasks for user ${userId}`);

  const [tier1Topics, tier2Topics] = await Promise.all([
    getTopicGroupsFromWindowTasks(supabase, userId, window),
    getTopicGroupsFromAllTasks(supabase, userId)
  ]);

  console.log(`[WINDOW-CONTEXT] Tier 1 topics: ${tier1Topics.length}, Tier 2 topics: ${tier2Topics.length}`);

  const dayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  return buildWindowContext(window, windowTasks, tier1Topics, tier2Topics, preferredGreeting, dayName);
}

// ── Main Entry Point ────────────────────────────────────────────────

export async function buildCallContext(
  call: CallDescriptor,
  userId: string,
  supabaseUrl: string,
  supabaseServiceKey: string,
  preferredGreeting: string = 'Sir'
): Promise<string> {
  // Check for window marker in context
  const windowMatch = call.context?.match(/\[WINDOW:(\w+)\]/);

  if (windowMatch) {
    const window = windowMatch[1];
    console.log(`[BUILD-CONTEXT] Detected window transition call: ${window}`);
    return buildWindowTransitionContext(call, userId, window, supabaseUrl, supabaseServiceKey, preferredGreeting);
  }

  // Legacy call types → map to windows and use the same per-window logic
  const legacyWindowMap: Record<string, string> = {
    'morning_standup': 'morning',
    'midday_checkin': 'business_hours',
    'eod_wrapup': 'after_work'
  };

  const mappedWindow = legacyWindowMap[call.callType || ''];
  if (mappedWindow) {
    console.log(`[BUILD-CONTEXT] Legacy callType ${call.callType} → window ${mappedWindow}`);
    return buildWindowTransitionContext(call, userId, mappedWindow, supabaseUrl, supabaseServiceKey, preferredGreeting);
  }

  // Custom calls: determine current window and include window-appropriate tasks + topics
  const userContext = call.context || '';
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  // Get user timezone
  const { data: prefs } = await supabase
    .from('user_scheduling_prefs')
    .select('timezone')
    .eq('user_id', userId)
    .maybeSingle();
  const tz = prefs?.timezone || 'America/New_York';
  
  // Determine current window from user's timezone
  const currentHour = parseInt(new Date().toLocaleString('en-US', {
    timeZone: tz, hour: '2-digit', hour12: false
  }), 10);
  
  let currentWindow = 'business_hours';
  if (currentHour < 9) currentWindow = 'morning';
  else if (currentHour >= 17 && currentHour < 19) currentWindow = 'after_work';
  else if (currentHour >= 19 && currentHour < 22) currentWindow = 'evening';
  
  // Check for weekend
  const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: tz });
  if (dayOfWeek === 'Saturday' || dayOfWeek === 'Sunday') currentWindow = 'weekends';

  console.log(`[BUILD-CONTEXT] Custom call: determined window=${currentWindow}, hour=${currentHour}, day=${dayOfWeek}`);

  // Fetch window-appropriate tasks and derive topic groups
  const windowTasks = await getTasksForWindow(supabase, userId, currentWindow, tz);
  const [tier1, tier2] = await Promise.all([
    getTopicGroupsFromWindowTasks(supabase, userId, currentWindow),
    getTopicGroupsFromAllTasks(supabase, userId)
  ]);
  
  const topicsToShow = tier1.length > 0 ? tier1 : tier2;
  const topicSection = topicsToShow.length > 0
    ? '\n\nACTIVE TOPICS for this time window (ranked by recency and priority):\n' +
      formatTopicGroups(topicsToShow)
    : '';
  const taskSection = windowTasks.length > 0
    ? '\n\nTASKS for current window:\n' + formatTaskList(windowTasks)
    : '';

  if (!userContext) {
    return `${AGENDA_HEADER}\n
CALL: Custom Scheduled Check-in
WINDOW: ${currentWindow}
${taskSection}${topicSection}

AGENDA QUEUE:
1. Greet the user
2. Present the topic groups above and ask which they want to explore
3. Use get_tasks_by_topic to drill into their selection

This is a user-scheduled call — follow their lead.`;
  }

  return `${AGENDA_HEADER}\n
CALL: Custom Scheduled Check-in
WINDOW: ${currentWindow}

[USER CONTEXT]
${userContext}
${taskSection}${topicSection}

Start with a friendly greeting addressing the user context.
Then present the topic groups and ask which the user wants to explore.
Use get_tasks_by_topic to drill into their selection.`;
}
