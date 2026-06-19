import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeDueDate, normalizeDateTime, getTodayInTimezone } from "../_shared/timezone.ts";
import { getToolDefinitions } from "../_shared/tool-definitions.ts";
import { getTopicGroupsManual, WINDOW_RANGES, CATEGORY_WINDOW_MAPPING } from "../_shared/call-context-builder.ts";
import { resolveConfig, validateTaskWindow } from "../_shared/scheduling-defaults.ts";

// ── Rollback Flag for shared topic ranking ──────────────────────────
const USE_SHARED_TOPICS = true;

// ── Rollback Flag for V2 task filters (category + status groups) ────
const USE_V2_TASK_FILTERS = true;

const STATUS_GROUPS: Record<string, string[]> = {
  'ACTIVE': ['BACKLOG', 'TODO', 'READY', 'UP_NEXT', 'DOING', 'PLANNING'],
  'WORKABLE': ['READY', 'UP_NEXT', 'DOING'],
};

// ============================================================================
// UTILITY: Proper error message extraction
// ============================================================================
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  if (typeof error === 'string') {
    return error;
  }
  return JSON.stringify(error);
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Use shared tool definitions as single source of truth
const toolDefinitions = getToolDefinitions();

// ============================================================================
// CENTRAL TIME ANCHOR - Used by all tools for consistent date/time
// ============================================================================

