import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set');
    }

    // Get user ID from request
    const authHeader = req.headers.get('Authorization');
    let userId: string | null = null;
    
    if (authHeader) {
      try {
        const token = authHeader.replace('Bearer ', '');
        const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        const { data: { user } } = await supabase.auth.getUser(token);
        userId = user?.id || null;
      } catch (error) {
        console.warn('Failed to get user from token:', error);
      }
    }

    console.log('Generating ephemeral token for user:', userId || 'anonymous');

    // Load user's AI instructions from scheduling preferences
    let coreInstructions = `You are a helpful task management assistant. You can help users create, update, and manage their tasks through voice commands.

IMPORTANT: Only create tasks when the user EXPLICITLY asks you to create them using phrases like:
- "Create a task for..."
- "Add a task to..."
- "Make a task for..."
- "Schedule..."
- "Remind me to..."

DO NOT create tasks when the user is:
- Just thinking out loud or planning
- Listing things they need to do (without asking you to create them)
- Having a general conversation about their work

When users ask about historical information like "tasks from last week" or "what did I work on yesterday", use the get_tasks function with appropriate time_filter parameters.

Available functions:
- get_tasks: Retrieve tasks and chat history with time/keyword filtering
- get_today_tasks: Get all tasks scheduled for today
- create_task: Create new tasks ONLY when explicitly requested with title, description, priority, and category
- update_task: Update existing tasks (status, title, description, priority)
- reschedule_task: Move a task to a different date or time
- schedule_task: Schedule an unscheduled task (automatically finds optimal time slot)
- unschedule_task: Remove a task from the calendar
- disconnect: Disconnect when user says goodbye, "that's all", "disconnect", "I'm done", or similar farewell phrases

When users ask about "today's tasks" or "what's on my schedule today", use get_today_tasks.
When users want to move tasks around, use reschedule_task with the new date/time.
When users want to add unscheduled tasks to today, use schedule_task which will automatically find the best time slot.

Always confirm actions you take and provide helpful feedback about task management.

When the user says goodbye phrases like 'that's all', 'thanks that's it', 'disconnect', 'I'm done', 'goodbye', or similar, call the disconnect function with a friendly farewell message.`;

    let realtimeExtensions = '';
    let schedulingPhilosophy = '';

    if (userId) {
      try {
        const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        
        const { data: prefs } = await supabase
          .from('user_scheduling_prefs')
          .select('core_instructions, realtime_extensions, config')
          .eq('user_id', userId)
          .maybeSingle();

        if (prefs) {
          if (prefs.core_instructions) coreInstructions = prefs.core_instructions;
          if (prefs.realtime_extensions) realtimeExtensions = prefs.realtime_extensions;
          if (prefs.config?.customAIInstructions) {
            schedulingPhilosophy = `\n\nScheduling Philosophy:\n${prefs.config.customAIInstructions}`;
          }
        }
      } catch (error) {
        console.warn('Failed to load user instructions, using defaults:', error);
      }
    }

    // Combine instructions
    const fullInstructions = [
      coreInstructions,
      realtimeExtensions,
      schedulingPhilosophy
    ].filter(Boolean).join('\n\n');

    // Request an ephemeral token from OpenAI
    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview-2024-12-17",
        voice: "alloy",
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        turn_detection: {
          type: "server_vad",
          threshold: 0.3,
          prefix_padding_ms: 400,
          silence_duration_ms: 1200
        },
        tool_choice: "auto",
        tools: [
          {
            type: "function",
            name: "get_tasks",
            description: "Retrieve tasks and chat history. Can search by time period, keywords, or status. Use this for any historical queries like 'tasks from last week' or 'what did I work on yesterday'.",
            parameters: {
              type: "object",
              properties: {
                query: { 
                  type: "string", 
                  description: "Search query or keywords to find in tasks/messages" 
                },
                time_filter: { 
                  type: "string", 
                  description: "Time period like 'past week', 'last month', 'yesterday', 'last 7 days'" 
                },
                status: { 
                  type: "string", 
                  enum: ["BACKLOG", "TODO", "DOING", "DONE"],
                  description: "Filter by task status" 
                }
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
                priority: { 
                  type: "string", 
                  enum: ["LOW", "MEDIUM", "HIGH", "URGENT"],
                  description: "Task priority level (UPPERCASE)" 
                },
                category: { 
                  type: "string", 
                  enum: ["LIFE", "CAREER", "VENTURES", "EDUCATION"],
                  description: "Task category - use EDUCATION for school/MIT/EMBA tasks" 
                }
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
                status: { 
                  type: "string", 
                  enum: ["BACKLOG", "TODO", "DOING", "DONE"],
                  description: "New task status (UPPERCASE)" 
                },
                priority: { 
                  type: "string", 
                  enum: ["LOW", "MEDIUM", "HIGH", "URGENT"],
                  description: "New task priority (UPPERCASE)" 
                },
                category: { 
                  type: "string", 
                  enum: ["LIFE", "CAREER", "VENTURES", "EDUCATION"],
                  description: "New task category" 
                }
              },
              required: ["task_id"]
            }
          },
          {
            type: "function",
            name: "get_today_tasks",
            description: "Get all tasks for today, including both scheduled and unscheduled tasks. Shows what the user has planned for today.",
            parameters: {
              type: "object",
              properties: {}
            }
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
        ],
        instructions: fullInstructions
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);

      // Parse OpenAI error details
      let errorDetails = { type: 'unknown', message: errorText };
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error) {
          errorDetails = {
            type: errorJson.error.type || 'unknown',
            message: errorJson.error.message || errorText
          };
        }
      } catch (parseError) {
        console.warn('Could not parse OpenAI error response:', parseError);
      }

      // Return structured error for client handling
      return new Response(JSON.stringify({ 
        error: 'openai_api_error',
        details: errorDetails,
        status: response.status,
        timestamp: new Date().toISOString()
      }), {
        status: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    console.log("Ephemeral token generated successfully");

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error("Error generating token:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
