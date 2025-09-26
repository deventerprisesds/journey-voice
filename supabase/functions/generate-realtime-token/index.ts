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
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 800
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
            description: "Create a new task with specified details",
            parameters: {
              type: "object",
              properties: {
                title: { type: "string", description: "Task title" },
                description: { type: "string", description: "Task description" },
                priority: { 
                  type: "string", 
                  enum: ["low", "medium", "high", "urgent"],
                  description: "Task priority level" 
                },
                category: { type: "string", description: "Task category or project" }
              },
              required: ["title"]
            }
          },
          {
            type: "function",
            name: "update_task",
            description: "Update an existing task's properties",
            parameters: {
              type: "object",
              properties: {
                task_id: { type: "string", description: "ID of the task to update" },
                title: { type: "string", description: "New task title" },
                description: { type: "string", description: "New task description" },
                status: { 
                  type: "string", 
                  enum: ["BACKLOG", "TODO", "DOING", "DONE"],
                  description: "New task status" 
                },
                priority: { 
                  type: "string", 
                  enum: ["low", "medium", "high", "urgent"],
                  description: "New task priority" 
                }
              },
              required: ["task_id"]
            }
          }
        ],
        instructions: `You are a helpful task management assistant. You can help users create, update, and manage their tasks through voice commands.

When users ask about historical information like "tasks from last week" or "what did I work on yesterday", use the get_tasks function with appropriate time_filter parameters.

Available functions:
- get_tasks: Retrieve tasks and chat history with time/keyword filtering
- create_task: Create new tasks with title, description, priority, and category
- update_task: Update existing tasks (status, title, description, priority)

Always confirm actions you take and provide helpful feedback about task management.`
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