function getCurrentTimeAnchor(timezone: string = 'America/New_York'): { 
  currentDateTime: string; 
  todayDate: string; 
  timezone: string;
} {
  try {
    const now = new Date();
    const currentDateTime = now.toLocaleString('en-US', { 
      timeZone: timezone, 
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    const todayDate = now.toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD format
    
    return { currentDateTime, todayDate, timezone };
  } catch (error) {
    const now = new Date();
    return {
      currentDateTime: now.toISOString(),
      todayDate: now.toLocaleDateString('en-CA'), // browser-local fallback, not UTC split
      timezone: 'UTC'
    };
  }
}

// ============================================================================
// TEMPORAL DATE CALCULATION - Auto-detect and calculate date ranges from query
// ============================================================================

/**
 * Detect temporal intent from natural language query
 * Order matters - check specific phrases first
 */
function detectTemporalIntent(query: string): string | null {
  const q = query.toLowerCase();
  
  // Rolling periods (check first - more specific)
  if (q.includes('over the next week') || q.includes('next 7 days') || q.includes('coming week')) return 'next_7_days';
  if (q.includes('over the last week') || q.includes('past week') || q.includes('last 7 days') || q.includes('past 7 days')) return 'last_7_days';
  
  // Calendar weeks
  if (q.includes('next week')) return 'next_week';      // Mon-Sun of NEXT week
  if (q.includes('this week')) return 'this_week';      // Mon-Sun of CURRENT week
  
  // Weekends
  if (q.includes('last weekend')) return 'last_weekend';
  if (q.includes('this weekend') || q.match(/\bweekend\b/)) return 'this_weekend';
  
  // Single days
  if (q.includes('tomorrow')) return 'tomorrow';
  if (q.includes('yesterday')) return 'yesterday';
  if (q.includes('today') || q.includes('tonight')) return 'today';
  
  return null;
}

/**
 * Get today's date object in user's timezone
 * Set to noon to avoid DST edge cases
 */
function getTodayInTz(timezone: string): Date {
  const now = new Date();
  // Get YYYY-MM-DD string in timezone, then create Date at noon
  const tzString = now.toLocaleDateString('en-CA', { timeZone: timezone });
  return new Date(tzString + 'T12:00:00');
}

/**
 * Format date as YYYY-MM-DD
 */
function formatYMD(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Calculate date range based on detected temporal intent and timezone
 * Week starts Monday, weekend = Friday-Sunday
 */
function calculateDateRange(
  intent: string, 
  timezone: string
): { start_date: string; end_date: string } | null {
  const today = getTodayInTz(timezone);
  const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ... 6=Sat
  
  switch (intent) {
    case 'today':
    case 'tomorrow': 
    case 'yesterday':
      // Return null - don't inject dates for single-day queries
      // Tavily rejects same start/end dates, and the verbatim query
      // already contains the temporal context ("today", "yesterday", etc.)
      console.log(`[DATE-CALC] Skipping date injection for single-day intent: ${intent}`);
      return null;
    
    case 'this_weekend': {
      // Weekend = Friday, Saturday, Sunday
      // If today is Sun(0), Fri(5), or Sat(6) - we're already in the weekend
      const friday = new Date(today);
      if (dayOfWeek === 0) {
        // Sunday: go back 2 days to Friday
        friday.setDate(today.getDate() - 2);
      } else if (dayOfWeek === 6) {
        // Saturday: go back 1 day to Friday
        friday.setDate(today.getDate() - 1);
      } else if (dayOfWeek === 5) {
        // Friday: today is Friday, keep it
      } else {
        // Mon-Thu: go forward to next Friday
        const daysUntilFriday = 5 - dayOfWeek;
        friday.setDate(today.getDate() + daysUntilFriday);
      }
      const sunday = new Date(friday);
      sunday.setDate(friday.getDate() + 2);
      return { start_date: formatYMD(friday), end_date: formatYMD(sunday) };
    }
    
    case 'last_weekend': {
      // Previous Fri-Sat-Sun
      const lastSunday = new Date(today);
      // If today is Sunday, last Sunday was 7 days ago
      // Otherwise, last Sunday was (dayOfWeek) days ago
      const daysSinceLastSunday = dayOfWeek === 0 ? 7 : dayOfWeek;
      lastSunday.setDate(today.getDate() - daysSinceLastSunday);
      const lastFriday = new Date(lastSunday);
      lastFriday.setDate(lastSunday.getDate() - 2);
      return { start_date: formatYMD(lastFriday), end_date: formatYMD(lastSunday) };
    }
    
    case 'this_week': {
      // Current calendar week: Monday to Sunday (Week starts Monday)
      const monday = new Date(today);
      const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      monday.setDate(today.getDate() - daysFromMonday);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return { start_date: formatYMD(monday), end_date: formatYMD(sunday) };
    }
    
    case 'next_week': {
      // Next calendar week: Next Monday to next Sunday
      const nextMonday = new Date(today);
      const daysUntilNextMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek);
      nextMonday.setDate(today.getDate() + daysUntilNextMonday);
      const nextSunday = new Date(nextMonday);
      nextSunday.setDate(nextMonday.getDate() + 6);
      return { start_date: formatYMD(nextMonday), end_date: formatYMD(nextSunday) };
    }
    
    case 'last_7_days': {
      // Rolling: today - 7 days to today
      const weekAgo = new Date(today);
      weekAgo.setDate(today.getDate() - 7);
      return { start_date: formatYMD(weekAgo), end_date: formatYMD(today) };
    }
    
    case 'next_7_days': {
      // Rolling: today to today + 7 days
      const weekAhead = new Date(today);
      weekAhead.setDate(today.getDate() + 7);
      return { start_date: formatYMD(today), end_date: formatYMD(weekAhead) };
    }
      
    default:
      return null;
  }
}

// ============================================================================
// TOOL EXECUTION ENGINE
// ============================================================================

interface ExecuteToolRequest {
  toolName: string;
  args: Record<string, any>;
  userId: string;
  context?: {
    interface: 'chat' | 'phone';
    timezone?: string;
    userProfile?: Record<string, any>;
  };
}

// Machine-readable facts for post-validation
interface ExtractedFacts {
  type: 'task_list' | 'today_tasks' | 'task_created' | 'task_updated' | 'web_search' | 'communication' | 'other';
  count?: number;
  scheduled?: number;
  unscheduled?: number;
  rawAnswer?: string;
  source?: string;
  taskTitle?: string;
  topicGroups?: string[];
}

interface ExecuteToolResponse {
  success: boolean;
  result?: any;
  error?: string;
  message?: string;
  timeAnchor?: { currentDateTime: string; todayDate: string; timezone: string };
  extractedFacts?: ExtractedFacts;
}

// ============================================================================
// VALIDATION FUNCTION - Used by chat/voice to verify AI claims
// ============================================================================

export function validateAiResponse(
  aiResponse: string, 
  toolOutputs: Array<{ toolName: string; extractedFacts?: ExtractedFacts }>
): { valid: boolean; correction?: string } {
  
  for (const output of toolOutputs) {
    if (!output.extractedFacts) continue;
    
    const facts = output.extractedFacts;
    
    // Validate task counts
    if (facts.type === 'task_list' || facts.type === 'today_tasks') {
      const actualCount = facts.count ?? 0;
      
      // Look for task count claims in AI response
      const countPatterns = [
        /you have (\d+) tasks?/i,
        /(\d+) tasks? (?:for|scheduled|today)/i,
        /found (\d+) tasks?/i,
        /there (?:are|is) (\d+) tasks?/i,
        /(\d+) scheduled/i,
        /have (\d+) things?/i
      ];
      
      for (const pattern of countPatterns) {
        const match = aiResponse.match(pattern);
        if (match) {
          const claimedCount = parseInt(match[1]);
          if (claimedCount !== actualCount) {
            console.log(`[VALIDATE] Discrepancy: AI claimed ${claimedCount}, tool returned ${actualCount}`);
            return {
              valid: false,
              correction: `Actually, I need to correct myself - you have ${actualCount} task${actualCount !== 1 ? 's' : ''}, not ${claimedCount}.`
            };
          }
        }
      }
    }
    
    // Validate scheduled vs unscheduled counts for today_tasks
    if (facts.type === 'today_tasks' && facts.scheduled !== undefined) {
      const scheduledMatch = aiResponse.match(/(\d+) scheduled/i);
      if (scheduledMatch) {
        const claimedScheduled = parseInt(scheduledMatch[1]);
        if (claimedScheduled !== facts.scheduled) {
          return {
            valid: false,
            correction: `Let me correct that - you have ${facts.scheduled} scheduled task${facts.scheduled !== 1 ? 's' : ''} for today.`
          };
        }
      }
    }
  }
  
  return { valid: true };
}

async function executeToolCall(
  supabase: any,
  toolName: string,
  args: Record<string, any>,
  userId: string,
  context: ExecuteToolRequest['context'] = { interface: 'chat' }
): Promise<ExecuteToolResponse> {
  console.log(`[EXECUTE-TOOL] Executing: ${toolName}`, { args, userId, interface: context.interface });

  try {
    switch (toolName) {
      // ============ TASK TOOLS ============
      case 'get_tasks':
        return await getTasks(supabase, userId, args, context.timezone);
      
      case 'get_today_tasks':
        return await getTodayTasks(supabase, userId, context.timezone);
      
      case 'create_task':
        // TEMPORARILY REDIRECTED FOR DEBUGGING
        // Route through parse_and_create_tasks for proper time extraction and scheduling
        console.log('[EXECUTE-TOOL] create_task redirected to parse_and_create_tasks');
        return await parseAndCreateTasks(supabase, userId, {
          text: args.title + (args.description ? '. ' + args.description : ''),
          auto_schedule: true
        }, context?.timezone);
      
      case 'update_task':
        return await updateTask(supabase, args);
      
      case 'reschedule_task':
        return await rescheduleTask(supabase, args);
      
      case 'schedule_task':
        return await scheduleTask(supabase, args);
      
      case 'unschedule_task':
        return await unscheduleTask(supabase, args);
      
      case 'parse_and_create_tasks':
        return await parseAndCreateTasks(supabase, userId, args, context?.timezone);

      // ============ COMMUNICATION TOOLS ============
      case 'send_email':
      case 'Email':
        return await sendEmail(supabase, userId, args, context.userProfile);
      
      case 'send_slack_message':
      case 'Slack_Message':
        return await sendSlackMessage(supabase, userId, args, context.userProfile);
      
      case 'create_outlook_event':
      case 'Outlook_Event':
        return await createOutlookEvent(supabase, userId, args, context.userProfile);
      
      case 'create_google_event':
      case 'Google_Event':
        return await createGoogleEvent(supabase, userId, args, context.userProfile);
      
      case 'create_calendar_event':
        return await createCalendarEvent(supabase, userId, args, context.userProfile);
      
      case 'initiate_phone_call':
      case 'Phone_Call':
        return await initiatePhoneCall(supabase, userId, args, context.interface);
      
      case 'send_chat_message':
        return await sendScheduledChatMessage(supabase, userId, args);

      // ============ SEARCH TOOLS ============
      case 'web_search':
        return await webSearch(args, context.timezone);

      // ============ TOPIC DRILL-DOWN ============
      case 'get_tasks_by_topic':
        return await getTasksByTopic(supabase, userId, args);

      // ============ ITINERARY TOOLS ============
      case 'explain_task_score':
        return await explainTaskScore(supabase, userId, args);

      case 'list_pending_assignments':
        return await listPendingAssignments(supabase, userId, args);

      case 'find_open_slots':
        return await findOpenSlots(supabase, userId, args, context.timezone);

      case 'move_task_to_day':
        return await moveTaskToDay(supabase, userId, args, context.timezone);

      case 'swap_task_order':
        return await swapTaskOrder(supabase, args);

      case 'set_priority_rank':
        return await setPriorityRank(supabase, args);

      case 'quick_create_task':
        return await quickCreateTask(supabase, userId, args, context.timezone);

      // ============ INTROSPECTION ============
      case 'get_my_config':
        return await getMyConfig(supabase, userId, args);

      // ============ PHONE-ONLY TOOLS ============
      case 'hang_up':
        // For chat interface, this is a no-op
        if (context.interface === 'chat') {
          return { success: true, message: "Call ended (chat mode - no action needed)" };
        }
        // For phone, return success - actual hang up is handled by twilio-realtime-bridge
        return { success: true, message: args.farewell_message || "Goodbye!" };

      default:
        return { 
          success: false, 
          error: `Unknown tool: ${toolName}`,
          message: `Available tools: ${toolDefinitions.map(t => t.name).join(', ')}`
        };
    }
  } catch (error) {
    console.error(`[EXECUTE-TOOL] Error executing ${toolName}:`, error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// ============================================================================
// TOPIC + WINDOW ENRICHMENT - Attaches topic_group labels to tasks
// ============================================================================

function detectCurrentWindowServer(timezone: string): { window: string; categories: string[] } {
  const now = new Date();
  const timeStr = now.toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', hour12: false });
  const hour = parseInt(timeStr, 10);
  const dayStr = now.toLocaleString('en-US', { timeZone: timezone, weekday: 'short' });
  const isWeekend = dayStr === 'Sat' || dayStr === 'Sun';

  let window = 'evening';
  if (isWeekend) {
    window = 'weekends';
  } else {
    for (const [w, range] of Object.entries(WINDOW_RANGES)) {
      if (w === 'weekends') continue;
      if (hour >= range.start && hour < range.end) { window = w; break; }
    }
  }

  const categories = Object.entries(CATEGORY_WINDOW_MAPPING)
    .filter(([_, windows]) => windows.includes(window))
    .map(([cat]) => cat);

  return { window, categories };
}

async function enrichTasksWithTopics(
  supabase: any,
  tasks: any[],
  userId: string,
  timezone: string
): Promise<any> {
  const count = tasks.length;
  const scheduled = tasks.filter((t: any) => t.is_scheduled === true).length;
  const unscheduled = count - scheduled;

  // Get topic mappings for returned tasks
  let topicLookup: Record<string, string> = {};
  if (tasks.length > 0) {
    try {
      const taskIds = tasks.map((t: any) => t.id);
      const { data: mappings } = await supabase
        .from('task_topic_mappings')
        .select('task_id, topic_id')
        .in('task_id', taskIds);

      if (mappings && mappings.length > 0) {
        const topicIds = [...new Set(mappings.map((m: any) => m.topic_id))];
        const { data: topics } = await supabase
          .from('task_topic_index')
          .select('id, topic_name')
          .in('id', topicIds);

        if (topics) {
          const topicNameMap = new Map(topics.map((t: any) => [t.id, t.topic_name]));
          for (const m of mappings) {
            topicLookup[m.task_id] = topicNameMap.get(m.topic_id) || 'Uncategorized';
          }
        }
      }
    } catch (e) {
      console.warn('[ENRICH] Topic lookup failed:', e);
    }
  }

  // Attach topic_group to each task
  const enrichedTasks = tasks.map((t: any) => ({
    ...t,
    topic_group: topicLookup[t.id] || 'Uncategorized'
  }));

  // Get current window context
  const { window: currentWindow, categories: windowCategories } = detectCurrentWindowServer(timezone);

  // Get ranked topic groups
  let topicGroups: any[] = [];
  try {
    topicGroups = await getTopicGroupsManual(supabase, userId, null);
  } catch (e) {
    console.warn('[ENRICH] Topic groups fetch failed:', e);
  }

  return {
    tasks: enrichedTasks,
    count,
    scheduled,
    unscheduled,
    current_window: currentWindow,
    window_categories: windowCategories,
    topic_groups: topicGroups
  };
}

// ============================================================================
// TASK FUNCTIONS
// ============================================================================

async function getTasks(supabase: any, userId: string, args: any, timezone: string = 'America/New_York'): Promise<ExecuteToolResponse> {
  try {
    console.log(`[GET_TASKS] Args:`, args, `Timezone: ${timezone}`);
    
    let query = supabase.from('tasks').select('*').eq('user_id', userId);
    
    // Apply status filter (V2: support group aliases ACTIVE/WORKABLE)
    if (args.status) {
      const upper = args.status.toUpperCase();
      if (USE_V2_TASK_FILTERS) {
        const group = STATUS_GROUPS[upper];
        if (group) {
          query = query.in('status', group);
        } else {
          query = query.eq('status', upper);
        }
      } else {
        query = query.eq('status', upper);
      }
    }

    // Apply category filter (V2 only)
    if (USE_V2_TASK_FILTERS && args.category) {
      query = query.eq('category', args.category.toUpperCase());
    }
    
    // Apply date filtering if time_filter provided
    if (args.time_filter) {
      console.log(`[GET_TASKS] Applying time_filter: "${args.time_filter}"`);
      
      const intent = detectTemporalIntent(args.time_filter);
      console.log(`[GET_TASKS] Detected intent: ${intent}`);
      
      if (intent) {
        const dateRange = calculateDateRange(intent, timezone);
        
        if (dateRange) {
          console.log(`[GET_TASKS] Date range: ${dateRange.start_date} to ${dateRange.end_date}`);
          
          // For date ranges, filter by start_time (scheduled) OR due_date (unscheduled)
          const startBoundary = `${dateRange.start_date}T00:00:00`;
          const endBoundary = `${dateRange.end_date}T23:59:59`;
          
          // Use OR filter: scheduled tasks by start_time, unscheduled by due_date
          query = query.or(
            `and(is_scheduled.eq.true,start_time.gte.${startBoundary},start_time.lte.${endBoundary}),` +
            `and(is_scheduled.is.null,due_date.gte.${startBoundary},due_date.lte.${endBoundary}),` +
            `and(is_scheduled.eq.false,due_date.gte.${startBoundary},due_date.lte.${endBoundary})`
          );
        } else if (intent === 'today' || intent === 'tomorrow' || intent === 'yesterday') {
          // For single-day intents, calculate the specific date
          const today = getTodayInTz(timezone);
          let targetDate: Date;
          
          if (intent === 'tomorrow') {
            targetDate = new Date(today);
            targetDate.setDate(today.getDate() + 1);
          } else if (intent === 'yesterday') {
            targetDate = new Date(today);
            targetDate.setDate(today.getDate() - 1);
          } else {
            targetDate = today;
          }
          
          const dateStr = formatYMD(targetDate);
          const startBoundary = `${dateStr}T00:00:00`;
          const endBoundary = `${dateStr}T23:59:59`;
          
          console.log(`[GET_TASKS] Single-day filter for ${intent}: ${dateStr}`);
          
          query = query.or(
            `and(is_scheduled.eq.true,start_time.gte.${startBoundary},start_time.lte.${endBoundary}),` +
            `and(is_scheduled.is.null,due_date.gte.${startBoundary},due_date.lte.${endBoundary}),` +
            `and(is_scheduled.eq.false,due_date.gte.${startBoundary},due_date.lte.${endBoundary})`
          );
        }
      } else {
        // No standard intent detected - try to parse as specific date like "January 19th"
        const parsedDate = parseSpecificDate(args.time_filter, timezone);
        if (parsedDate) {
          const startBoundary = `${parsedDate}T00:00:00`;
          const endBoundary = `${parsedDate}T23:59:59`;
          
          console.log(`[GET_TASKS] Parsed specific date: ${parsedDate}`);
          
          query = query.or(
            `and(is_scheduled.eq.true,start_time.gte.${startBoundary},start_time.lte.${endBoundary}),` +
            `and(is_scheduled.is.null,due_date.gte.${startBoundary},due_date.lte.${endBoundary}),` +
            `and(is_scheduled.eq.false,due_date.gte.${startBoundary},due_date.lte.${endBoundary})`
          );
        }
      }
    }
    
    const { data, error } = await query.order('start_time', { ascending: true, nullsFirst: false }).limit(50);
    
    if (error) throw error;
    
    const count = data?.length || 0;
    const scheduled = (data || []).filter((t: any) => t.is_scheduled === true).length;
    const unscheduled = count - scheduled;
    
    console.log(`[GET_TASKS] Found ${count} tasks (${scheduled} scheduled, ${unscheduled} unscheduled)`);
    
    // Enrich tasks with topic_group labels
    const enrichedTasks = await enrichTasksWithTopics(supabase, data || [], userId, timezone);
    
    return { 
      success: true, 
      result: enrichedTasks,
      message: `Found ${count} tasks${args.time_filter ? ` for "${args.time_filter}"` : ''} (${scheduled} scheduled, ${unscheduled} unscheduled)`,
      extractedFacts: { type: 'task_list', count, scheduled, unscheduled, topicGroups: enrichedTasks.topic_groups?.map((t: any) => t.topic_name) || [] }
    };
  } catch (error) {
    console.error('[GET_TASKS] Error:', error);
    return { success: false, error: extractErrorMessage(error) };
  }
}

/**
 * Parse specific date strings like "January 19th", "Jan 19", "19th January"
 * Returns YYYY-MM-DD string or null
 */
function parseSpecificDate(dateStr: string, timezone: string): string | null {
  const months: Record<string, number> = {
    'january': 0, 'jan': 0,
    'february': 1, 'feb': 1,
    'march': 2, 'mar': 2,
    'april': 3, 'apr': 3,
    'may': 4,
    'june': 5, 'jun': 5,
    'july': 6, 'jul': 6,
    'august': 7, 'aug': 7,
    'september': 8, 'sep': 8, 'sept': 8,
    'october': 9, 'oct': 9,
    'november': 10, 'nov': 10,
    'december': 11, 'dec': 11
  };
  
  const normalized = dateStr.toLowerCase().trim();
  
  // Pattern: "January 19th", "Jan 19", "January 19"
  const pattern1 = /^(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?$/i;
  // Pattern: "19th January", "19 Jan"
  const pattern2 = /^(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)$/i;
  
  let month: number | null = null;
  let day: number | null = null;
  
  const match1 = normalized.match(pattern1);
  if (match1) {
    month = months[match1[1].toLowerCase()];
    day = parseInt(match1[2], 10);
  }
  
  const match2 = normalized.match(pattern2);
  if (match2) {
    day = parseInt(match2[1], 10);
    month = months[match2[2].toLowerCase()];
  }
  
  if (month !== null && day !== null && day >= 1 && day <= 31) {
    const today = getTodayInTz(timezone);
    let year = today.getFullYear();
    
    // If the date has already passed this year, assume next year
    const candidateDate = new Date(year, month, day);
    if (candidateDate < today) {
      year++;
    }
    
    const result = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    console.log(`[PARSE_DATE] Parsed "${dateStr}" as ${result}`);
    return result;
  }
  
  return null;
}

async function getTodayTasks(supabase: any, userId: string, timezone?: string): Promise<ExecuteToolResponse> {
  try {
    const tz = timezone || 'America/New_York';
    
    // Calculate today's boundaries in the user's timezone
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA', { timeZone: tz });
    const startOfDay = `${todayStr}T00:00:00`;
    const endOfDay = `${todayStr}T23:59:59`;
    
    console.log(`[GET_TODAY_TASKS] Querying for date=${todayStr}, tz=${tz}`);
    
    // Get scheduled tasks (start_time falls within today)
    const { data: scheduledTasks, error: schedError } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .eq('is_scheduled', true)
      .gte('start_time', startOfDay)
      .lte('start_time', endOfDay)
      .order('start_time', { ascending: true });
    
    if (schedError) throw schedError;
    
    // Get unscheduled tasks due today
    const { data: unscheduledTasks, error: unschedError } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .or('is_scheduled.is.null,is_scheduled.eq.false')
      .gte('due_date', startOfDay)
      .lte('due_date', endOfDay)
      .order('due_date', { ascending: true });
    
    if (unschedError) throw unschedError;
    
    const scheduled = scheduledTasks || [];
    const unscheduled = unscheduledTasks || [];
    const allTasks = [...scheduled, ...unscheduled];
    
    console.log(`[GET_TODAY_TASKS] Found ${scheduled.length} scheduled, ${unscheduled.length} unscheduled`);
    
    // Enrich with topic groups
    const enrichedTasks = await enrichTasksWithTopics(supabase, allTasks, userId, tz);
    
    return { 
      success: true, 
      result: { 
        ...enrichedTasks,
        scheduled,
        unscheduled,
        date: todayStr,
        timezone: tz
      },
      message: `Today (${todayStr}): ${scheduled.length} scheduled, ${unscheduled.length} unscheduled tasks`,
      extractedFacts: { 
        type: 'today_tasks', 
        count: allTasks.length, 
        scheduled: scheduled.length, 
        unscheduled: unscheduled.length,
        topicGroups: enrichedTasks.topic_groups?.map((t: any) => t.topic_name) || []
      }
    };
  } catch (error) {
    console.error('[GET_TODAY_TASKS] Error:', error);
    return { success: false, error: extractErrorMessage(error) };
  }
}

async function createTask(supabase: any, userId: string, args: any): Promise<ExecuteToolResponse> {
  if (!args.title) return { success: false, error: "Task title is required" };

  try {
    const { data: board } = await supabase
      .from('boards')
      .select('id')
      .eq('user_id', userId)
      .limit(1)
      .single();

    if (!board) return { success: false, error: "No board found for user" };

    const taskData = {
      title: args.title,
      description: args.description || null,
      priority: args.priority?.toUpperCase() || 'MEDIUM',
      category: args.category?.toUpperCase() || 'LIFE',
      status: 'BACKLOG',
      board_id: board.id,
      user_id: userId
    };

    const { data, error } = await supabase
      .from('tasks')
      .insert([taskData])
      .select()
      .single();

    if (error) throw error;

    return { 
      success: true, 
      result: { task: data },
      message: `Created task "${data.title}" with ${data.priority} priority`
    };
  } catch (error) {
    return { success: false, error: extractErrorMessage(error) };
  }
}

async function updateTask(supabase: any, args: any): Promise<ExecuteToolResponse> {
  if (!args.task_id) return { success: false, error: "Task ID is required" };

  try {
    const updateData: any = {};
    if (args.title) updateData.title = args.title;
    if (args.description !== undefined) updateData.description = args.description;
    if (args.status) updateData.status = args.status.toUpperCase();
    if (args.priority) updateData.priority = args.priority.toUpperCase();
    if (args.category) updateData.category = args.category.toUpperCase();

    const { data, error } = await supabase
      .from('tasks')
      .update(updateData)
      .eq('id', args.task_id)
      .select()
      .single();

    if (error) throw error;

    return { 
      success: true, 
      result: { task: data },
      message: `Updated task "${data.title}"`
    };
  } catch (error) {
    return { success: false, error: extractErrorMessage(error) };
  }
}

async function rescheduleTask(supabase: any, args: any, timezone?: string): Promise<ExecuteToolResponse> {
  if (!args.task_id) return { success: false, error: "Task ID is required" };
  if (!args.new_date) return { success: false, error: "New date is required" };

  const tz = timezone || 'America/New_York';

  try {
    // Parse the new date and optional time, normalizing to UTC
    let startTimeRaw = args.new_date;
    if (args.new_start_time) {
      startTimeRaw = `${args.new_date}T${args.new_start_time}`;
    }
    
    // Normalize the datetime to proper UTC (treats naive datetime as local to user's tz)
    const normalizedStartTime = normalizeDateTime(startTimeRaw, tz);
    console.log(`[RESCHEDULE] Raw: ${startTimeRaw} → Normalized: ${normalizedStartTime} (tz: ${tz})`);

    // Validate time window constraints
    try {
      const { data: taskData } = await supabase
        .from('tasks')
        .select('category')
        .eq('id', args.task_id)
        .single();
      const taskCategory = taskData?.category || 'LIFE';
      
      const supabaseForConfig = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const { data: userPrefs } = await supabaseForConfig
        .from('user_scheduling_prefs')
        .select('config, timezone')
        .eq('user_id', (await supabase.auth.getUser()).data.user?.id || '')
        .single();
      const { timeWindows, categoryMappings } = resolveConfig(userPrefs?.config);
      const windowCheck = validateTaskWindow(normalizedStartTime, taskCategory, timeWindows, categoryMappings, tz);
      if (!windowCheck.valid) {
        console.error(`[RESCHEDULE] ⛔ WINDOW VIOLATION: category=${taskCategory}, actual="${windowCheck.actualWindow}", allowed=${windowCheck.allowedWindows.join(',')}`);
        return {
          success: false,
          error: `Cannot reschedule this ${taskCategory} task to the requested time — it falls in the "${windowCheck.actualWindow || 'outside any'}" window, but ${taskCategory} tasks are only allowed in: ${windowCheck.allowedWindows.join(', ')}. Please pick a valid time.`
        };
      }
    } catch (configErr) {
      console.warn(`[RESCHEDULE] Could not validate window (non-blocking):`, configErr);
    }

    const updateData: any = {
      start_time: normalizedStartTime,
      is_scheduled: true
    };
    
    // Always sync due_date with scheduled date (unless explicitly disabled)
    // This ensures "scheduled for tomorrow" shows as tomorrow's due date
    if (args.update_due_date !== false) {
      const normalizedDueDate = normalizeDueDate(args.new_date, tz);
      updateData.due_date = normalizedDueDate;
      console.log(`[RESCHEDULE] Due date normalized: ${args.new_date} → ${normalizedDueDate}`);
    }

    const { data, error } = await supabase
      .from('tasks')
      .update(updateData)
      .eq('id', args.task_id)
      .select()
      .single();

    if (error) throw error;

    return { 
      success: true, 
      result: { task: data },
      message: `Rescheduled "${data.title}" to ${normalizedStartTime}`
    };
  } catch (error) {
    return { success: false, error: extractErrorMessage(error) };
  }
}

async function scheduleTask(supabase: any, args: any, timezone?: string): Promise<ExecuteToolResponse> {
  if (!args.task_id) return { success: false, error: "Task ID is required" };

  const tz = timezone || 'America/New_York';

  try {
    // =====================================================
    // CHECK 1: Skip if task is already scheduled
    // Prevents OpenAI from overwriting batch scheduler times
    // =====================================================
    const { data: existingTask, error: fetchError } = await supabase
      .from('tasks')
      .select('id, title, start_time, end_time, is_scheduled')
      .eq('id', args.task_id)
      .single();
    
    if (fetchError) {
      return { success: false, error: `Task not found: ${fetchError.message}` };
    }
    
    if (existingTask?.is_scheduled && existingTask?.start_time) {
      console.warn(`[SCHEDULE_TASK] ⚠️ SKIPPED: Task "${existingTask.title}" already scheduled at ${existingTask.start_time}`);
      return { 
        success: true, 
        result: { task: existingTask, skipped: true },
        message: `Task "${existingTask.title}" is already scheduled for ${existingTask.start_time}. Use reschedule_task to change the time.`
      };
    }

    // =====================================================
    // CHECK 2: Validate and auto-correct past dates
    // =====================================================
    const today = getTodayInTimezone(tz);
    let dateStr = args.date || today;
    
    if (dateStr < today) {
      console.error(`[SCHEDULE_TASK] ⚠️ PAST DATE ${dateStr} auto-corrected to ${today}`);
      dateStr = today;
    }
    
    let startTimeRaw = dateStr;
    if (args.start_time) {
      startTimeRaw = `${dateStr}T${args.start_time}`;
    }
    
    // Normalize to proper UTC
    const normalizedStartTime = normalizeDateTime(startTimeRaw, tz);
    console.log(`[SCHEDULE_TASK] Raw: ${startTimeRaw} → Normalized: ${normalizedStartTime} (tz: ${tz})`);

    // =====================================================
    // CHECK 3: Validate time window constraints
    // =====================================================
    const taskForCategory = existingTask;
    const taskCategory = taskForCategory?.category || 'LIFE';
    try {
      const supabaseForConfig = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      const { data: userPrefs } = await supabaseForConfig
        .from('user_scheduling_prefs')
        .select('config, timezone')
        .eq('user_id', (await supabase.auth.getUser()).data.user?.id || '')
        .single();
      const { timeWindows, categoryMappings } = resolveConfig(userPrefs?.config);
      const windowCheck = validateTaskWindow(normalizedStartTime, taskCategory, timeWindows, categoryMappings, tz);
      if (!windowCheck.valid) {
        console.error(`[SCHEDULE_TASK] ⛔ WINDOW VIOLATION: category=${taskCategory}, time falls in "${windowCheck.actualWindow}", allowed=${windowCheck.allowedWindows.join(',')}`);
        return {
          success: false,
          error: `Cannot schedule a ${taskCategory} task at this time — it falls in the "${windowCheck.actualWindow || 'outside any'}" window, but ${taskCategory} tasks are only allowed in: ${windowCheck.allowedWindows.join(', ')}. Please choose a time within those windows.`
        };
      }
    } catch (configErr) {
      console.warn(`[SCHEDULE_TASK] Could not validate window (non-blocking):`, configErr);
    }

    const normalizedDueDate = normalizeDueDate(dateStr, tz);
    const updateData: any = {
      start_time: normalizedStartTime,
      is_scheduled: true,
      status: 'UP_NEXT',  // Has start_time, so UP_NEXT
      // Sync due_date to the scheduled date
      due_date: normalizedDueDate
    };
    
    if (args.duration_minutes) {
      updateData.estimate_minutes = args.duration_minutes;
      // Calculate end_time if start_time and duration provided
      if (args.start_time && normalizedStartTime) {
        const start = new Date(normalizedStartTime);
        const end = new Date(start.getTime() + args.duration_minutes * 60000);
        updateData.end_time = end.toISOString();
      }
    }

    const { data, error } = await supabase
      .from('tasks')
      .update(updateData)
      .eq('id', args.task_id)
      .select()
      .single();

    if (error) throw error;

    return { 
      success: true, 
      result: { task: data },
      message: `Scheduled "${data.title}" for ${normalizedStartTime}`
    };
  } catch (error) {
    return { success: false, error: extractErrorMessage(error) };
  }
}

async function unscheduleTask(supabase: any, args: any): Promise<ExecuteToolResponse> {
  if (!args.task_id) return { success: false, error: "Task ID is required" };

  try {
    const { data, error } = await supabase
      .from('tasks')
      .update({
        start_time: null,
        end_time: null,
        is_scheduled: false,
        status: 'BACKLOG'
      })
      .eq('id', args.task_id)
      .select()
      .single();

    if (error) throw error;

    return { 
      success: true, 
      result: { task: data },
      message: `Unscheduled "${data.title}" and moved to backlog`
    };
  } catch (error) {
    return { success: false, error: extractErrorMessage(error) };
  }
}

// ============================================================================
// PARSE AND CREATE TASKS - Leverages AI task parser for NLP extraction
// ============================================================================

function getEndOfSundayISO(tz: string): string {
  const todayStr = getTodayInTimezone(tz); // YYYY-MM-DD via _shared/timezone.ts
  const [y, m, d] = todayStr.split('-').map(Number);
  // Use Intl with weekday:'short' — same pattern as app's getDayOfWeekInTimezone
  const shortDay = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date());
  const dowMap: Record<string, number> = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
  const dow = dowMap[shortDay] ?? 0;
  const daysToSunday = dow === 0 ? 0 : 7 - dow;
  const sundayMs = Date.UTC(y, m - 1, d + daysToSunday);
  return new Date(sundayMs).toISOString().slice(0, 10); // YYYY-MM-DD
}

async function parseAndCreateTasks(
  supabase: any,
  userId: string,
  args: { text: string; target_date?: string; auto_schedule?: boolean; source_topic_id?: string },
  timezone?: string
): Promise<ExecuteToolResponse> {
  const tz = timezone || 'America/New_York';
  const autoSchedule = args.auto_schedule !== false; // Default true
  const hasThisWeek = /this\s+week/i.test(args.text);
  // Detect any explicit date phrase — used to avoid inventing a deadline for priority tasks
  const hasDatePhrase = /\b(today|tonight|tomorrow|this\s+week|next\s+week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(args.text);

  console.log(`[PARSE_AND_CREATE] Input: "${args.text}", target_date: ${args.target_date}, auto_schedule: ${autoSchedule}, tz: ${tz}, hasThisWeek: ${hasThisWeek}, hasDatePhrase: ${hasDatePhrase}`);
  
  if (!args.text || args.text.trim().length === 0) {
    return { success: false, error: "Task text is required" };
  }

  try {
    // 1. Get user's board
    const { data: board, error: boardError } = await supabase
      .from('boards')
      .select('id')
      .eq('user_id', userId)
      .limit(1)
      .single();
      
    if (boardError || !board) {
      console.error('[PARSE_AND_CREATE] Board error:', boardError);
      return { success: false, error: "No board found for user" };
    }

    // 2. Parse target_date keywords
    let targetDate = args.target_date;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
    
    if (targetDate) {
      const lowerDate = targetDate.toLowerCase().trim();
      if (lowerDate === 'today') {
        targetDate = today;
      } else if (lowerDate === 'tomorrow') {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        targetDate = d.toLocaleDateString('en-CA', { timeZone: tz });
      }
    }
    
    console.log(`[PARSE_AND_CREATE] Resolved target_date: ${targetDate || 'none'}`);

    // 3. Get existing tasks for scheduling context
    const { data: existingTasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .eq('board_id', board.id);

    // 4. Call ai-task-parser edge function
    console.log('[PARSE_AND_CREATE] Calling ai-task-parser...');
    const parserResponse = await fetch(
      `${SUPABASE_URL}/functions/v1/ai-task-parser`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: args.text,
          mode: 'multiple',
          timezone: tz,
          userId,
          boardId: board.id,
          existingTasks: existingTasks || [],
          targetDate: targetDate ? `${targetDate}T12:00:00` : undefined
        })
      }
    );

    if (!parserResponse.ok) {
      const errorText = await parserResponse.text();
      console.error('[PARSE_AND_CREATE] Parser error:', parserResponse.status, errorText);
      return { success: false, error: `Failed to parse tasks: ${parserResponse.status}` };
    }

    const parsed = await parserResponse.json();
    const tasks = parsed.tasks || [];

    console.log(`[PARSE_AND_CREATE] Parsed ${tasks.length} tasks:`, tasks.map((t: any) => t.title));

    if (tasks.length === 0) {
      return { success: false, error: "No tasks could be parsed from the input. Please try rephrasing." };
    }

    // 5. Create tasks in database with normalized dates
    const createdTasks: any[] = [];
    for (const task of tasks) {
      const isPriority = task.intent === 'priority';

      // Normalize due_date to end-of-day in user's timezone.
      // Priority date rules (applied before OpenAI's suggestion):
      //   - priority + "this week" → always end of Sunday (ignore OpenAI's pick)
      //   - priority + no date phrase at all → null (don't invent a deadline)
      //   - everything else → OpenAI's due_date or targetDate fallback
      let rawDueDate: string | null;
      if (isPriority && hasThisWeek) {
        rawDueDate = getEndOfSundayISO(tz);
        console.log(`[PARSE_AND_CREATE] Priority+"this week" → due_date set to end of Sunday: ${rawDueDate}`);
      } else if (isPriority && !hasDatePhrase) {
        rawDueDate = null;
        console.log(`[PARSE_AND_CREATE] Priority+no date phrase → due_date null`);
      } else {
        rawDueDate = task.due_date || targetDate || null;
      }
      const normalizedDueDate = rawDueDate ? normalizeDueDate(rawDueDate, tz) : null;
      
      // Normalize start_time/end_time if provided (treat as local to user's timezone)
      const normalizedStartTime = task.start_time ? normalizeDateTime(task.start_time, tz) : null;
      let normalizedEndTime = task.end_time ? normalizeDateTime(task.end_time, tz) : null;
      
      // Calculate end_time from start_time + estimate if missing
      if (normalizedStartTime && !normalizedEndTime) {
        const durationMinutes = task.estimate_minutes || task.estimatedDuration || 60;
        const endDate = new Date(new Date(normalizedStartTime).getTime() + durationMinutes * 60000);
        normalizedEndTime = endDate.toISOString();
        console.log(`[PARSE_AND_CREATE] Calculated end_time for "${task.title}": ${normalizedEndTime} (${durationMinutes} min)`);
      }
      
      console.log(`[PARSE_AND_CREATE] Task "${task.title}" dates: raw_due=${rawDueDate} → ${normalizedDueDate}, start=${task.start_time} → ${normalizedStartTime}, end=${normalizedEndTime}`);
      
      const taskData = {
        title: task.title,
        description: task.description || null,
        priority: (task.priority || 'MEDIUM').toUpperCase(),
        category: (task.category || 'LIFE').toUpperCase(),
        status: task.status || args.default_status || ((normalizedStartTime || normalizedDueDate) ? 'UP_NEXT' : 'BACKLOG'),
        is_priority: isPriority,
        due_date: normalizedDueDate,
        start_time: normalizedStartTime,
        end_time: normalizedEndTime,
        estimate_minutes: task.estimate_minutes || task.estimatedDuration || 60,
        is_scheduled: !!(normalizedStartTime && normalizedEndTime),
        board_id: board.id,
        user_id: userId
      };

      const { data, error } = await supabase
        .from('tasks')
        .insert([taskData])
        .select()
        .single();

      if (data) {
        createdTasks.push(data);
        console.log(`[PARSE_AND_CREATE] Created task: ${data.title} (${data.id}) is_priority=${isPriority} at ${new Date().toISOString()}`);

        // Wire priority board mapping when intent === "priority"
        if (isPriority) {
          try {
            let topicId: string | null = args.source_topic_id || null;
            if (!topicId) {
              const { data: topics } = await supabase
                .from('task_topic_index')
                .select('id, topic_name')
                .eq('user_id', userId);
              if (topics && topics.length > 0) {
                const keyword = (task.category || '').toLowerCase();
                const exact = topics.find((t: any) => t.topic_name.toLowerCase() === keyword);
                const partial = topics.find((t: any) => t.topic_name.toLowerCase().includes(keyword));
                topicId = (exact || partial)?.id || null;
              }
            }
            if (topicId) {
              await supabase.from('task_topic_mappings').insert({ task_id: data.id, topic_id: topicId });
              console.log(`[PARSE_AND_CREATE] Priority task "${data.title}" mapped to topic ${topicId}`);
            } else {
              console.log(`[PARSE_AND_CREATE] Priority task "${data.title}" — no matching topic group found`);
            }
          } catch (err) {
            console.error(`[PARSE_AND_CREATE] Topic mapping failed (non-fatal):`, err);
          }
        }

        // Create Outlook calendar event IMMEDIATELY if task has scheduled time
        if (data.start_time) {
          console.log(`[PARSE_AND_CREATE] Creating immediate Outlook event for "${data.title}" at ${data.start_time}`);
          
          supabase.functions.invoke('send-unified-notification', {
            body: {
              userId: userId,
              title: `Task: ${data.title}`,
              body: data.description || 'Scheduled task',
              channels: ['OUTLOOK_EVENT'],  // Only Outlook - Slack/Email via reminders
              data: {
                type: 'task_calendar_event',
                taskId: data.id,
                taskTitle: data.title,
                startTime: data.start_time,
                endTime: data.end_time,
                estimateMinutes: data.estimate_minutes
              }
            }
          }).then(response => {
            console.log(`[PARSE_AND_CREATE] Outlook event result for "${data.title}":`, response.data?.channelResults?.outlook);
          }).catch(err => {
            console.error(`[PARSE_AND_CREATE] Outlook event failed for "${data.title}":`, err);
          });
        }
        
        // Best-effort activity logging (fire and forget)
        supabase.from('activity_log').insert({
          user_id: userId,
          activity_type: 'task_created',
          session_id: data.id,
          status: 'completed',
          stage: 'parse_and_create',
          metadata: { title: data.title, category: data.category, status: data.status, priority: data.priority, start_time: data.start_time }
        }).then(() => {
          console.log('[PARSE_AND_CREATE] Activity logged: task_created');
        }).catch(() => {
          // Silently ignore logging failures
        });
      } else if (error) {
        console.error(`[PARSE_AND_CREATE] Failed to create task "${task.title}":`, error);
      }
    }

    if (createdTasks.length === 0) {
      return { success: false, error: "Failed to create any tasks" };
    }

    // 6. If auto_schedule is enabled and tasks need scheduling, call batch-calendar-scheduler
    // Filter out tasks that already have start_time (they're already scheduled)
    const unscheduledTasks = createdTasks.filter(t => {
      if (t.start_time) {
        console.log(`[PARSE_AND_CREATE] Task "${t.title}" has start_time, skipping batch scheduler`);
        return false;
      }
      return !t.is_scheduled;
    });
    const scheduledResults: Array<{ title: string; time: string }> = [];

    if (autoSchedule && unscheduledTasks.length > 0) {
      console.log(`[PARSE_AND_CREATE] Auto-scheduling ${unscheduledTasks.length} tasks...`);
      
      try {
        const batchResponse = await fetch(
          `${SUPABASE_URL}/functions/v1/batch-calendar-scheduler`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              tasks: unscheduledTasks.map((t, idx) => ({
                id: t.id,
                index: idx,
                title: t.title,
                category: t.category,
                priority: t.priority,
                estimate_minutes: t.estimate_minutes || 60,
                due_date: t.due_date
              })),
              userId,
              timezone: tz,
              targetDate: targetDate || today,
              allowOverflow: true
            })
          }
        );

        if (batchResponse.ok) {
          const batchResult = await batchResponse.json();
          console.log('[PARSE_AND_CREATE] Batch scheduler result:', batchResult);
          
          // Apply scheduled times to tasks (already normalized by batch-calendar-scheduler)
          const todayInTz = new Date().toLocaleDateString('en-CA', { timeZone: tz });
          
          for (const slot of batchResult.scheduled || []) {
            const task = unscheduledTasks[slot.taskIndex];
            if (task && slot.start_time && slot.end_time) {
              // The batch scheduler now returns properly normalized UTC times
              // Also sync due_date to match the scheduled date
              const scheduledDate = slot.start_time.split('T')[0];
              
              // VALIDATION: Reject past dates - task keeps original status (BACKLOG if no due_date, UP_NEXT if has due_date)
              if (scheduledDate < todayInTz) {
                console.error(`[PARSE_AND_CREATE] REJECTED past date ${scheduledDate} for "${task.title}" - keeping original status`);
                continue;
              }
              
              const syncedDueDate = normalizeDueDate(scheduledDate, tz);
              
              console.log(`[PARSE_AND_CREATE] Applying schedule: task="${task.title}", start=${slot.start_time}, synced_due=${syncedDueDate}, status=UP_NEXT, today=${todayInTz}`);
              
              const { error: updateError } = await supabase
                .from('tasks')
                .update({
                  start_time: slot.start_time,
                  end_time: slot.end_time,
                  due_date: syncedDueDate, // Sync due_date with scheduled date
                  is_scheduled: true,
                  status: 'UP_NEXT'  // Has start_time now, so UP_NEXT
                })
                .eq('id', task.id);

              if (!updateError) {
                scheduledResults.push({
                  title: task.title,
                  time: new Date(slot.start_time).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    timeZone: tz
                  }),
                  start_time: slot.start_time
                });
                console.log(`[PARSE_AND_CREATE] Scheduled "${task.title}" at ${slot.start_time} with status UP_NEXT`);
                
                // Best-effort activity logging (fire and forget)
                supabase.from('activity_log').insert({
                  user_id: userId,
                  activity_type: 'task_scheduled',
                  session_id: task.id,
                  status: 'completed',
                  stage: 'auto_schedule',
                  metadata: { title: task.title, start_time: slot.start_time, status: 'UP_NEXT', today: todayInTz }
                }).then(() => {
                  console.log('[PARSE_AND_CREATE] Activity logged: task_scheduled');
                }).catch(() => {
                  // Silently ignore logging failures
                });
              }
            }
          }
        } else {
          console.error('[PARSE_AND_CREATE] Batch scheduler error:', await batchResponse.text());
        }
      } catch (e) {
        console.error('[PARSE_AND_CREATE] Batch scheduling exception:', e);
        // Continue - tasks are created, just not scheduled
      }
    }

    // 7. Build response message
    const taskCount = createdTasks.length;
    let message = `Created ${taskCount} task${taskCount > 1 ? 's' : ''}`;
    
    if (scheduledResults.length > 0) {
      const scheduleDetails = scheduledResults.map(s => `${s.title} at ${s.time}`).join(', ');
      message += `. Scheduled: ${scheduleDetails}`;
    } else if (autoSchedule && unscheduledTasks.length > 0) {
      message += ` (scheduling was requested but no optimal slots found)`;
    }

    console.log(`[PARSE_AND_CREATE] Complete. ${message}`);

    return {
      success: true,
      result: {
        created: createdTasks.length,
        scheduled: scheduledResults,
        tasks: createdTasks.map(t => ({
          id: t.id,
          title: t.title,
          priority: t.priority,
          category: t.category,
          due_date: t.due_date,
          start_time: t.start_time,
          is_scheduled: t.is_scheduled
        }))
      },
      message,
      extractedFacts: { 
        type: 'task_created', 
        count: createdTasks.length,
        scheduled: scheduledResults.length
      }
    };
  } catch (error) {
    console.error('[PARSE_AND_CREATE] Error:', error);
    return { success: false, error: extractErrorMessage(error) };
  }
}

