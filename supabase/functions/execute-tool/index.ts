import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeDueDate, normalizeDateTime, getTodayInTimezone } from "../_shared/timezone.ts";

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

// ============================================================================
// UNIFIED TOOL DEFINITIONS - Single source of truth for all AI interfaces
// ============================================================================

export const toolDefinitions = [
  // TASK TOOLS
  {
    type: "function",
    name: "get_tasks",
    description: "Retrieve tasks and chat history. Can search by time period, keywords, or status.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query or keywords" },
        time_filter: { type: "string", description: "Time period like 'past week', 'yesterday'" },
        status: { 
          type: "string", 
          enum: ["BACKLOG", "TODO", "READY", "UP_NEXT", "DOING", "DONE", "BLOCKED", "PLANNING"],
          description: "Task workflow status. BACKLOG=not yet planned, TODO=planned but not started, READY=ready to work on, UP_NEXT=queued to start soon, DOING=in progress, DONE=completed, BLOCKED=waiting on something, PLANNING=needs more detail"
        }
      }
    }
  },
  {
    type: "function",
    name: "get_today_tasks",
    description: "Get all tasks for today, including both scheduled and unscheduled tasks.",
    parameters: { type: "object", properties: {} }
  },
  {
    type: "function",
    name: "create_task",
    description: "Create a new task. Use UPPERCASE for priority.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title" },
        description: { type: "string", description: "Task description" },
        priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
        category: { type: "string", enum: ["LIFE", "CAREER", "VENTURES", "EDUCATION"] },
        status: { 
          type: "string", 
          enum: ["BACKLOG", "TODO", "READY", "UP_NEXT", "DOING", "DONE", "BLOCKED", "PLANNING"],
          description: "Task workflow status. BACKLOG=not yet planned, TODO=planned but not started, READY=ready to work on, UP_NEXT=queued to start soon, DOING=in progress, DONE=completed, BLOCKED=waiting on something, PLANNING=needs more detail. Defaults to BACKLOG."
        }
      },
      required: ["title"]
    }
  },
  {
    type: "function",
    name: "update_task",
    description: "Update an existing task's properties.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "ID of the task to update" },
        title: { type: "string" },
        description: { type: "string" },
        status: { 
          type: "string", 
          enum: ["BACKLOG", "TODO", "READY", "UP_NEXT", "DOING", "DONE", "BLOCKED", "PLANNING"],
          description: "Task workflow status. BACKLOG=not yet planned, TODO=planned but not started, READY=ready to work on, UP_NEXT=queued to start soon, DOING=in progress, DONE=completed, BLOCKED=waiting on something, PLANNING=needs more detail"
        },
        priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
        category: { type: "string", enum: ["LIFE", "CAREER", "VENTURES", "EDUCATION"] }
      },
      required: ["task_id"]
    }
  },
  {
    type: "function",
    name: "reschedule_task",
    description: "Move a task to a different date or time.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "ID of the task to reschedule" },
        new_date: { type: "string", description: "New date in YYYY-MM-DD format" },
        new_start_time: { type: "string", description: "New start time in HH:MM format" },
        reason: { type: "string" }
      },
      required: ["task_id", "new_date"]
    }
  },
  {
    type: "function",
    name: "schedule_task",
    description: "Schedule an unscheduled task to a specific date and time.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "ID of the task to schedule" },
        date: { type: "string", description: "Date in YYYY-MM-DD format" },
        start_time: { type: "string", description: "Start time in HH:MM format" },
        duration_minutes: { type: "number" }
      },
      required: ["task_id"]
    }
  },
  {
    type: "function",
    name: "unschedule_task",
    description: "Remove a task from the calendar schedule.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "ID of the task to unschedule" }
      },
      required: ["task_id"]
    }
  },
  {
    type: "function",
    name: "parse_and_create_tasks",
    description: "Parse natural language into tasks using AI and create them. Handles multiple tasks, date parsing ('today', 'tomorrow', 'next week'), categories, priorities, and optional auto-scheduling. Use this when user describes tasks in conversational language rather than explicit field values.",
    parameters: {
      type: "object",
      properties: {
        text: { 
          type: "string", 
          description: "Natural language task description. Can include multiple tasks, dates, priorities. Example: 'I need to get a haircut, work on the Nexus application, and meet with my MBA partner'" 
        },
        target_date: { 
          type: "string", 
          description: "Target date for tasks. Can be YYYY-MM-DD format or keywords like 'today', 'tomorrow'. Used when user specifies a day context." 
        },
        auto_schedule: { 
          type: "boolean", 
          description: "If true, automatically find optimal time slots for tasks based on user preferences and calendar. Default: true" 
        }
      },
      required: ["text"]
    }
  },

  // COMMUNICATION TOOLS
  {
    type: "function",
    name: "send_email",
    description: "Send an email to the user.",
    parameters: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Email body content" }
      },
      required: ["subject", "body"]
    }
  },
  {
    type: "function",
    name: "send_slack_message",
    description: "Send a Slack message to the user.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "The message to send" }
      },
      required: ["message"]
    }
  },
  {
    type: "function",
    name: "create_outlook_event",
    description: "Create an Outlook calendar event.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Event title" },
        start_time: { type: "string", description: "Start time in ISO format" },
        end_time: { type: "string", description: "End time in ISO format" },
        duration: { type: "number", description: "Duration in minutes (if no end_time)" },
        description: { type: "string", description: "Event description" },
        reminder: { type: "string", description: "Reminder minutes before" }
      },
      required: ["title", "start_time"]
    }
  },
  {
    type: "function",
    name: "create_google_event",
    description: "Create a Google Calendar event.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Event title" },
        start_time: { type: "string", description: "Start time in ISO format" },
        end_time: { type: "string", description: "End time in ISO format" },
        duration: { type: "number", description: "Duration in minutes (if no end_time)" },
        description: { type: "string", description: "Event description" },
        reminder: { type: "string", description: "Reminder minutes before" }
      },
      required: ["title", "start_time"]
    }
  },
  {
    type: "function",
    name: "create_calendar_event",
    description: "Create a calendar event in Outlook or Google Calendar.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Event title" },
        start_time: { type: "string", description: "Start time in ISO format or HH:MM" },
        end_time: { type: "string", description: "End time in ISO format or HH:MM" },
        calendar: { type: "string", enum: ["outlook", "google"], description: "Which calendar to use" }
      },
      required: ["title", "start_time"]
    }
  },
  {
    type: "function",
    name: "initiate_phone_call",
    description: "Schedule a callback - useful for 'call me back in X minutes' requests.",
    parameters: {
      type: "object",
      properties: {
        delay_minutes: { type: "number", description: "Minutes to wait before calling back" },
        context: { type: "string", description: "What the callback should be about" }
      }
    }
  },

  // SEARCH TOOLS
  {
    type: "function",
    name: "web_search",
    description: "Search the internet for REAL-TIME information using Tavily. CRITICAL INSTRUCTION: The 'query' parameter MUST be a VERBATIM transcription of what the user said - do NOT rephrase, summarize, or convert temporal phrases like 'this weekend' or 'today' into specific dates. Pass the EXACT words the user spoke. Use the other parameters to configure the search appropriately.",
    parameters: {
      type: "object",
      properties: {
        query: { 
          type: "string", 
          description: "The user's EXACT spoken words - pass verbatim without any modification (e.g., if user says 'What are the NBA scores for this weekend?', pass EXACTLY that string)" 
        },
        topic: {
          type: "string",
          enum: ["general", "news", "finance"],
          description: "Search category. Use 'news' for sports scores, current events, breaking news, real-time updates. Use 'finance' for stock prices, market data, financial news. Use 'general' for everything else."
        },
        search_depth: {
          type: "string",
          enum: ["basic", "advanced"],
          description: "Search depth. Use 'advanced' for complex queries requiring high relevance (sports scores, specific facts). Use 'basic' for simple lookups."
        },
        time_range: {
          type: "string",
          enum: ["day", "week", "month", "year"],
          description: "Relative time filter. Use 'day' for 'today/tonight', 'week' for 'this week/this weekend', 'month' for recent news, 'year' for broader searches. Only set if query implies a time constraint."
        },
        start_date: {
          type: "string",
          description: "Explicit start date in YYYY-MM-DD format. Only use if you can determine a specific date range from context. Leave empty if unsure."
        },
        end_date: {
          type: "string",
          description: "Explicit end date in YYYY-MM-DD format. Only use if you can determine a specific date range from context. Leave empty if unsure."
        },
        include_domains: {
          type: "array",
          items: { type: "string" },
          description: "Optional: List of domains to prioritize (e.g., ['espn.com', 'nba.com'] for sports, ['reuters.com', 'bbc.com'] for news). Only provide if you have specific trusted sources for the query type. Leave empty to search all sources."
        },
        exclude_domains: {
          type: "array",
          items: { type: "string" },
          description: "Optional: Domains to exclude from results. Leave empty unless there's a specific reason to exclude."
        },
        max_results: {
          type: "integer",
          description: "Number of results to return (1-20). Default 10. Use higher for broad queries, lower for specific lookups."
        }
      },
      required: ["query"]
    }
  },

  // PHONE-ONLY TOOLS (no-op for chat, active for phone)
  {
    type: "function",
    name: "hang_up",
    description: "End the phone call gracefully. Use when the user says goodbye or indicates they're done.",
    parameters: {
      type: "object",
      properties: {
        farewell_message: { type: "string", description: "Optional farewell message to say before hanging up" }
      }
    }
  }
];

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
      todayDate: now.toISOString().split('T')[0],
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
        return await createTask(supabase, userId, args);
      
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

      // ============ SEARCH TOOLS ============
      case 'web_search':
        return await webSearch(args, context.timezone);

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
// TASK FUNCTIONS
// ============================================================================

