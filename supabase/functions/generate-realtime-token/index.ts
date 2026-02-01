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

    // Use demo user ID if no authenticated user (for demo mode)
    if (!userId) {
      userId = '00000000-0000-0000-0000-000000000001';
      console.log('Using demo user for preferences');
    }

    console.log('Generating ephemeral token for user:', userId);

    // Load user's AI instructions and TTS preferences from scheduling preferences
    let coreInstructions = `You are a helpful task management assistant. You can help users create, update, and manage their tasks through voice commands.

When users ask about historical information like "tasks from last week" or "what did I work on yesterday", use the get_tasks function with appropriate time_filter parameters.

Available functions:
- get_tasks: Retrieve tasks and chat history with time/keyword filtering
- get_today_tasks: Get all tasks scheduled for today
- create_task: Create new tasks with title, description, priority, and category
- update_task: Update existing tasks (status, title, description, priority)
- reschedule_task: Move a task to a different date or time
- schedule_task: Schedule an unscheduled task (automatically finds optimal time slot)
- unschedule_task: Remove a task from the calendar
- disconnect: Disconnect when user says goodbye, "that's all", "disconnect", "I'm done", or similar farewell phrases
- initiate_phone_call: Call the user on their phone when they request it (supports delay and context)

When users ask about "today's tasks" or "what's on my schedule today", use get_today_tasks.
When users want to move tasks around, use reschedule_task with the new date/time.
When users want to add unscheduled tasks to today, use schedule_task which will automatically find the best time slot.

Always confirm actions you take and provide helpful feedback about task management.

When the user says goodbye phrases like 'that's all', 'thanks that's it', 'disconnect', 'that will be all', 'goodbye', or similar, call the disconnect function with a friendly farewell message.`;

    let realtimeExtensions = '';
    let schedulingPhilosophy = '';
    let personalizationContext = '';  // Will be populated from profile
    let ttsProvider: 'openai' | 'elevenlabs' = 'openai';
    let openaiVoice = 'alloy';
    let elevenlabsVoiceId = 'EXAVITQu4vr4xnSDxMaL';

    if (userId) {
      try {
        const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
        
        // Load user preferences and profile in parallel
        const [prefsResult, profileResult] = await Promise.all([
          supabase
            .from('user_scheduling_prefs')
            .select('core_instructions, realtime_extensions, config, tts_provider, openai_voice, elevenlabs_voice_id, timezone')
            .eq('user_id', userId)
            .maybeSingle(),
          supabase
            .from('profiles')
            .select('first_name, full_name, preferred_greeting')
            .eq('user_id', userId)
            .maybeSingle()
        ]);

        const prefs = prefsResult.data;
        const profile = profileResult.data;

        // Extract user name with fallback to "sir" - preferred_greeting takes priority
        const userName = profile?.preferred_greeting || profile?.first_name || profile?.full_name?.split(' ')[0] || 'sir';
        const userTimezone = prefs?.timezone || 'America/New_York';
        const currentTime = new Date().toLocaleString('en-US', {
          timeZone: userTimezone,
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit'
        });

        // Build personalization context (matches Twilio bridge)
        // NOTE: Assigning to outer 'let' variable, not declaring new const
        personalizationContext = `
CURRENT TIME: ${currentTime}
TIMEZONE: ${userTimezone}
USER: ${userName}`;

        if (prefs) {
          if (prefs.core_instructions) coreInstructions = prefs.core_instructions;
          if (prefs.realtime_extensions) realtimeExtensions = prefs.realtime_extensions;
          if (prefs.config?.customAIInstructions) {
            schedulingPhilosophy = `\n\nScheduling Philosophy:\n${prefs.config.customAIInstructions}`;
          }
          if (prefs.tts_provider) ttsProvider = prefs.tts_provider as 'openai' | 'elevenlabs';
          if (prefs.openai_voice) openaiVoice = prefs.openai_voice;
          if (prefs.elevenlabs_voice_id) elevenlabsVoiceId = prefs.elevenlabs_voice_id;
        }
      } catch (error) {
        console.warn('Failed to load user instructions, using defaults:', error);
      }
    }

    // Combine instructions with personalization context
    const fullInstructions = [
      coreInstructions,
      personalizationContext,
      realtimeExtensions,
      schedulingPhilosophy
    ].filter(Boolean).join('\n\n');

    // Determine modalities based on TTS provider
    // If ElevenLabs is selected, we need text-only output from OpenAI
    // The client will then send text to ElevenLabs TTS
    const modalities = ttsProvider === 'elevenlabs' ? ['text'] : ['text', 'audio'];

    console.log(`TTS Provider: ${ttsProvider}, OpenAI Voice: ${openaiVoice}, Modalities: ${JSON.stringify(modalities)}`);

    // Request an ephemeral token from OpenAI
    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview-2024-12-17",
        voice: openaiVoice,  // Use user's selected OpenAI voice
        modalities: modalities,  // Dynamic based on TTS provider
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        // Enable transcription for user speech - required for transcript persistence
        input_audio_transcription: {
          model: "gpt-4o-mini-transcribe",
          language: "en",
          prompt: "tasks, schedule, calendar, reschedule, today, tomorrow, priorities"
        },
        // Use semantic VAD (AI-based) instead of server_vad (amplitude-based)
        // This prevents background noise from triggering false speech detection
        turn_detection: {
          type: "semantic_vad",
          eagerness: "low",
          create_response: true,
          interrupt_response: true
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
          },
          {
            type: "function",
            name: "initiate_phone_call",
            description: "Call the user on their phone. Use when user says 'call me', 'phone me', 'give me a call', or requests a phone conversation. Can include an optional delay in minutes.",
            parameters: {
              type: "object",
              properties: {
                delay_minutes: {
                  type: "number",
                  description: "Optional minutes to wait before calling (e.g., 'call me in 5 minutes')"
                },
                context: {
                  type: "string",
                  description: "What the call should be about (e.g., 'morning briefing', 'task review', 'afternoon schedule')"
                }
              }
            }
          },
          {
            type: "function",
            name: "web_search",
            description: "Search the internet for real-time information. Use for: weather, sports scores, news, stock prices, current events, or anything requiring live data that you don't have.",
            parameters: {
              type: "object",
              properties: {
                query: { 
                  type: "string", 
                  description: "The search query (e.g., 'Ravens game score today', 'weather in Baltimore', 'latest tech news')" 
                }
              },
              required: ["query"]
            }
          },
          // COMMUNICATION TOOLS - Now supported via centralized execute-tool
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
            name: "create_outlook_event",
            description: "Create an Outlook calendar event directly.",
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
            description: "Create a Google Calendar event directly.",
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
            name: "parse_and_create_tasks",
            description: "Parse natural language into tasks using AI and create them. Handles multiple tasks, date parsing, categories, and priorities. Use when user describes tasks conversationally.",
            parameters: {
              type: "object",
              properties: {
                text: { 
                  type: "string", 
                  description: "Natural language task description" 
                },
                target_date: { 
                  type: "string", 
                  description: "Target date for tasks. YYYY-MM-DD or 'today', 'tomorrow'" 
                },
                auto_schedule: { 
                  type: "boolean", 
                  description: "If true, automatically find optimal time slots" 
                }
              },
              required: ["text"]
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

    // Extract userName for greeting personalization (matches Twilio bridge pattern)
    // This was already computed earlier as 'userName' variable around line 102
    const { createClient: createClientForProfile } = await import('https://esm.sh/@supabase/supabase-js@2');
    const supabaseForProfile = createClientForProfile(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: profileData } = await supabaseForProfile
      .from('profiles')
      .select('first_name, full_name')
      .eq('user_id', userId)
      .maybeSingle();
    
    const userNameForGreeting = profileData?.first_name || profileData?.full_name?.split(' ')[0] || 'sir';

    // Return token along with TTS config and userName for client
    return new Response(JSON.stringify({
      ...data,
      tts_config: {
        provider: ttsProvider,
        openai_voice: openaiVoice,
        elevenlabs_voice_id: elevenlabsVoiceId,
      },
      userName: userNameForGreeting,  // For personalized greetings
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error("Error generating token:", error);
    
    // Persist error to error_log for debugging visibility
    try {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );
      
      await supabaseAdmin.from('error_log').insert({
        source: 'edge_function',
        component: 'generate-realtime-token',
        user_id: userId || null,
        error_type: 'token_generation_failed',
        error_message: error instanceof Error ? error.message : String(error),
        context: {
          ttsProvider: ttsProvider || 'unknown',
          stack: error instanceof Error ? error.stack : undefined
        }
      });
    } catch (logError) {
      console.error('Failed to log error to database:', logError);
    }
    
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