// ============================================================================
// COMMUNICATION FUNCTIONS
// ============================================================================

async function sendEmail(supabase: any, userId: string, args: any, userProfile?: any): Promise<ExecuteToolResponse> {
  try {
    // Get user profile if not provided
    if (!userProfile) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('email, phone, full_name')
        .eq('user_id', userId)
        .maybeSingle();
      userProfile = profile || {};
    }

    const { data, error } = await supabase.functions.invoke('send-unified-notification', {
      body: {
        userId,
        title: args.subject || args.title || 'AI Assistant Email',
        body: args.body || args.message || args.content || '',
        channels: ['EMAIL'],
        data: { type: 'assistant_email' },
        userProfile
      }
    });

    if (error) throw error;

    if (data?.success) {
      return { 
        success: true, 
        message: `Email sent successfully to ${userProfile?.email || 'user'}`,
        result: data.channelResults?.email
      };
    } else {
      return { 
        success: false, 
        error: data?.errors?.join(', ') || 'Failed to send email'
      };
    }
  } catch (error) {
    return { success: false, error: extractErrorMessage(error) };
  }
}

async function sendSlackMessage(supabase: any, userId: string, args: any, userProfile?: any): Promise<ExecuteToolResponse> {
  try {
    const { data, error } = await supabase.functions.invoke('send-unified-notification', {
      body: {
        userId,
        title: args.title || 'Message from Iris',
        body: args.message || args.text || args.body || '',
        channels: ['SLACK'],
        data: { type: 'assistant_slack' },
        userProfile: userProfile || {}
      }
    });

    if (error) throw error;

    if (data?.success) {
      return { 
        success: true, 
        message: 'Slack message sent successfully',
        result: data.channelResults?.slack
      };
    } else {
      return { 
        success: false, 
        error: data?.errors?.join(', ') || 'Failed to send Slack message'
      };
    }
  } catch (error) {
    return { success: false, error: extractErrorMessage(error) };
  }
}

