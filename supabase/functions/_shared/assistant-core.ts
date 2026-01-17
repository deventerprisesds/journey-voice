// Shared Assistant Core - Unified instructions, tools, and execution for all channels
// Used by: generate-realtime-token (WebRTC), twilio-realtime-bridge (Phone), hybrid-assistant-api (Text)

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============ Types ============

export interface UserContext {
  userId: string | null;
  userName: string;
  email: string | null;
  phone: string | null;
  timezone: string;
  todayTasks: string;
  ragContext: string;
}

export interface ChannelConfig {
  type: 'webrtc' | 'phone' | 'text' | 'slack';
  voiceOptimized: boolean;
  interruptionHandling: boolean;
}

// ============ Tool Definitions (Unified across all channels) ============

export const toolDefinitions = [
  {
    type: "function",
    name: "get_tasks",
    description: "Retrieve tasks and chat history. Can search by time period, keywords, or status. Use this for any historical queries like 'tasks from last week' or 'what did I work on yesterday'.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query or keywords to find in tasks/messages" },
        time_filter: { type: "string", description: "Time period like 'past week', 'last month', 'yesterday', 'last 7 days'" },
        status: { type: "string", enum: ["BACKLOG", "TODO", "DOING", "DONE"], description: "Filter by task status" }
      }
    }
  },
  {
    type: "function",
    name: "create_task",
    description: "Create a new task. Use UPPERCASE for priority (LOW, MEDIUM, HIGH, URGENT). For education/school tasks, use category 'EDUCATION'. The system will place tasks in the appropriate board.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title" },
        description: { type: "string", description: "Task description" },
        priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"], description: "Task priority level (UPPERCASE)" },
        category: { type: "string", enum: ["LIFE", "CAREER", "VENTURES", "EDUCATION"], description: "Task category - use EDUCATION for school/MIT/EMBA tasks" }
      },
      required: ["title"]
    }
  },
  {
    type: "function",
    name: "update_task",
    description: "Update an existing task's properties. Use UPPERCASE for priority and status.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "ID of the task to update" },
        title: { type: "string", description: "New task title" },
        description: { type: "string", description: "New task description" },
        status: { type: "string", enum: ["BACKLOG", "TODO", "DOING", "DONE"], description: "New task status (UPPERCASE)" },
        priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"], description: "New task priority (UPPERCASE)" },
        category: { type: "string", enum: ["LIFE", "CAREER", "VENTURES", "EDUCATION"], description: "New task category" }
      },
      required: ["task_id"]
    }
  },
  {
    type: "function",
    name: "get_today_tasks",
    description: "Get all tasks for today, including both scheduled and unscheduled tasks. Shows what the user has planned for today.",
    parameters: { type: "object", properties: {} }
  },
  {
    type: "function",
    name: "reschedule_task",
    description: "Move a task to a different date or time. Use this when user says 'move task to tomorrow', 'reschedule for next week', etc.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "ID of the task to reschedule" },
        new_date: { type: "string", description: "New date in YYYY-MM-DD format" },
        new_start_time: { type: "string", description: "New start time in HH:MM format (24-hour)" },
        reason: { type: "string", description: "Optional reason for rescheduling" }
      },
      required: ["task_id", "new_date"]
    }
  },
  {
    type: "function",
    name: "schedule_task",
    description: "Schedule an unscheduled task to a specific date and time. Automatically finds optimal time slot based on category preferences if time not specified.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "ID of the task to schedule" },
        date: { type: "string", description: "Date to schedule in YYYY-MM-DD format, defaults to today" },
        start_time: { type: "string", description: "Optional start time in HH:MM format (24-hour)" },
        duration_minutes: { type: "number", description: "Duration in minutes, defaults to task estimate or 60" }
      },
      required: ["task_id"]
    }
  },
  {
    type: "function",
    name: "unschedule_task",
    description: "Remove a task from the calendar schedule. The task will remain in backlog.",
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
    name: "send_slack_message",
    description: "Send a Slack message to the user or a channel.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "The message to send" },
        channel: { type: "string", description: "Optional channel name (defaults to user's primary channel)" }
      },
      required: ["message"]
    }
  },
  {
    type: "function",
    name: "send_email",
    description: "Send an email to the user or a specified recipient.",
    parameters: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Email subject line" },
        body: { type: "string", description: "Email body content" },
        to: { type: "string", description: "Optional recipient email (defaults to user's email)" }
      },
      required: ["subject", "body"]
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
        calendar: { type: "string", enum: ["outlook", "google"], description: "Which calendar to use" },
        description: { type: "string", description: "Event description" }
      },
      required: ["title", "start_time"]
    }
  },
  {
    type: "function",
    name: "initiate_phone_call",
    description: "Call the user on their phone. Use when user says 'call me', 'phone me', 'give me a call', or requests a phone conversation. Can include an optional delay in minutes.",
    parameters: {
      type: "object",
      properties: {
        delay_minutes: { type: "number", description: "Optional minutes to wait before calling (e.g., 'call me in 5 minutes')" },
        context: { type: "string", description: "What the call should be about (e.g., 'morning briefing', 'task review')" }
      }
    }
  },
  {
    type: "function",
    name: "disconnect",
    description: "Disconnect the voice assistant when user says goodbye, 'that's all', 'disconnect', 'that will be all', 'thanks that's it', or similar phrases indicating they're done. For phone calls, this will hang up.",
    parameters: {
      type: "object",
      properties: {
        farewell_message: { type: "string", description: "Optional goodbye message to say before disconnecting" }
      }
    }
  }
];

