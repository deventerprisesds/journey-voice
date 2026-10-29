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
            enum: ["BACKLOG", "TODO", "READY", "UP_NEXT", "DOING", "IN_REVIEW", "DONE", "BLOCKED", "PLANNING", "ACTIVE", "WORKABLE"],
            description: "Task workflow status. BACKLOG=not yet planned, TODO=planned but not started, READY=ready to work on, UP_NEXT=queued to start soon, DOING=in progress, IN_REVIEW=work finished, awaiting the user's approval before it can be DONE, DONE=completed, BLOCKED=waiting on something, PLANNING=needs more detail. ACTIVE=everything not DONE/BLOCKED. WORKABLE=READY+UP_NEXT+DOING (ready to act on now)."
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
            enum: ["BACKLOG", "TODO", "READY", "UP_NEXT", "DOING", "IN_REVIEW", "DONE", "BLOCKED", "PLANNING"],
            description: "Task workflow status. IN_REVIEW = finished, awaiting the user's approval before DONE."
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
    // ── TEMPORARY SCHEDULING CAVEATS ─────────────────────────────
    // A caveat is a TEMPORARY preference layered over the scheduling config at read time. It is never
    // merged into the config, so clearing one restores prior behaviour exactly.
    {
      type: "function",
      name: "set_scheduling_caveat",
      description: "Add a TEMPORARY scheduling preference the nightly scheduler follows until it expires or is cleared — e.g. 'push research to the evening for now', 'keep errands out of business hours this week'. Use this when the user wants a temporary change, NOT a permanent one: phrases like 'for now', 'this week', 'until I say otherwise', 'temporarily'. A caveat is a PREFERENCE, not a rule — anything that will not fit the preferred window still gets scheduled normally. For a PERMANENT change to when a category is scheduled, do not use this; that is a Settings change to category mappings or keyword rules.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "The user's own words, kept verbatim so they recognize the caveat in Settings later. E.g. 'push research to the evening for now'" },
          prefer_windows: {
            type: "array", items: { type: "string" },
            description: "Named time windows to prefer, in order. MUST be existing window names: morning, business_hours, after_work, evening, weekends. Never invent a name."
          },
          keywords: { type: "array", items: { type: "string" }, description: "Match tasks whose TITLE contains any of these, e.g. ['research','explore']. Omit to match on category/tags instead." },
          categories: { type: "array", items: { type: "string" }, description: "Match tasks in any of these categories: CAREER, PROF_EDUCATION, EDUCATION, VENTURES, LIFE, PERSONAL" },
          tags: { type: "array", items: { type: "string" }, description: "Match tasks carrying any of these tags" },
          expires_at: { type: "string", description: "ISO timestamp when this stops applying. OMIT for 'until I clear it' — do not guess an expiry the user did not state." }
        },
        required: ["text", "prefer_windows"]
      }
    },
    {
      type: "function",
      name: "list_scheduling_caveats",
      description: "List the temporary scheduling caveats currently in force, with their ids, so the user can see what is affecting their schedule or choose one to clear. Expired caveats are not returned.",
      parameters: { type: "object", properties: {}, required: [] }
    },
    {
      type: "function",
      name: "clear_scheduling_caveat",
      description: "Remove a temporary scheduling caveat. Clearing restores the previous scheduling behaviour exactly. Call list_scheduling_caveats first to get the id unless the user named it unambiguously.",
      parameters: {
        type: "object",
        properties: {
          caveat_id: { type: "string", description: "The caveat id from list_scheduling_caveats" },
          all: { type: "boolean", description: "Set true to clear every caveat at once — only when the user asks for exactly that" }
        },
        required: []
      }
    },
    // ── ACTIVITIES ───────────────────────────────────────────────
    // Reserved time that is NOT a task: lunch, gym, church, haircut, standup, 1:1s. Stored in the
    // scheduling config (never as task rows) and avoided by every scheduler. _shared/activities.ts.
    {
      type: "function",
      name: "add_activity",
      description: "Reserve a block of the user's time for something they DO rather than work to complete — gym, lunch, church, a haircut appointment, morning standup, a direct-report or peer 1:1, school pickup, LinkedIn writing time. Activities are never tasks: they do not go on the task board, are never auto-worked, and every scheduler plans tasks around them. Use kind 'recurring' with days for repeating ones ('church Sundays 10am', '1:1 with Sam every other Tuesday at 2'), 'one_off' with date for a single appointment ('haircut Thursday at 11'), 'on_demand' for something with no fixed time that the user starts when they go (gym). mode 'locked' = fixed time; 'floating' = may slide between earliest and latest to fit around meetings (lunch). Ask for a time only if a scheduled activity has none.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short name the user will recognize, e.g. 'Church', '1:1 with Sam', 'Lunch'" },
          kind: { type: "string", enum: ["recurring", "one_off", "on_demand"] },
          mode: { type: "string", enum: ["locked", "floating"], description: "Default locked" },
          start: { type: "string", description: "HH:mm 24-hour start (preferred start if floating). Required unless on_demand." },
          duration_min: { type: "number", description: "Length in minutes" },
          days: { type: "array", items: { type: "number" }, description: "recurring: days of week, 0=Sun 1=Mon … 6=Sat" },
          every_n_weeks: { type: "number", description: "recurring: 2 = every other week. Omit for weekly." },
          anchor_date: { type: "string", description: "YYYY-MM-DD of the first occurrence, for every_n_weeks > 1" },
          date: { type: "string", description: "one_off: YYYY-MM-DD" },
          earliest: { type: "string", description: "floating: HH:mm earliest start of the range" },
          latest: { type: "string", description: "floating: HH:mm by which it must end" },
          parent_window: { type: "string", description: "Which time window it sits inside: morning, business_hours, after_work, evening, weekends" },
          aliases: { type: "array", items: { type: "string" }, description: "Other words the user uses for it, e.g. ['workout','lift'] for gym" },
          pushes_schedule: { type: "boolean", description: "on_demand: starting it pushes the rest of the day later (true for gym)" }
        },
        required: ["name", "duration_min"]
      }
    },
    {
      type: "function",
      name: "list_activities",
      description: "List the user's activities (recurring, one-off and on-demand reserved time) with their days and times.",
      parameters: { type: "object", properties: {}, required: [] }
    },
    {
      type: "function",
      name: "update_activity",
      description: "Change an existing activity — its time, days, length, or pause it (enabled false). Identify it by name (or activity_id from list_activities). To rename, pass new_name.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The activity's current name (or an alias)" },
          activity_id: { type: "string" },
          new_name: { type: "string" },
          start: { type: "string", description: "HH:mm 24-hour" },
          duration_min: { type: "number" },
          days: { type: "array", items: { type: "number" } },
          every_n_weeks: { type: "number" },
          mode: { type: "string", enum: ["locked", "floating"] },
          earliest: { type: "string" },
          latest: { type: "string" },
          enabled: { type: "boolean", description: "false pauses it without deleting" }
        },
        required: []
      }
    },
    {
      type: "function",
      name: "remove_activity",
      description: "Delete an activity permanently. For a single day off use skip_activity; to pause use update_activity with enabled false.",
      parameters: {
        type: "object",
        properties: { name: { type: "string" }, activity_id: { type: "string" } },
        required: []
      }
    },
    {
      type: "function",
      name: "skip_activity",
      description: "Skip one occurrence of an activity ('skip lunch today', 'no church this Sunday') so that time opens up for tasks. Defaults to today.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          activity_id: { type: "string" },
          date: { type: "string", description: "YYYY-MM-DD; defaults to today" }
        },
        required: []
      }
    },
    {
      type: "function",
      name: "start_activity",
      description: "The user is going to do an activity NOW (or at a stated time today) — 'I'm headed to the gym', 'going to lunch', 'stepping out for a haircut'. Reserves the block and PUSHES the rest of today later in order, because they will not be working on what was scheduled then. Meetings and locked activities never move; any that overlap come back as conflicts — ask the user whether to skip them or shorten the activity. Work that no longer fits its time window today is returned to be rescheduled. Act immediately; do not ask first. Tell the user what moved, and that they can say undo.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The activity, e.g. 'gym' — matched against the user's activities and their aliases" },
          duration_min: { type: "number", description: "Override the activity's usual length (gym defaults to 120)" },
          start_time: { type: "string", description: "HH:mm 24-hour, today. Omit for now." }
        },
        required: ["name"]
      }
    },
    {
      type: "function",
      name: "undo_activity_start",
      description: "Undo the most recent start_activity: put every moved task back where it was and remove the block.",
      parameters: { type: "object", properties: {}, required: [] }
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
      description: "Create a single task quickly with optional scheduling. Use for 'I need to call John today', 'add an item to email the prof'. Prefer parse_and_create_tasks for multi-task or vague NL. NOT for activities: time the user spends being somewhere or doing a routine at a time (gym, lunch, church, a haircut appointment, a standup or 1:1, school pickup) is an ACTIVITY — use add_activity, or start_activity when they are going now. A task is work to get done (e.g. 'book a haircut' is a task; 'haircut Thursday at 11' is an activity).",
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
            description: "Natural language task description. Can include multiple tasks, dates, priorities. Example: 'I need to book a haircut, work on the Nexus application, and prep for my MBA partner meeting'. Leave OUT activities at a time (gym, lunch, church, an appointment, a standup or 1:1) — those go to add_activity, not here."
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
    {
      type: "function",
      name: "undo_dedup",
      description: "Restore a task that the duplicate-detection guard recently SKIPPED as a likely duplicate. Use this when the user replies 'undo', 'undo that', 'add it back', 'no it's not a duplicate', or otherwise says a skipped/deduped task should be restored — typically right after you told them you skipped a duplicate. With no arguments it restores the most recent batch of skipped tasks. Do NOT use this for normal task creation or for un-completing a done task.",
      parameters: {
        type: "object",
        properties: {
          all: { type: "boolean", description: "If true, restore every skipped duplicate that hasn't been undone yet, not just the most recent batch. Default: false." },
          log_id: { type: "string", description: "Optional id of a specific dedup-log entry to restore, when the user names a particular task." }
        },
        required: []
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