async function createOutlookEvent(supabase: any, userId: string, args: any, userProfile?: any): Promise<ExecuteToolResponse> {
  try {
    if (!userProfile) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('email')
        .eq('user_id', userId)
        .maybeSingle();
      userProfile = profile || {};
    }

    const startTime = args.start_time || args.startTime || new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const durationMinutes = args.duration || args.durationMinutes || 60;
    const endTime = args.end_time || args.endTime || new Date(new Date(startTime).getTime() + durationMinutes * 60 * 1000).toISOString();

    const { data, error } = await supabase.functions.invoke('send-unified-notification', {
      body: {
        userId,
        channels: ['OUTLOOK_EVENT'],
        userProfile,
        data: {
          type: 'assistant_calendar',
          taskTitle: args.title || args.subject || 'AI Created Event',
          taskDescription: args.description || args.body || '',
          startTime,
          estimateMinutes: durationMinutes
        },
        outlookEvent: {
          title: args.title || args.subject || 'AI Created Event',
          startTime,
          endTime,
          reminder: args.reminder || '15'
        }
      }
    });

    if (error) throw error;

    if (data?.success) {
      return { 
        success: true, 
        message: `Outlook event "${args.title || 'Event'}" created for ${new Date(startTime).toLocaleString()}`,
        result: data.channelResults?.outlook
      };
    } else {
      return { 
        success: false, 
        error: data?.errors?.join(', ') || 'Failed to create Outlook event'
      };
    }
  } catch (error) {
    return { success: false, error: extractErrorMessage(error) };
  }
}