// ============ Instruction Building ============

export function getTimeBasedGreeting(timezone: string = 'America/New_York'): string {
  try {
    const now = new Date();
    const timeStr = now.toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', hour12: false });
    const hour = parseInt(timeStr, 10);
    
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  } catch {
    const hour = new Date().getUTCHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }
}

export function getCurrentTimeString(timezone: string = 'America/New_York'): string {
  try {
    return new Date().toLocaleString('en-US', { 
      timeZone: timezone, 
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  } catch {
    return new Date().toISOString();
  }
}

export function buildInstructions(
  context: UserContext,
  channel: ChannelConfig,
  customInstructions?: string
): string {
  const currentTime = getCurrentTimeString(context.timezone);
  
  // Base capabilities - same across ALL channels
  const baseCapabilities = `You are Iris, a knowledgeable and proactive executive assistant for ${context.userName}.

CURRENT TIME: ${currentTime}
TIMEZONE: ${context.timezone}

YOU CAN HELP WITH ANYTHING, including:
- Task and schedule management (your primary function)
- General knowledge questions (history, science, concepts, advice)
- Current events awareness (note: you may not have real-time data for live scores/weather)
- Calculations and reasoning
- Sending messages (Slack, Email) and creating calendar events
- Any question ${context.userName} might have

When asked about real-time data you don't have access to (live sports scores, current weather, stock prices), acknowledge the limitation and offer alternatives or explain what you do know.

${context.todayTasks ? `SCHEDULE CONTEXT:\n${context.todayTasks}` : ''}
${context.ragContext ? `\nKNOWLEDGE CONTEXT:\n${context.ragContext}` : ''}`;

  // Channel-specific behavior
  let channelBehavior = '';
  
  if (channel.type === 'phone') {
    channelBehavior = `
PHONE CONVERSATION STYLE:
- Keep responses conversational and concise - this is a phone call
- Listen for interruptions and stop speaking when the user starts talking
- Execute actions immediately with brief confirmation
- Don't ask unnecessary confirmation questions
- When the user says goodbye, use the disconnect function to end the call`;
  } else if (channel.type === 'webrtc') {
    channelBehavior = `
VOICE CONVERSATION STYLE:
- Keep responses conversational but can be more detailed than phone
- Execute actions immediately with confirmation
- Offer follow-up suggestions after completing tasks
- When the user says goodbye, use the disconnect function`;
  } else if (channel.type === 'text') {
    channelBehavior = `
TEXT CONVERSATION STYLE:
- Can provide more detailed responses with formatting
- Use bullet points and structure for complex information
- Ask clarifying questions when needed for precision`;
  }

  // Available functions summary
  const functionsSummary = `
AVAILABLE FUNCTIONS:
- get_tasks: Retrieve tasks with time/keyword filtering
- get_today_tasks: Get all tasks scheduled for today
- create_task: Create new tasks with title, description, priority, and category
- update_task: Update existing tasks (status, title, description, priority)
- reschedule_task: Move a task to a different date or time
- schedule_task: Schedule an unscheduled task
- unschedule_task: Remove a task from the calendar
- send_slack_message: Send a Slack message
- send_email: Send an email
- create_calendar_event: Create an Outlook or Google Calendar event
- initiate_phone_call: Request a callback (for scheduling future calls)
- disconnect: End the conversation gracefully`;

  // Combine all parts
  let fullInstructions = [
    baseCapabilities,
    channelBehavior,
    functionsSummary
  ].join('\n');

  // Add custom user instructions if provided
  if (customInstructions) {
    fullInstructions += `\n\nUSER PREFERENCES:\n${customInstructions}`;
  }

  return fullInstructions;
}

// ============ Context Loading ============

export async function loadUserProfile(supabase: SupabaseClient, userId: string): Promise<any> {
  try {
    const { data } = await supabase
      .from('profiles')
      .select('full_name, first_name, email, phone')
      .eq('user_id', userId)
      .maybeSingle();
    return data || {};
  } catch (error) {
    console.warn('[CORE] Failed to load user profile:', error);
    return {};
  }
}

export async function loadTodayTasks(supabase: SupabaseClient, userId: string, timezone: string): Promise<string> {
  try {
    const now = new Date();
    const today = now.toLocaleDateString('en-CA', { timeZone: timezone });
    
    const { data: tasks } = await supabase
      .from('tasks')
      .select('title, scheduled_start_time, scheduled_end_time, priority, status, category')
      .eq('user_id', userId)
      .or(`due_date.eq.${today},scheduled_date.eq.${today}`)
      .order('scheduled_start_time', { ascending: true });

    if (!tasks || tasks.length === 0) {
      return "No tasks scheduled for today.";
    }

    const taskList = tasks.map((t: any, i: number) => {
      const time = t.scheduled_start_time ? `at ${t.scheduled_start_time}` : 'unscheduled';
      return `${i + 1}. ${t.title} (${time}, ${t.priority} priority, ${t.status})`;
    }).join('\n');

    return `Today's ${tasks.length} tasks:\n${taskList}`;
  } catch (error) {
    console.warn('[CORE] Failed to load today tasks:', error);
    return "Unable to load today's tasks.";
  }
}

export async function loadRAGContext(supabase: SupabaseClient, userId: string, userInput?: string): Promise<string> {
  try {
    const { data, error } = await supabase.functions.invoke('rag-context-retrieval', {
      body: {
        action: 'get_context',
        userInput: userInput || 'general assistant knowledge and user preferences',
        userId,
        baseInstructions: ''
      }
    });

    if (error || !data?.context) {
      return '';
    }

    let contextParts: string[] = [];

    if (data.context.knowledgeContext) {
      contextParts.push(data.context.knowledgeContext);
    }

    const convHistory = data.context.conversationContext || [];
    if (convHistory.length > 0) {
      const relevantContext = convHistory
        .slice(0, 5)
        .map((c: any) => `${c.message_type}: ${c.content}`)
        .join('\n');
      contextParts.push(`Recent conversation:\n${relevantContext}`);
    }

    return contextParts.join('\n\n');
  } catch (error) {
    console.warn('[CORE] RAG context error:', error);
    return '';
  }
}

export async function loadUserInstructions(supabase: SupabaseClient, userId: string): Promise<{ coreInstructions: string; realtimeExtensions: string; customAI: string; timezone: string }> {
  try {
    const { data: prefs } = await supabase
      .from('user_scheduling_prefs')
      .select('core_instructions, realtime_extensions, config, timezone')
      .eq('user_id', userId)
      .maybeSingle();

    return {
      coreInstructions: prefs?.core_instructions || '',
      realtimeExtensions: prefs?.realtime_extensions || '',
      customAI: prefs?.config?.customAIInstructions || '',
      timezone: prefs?.timezone || 'America/New_York'
    };
  } catch (error) {
    console.warn('[CORE] Failed to load user instructions:', error);
    return { coreInstructions: '', realtimeExtensions: '', customAI: '', timezone: 'America/New_York' };
  }
}

export async function buildFullContext(
  supabase: SupabaseClient,
  userId: string | null,
  channel: ChannelConfig
): Promise<{ instructions: string; context: UserContext }> {
  const defaultContext: UserContext = {
    userId: null,
    userName: 'sir',
    email: null,
    phone: null,
    timezone: 'America/New_York',
    todayTasks: '',
    ragContext: ''
  };

  if (!userId) {
    const instructions = buildInstructions(defaultContext, channel);
    return { instructions, context: defaultContext };
  }

  // Load all context in parallel
  const [profile, userPrefs, todayTasks, ragContext] = await Promise.all([
    loadUserProfile(supabase, userId),
    loadUserInstructions(supabase, userId),
    loadTodayTasks(supabase, userId, 'America/New_York'), // Will use prefs timezone after loading
    loadRAGContext(supabase, userId)
  ]);

  const timezone = userPrefs.timezone || 'America/New_York';
  
  // Reload today's tasks with correct timezone if different
  let finalTodayTasks = todayTasks;
  if (userPrefs.timezone && userPrefs.timezone !== 'America/New_York') {
    finalTodayTasks = await loadTodayTasks(supabase, userId, timezone);
  }

  const context: UserContext = {
    userId,
    userName: profile?.first_name || profile?.full_name?.split(' ')[0] || 'sir',
    email: profile?.email || null,
    phone: profile?.phone || null,
    timezone,
    todayTasks: finalTodayTasks,
    ragContext
  };

  // Combine custom instructions
  const customInstructions = [
    userPrefs.realtimeExtensions,
    userPrefs.customAI
  ].filter(Boolean).join('\n\n');

  const instructions = buildInstructions(context, channel, customInstructions);
  
  return { instructions, context };
}

// ============ Tool Execution ============

export async function executeTool(
  supabase: SupabaseClient,
  toolName: string,
  args: any,
  context: UserContext
): Promise<any> {
  const { userId, timezone } = context;
  
  if (!userId && !['disconnect'].includes(toolName)) {
    return { success: false, error: "Not authenticated" };
  }

  console.log(`[CORE] Executing tool: ${toolName}`, args);

  try {
    switch (toolName) {
      case "get_tasks":
        return await getTasksExec(supabase, userId!, args);
      case "get_today_tasks":
        return await getTodayTasksExec(supabase, userId!, timezone);
      case "create_task":
        return await createTaskExec(supabase, userId!, args);
      case "update_task":
        return await updateTaskExec(supabase, args);
      case "reschedule_task":
        return await rescheduleTaskExec(supabase, args);
      case "schedule_task":
        return await scheduleTaskExec(supabase, args);
      case "unschedule_task":
        return await unscheduleTaskExec(supabase, args);
      case "send_slack_message":
        return await sendSlackMessageExec(supabase, userId!, args, context);
      case "send_email":
        return await sendEmailExec(supabase, userId!, args, context);
      case "create_calendar_event":
        return await createCalendarEventExec(supabase, userId!, args, context);
      case "initiate_phone_call":
        return await initiatePhoneCallExec(supabase, userId!, args);
      case "disconnect":
        return { success: true, action: 'disconnect', message: args.farewell_message || 'Goodbye!' };
      default:
        return { success: false, error: `Unknown function: ${toolName}` };
    }
  } catch (error) {
    console.error(`[CORE] Tool execution error:`, error);
    return { success: false, error: String(error) };
  }
}

// ============ Individual Tool Implementations ============

async function getTasksExec(supabase: SupabaseClient, userId: string, args: any) {
  let query = supabase.from('tasks').select('*').eq('user_id', userId);
  
  if (args.status) {
    query = query.eq('status', args.status);
  }
  
  const { data, error } = await query.order('created_at', { ascending: false }).limit(20);
  
  if (error) throw error;
  
  return { 
    success: true, 
    tasks: data || [],
    count: data?.length || 0,
    message: `Found ${data?.length || 0} tasks`
  };
}

async function getTodayTasksExec(supabase: SupabaseClient, userId: string, timezone: string) {
  const now = new Date();
  const today = now.toLocaleDateString('en-CA', { timeZone: timezone });
  
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .or(`due_date.eq.${today},scheduled_date.eq.${today}`)
    .order('scheduled_start_time', { ascending: true });
  
  if (error) throw error;
  
  return { 
    success: true, 
    tasks: data || [],
    count: data?.length || 0,
    message: `You have ${data?.length || 0} tasks for today`
  };
}

async function createTaskExec(supabase: SupabaseClient, userId: string, args: any) {
  if (!args.title) return { success: false, error: "Task title is required" };

  const { data: board } = await supabase
    .from('boards')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
    .single();

  if (!board) return { success: false, error: "No board found" };

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
    task: data,
    message: `Created task "${data.title}" with ${data.priority} priority`
  };
}

async function updateTaskExec(supabase: SupabaseClient, args: any) {
  if (!args.task_id) return { success: false, error: "Task ID is required" };

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

  return { success: true, task: data, message: `Updated task "${data.title}"` };
}

async function rescheduleTaskExec(supabase: SupabaseClient, args: any) {
  if (!args.task_id) return { success: false, error: "Task ID is required" };
  if (!args.new_date) return { success: false, error: "New date is required" };

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

  return { success: true, task: data, message: `Rescheduled "${data.title}" to ${args.new_date}` };
}

async function scheduleTaskExec(supabase: SupabaseClient, args: any) {
  if (!args.task_id) return { success: false, error: "Task ID is required" };

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

  return { success: true, task: data, message: `Scheduled "${data.title}" for ${updateData.scheduled_date}` };
}

async function unscheduleTaskExec(supabase: SupabaseClient, args: any) {
  if (!args.task_id) return { success: false, error: "Task ID is required" };

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

  return { success: true, task: data, message: `Unscheduled "${data.title}" and moved to backlog` };
}

async function sendSlackMessageExec(supabase: SupabaseClient, userId: string, args: any, context: UserContext) {
  if (!args.message) return { success: false, error: "Message is required" };

  try {
    const { error } = await supabase.functions.invoke('send-unified-notification', {
      body: {
        userId,
        channels: ['slack'],
        title: 'Message from Iris',
        body: args.message,
        notification_type: 'slack_message'
      }
    });

    if (error) throw error;

    return { success: true, message: `Sent Slack message: "${args.message.substring(0, 50)}..."` };
  } catch (error) {
    return { success: false, error: `Failed to send Slack message: ${error}` };
  }
}

async function sendEmailExec(supabase: SupabaseClient, userId: string, args: any, context: UserContext) {
  if (!args.subject || !args.body) return { success: false, error: "Subject and body are required" };

  try {
    const { error } = await supabase.functions.invoke('send-unified-notification', {
      body: {
        userId,
        channels: ['email'],
        title: args.subject,
        body: args.body,
        notification_type: 'email',
        to: args.to || context.email
      }
    });

    if (error) throw error;

    return { success: true, message: `Sent email with subject: "${args.subject}"` };
  } catch (error) {
    return { success: false, error: `Failed to send email: ${error}` };
  }
}

async function createCalendarEventExec(supabase: SupabaseClient, userId: string, args: any, context: UserContext) {
  if (!args.title || !args.start_time) return { success: false, error: "Title and start time are required" };

  const calendarType = args.calendar || 'outlook';
  const channelType = calendarType === 'google' ? 'google_event' : 'outlook_event';

  try {
    const { error } = await supabase.functions.invoke('send-unified-notification', {
      body: {
        userId,
        channels: [channelType],
        title: args.title,
        body: args.description || '',
        notification_type: 'calendar_event',
        metadata: {
          start_time: args.start_time,
          end_time: args.end_time,
          calendar: calendarType
        }
      }
    });

    if (error) throw error;

    return { success: true, message: `Created ${calendarType} calendar event: "${args.title}"` };
  } catch (error) {
    return { success: false, error: `Failed to create calendar event: ${error}` };
  }
}

async function initiatePhoneCallExec(supabase: SupabaseClient, userId: string, args: any) {
  try {
    const { error } = await supabase.functions.invoke('twilio-voice-handler', {
      body: {
        action: 'trigger-call',
        userId,
        delay_minutes: args.delay_minutes || 0,
        context: args.context || 'callback requested'
      }
    });

    if (error) throw error;

    const delayText = args.delay_minutes ? ` in ${args.delay_minutes} minutes` : '';
    return { success: true, message: `I'll call you${delayText}` };
  } catch (error) {
    return { success: false, error: `Failed to initiate call: ${error}` };
  }
}
