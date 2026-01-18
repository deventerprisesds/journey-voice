import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
        status: { type: "string", enum: ["BACKLOG", "TODO", "DOING", "DONE"] }
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
        category: { type: "string", enum: ["LIFE", "CAREER", "VENTURES", "EDUCATION"] }
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
        status: { type: "string", enum: ["BACKLOG", "TODO", "DOING", "DONE"] },
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
    description: "Search the internet for REAL-TIME information. Use for: weather, sports scores (NFL, NBA, MLB, etc.), news, stock prices, current events, or anything requiring live data.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query (e.g., 'Ravens game score today', 'weather in Baltimore', 'latest tech news', 'AAPL stock price')" }
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

interface ExecuteToolResponse {
  success: boolean;
  result?: any;
  error?: string;
  message?: string;
  timeAnchor?: { currentDateTime: string; todayDate: string; timezone: string };
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
        return await getTasks(supabase, userId, args);
      
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
        return await webSearch(args.query, context.timezone);

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

async function getTasks(supabase: any, userId: string, args: any): Promise<ExecuteToolResponse> {
  try {
    let query = supabase.from('tasks').select('*').eq('user_id', userId);
    
    if (args.status) {
      query = query.eq('status', args.status.toUpperCase());
    }
    
    const { data, error } = await query.order('created_at', { ascending: false }).limit(20);
    
    if (error) throw error;
    
    return { 
      success: true, 
      result: { tasks: data || [], count: data?.length || 0 },
      message: `Found ${data?.length || 0} tasks`
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function getTodayTasks(supabase: any, userId: string, timezone?: string): Promise<ExecuteToolResponse> {
  try {
    const tz = timezone || 'America/New_York';
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .or(`scheduled_date.eq.${today},due_date.eq.${today}`)
      .order('scheduled_start_time', { ascending: true, nullsFirst: false });
    
    if (error) throw error;
    
    const scheduled = data?.filter((t: any) => t.scheduled_start_time) || [];
    const unscheduled = data?.filter((t: any) => !t.scheduled_start_time) || [];
    
    return { 
      success: true, 
      result: { 
        tasks: data || [],
        scheduled,
        unscheduled,
        date: today,
        timezone: tz
      },
      message: `Today (${today}): ${scheduled.length} scheduled, ${unscheduled.length} unscheduled tasks`
    };
  } catch (error) {
    return { success: false, error: String(error) };
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
    return { success: false, error: String(error) };
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
    return { success: false, error: String(error) };
  }
}

async function rescheduleTask(supabase: any, args: any): Promise<ExecuteToolResponse> {
  if (!args.task_id) return { success: false, error: "Task ID is required" };
  if (!args.new_date) return { success: false, error: "New date is required" };

  try {
    const updateData: any = {
      scheduled_date: args.new_date,
      due_date: args.new_date
    };
    
    if (args.new_start_time) {
      updateData.scheduled_start_time = args.new_start_time;
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
      message: `Rescheduled "${data.title}" to ${args.new_date}`
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function scheduleTask(supabase: any, args: any): Promise<ExecuteToolResponse> {
  if (!args.task_id) return { success: false, error: "Task ID is required" };

  try {
    const today = new Date().toISOString().split('T')[0];
    const updateData: any = {
      scheduled_date: args.date || today,
      status: 'TODO'
    };
    
    if (args.start_time) {
      updateData.scheduled_start_time = args.start_time;
    }
    if (args.duration_minutes) {
      updateData.estimated_duration = args.duration_minutes;
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
      message: `Scheduled "${data.title}" for ${updateData.scheduled_date}`
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function unscheduleTask(supabase: any, args: any): Promise<ExecuteToolResponse> {
  if (!args.task_id) return { success: false, error: "Task ID is required" };

  try {
    const { data, error } = await supabase
      .from('tasks')
      .update({
        scheduled_date: null,
        scheduled_start_time: null,
        scheduled_end_time: null,
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
    return { success: false, error: String(error) };
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
    return { success: false, error: String(error) };
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
    return { success: false, error: String(error) };
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
    return { success: false, error: String(error) };
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
    return { success: false, error: String(error) };
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
    return { success: false, error: String(error) };
  }
}

// ============================================================================
// SEARCH FUNCTIONS
// ============================================================================

async function webSearch(query: string, timezone?: string): Promise<ExecuteToolResponse> {
  const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');
  
  // Get the central time anchor for accurate date context
  const timeAnchor = getCurrentTimeAnchor(timezone || 'America/New_York');
  
  console.log('[WEB-SEARCH] ==================== START ====================');
  console.log('[WEB-SEARCH] Query received:', query);
  console.log('[WEB-SEARCH] Time anchor:', JSON.stringify(timeAnchor));
  console.log('[WEB-SEARCH] API Key configured:', !!PERPLEXITY_API_KEY);
  
  if (!PERPLEXITY_API_KEY) {
    console.error('[WEB-SEARCH] ❌ NO API KEY - CANNOT SEARCH');
    return { 
      success: false, 
      error: "Web search not configured - PERPLEXITY_API_KEY missing",
      message: "I cannot search the web right now because the search API is not configured. I CANNOT provide real-time information without it.",
      timeAnchor
    };
  }
  
  try {
    // Enhance the query with the current date for time-sensitive searches
    const enhancedQuery = `${query} (current date: ${timeAnchor.todayDate})`;
    
    // Detect multi-day queries for appropriate recency filter
    let recency: string = 'day';
    if (/weekend|this week|last week|past \d+ days/i.test(query)) {
      recency = 'week';
    }
    
    const requestBody = {
      model: 'sonar-pro',  // Advanced search model for complete results
      messages: [
        { 
          role: 'system', 
          content: `You are a factual search assistant. Today's date is ${timeAnchor.currentDateTime}. 

RESPONSE RULES:
- Provide COMPLETE data - list ALL items found, not partial lists
- For sports scores: Include BOTH teams' final scores for EVERY game
- Weekend = Friday, Saturday, Sunday; Week starts Monday
- End with brief source attribution (e.g., "Source: ESPN")
- If data is incomplete, explicitly state what's missing
- NEVER fabricate information - only report what search results contain` 
        },
        { role: 'user', content: enhancedQuery }
      ],
      search_recency_filter: recency,
      web_search_options: {
        search_context_size: 'high'  // Get complete search context
      },
      max_tokens: 1500  // Allow longer responses for complete data
    };
    
    console.log('[WEB-SEARCH] Enhanced query:', enhancedQuery);
    console.log('[WEB-SEARCH] Perplexity request body:', JSON.stringify(requestBody, null, 2));
    
    const startTime = Date.now();
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    
    const duration = Date.now() - startTime;
    console.log(`[WEB-SEARCH] Perplexity responded in ${duration}ms with status: ${response.status}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[WEB-SEARCH] ❌ Perplexity API error:', response.status, errorText);
      return { 
        success: false, 
        error: `Search API error: ${response.status} - ${errorText}`,
        message: "The web search failed. I CANNOT provide real-time information right now.",
        timeAnchor
      };
    }
    
    const data = await response.json();
    console.log('[WEB-SEARCH] ✅ Raw Perplexity response:', JSON.stringify(data, null, 2));
    
    const answer = data.choices?.[0]?.message?.content || "No results found.";
    const sources = data.citations || [];
    
    console.log('[WEB-SEARCH] Extracted answer:', answer);
    console.log('[WEB-SEARCH] Sources:', JSON.stringify(sources));
    console.log('[WEB-SEARCH] ==================== END ====================');
    
    return {
      success: true,
      result: { 
        answer, 
        sources, 
        query, 
        enhancedQuery,
        searchTimestamp: new Date().toISOString(),
        currentDate: timeAnchor.todayDate
      },
      message: answer,
      timeAnchor
    };
  } catch (error) {
    console.error('[WEB-SEARCH] ❌ Exception:', error);
    console.log('[WEB-SEARCH] ==================== END (ERROR) ====================');
    return { 
      success: false, 
      error: String(error),
      message: "I encountered an error while searching. I CANNOT provide real-time information right now."
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