async function createGoogleEvent(supabase: any, userId: string, args: any, userProfile?: any): Promise<ExecuteToolResponse> {
  try {
    if (!userProfile) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('email')
        .eq('user_id', userId)
        .maybeSingle();
      userProfile = profile || {};
    }

    const startTime = args.start_time || args.startTime || new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const durationMinutes = args.duration || args.durationMinutes || 60;
    const endTime = args.end_time || args.endTime || new Date(new Date(startTime).getTime() + durationMinutes * 60 * 1000).toISOString();

    const { data, error } = await supabase.functions.invoke('send-unified-notification', {
      body: {
        userId,
        channels: ['GOOGLE_EVENT'],
        userProfile,
        data: {
          type: 'assistant_calendar',
          taskTitle: args.title || args.subject || 'AI Created Event',
          taskDescription: args.description || args.body || '',
          startTime,
          estimateMinutes: durationMinutes
        },
        googleEvent: {
          title: args.title || args.subject || 'AI Created Event',
          startTime,
          endTime,
          reminder: args.reminder || '15'
        }
      }
    });

    if (error) throw error;

    if (data?.success) {
      return { 
        success: true, 
        message: `Google Calendar event "${args.title || 'Event'}" created for ${new Date(startTime).toLocaleString()}`,
        result: data.channelResults?.google
      };
    } else {
      return { 
        success: false, 
        error: data?.errors?.join(', ') || 'Failed to create Google Calendar event'
      };
    }
  } catch (error) {
    return { success: false, error: extractErrorMessage(error) };
  }
}

