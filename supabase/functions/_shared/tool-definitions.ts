/**
 * OpenAI Tool Definitions — SINGLE SOURCE OF TRUTH
 * 
 * Every consumer (phone via twilio-realtime-bridge, in-app voice via
 * generate-realtime-token, chat via execute-tool /definitions endpoint,
 * and persona.ts system prompt) imports from THIS file.
 *
 * To add a tool: add it here. It propagates everywhere automatically.
 *
 * IMPORTANT: After adding a new tool, run the sync-assistant-tools
 * edge function to update the OpenAI Assistant's static tool list.
 */

export interface ToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * Complete tool definitions for all AI interfaces.
 * This is the ONLY place tools are defined.
 */
export function getToolDefinitions(): ToolDefinition[] {
  return [
    // ── TASK TOOLS ──────────────────────────────────────────────
    {
      type: "function",
      name: "get_tasks",
      description: "PRIMARY task retrieval tool. Returns tasks with topic_group labels and current time window context. Handles all queries: today (time_filter='today'), this week, by category, by status, by keyword. Use this for ANY task query.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query or keywords" },
          time_filter: { type: "string", description: "Time period like 'past week', 'yesterday'" },
          status: { 
            type: "string", 
            enum: ["BACKLOG", "TODO", "READY", "UP_NEXT", "DOING", "DONE", "BLOCKED", "PLANNING", "ACTIVE", "WORKABLE"],
            description: "Task workflow status. BACKLOG=not yet planned, TODO=planned but not started, READY=ready to work on, UP_NEXT=queued to start soon, DOING=in progress, DONE=completed, BLOCKED=waiting on something, PLANNING=needs more detail. ACTIVE=everything not DONE/BLOCKED. WORKABLE=READY+UP_NEXT+DOING (ready to act on now)."
          },
          category: {
            type: "string",
            enum: ["LIFE", "CAREER", "VENTURES", "PROF_EDUCATION", "EDUCATION", "PERSONAL"],
            description: "Life area filter. Use for area-specific queries like 'life tasks', 'career items'."
          }
        }
      }
    },
    {
      type: "function",
      name: "get_today_tasks",
      description: "Alias for get_tasks with time_filter='today'. Returns same enriched format with topic_group labels. Prefer get_tasks directly for consistency.",
      parameters: { type: "object", properties: {} }
    },
    {
      type: "function",
      name: "get_tasks_by_topic",
      description: "DRILL-DOWN tool. Use after get_tasks to explore a specific topic group in depth. Requires EXACT topic_name from get_tasks results or get_my_config(section='topic_groups'). NEVER guess topic names.",
      parameters: {
        type: "object",
        properties: {
          topic_name: { type: "string", description: "The EXACT topic group name from get_tasks results or get_my_config. Never guess or fabricate topic names." }
        },
        required: ["topic_name"]
      }
    },
    {
      type: "function",
      name: "update_task",
      description: "Update an existing task's properties, including scrum-master grooming: assign it to a specific agent and apply labels.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "ID of the task to update" },
          title: { type: "string" },
          description: { type: "string" },
          status: {
            type: "string",
            enum: ["BACKLOG", "TODO", "READY", "UP_NEXT", "DOING", "DONE", "BLOCKED", "PLANNING"],
            description: "Task workflow status"
          },
          priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
          category: { type: "string", enum: ["LIFE", "CAREER", "VENTURES", "EDUCATION"] },
          assigned_agent: { type: "string", description: "Huddle agent id to assign this task to (e.g. finn-reid). Pass empty string to unassign." },
          tags: { type: "array", items: { type: "string" }, description: "Labels for the task (e.g. needs-plaid, quick-win). Replaces existing tags." }
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
    // ── ITINERARY TOOLS (used by Daily Review chat) ──────────────
    {
      type: "function",
      name: "explain_task_score",
      description: "Return the scheduling-score breakdown for one task (priority, due-soon, recency, keyword bonuses, staleness penalties, etc.). Use this when the user asks 'why is X scored so high', 'why was Y picked over Z', or 'why is this on today's plan'.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Task ID from DAY_CONTEXT.schedule[].id or another tool's result" }
        },
        required: ["task_id"]
      }
    },
    {
      type: "function",
      name: "list_pending_assignments",
      description: "List academic assignments that are not yet done. Optionally filter by program or by how many days until due. Use for questions like 'is there another assignment due?', 'what's pending in MIT?', 'anything due this week I'm not seeing?'.",
      parameters: {
        type: "object",
        properties: {
          program_id: { type: "string", description: "Optional program UUID to filter (EMBA / MIT)" },
          due_within_days: { type: "number", description: "Optional: only return assignments due within this many days" },
          include_overdue: { type: "boolean", description: "Include overdue assignments. Default true." }
        }
      }
    },
    {
      type: "function",
      name: "find_open_slots",
      description: "Find open time slots on a given date that match a window (morning/business_hours/after_work/evening) and minimum duration. Use to answer 'what could fit in the morning?' or 'where's the gap in my afternoon?' before proposing a placement.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Date in YYYY-MM-DD format. Defaults to today." },
          window: { type: "string", enum: ["morning", "business_hours", "after_work", "evening", "weekends"], description: "Optional window filter" },
          min_duration_min: { type: "number", description: "Minimum slot duration in minutes. Default 30." }
        }
      }
    },
    {
      type: "function",
      name: "move_task_to_day",
      description: "Move a task to a specific day, optionally targeting a window (the scheduler will pick the time). Use for 'move email to tomorrow morning' or 'push this to Friday'.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Task ID to move" },
          date: { type: "string", description: "Target date YYYY-MM-DD" },
          window: { type: "string", enum: ["morning", "business_hours", "after_work", "evening", "weekends"], description: "Optional preferred window" }
        },
        required: ["task_id", "date"]
      }
    },
    {
      type: "function",
      name: "swap_task_order",
      description: "Swap the start times of two same-day tasks (reorder). Use for 'put X before Y' or 'do the call before the email'.",
      parameters: {
        type: "object",
        properties: {
          task_id_a: { type: "string", description: "First task ID" },
          task_id_b: { type: "string", description: "Second task ID" }
        },
        required: ["task_id_a", "task_id_b"]
      }
    },
    {
      type: "function",
      name: "set_priority_rank",
      description: "Promote a task onto the user's explicit Priority Lane and (optionally) set its rank. Use when the user says 'make X my top priority' or 'promote this to priority'.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Task ID to promote" },
          rank: { type: "number", description: "1 = top priority, 2 = next, etc. Omit to add at end." },
          unset: { type: "boolean", description: "If true, REMOVE from priority lane instead of adding." }
        },
        required: ["task_id"]
      }
    },
    {
      type: "function",
      name: "quick_create_task",
      description: "Create a single task quickly with optional scheduling. Use for 'I need to call John today', 'add an item to email the prof'. Prefer parse_and_create_tasks for multi-task or vague NL.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Task title" },
          date: { type: "string", description: "Optional YYYY-MM-DD or 'today'/'tomorrow'" },
          window: { type: "string", enum: ["morning", "business_hours", "after_work", "evening"], description: "Optional preferred window — scheduler picks exact time" },
          duration_minutes: { type: "number", description: "Estimated duration. Default 30." },
          category: { type: "string", enum: ["LIFE", "CAREER", "VENTURES", "EDUCATION", "PROF_EDUCATION", "PERSONAL"], description: "Defaults to LIFE" },
          priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"], description: "Defaults to MEDIUM" },
          auto_schedule: { type: "boolean", description: "If true (default), find a slot automatically." }
        },
        required: ["title"]
      }
    },
    {
      type: "function",
      name: "parse_and_create_tasks",
      description: "Parse natural language into tasks using AI and create them. Handles multiple tasks, date parsing ('today', 'tomorrow', 'next week'), categories, priorities, and optional auto-scheduling. Use this when user describes tasks in conversational language rather than explicit field values. IMPORTANT: When the user says 'this week', 'sometime soon', 'when I have time', or any vague timeframe, set auto_schedule to true and DO NOT ask for a specific time or day. The batch scheduler will find the optimal slot automatically. Only ask for clarification if the task description itself is ambiguous (not the timing).",
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

    // ── COMMUNICATION TOOLS ────────────────────────────────────
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
      description: "Send a message via Slack integration. ONLY use when user EXPLICITLY requests Slack (e.g., 'send me a Slack message', 'post to Slack', 'message me on Slack'). For general 'send me a message' requests, use send_chat_message instead.",
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
      name: "send_chat_message",
      description: "Send a message to the user via the app's chat interface. This is the PRIMARY and DEFAULT way to message the user. Use for: immediate messages, reminders ('remind me in X minutes'), scheduled check-ins ('message me at 3pm'), or ANY request like 'message me', 'send me something', 'text me', 'notify me about X'. Prefer this over Slack/Email unless user explicitly requests those channels.",
      parameters: {
        type: "object",
        properties: {
          delay_minutes: { 
            type: "number", 
            description: "Minutes to wait before sending (e.g., 'in 5 minutes' = 5). If 0 or not provided, sends immediately." 
          },
          scheduled_time: { 
            type: "string", 
            description: "Specific time to send in HH:MM format (e.g., '15:00' for 3pm). Takes precedence over delay_minutes." 
          },
          message: { 
            type: "string", 
            description: "The message content to send. If not provided, AI will generate a contextual message." 
          },
          context: { 
            type: "string", 
            description: "Context for AI to generate a message if no specific message provided (e.g., 'check on task progress', 'daily reminder')" 
          }
        }
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

    // ── SEARCH TOOLS ───────────────────────────────────────────
    {
      type: "function",
      name: "web_search",
      description: "Search the internet for REAL-TIME information using Tavily. CRITICAL INSTRUCTION: The 'query' parameter MUST be a VERBATIM transcription of what the user said - do NOT rephrase, summarize, or convert temporal phrases like 'this weekend' or 'today' into specific dates. Pass the EXACT words the user spoke.",
      parameters: {
        type: "object",
        properties: {
          query: { 
            type: "string", 
            description: "The user's EXACT spoken words - pass verbatim without any modification" 
          },
          topic: {
            type: "string",
            enum: ["general", "news", "finance"],
            description: "Search category. Use 'news' for sports scores, current events, breaking news. Use 'finance' for stock prices. Use 'general' for everything else."
          },
          search_depth: {
            type: "string",
            enum: ["basic", "advanced"],
            description: "Use 'advanced' for complex queries (sports scores, specific facts). Use 'basic' for simple lookups."
          },
          time_range: {
            type: "string",
            enum: ["day", "week", "month", "year"],
            description: "Use 'day' for today/tonight, 'week' for this week/weekend. Only set if query implies time constraint."
          },
          start_date: {
            type: "string",
            description: "Explicit start date in YYYY-MM-DD format. Only use if you can determine a specific date range."
          },
          end_date: {
            type: "string",
            description: "Explicit end date in YYYY-MM-DD format. Only use if you can determine a specific date range."
          },
          include_domains: {
            type: "array",
            items: { type: "string" },
            description: "Optional: Domains to prioritize. Leave empty to search all sources."
          },
          exclude_domains: {
            type: "array",
            items: { type: "string" },
            description: "Optional: Domains to exclude from results."
          },
          max_results: {
            type: "integer",
            description: "Number of results to return (1-20). Default 10."
          }
        },
        required: ["query"]
      }
    },

    // ── INTROSPECTION TOOLS ───────────────────────────────────
    {
      type: "function",
      name: "get_my_config",
      description: "Get information about the user's assistant configuration, scheduled/recurring calls, notification preferences, topic groups, call history, calendar connections, pending notifications, or profile. Use this when the user asks about their setup, calls, schedules, connections, reminders, or how things are configured.",
      parameters: {
        type: "object",
        properties: {
          section: {
            type: "string",
            enum: ["scheduled_calls", "call_history", "topic_groups", "notification_prefs", "calendar_connections", "pending_notifications", "my_profile", "full_config"],
            description: "Which config section to retrieve. 'scheduled_calls' = recurring call schedule with names, times, and scripts. 'call_history' = recent past calls. 'topic_groups' = how tasks are organized into topics. 'notification_prefs' = notification settings. 'calendar_connections' = connected calendars (Outlook, Google). 'pending_notifications' = upcoming queued reminders. 'my_profile' = user's name, phone, email. 'full_config' = everything including core instructions."
          }
        },
        required: ["section"]
      }
    },

    // ── PHONE/VOICE-ONLY TOOLS ─────────────────────────────────
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
    },
    {
      type: "function",
      name: "disconnect",
      description: "Disconnect the voice assistant when user says goodbye, 'that's all', 'disconnect', 'that will be all', 'thanks that's it', or similar phrases indicating they're done.",
      parameters: {
        type: "object",
        properties: {
          farewell_message: {
            type: "string",
            description: "Optional goodbye message to say before disconnecting"
          }
        }
      }
    }
  ];
}

/**
 * Get tool names as a simple list (for persona prompt generation)
 */
export function getToolNamesList(): string {
  return getToolDefinitions()
    .map(t => `- ${t.name}: ${t.description.split('.')[0]}`)
    .join('\n');
}
