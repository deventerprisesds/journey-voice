/**
 * OpenAI Tool Definitions for Voice & Chat Interfaces
 * 
 * Centralized tool schemas for the Realtime API and Chat Completions API.
 * These definitions ensure feature parity across phone, voice, and chat interfaces.
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
 * Get all tool definitions for OpenAI Realtime API
 * Used by twilio-realtime-bridge for phone calls
 */
export function getToolDefinitions(): ToolDefinition[] {
  return [
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
      name: "get_today_tasks",
      description: "Get all tasks for today, including both scheduled and unscheduled tasks.",
      parameters: { type: "object", properties: {} }
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
      name: "web_search",
      description: "Search the internet for REAL-TIME information using Tavily. CRITICAL: The 'query' parameter MUST be a VERBATIM transcription of what the user said - do NOT rephrase or convert temporal phrases like 'this weekend' or 'today' into specific dates.",
      parameters: {
        type: "object",
        properties: {
          query: { 
            type: "string", 
            description: "The user's EXACT spoken words - pass verbatim without modification" 
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
          include_domains: {
            type: "array",
            items: { type: "string" },
            description: "Optional: Domains to prioritize. Leave empty to search all sources."
          }
        },
        required: ["query"]
      }
    }
  ];
}

/**
 * Get phone-specific tool definitions (subset for voice handler fallback)
 * Used by twilio-voice-handler for turn-based conversation
 */
export function getPhoneToolDefinitions(): any[] {
  return [
    {
      type: "function",
      function: {
        name: "get_today_tasks",
        description: "Get all tasks scheduled for today",
        parameters: { type: "object", properties: {}, required: [] }
      }
    },
    {
      type: "function",
      function: {
        name: "get_upcoming_tasks",
        description: "Get upcoming tasks for the next few days",
        parameters: { 
          type: "object", 
          properties: {
            days: { type: "number", description: "Number of days to look ahead (default 3)" }
          },
          required: [] 
        }
      }
    },
    {
      type: "function",
      function: {
        name: "create_task",
        description: "Create a new task",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Task title" },
            description: { type: "string", description: "Task description" },
            due_date: { type: "string", description: "Due date in YYYY-MM-DD format" },
            priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], description: "Task priority" }
          },
          required: ["title"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "complete_task",
        description: "Mark a task as completed",
        parameters: {
          type: "object",
          properties: {
            task_title: { type: "string", description: "Title or partial title of the task to complete" }
          },
          required: ["task_title"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "reschedule_task",
        description: "Reschedule a task to a different time",
        parameters: {
          type: "object",
          properties: {
            task_title: { type: "string", description: "Title or partial title of the task" },
            new_date: { type: "string", description: "New date in YYYY-MM-DD format" },
            new_time: { type: "string", description: "New time in HH:MM format (24h)" }
          },
          required: ["task_title", "new_date"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "end_call",
        description: "End the phone call when the user says goodbye or indicates they're done",
        parameters: { type: "object", properties: {}, required: [] }
      }
    }
  ];
}