async function createCalendarEvent(supabase: any, userId: string, args: any, userProfile?: any): Promise<ExecuteToolResponse> {
  // Parse times - handle both ISO format and HH:MM format
  let startTime = args.start_time;
  let endTime = args.end_time;
  
  if (startTime && !startTime.includes('T')) {
    // Use timezone from user profile if available, fallback to America/New_York
    const tz = userProfile?.timezone || 'America/New_York';
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    startTime = `${today}T${startTime}:00`;
    endTime = endTime ? `${today}T${endTime}:00` : new Date(new Date(startTime).getTime() + 60 * 60 * 1000).toISOString();
  }

  const calendarType = args.calendar?.toLowerCase() || 'outlook';
  
  if (calendarType === 'google') {
    return createGoogleEvent(supabase, userId, { ...args, start_time: startTime, end_time: endTime }, userProfile);
  } else {
    return createOutlookEvent(supabase, userId, { ...args, start_time: startTime, end_time: endTime }, userProfile);
  }
}

async function initiatePhoneCall(supabase: any, userId: string, args: any, interfaceType: string): Promise<ExecuteToolResponse> {
  // If called from phone, it's a callback request during active call
  if (interfaceType === 'phone') {
    const delayMinutes = args.delay_minutes || 0;
    const context = args.context || 'callback request';
    
    if (delayMinutes > 0) {
      return {
        success: true,
        message: `I'll call you back in ${delayMinutes} minutes regarding ${context}.`
      };
    } else {
      return {
        success: true,
        message: `You're already on the phone with me! What can I help you with?`
      };
    }
  }

  // For chat interface, trigger actual phone call via Twilio
  try {
    const { data, error } = await supabase.functions.invoke('twilio-voice-handler', {
      body: {
        action: 'trigger-call',
        userId,
        delay_minutes: args.delay_minutes,
        context: args.context
      }
    });

    if (error) throw error;

    if (data?.success) {
      const message = args.delay_minutes 
        ? `I'll call you in ${args.delay_minutes} minute${args.delay_minutes > 1 ? 's' : ''}`
        : 'Calling you now';
      return { 
        success: true, 
        message,
        result: { call_sid: data.call_sid }
      };
    } else {
      return { 
        success: false, 
        error: data?.error || 'Failed to initiate phone call'
      };
    }
  } catch (error) {
    return { success: false, error: extractErrorMessage(error) };
  }
}

// ============================================================================
// SCHEDULED CHAT MESSAGE FUNCTION
// ============================================================================

async function sendScheduledChatMessage(supabase: any, userId: string, args: any): Promise<ExecuteToolResponse> {
  const delayMinutes = args.delay_minutes || 0;
  const scheduledTime = args.scheduled_time;
  const message = args.message;
  const context = args.context || 'scheduled check-in';
  
  console.log(`[SEND_CHAT_MESSAGE] userId: ${userId}, delay: ${delayMinutes}min, time: ${scheduledTime}, message: ${message?.substring(0, 50)}`);
  
  try {
    // Get user's default assistant ID
    const { data: defaultAssistant } = await supabase
      .from('assistants')
      .select('id')
      .eq('user_id', userId)
      .eq('is_default', true)
      .maybeSingle();
    
    const assistantId = defaultAssistant?.id || null;
    
    // Calculate when to send
    let sendAt: Date;
    if (scheduledTime) {
      // Parse HH:MM and set for today/tomorrow
      const [hours, minutes] = scheduledTime.split(':').map(Number);
      sendAt = new Date();
      sendAt.setHours(hours, minutes, 0, 0);
      if (sendAt < new Date()) sendAt.setDate(sendAt.getDate() + 1); // Tomorrow if past
    } else {
      sendAt = new Date(Date.now() + delayMinutes * 60 * 1000);
    }
    
    // Send immediately if no delay
    if (delayMinutes === 0 && !scheduledTime) {
      const { data, error } = await supabase.functions.invoke('send-chat-message', {
        body: {
          userId,
          message,
          generateFromContext: message ? undefined : { callType: 'custom', context },
          sendPush: true,
          assistantId
        }
      });
      
      if (error) throw error;
      
      return { 
        success: true, 
        message: message ? 'Message sent!' : `I've sent you a check-in message.`
      };
    }
    
    // Schedule for later via scheduled_notifications
    const { error } = await supabase.from('scheduled_notifications').insert({
      user_id: userId,
      notification_type: 'scheduled_chat',
      scheduled_for: sendAt.toISOString(),
      title: 'Iris',
      body: message || `Scheduled check-in: ${context}`,
      metadata: {
        type: 'chat_message',
        message,
        context,
        assistantId
      }
    });
    
    if (error) throw error;
    
    const timeDescription = scheduledTime 
      ? `at ${scheduledTime}`
      : `in ${delayMinutes} minute${delayMinutes !== 1 ? 's' : ''}`;
    
    return { 
      success: true, 
      message: `I'll send you a message ${timeDescription}.`
    };
  } catch (error) {
    console.error('[SEND_CHAT_MESSAGE] Error:', error);
    return { success: false, error: extractErrorMessage(error) };
  }
}

// ============================================================================
// SEARCH FUNCTIONS
// ============================================================================

interface WebSearchArgs {
  query: string;
  topic?: "general" | "news" | "finance";
  search_depth?: "basic" | "advanced";
  time_range?: "day" | "week" | "month" | "year";
  start_date?: string;
  end_date?: string;
  include_domains?: string[];
  exclude_domains?: string[];
  max_results?: number;
}

// ============================================================================
// GET TASKS BY TOPIC - Topic drill-down to prevent hallucination
// ============================================================================

async function getTasksByTopic(supabase: any, userId: string, args: any): Promise<ExecuteToolResponse> {
  const topicName = args.topic_name;
  if (!topicName) {
    return { success: false, error: "topic_name is required", message: "Please specify a topic name." };
  }

  try {
    // Find the topic
    const { data: topic } = await supabase
      .from('task_topic_index')
      .select('id, topic_name, topic_summary')
      .eq('user_id', userId)
      .ilike('topic_name', topicName)
      .maybeSingle();

    if (!topic) {
      return {
        success: true,
        result: { tasks: [], count: 0 },
        message: `No topic group found matching "${topicName}". The user may not have tasks classified under this topic.`
      };
    }

    // Get task IDs from mappings
    const { data: mappings } = await supabase
      .from('task_topic_mappings')
      .select('task_id')
      .eq('topic_id', topic.id);

    if (!mappings || mappings.length === 0) {
      return {
        success: true,
        result: { tasks: [], count: 0, topic: topic.topic_name },
        message: `Topic "${topic.topic_name}" exists but has no tasks mapped to it.`
      };
    }

    // Fetch the actual tasks
    const taskIds = mappings.map((m: any) => m.task_id);
    const { data: tasks } = await supabase
      .from('tasks')
      .select('id, title, status, priority, category, due_date, start_time, description')
      .in('id', taskIds)
      .neq('status', 'DONE')
      .neq('status', 'BLOCKED')
      .not('title', 'ilike', '%test%')
      .order('priority', { ascending: false });

    console.log(`[GET-TASKS-BY-TOPIC] Topic "${topic.topic_name}": found ${tasks?.length || 0} open tasks`);

    return {
      success: true,
      result: {
        tasks: tasks || [],
        count: tasks?.length || 0,
        topic: topic.topic_name,
        summary: topic.topic_summary
      },
      message: `Found ${tasks?.length || 0} open tasks under "${topic.topic_name}"`,
      extractedFacts: { type: 'topic_drill_down', topic: topic.topic_name, taskCount: tasks?.length || 0 }
    };
  } catch (error) {
    console.error('[GET-TASKS-BY-TOPIC] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      message: "Failed to retrieve tasks for that topic."
    };
  }
}