async function getTasks(supabase: any, userId: string, args: any, timezone: string = 'America/New_York'): Promise<ExecuteToolResponse> {
  try {
    console.log(`[GET_TASKS] Args:`, args, `Timezone: ${timezone}`);
    
    let query = supabase.from('tasks').select('*').eq('user_id', userId);
    
    // Apply status filter
    if (args.status) {
      query = query.eq('status', args.status.toUpperCase());
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
    
    return { 
      success: true, 
      result: { tasks: data || [], count, scheduled, unscheduled },
      message: `Found ${count} tasks${args.time_filter ? ` for "${args.time_filter}"` : ''} (${scheduled} scheduled, ${unscheduled} unscheduled)`,
      extractedFacts: { type: 'task_list', count, scheduled, unscheduled }
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
    
    return { 
      success: true, 
      result: { 
        tasks: allTasks,
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
        unscheduled: unscheduled.length 
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
    const today = getTodayInTimezone(tz);
    const dateStr = args.date || today;
    
    let startTimeRaw = dateStr;
    if (args.start_time) {
      startTimeRaw = `${dateStr}T${args.start_time}`;
    }
    
    // Normalize to proper UTC
    const normalizedStartTime = normalizeDateTime(startTimeRaw, tz);
    console.log(`[SCHEDULE_TASK] Raw: ${startTimeRaw} → Normalized: ${normalizedStartTime} (tz: ${tz})`);
    
    const updateData: any = {
      start_time: normalizedStartTime,
      is_scheduled: true,
      status: 'TODO',
      // Sync due_date to the scheduled date
      due_date: normalizeDueDate(dateStr, tz)
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

async function parseAndCreateTasks(
  supabase: any, 
  userId: string, 
  args: { text: string; target_date?: string; auto_schedule?: boolean },
  timezone?: string
): Promise<ExecuteToolResponse> {
  const tz = timezone || 'America/New_York';
  const autoSchedule = args.auto_schedule !== false; // Default true
  
  console.log(`[PARSE_AND_CREATE] Input: "${args.text}", target_date: ${args.target_date}, auto_schedule: ${autoSchedule}, tz: ${tz}`);
  
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
      // Normalize due_date to end-of-day in user's timezone
      const rawDueDate = task.due_date || targetDate || null;
      const normalizedDueDate = rawDueDate ? normalizeDueDate(rawDueDate, tz) : null;
      
      // Normalize start_time/end_time if provided (treat as local to user's timezone)
      const normalizedStartTime = task.start_time ? normalizeDateTime(task.start_time, tz) : null;
      const normalizedEndTime = task.end_time ? normalizeDateTime(task.end_time, tz) : null;
      
      console.log(`[PARSE_AND_CREATE] Task "${task.title}" dates: raw_due=${rawDueDate} → ${normalizedDueDate}, start=${task.start_time} → ${normalizedStartTime}`);
      
      const taskData = {
        title: task.title,
        description: task.description || null,
        priority: (task.priority || 'MEDIUM').toUpperCase(),
        category: (task.category || 'LIFE').toUpperCase(),
        status: task.status || 'BACKLOG',
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
        console.log(`[PARSE_AND_CREATE] Created task: ${data.title} (${data.id})`);
      } else if (error) {
        console.error(`[PARSE_AND_CREATE] Failed to create task "${task.title}":`, error);
      }
    }

    if (createdTasks.length === 0) {
      return { success: false, error: "Failed to create any tasks" };
    }

    // 6. If auto_schedule is enabled and tasks need scheduling, call batch-calendar-scheduler
    const unscheduledTasks = createdTasks.filter(t => !t.is_scheduled);
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
          for (const slot of batchResult.scheduled || []) {
            const task = unscheduledTasks[slot.taskIndex];
            if (task && slot.start_time && slot.end_time) {
              // The batch scheduler now returns properly normalized UTC times
              // Also sync due_date to match the scheduled date
              const scheduledDate = slot.start_time.split('T')[0];
              const syncedDueDate = normalizeDueDate(scheduledDate, tz);
              
              console.log(`[PARSE_AND_CREATE] Applying schedule: task="${task.title}", start=${slot.start_time}, synced_due=${syncedDueDate}`);
              
              const { error: updateError } = await supabase
                .from('tasks')
                .update({
                  start_time: slot.start_time,
                  end_time: slot.end_time,
                  due_date: syncedDueDate, // Sync due_date with scheduled date
                  is_scheduled: true,
                  status: 'TODO'
                })
                .eq('id', task.id);

              if (!updateError) {
                scheduledResults.push({
                  title: task.title,
                  time: new Date(slot.start_time).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    timeZone: tz
                  })
                });
                console.log(`[PARSE_AND_CREATE] Scheduled "${task.title}" at ${slot.start_time}`);
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
        scheduled: scheduledResults.length,
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
    const today = new Date().toISOString().split('T')[0];
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
