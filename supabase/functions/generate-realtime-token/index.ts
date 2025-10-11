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
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set');
    }

    console.log('Generating ephemeral token for WebRTC connection');

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
        instructions: `You are a helpful task management assistant. You can help users create, update, and manage their tasks through voice commands.

When users ask about historical information like "tasks from last week" or "what did I work on yesterday", use the get_tasks function with appropriate time_filter parameters.

Available functions:
- get_tasks: Retrieve tasks and chat history with time/keyword filtering
- create_task: Create new tasks with title, description, priority, and category
- update_task: Update existing tasks (status, title, description, priority)
- disconnect: Disconnect when user says goodbye, "that's all", "disconnect", "I'm done", or similar farewell phrases

Always confirm actions you take and provide helpful feedback about task management.

When the user says goodbye phrases like 'that's all', 'thanks that's it', 'disconnect', 'I'm done', 'goodbye', or similar, call the disconnect function with a friendly farewell message.`
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