async function webSearch(args: WebSearchArgs, timezone?: string): Promise<ExecuteToolResponse> {
  const TAVILY_API_KEY = Deno.env.get('TAVILY_API_KEY');
  const tz = timezone || 'America/New_York';
  const timeAnchor = getCurrentTimeAnchor(tz);
  
  console.log('[WEB-SEARCH] ==================== START ====================');
  console.log('[WEB-SEARCH] Using TAVILY API');
  console.log('[WEB-SEARCH] Query (verbatim):', args.query);
  console.log('[WEB-SEARCH] User timezone:', tz);
  console.log('[WEB-SEARCH] AI-provided params:', JSON.stringify(args, null, 2));
  console.log('[WEB-SEARCH] Time anchor:', JSON.stringify(timeAnchor));
  
  // AUTO-DETECT temporal intent and calculate dates from verbatim query
  const temporalIntent = detectTemporalIntent(args.query);
  let calculatedDates: { start_date: string; end_date: string } | null = null;
  
  if (temporalIntent) {
    calculatedDates = calculateDateRange(temporalIntent, tz);
    console.log(`[WEB-SEARCH] Detected temporal intent: "${temporalIntent}"`);
    console.log(`[WEB-SEARCH] Auto-calculated dates: ${JSON.stringify(calculatedDates)}`);
  } else {
    console.log('[WEB-SEARCH] No temporal intent detected - using AI-provided params');
  }
  
  if (!TAVILY_API_KEY) {
    console.error('[WEB-SEARCH] ❌ NO TAVILY_API_KEY - CANNOT SEARCH');
    return { 
      success: false, 
      error: "TAVILY_API_KEY not configured",
      message: "I cannot search the web right now because the search API is not configured.",
      timeAnchor
    };
  }
  
  try {
    // Build Tavily request from AI-provided parameters
    const requestBody: Record<string, any> = {
      query: args.query, // VERBATIM - exactly as user spoke
      topic: args.topic || 'general',
      search_depth: args.search_depth || 'advanced', // Default to advanced for better results
      max_results: args.max_results || 10,
      include_answer: 'advanced', // Always get AI summary
      include_raw_content: false,
      include_favicon: false
    };
    
    // Use calculated dates if detected, otherwise fall back to AI-provided params
    if (calculatedDates) {
      // Auto-calculated dates take precedence - ensures correct interpretation
      requestBody.start_date = calculatedDates.start_date;
      requestBody.end_date = calculatedDates.end_date;
      // Don't use time_range when we have explicit calculated dates
      console.log(`[WEB-SEARCH] Using AUTO-CALCULATED dates: ${calculatedDates.start_date} to ${calculatedDates.end_date}`);
    } else {
      // Fall back to AI-provided date parameters
      if (args.time_range) requestBody.time_range = args.time_range;
      if (args.start_date) requestBody.start_date = args.start_date;
      if (args.end_date) requestBody.end_date = args.end_date;
    }
    
    // Add domain filters if AI provided them (leave empty by default)
    if (args.include_domains?.length) requestBody.include_domains = args.include_domains;
    if (args.exclude_domains?.length) requestBody.exclude_domains = args.exclude_domains;
    
    console.log('[WEB-SEARCH] Tavily request:', JSON.stringify(requestBody, null, 2));
    
    const startTime = Date.now();
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TAVILY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    
    const duration = Date.now() - startTime;
    console.log(`[WEB-SEARCH] Tavily responded in ${duration}ms with status: ${response.status}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[WEB-SEARCH] ❌ Tavily API error:', response.status, errorText);
      return { 
        success: false, 
        error: `Search API error: ${response.status}`,
        message: "The web search failed. I cannot provide real-time information right now.",
        timeAnchor
      };
    }
    
    const data = await response.json();
    console.log('[WEB-SEARCH] ✅ Tavily results count:', data.results?.length || 0);
    console.log('[WEB-SEARCH] Answer preview:', data.answer?.substring(0, 300) + '...');
    
    const answer = data.answer || "No results found.";
    const sources = data.results?.map((r: any) => r.url) || [];
    
    console.log('[WEB-SEARCH] Sources:', JSON.stringify(sources));
    console.log('[WEB-SEARCH] ==================== END ====================');
    
    return {
      success: true,
      result: {
        answer,
        sources,
        results: data.results?.map((r: any) => ({
          title: r.title,
          url: r.url,
          content: r.content,
          score: r.score,
          published_date: r.published_date
        })),
        query: args.query,
        searchTimestamp: new Date().toISOString(),
        currentDate: timeAnchor.todayDate,
        paramsUsed: {
          topic: requestBody.topic,
          search_depth: requestBody.search_depth,
          time_range: requestBody.time_range,
          start_date: requestBody.start_date,
          end_date: requestBody.end_date
        }
      },
      message: answer,
      timeAnchor,
      extractedFacts: { type: 'web_search', source: 'tavily', rawAnswer: answer }
    };
  } catch (error) {
    console.error('[WEB-SEARCH] ❌ Exception:', error);
    console.log('[WEB-SEARCH] ==================== END (ERROR) ====================');
    return { 
      success: false, 
      error: extractErrorMessage(error),
      message: "I encountered an error while searching."
    };
  }
}

// ============================================================================
// INTROSPECTION: getMyConfig
// ============================================================================

async function getMyConfig(supabase: any, userId: string, args: any): Promise<ExecuteToolResponse> {
  const section = args.section || 'full_config';
  console.log(`[GET_MY_CONFIG] Section: ${section}, User: ${userId}`);

  const results: Record<string, any> = {};

  const fetchScheduledCalls = async () => {
    const { data } = await supabase
      .from('user_scheduling_prefs')
      .select('scheduled_calls, config, core_instructions, timezone')
      .eq('user_id', userId)
      .maybeSingle();
    return data;
  };

  const fetchCallHistory = async () => {
    const { data } = await supabase
      .from('call_sessions')
      .select('started_at, ended_at, duration_seconds, direction, call_context, from_number, to_number')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(10);
    return data || [];
  };

  const fetchTopicGroups = async () => {
    if (USE_SHARED_TOPICS) {
      // V2: Use shared ranking (recency + priority density + task count)
      console.log('[GET_MY_CONFIG] Using shared topic ranking');
      return getTopicGroupsManual(supabase, userId, null);
    }
    // Legacy fallback
    const { data } = await supabase
      .from('task_topic_index')
      .select('topic_name, summary, task_count, category_affinity, updated_at')
      .eq('user_id', userId)
      .order('task_count', { ascending: false });
    return data || [];
  };

  const fetchNotificationPrefs = async () => {
    const { data } = await supabase
      .from('notification_prefs')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    return data;
  };

  const fetchCalendarConnections = async () => {
    const { data } = await supabase
      .from('calendar_connections')
      .select('provider, provider_account_email, is_active, expires_at, connected_services, created_at, updated_at')
      .eq('user_id', userId);
    return data || [];
  };

  const fetchPendingNotifications = async () => {
    const { data } = await supabase
      .from('scheduled_notifications')
      .select('title, body, notification_type, scheduled_for')
      .eq('user_id', userId)
      .is('delivered_at', null)
      .is('failed_at', null)
      .order('scheduled_for', { ascending: true })
      .limit(10);
    return data || [];
  };

  const fetchProfile = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('full_name, first_name, last_name, email, phone, job_title, company, preferred_greeting, avatar_url')
      .eq('user_id', userId)
      .maybeSingle();
    return data;
  };

  try {
    if (section === 'full_config') {
      const [prefs, history, topics, notifPrefs, calendars, pending, profile] = await Promise.all([
        fetchScheduledCalls(),
        fetchCallHistory(),
        fetchTopicGroups(),
        fetchNotificationPrefs(),
        fetchCalendarConnections(),
        fetchPendingNotifications(),
        fetchProfile()
      ]);
      results.scheduled_calls = prefs?.scheduled_calls || [];
      results.scheduling_config = prefs?.config || {};
      results.core_instructions = prefs?.core_instructions || '';
      results.timezone = prefs?.timezone || 'America/New_York';
      results.call_history = history;
      results.topic_groups = topics;
      results.notification_prefs = notifPrefs || {};
      results.calendar_connections = calendars;
      results.pending_notifications = pending;
      results.my_profile = profile || {};
    } else if (section === 'scheduled_calls') {
      const [prefs, pending] = await Promise.all([
        fetchScheduledCalls(),
        fetchPendingNotifications()
      ]);
      results.scheduled_calls = prefs?.scheduled_calls || [];
      results.timezone = prefs?.timezone || 'America/New_York';
      
      // Include actual pending scheduled calls from the notification queue
      const pendingCalls = (pending || []).filter(
        (n: any) => n.notification_type === 'scheduled_call'
      );
      results.upcoming_scheduled_calls = pendingCalls.map((n: any) => ({
        name: n.title,
        scheduled_for: n.scheduled_for,
      }));
      if (pendingCalls.length > 0) {
        results.next_upcoming_call = {
          name: pendingCalls[0].title,
          scheduled_for: pendingCalls[0].scheduled_for,
        };
      }
    } else if (section === 'call_history') {
      results.call_history = await fetchCallHistory();
    } else if (section === 'topic_groups') {
      results.topic_groups = await fetchTopicGroups();
    } else if (section === 'notification_prefs') {
      results.notification_prefs = await fetchNotificationPrefs() || {};
    } else if (section === 'calendar_connections') {
      results.calendar_connections = await fetchCalendarConnections();
    } else if (section === 'pending_notifications') {
      results.pending_notifications = await fetchPendingNotifications();
    } else if (section === 'my_profile') {
      results.my_profile = await fetchProfile() || {};
    } else {
      return { success: false, error: `Unknown section: ${section}` };
    }

    return {
      success: true,
      result: results,
      extractedFacts: { type: 'other' as const }
    };
  } catch (error) {
    console.error('[GET_MY_CONFIG] Error:', error);
    return { success: false, error: extractErrorMessage(error) };
  }
}

// ============================================================================
// ITINERARY TOOLS — used by the Daily Review chat assistant
// Server-side mirror of the rules in src/lib/schedulingCandidates.ts
// ============================================================================

const ITINERARY_PRIORITY_WEIGHT: Record<string, number> = { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
const ITINERARY_KEYWORDS = ['payment','invoice','bill','tax','budget','contract','financial','money','pay','credit','transfer','fee','email','follow up','follow-up','respond','reply','call','meeting','text','message','contact','coach'];

function itineraryHourFromIso(iso: string, tz: string): number {
  try {
    const h = new Date(iso).toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false });
    return parseInt(h, 10);
  } catch { return 0; }
}

function itineraryDetectWindow(hour: number, isWeekend: boolean): string {
  if (isWeekend) return 'weekends';
  if (hour >= 6 && hour < 9) return 'morning';
  if (hour >= 9 && hour < 17) return 'business_hours';
  if (hour >= 17 && hour < 19) return 'after_work';
  return 'evening';
}

function itineraryWindowRange(window: string): { start: number; end: number } {
  switch (window) {
    case 'morning': return { start: 6, end: 9 };
    case 'business_hours': return { start: 9, end: 17 };
    case 'after_work': return { start: 17, end: 19 };
    case 'evening': return { start: 19, end: 23 };
    case 'weekends': return { start: 9, end: 21 };
    default: return { start: 9, end: 17 };
  }
}

function explainSchedulingScoreServer(task: any): {
  base: number; priorityExplicit: number; pushed: number; dueSoon: number;
  dueWindow: number; staleness: number; recency: number; keyword: number; upNext: number; total: number;
} {
  const base = ITINERARY_PRIORITY_WEIGHT[task.priority] || 1;
  const priorityExplicit = task.is_priority ? 10 + Math.max(5 - (task.priority_rank ?? 0), 0) : 0;
  let pushed = 0;
  if ((task.pushed_count ?? 0) > 0) {
    const n = task.pushed_count;
    if (n <= 3) pushed = 1;
    else if (n > 7 && !task.is_priority) pushed = -1;
  }
  const nowMs = Date.now();
  let dueSoon = 0, dueWindow = 0, staleness = 0;
  if (task.due_date) {
    const dueMs = new Date(task.due_date).getTime();
    const delta = dueMs - nowMs;
    if (delta <= 48 * 3600 * 1000 && delta >= -48 * 3600 * 1000) dueSoon = 5;
    if (delta > 48 * 3600 * 1000 && delta <= 7 * 24 * 3600 * 1000) dueWindow = 3;
    if (delta < -30 * 24 * 3600 * 1000) staleness = -10;
    else if (delta < -14 * 24 * 3600 * 1000) staleness = -3;
  }
  const createdAt = new Date(task.created_at).getTime();
  const daysSince = (nowMs - createdAt) / (24 * 3600 * 1000);
  const recency = daysSince <= 3 ? 2 : daysSince <= 7 ? 1 : 0;
  const lower = (task.title || '').toLowerCase();
  const keyword = ITINERARY_KEYWORDS.some(k => lower.includes(k)) ? 5 : 0;
  const upNext = task.status === 'UP_NEXT' ? 1 : 0;
  const total = Math.max(base + priorityExplicit + pushed + dueSoon + dueWindow + staleness + recency + keyword + upNext, 0);
  return { base, priorityExplicit, pushed, dueSoon, dueWindow, staleness, recency, keyword, upNext, total };
}

async function explainTaskScore(supabase: any, userId: string, args: any): Promise<ExecuteToolResponse> {
  if (!args.task_id) return { success: false, error: 'task_id required' };
  try {
    const { data: task, error } = await supabase
      .from('tasks').select('*').eq('id', args.task_id).eq('user_id', userId).maybeSingle();
    if (error) throw error;
    if (!task) return { success: false, error: 'Task not found' };
    const breakdown = explainSchedulingScoreServer(task);
    const factors: string[] = [];
    if (breakdown.base) factors.push(`priority=${task.priority} (+${breakdown.base})`);
    if (breakdown.priorityExplicit) factors.push(`on Priority Lane rank=${task.priority_rank ?? '?'} (+${breakdown.priorityExplicit})`);
    if (breakdown.dueSoon) factors.push(`due within 48h (+${breakdown.dueSoon})`);
    if (breakdown.dueWindow) factors.push(`due in 3-7 days (+${breakdown.dueWindow})`);
    if (breakdown.staleness) factors.push(`stale (${breakdown.staleness})`);
    if (breakdown.recency) factors.push(`recently created (+${breakdown.recency})`);
    if (breakdown.keyword) factors.push(`title keyword matched (+${breakdown.keyword})`);
    if (breakdown.upNext) factors.push(`already UP_NEXT (+${breakdown.upNext})`);
    if (breakdown.pushed > 0) factors.push(`recently rolled (+${breakdown.pushed})`);
    if (breakdown.pushed < 0) factors.push(`stale rolled-over (${breakdown.pushed})`);
    return {
      success: true,
      result: { task: { id: task.id, title: task.title, priority: task.priority, due_date: task.due_date, status: task.status, is_priority: task.is_priority, priority_rank: task.priority_rank, pushed_count: task.pushed_count }, breakdown, total: breakdown.total, factors },
      message: `"${task.title}" scored ${breakdown.total}: ${factors.join('; ') || 'base score only'}`
    };
  } catch (error) {
    return { success: false, error: extractErrorMessage(error) };
  }
}

async function listPendingAssignments(supabase: any, userId: string, args: any): Promise<ExecuteToolResponse> {
  try {
    const includeOverdue = args.include_overdue !== false;
    let q = supabase
      .from('assignments')
      .select('id, title, due_date, priority, status, program_id, assignment_url, course_id')
      .eq('user_id', userId)
      .neq('status', 'completed')
      .neq('status', 'graded');
    if (args.program_id) q = q.eq('program_id', args.program_id);
    const { data, error } = await q;
    if (error) throw error;
    const now = Date.now();
    const filtered = (data || []).filter((a: any) => {
      if (!a.due_date) return true;
      const due = new Date(a.due_date).getTime();
      if (!includeOverdue && due < now) return false;
      if (args.due_within_days != null) {
        const cutoff = now + args.due_within_days * 24 * 3600 * 1000;
        return due <= cutoff;
      }
      return true;
    }).sort((a: any, b: any) => {
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
    });
    // Check which have linked tasks
    const aIds = filtered.map((a: any) => a.id.toString());
    const { data: linkedTasks } = await supabase.from('tasks').select('id, assignment_id, status, start_time').in('assignment_id', aIds).eq('user_id', userId);
    const linkMap = new Map((linkedTasks || []).map((t: any) => [String(t.assignment_id), t]));
    const enriched = filtered.slice(0, 30).map((a: any) => ({
      id: a.id, title: a.title, due_date: a.due_date, priority: a.priority,
      program_id: a.program_id, url: a.assignment_url,
      task: linkMap.get(String(a.id)) || null
    }));
    return {
      success: true,
      result: { assignments: enriched, count: enriched.length, total: filtered.length },
      message: `${enriched.length} pending assignment${enriched.length !== 1 ? 's' : ''}${args.due_within_days ? ` due within ${args.due_within_days}d` : ''}`
    };
  } catch (error) {
    return { success: false, error: extractErrorMessage(error) };
  }
}

async function findOpenSlots(supabase: any, userId: string, args: any, timezone?: string): Promise<ExecuteToolResponse> {
  const tz = timezone || 'America/New_York';
  const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const date = args.date || today;
  const minDur = args.min_duration_min || 30;
  try {
    const dayStart = `${date}T00:00:00`;
    const dayEnd = `${date}T23:59:59`;
    const [tasksRes, eventsRes] = await Promise.all([
      supabase.from('tasks').select('start_time, end_time, estimate_minutes').eq('user_id', userId).eq('is_scheduled', true).gte('start_time', dayStart).lte('start_time', dayEnd),
      supabase.from('external_calendar_events').select('start_time, end_time').eq('user_id', userId).gte('start_time', dayStart).lte('start_time', dayEnd)
    ]);
    const dow = new Date(date + 'T12:00:00').toLocaleString('en-US', { timeZone: tz, weekday: 'short' });
    const isWeekend = dow === 'Sat' || dow === 'Sun';
    const occupied: Array<{ start: number; end: number }> = [];
    for (const t of (tasksRes.data || [])) {
      if (!t.start_time) continue;
      const sH = itineraryHourFromIso(t.start_time, tz);
      const dur = t.end_time ? (new Date(t.end_time).getTime() - new Date(t.start_time).getTime()) / 3600000 : (t.estimate_minutes || 60) / 60;
      occupied.push({ start: sH, end: sH + dur });
    }
    for (const e of (eventsRes.data || [])) {
      occupied.push({ start: itineraryHourFromIso(e.start_time, tz), end: itineraryHourFromIso(e.end_time, tz) });
    }
    occupied.sort((a, b) => a.start - b.start);
    const range = args.window ? itineraryWindowRange(args.window) : { start: isWeekend ? 9 : 6, end: 23 };
    const slots: Array<{ start_hour: number; end_hour: number; duration_min: number; window: string }> = [];
    let cursor = range.start;
    for (const span of occupied) {
      if (span.start >= range.end) break;
      if (span.start > cursor + minDur / 60) {
        const slotEnd = Math.min(span.start, range.end);
        slots.push({ start_hour: cursor, end_hour: slotEnd, duration_min: Math.round((slotEnd - cursor) * 60), window: itineraryDetectWindow(Math.floor(cursor), isWeekend) });
      }
      cursor = Math.max(cursor, span.end);
    }
    if (cursor < range.end) {
      slots.push({ start_hour: cursor, end_hour: range.end, duration_min: Math.round((range.end - cursor) * 60), window: itineraryDetectWindow(Math.floor(cursor), isWeekend) });
    }
    const filtered = slots.filter(s => s.duration_min >= minDur);
    return { success: true, result: { date, timezone: tz, slots: filtered }, message: `${filtered.length} open slot${filtered.length !== 1 ? 's' : ''} ≥${minDur}m on ${date}` };
  } catch (error) {
    return { success: false, error: extractErrorMessage(error) };
  }
}

async function moveTaskToDay(supabase: any, userId: string, args: any, timezone?: string): Promise<ExecuteToolResponse> {
  if (!args.task_id || !args.date) return { success: false, error: 'task_id and date required' };
  const tz = timezone || 'America/New_York';
  // Find a slot on the target date matching the requested window (if any)
  const slotResp = await findOpenSlots(supabase, userId, { date: args.date, window: args.window, min_duration_min: 30 }, tz);
  if (!slotResp.success || !(slotResp.result as any).slots?.length) {
    // Fall back to a default time at the start of the requested window or 9am
    const range = itineraryWindowRange(args.window || 'business_hours');
    const fallback = `${String(range.start).padStart(2, '0')}:00`;
    return rescheduleTask(supabase, { task_id: args.task_id, new_date: args.date, new_start_time: fallback }, tz);
  }
  const slot = (slotResp.result as any).slots[0];
  const hh = String(Math.floor(slot.start_hour)).padStart(2, '0');
  const mm = String(Math.round((slot.start_hour - Math.floor(slot.start_hour)) * 60)).padStart(2, '0');
  return rescheduleTask(supabase, { task_id: args.task_id, new_date: args.date, new_start_time: `${hh}:${mm}` }, tz);
}

async function swapTaskOrder(supabase: any, args: any): Promise<ExecuteToolResponse> {
  if (!args.task_id_a || !args.task_id_b) return { success: false, error: 'task_id_a and task_id_b required' };
  try {
    const { data: tasks, error } = await supabase.from('tasks').select('id, title, start_time, end_time').in('id', [args.task_id_a, args.task_id_b]);
    if (error) throw error;
    if (!tasks || tasks.length !== 2) return { success: false, error: 'Both tasks not found' };
    const a = tasks.find((t: any) => t.id === args.task_id_a);
    const b = tasks.find((t: any) => t.id === args.task_id_b);
    if (!a?.start_time || !b?.start_time) return { success: false, error: 'Both tasks must be scheduled' };
    const [updA, updB] = await Promise.all([
      supabase.from('tasks').update({ start_time: b.start_time, end_time: b.end_time }).eq('id', a.id),
      supabase.from('tasks').update({ start_time: a.start_time, end_time: a.end_time }).eq('id', b.id),
    ]);
    if (updA.error) throw updA.error;
    if (updB.error) throw updB.error;
    return { success: true, result: { swapped: [a.id, b.id] }, message: `Swapped "${a.title}" and "${b.title}"` };
  } catch (error) {
    return { success: false, error: extractErrorMessage(error) };
  }
}

async function setPriorityRank(supabase: any, args: any): Promise<ExecuteToolResponse> {
  if (!args.task_id) return { success: false, error: 'task_id required' };
  try {
    const update: any = args.unset
      ? { is_priority: false, priority_rank: null }
      : { is_priority: true, priority_rank: args.rank ?? null };
    const { data, error } = await supabase.from('tasks').update(update).eq('id', args.task_id).select('id, title, is_priority, priority_rank').single();
    if (error) throw error;
    return { success: true, result: { task: data }, message: args.unset ? `Removed "${data.title}" from priority lane` : `"${data.title}" set as priority${data.priority_rank ? ` (rank ${data.priority_rank})` : ''}` };
  } catch (error) {
    return { success: false, error: extractErrorMessage(error) };
  }
}

async function quickCreateTask(supabase: any, userId: string, args: any, timezone?: string): Promise<ExecuteToolResponse> {
  if (!args.title) return { success: false, error: 'title required' };
  // Re-use parse_and_create_tasks for consistent scheduling/buffer/window enforcement
  const text = args.title;
  const targetDate = args.date;
  const auto = args.auto_schedule !== false;
  // Inject duration/category/priority hints by prefixing — ai-task-parser respects these
  return parseAndCreateTasks(supabase, userId, {
    text,
    target_date: targetDate,
    auto_schedule: auto,
  } as any, timezone);
}

// ============================================================================
// HTTP SERVER
// ============================================================================


serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const url = new URL(req.url);

    // GET /definitions - Return tool definitions for use by other systems
    if (req.method === 'GET' && url.pathname.endsWith('/definitions')) {
      return new Response(JSON.stringify({ 
        tools: toolDefinitions,
        count: toolDefinitions.length
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // POST /execute - Execute a tool
    const body: ExecuteToolRequest = await req.json();
    const { toolName, args, userId, context } = body;

    if (!toolName || !userId) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'toolName and userId are required' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const result = await executeToolCall(supabase, toolName, args || {}, userId, context);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[EXECUTE-TOOL] Server error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
