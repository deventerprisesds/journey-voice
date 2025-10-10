import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper function to extract scheduling hints from task text and user config
function extractSchedulingHints(
  taskText: string,
  category: string,
  priority: string,
  userConfig: any
): { context: string[]; estimatedDuration: number } {
  const context: string[] = [];
  const lowerText = taskText.toLowerCase();
  
  // Keyword-based time suggestions (search directly in task text)
  const timeSuggestions: { [key: string]: { hour: number; minute: number; duration: number; window: string } } = {
    standup: { hour: 9, minute: 0, duration: 30, window: 'morning' },
    sync: { hour: 10, minute: 0, duration: 30, window: 'morning' },
    lunch: { hour: 12, minute: 0, duration: 60, window: 'business_hours' },
    brunch: { hour: 10, minute: 30, duration: 75, window: 'morning' },
    dinner: { hour: 19, minute: 0, duration: 90, window: 'after_work' },
    breakfast: { hour: 7, minute: 30, duration: 30, window: 'morning' },
    gym: { hour: 17, minute: 30, duration: 60, window: 'after_work' },
    workout: { hour: 6, minute: 30, duration: 60, window: 'morning' },
    exercise: { hour: 17, minute: 30, duration: 60, window: 'after_work' },
    shopping: { hour: 17, minute: 30, duration: 45, window: 'after_work' },
    grocery: { hour: 17, minute: 30, duration: 60, window: 'after_work' },
    groceries: { hour: 17, minute: 30, duration: 60, window: 'after_work' },
    bank: { hour: 12, minute: 0, duration: 45, window: 'business_hours' },
    doctor: { hour: 9, minute: 0, duration: 60, window: 'morning' },
    dentist: { hour: 9, minute: 0, duration: 60, window: 'morning' },
    coffee: { hour: 10, minute: 0, duration: 45, window: 'morning' },
    meeting: { hour: 10, minute: 0, duration: 60, window: 'business_hours' },
  };

  // Find matching keyword suggestion in task text
  let estimatedDuration = 30;
  let foundMatch = false;
  
  for (const [keyword, suggestion] of Object.entries(timeSuggestions)) {
    if (lowerText.includes(keyword)) {
      context.push(`suggested_time:${suggestion.hour}:${suggestion.minute}`);
      context.push(`timeWindow:${suggestion.window}`);
      estimatedDuration = suggestion.duration;
      foundMatch = true;
      break;
    }
  }

  // Fallback to category mappings if no keyword match
  if (!foundMatch && userConfig?.categoryMappings?.[category]) {
    const categoryWindow = userConfig.categoryMappings[category];
    context.push(`timeWindow:${categoryWindow}`);
  }
  
  return { context, estimatedDuration };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, mode = 'single', timezone, userId, boardId, existingTasks = [] } = await req.json();
    
    console.log('📥 Received request:', { 
      text: text?.substring(0, 50), 
      mode, 
      timezone,
      hasContext: !!(userId && boardId),
      existingTasksCount: existingTasks.length
    });
    
    if (!text) {
      console.error('❌ No text input provided');
      throw new Error('Text input is required');
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      console.error('❌ OpenAI API key not configured');
      throw new Error('OpenAI API key not configured');
    }
    
    // Initialize Supabase client for loading user config
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    console.log('✅ Starting task parsing...');

// Get current date for context
const now = new Date();
const currentDateString = now.toLocaleDateString('en-US', { 
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric'
});
const currentTimeString = now.toLocaleTimeString('en-US', { 
  hour: '2-digit',
  minute: '2-digit'
});

const systemPrompt = `You are an intelligent task parser that converts natural language into structured task data with smart context awareness.

CURRENT DATE CONTEXT:
- Today is: ${currentDateString}
- Current time: ${currentTimeString}

CRITICAL: Use this current date as your reference for relative dates like "tomorrow", "next Tuesday", "next week", etc.

Parse the user's input into one or more tasks. Each task should have:
- title: Clear, actionable task title
- description: Optional detailed description
- priority: LOW, MEDIUM, HIGH, or URGENT (infer from urgency words)
- category: LIFE, CAREER, VENTURES, or EDUCATION (infer from context)
- due_date: ISO date string ONLY if user specifies a deadline (null otherwise)
- start_time: null (DO NOT SET - scheduler handles all timing)
- end_time: null (DO NOT SET - scheduler handles all timing)
- estimate_minutes: Estimated duration in minutes
- status: BACKLOG, TODO, READY, UP_NEXT, DOING
- scheduling_context: Empty array (client-side will extract context from title/description)

DURATION ESTIMATES:
- Quick meeting/call: 30 minutes
- Regular meeting: 60 minutes
- Meals: 60-90 minutes (lunch 60min, dinner 90min)
- Errands: 30-45 minutes
- Grocery shopping: 45-60 minutes
- Appointments: 45-60 minutes
- Workouts: 60 minutes
- Social events: 120 minutes

CATEGORY INFERENCE:
- Work/job/career/meeting → CAREER
- School/course/study/learning → EDUCATION
- Business/startup/venture → VENTURES
- Personal/family/life/errands → LIFE

Return JSON in this exact format:
{
  "tasks": [
    {
      "title": "string",
      "description": "string or null",
      "priority": "LOW|MEDIUM|HIGH|URGENT",
      "category": "LIFE|CAREER|VENTURES|EDUCATION", 
      "due_date": "ISO string or null",
      "start_time": "ISO string or null",
      "end_time": "ISO string or null",
      "estimate_minutes": number or null,
      "status": "BACKLOG|TODO|READY|UP_NEXT|DOING",
      "scheduling_context": ["array of context clues"]
    }
  ]
}

Guidelines:
- Extract multiple tasks if the input contains a list
- Infer priority from urgency indicators (urgent, asap, high priority, etc.)
- Infer category from context (work/job=CAREER, school/course=EDUCATION, business=VENTURES, personal=LIFE)
- Parse relative dates ("tomorrow", "next week", "in 3 days") into ISO dates
- Parse time estimates ("2 hours", "30 minutes", "half day") into minutes
- Default to BACKLOG status unless urgency suggests TODO/READY/UP_NEXT
- Make titles concise but actionable
- Add context to descriptions when helpful

Examples:
- "Schedule dentist appointment for next Tuesday" → title: "Schedule dentist appointment", due_date: next Tuesday's ISO date
- "Urgent: finish project proposal by Friday, should take 3 hours" → priority: "URGENT", estimate_minutes: 180
- "Learn React, Vue, and Angular" → 3 separate tasks with EDUCATION category`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ OpenAI API error:', response.status, errorText);
      try {
        const error = JSON.parse(errorText);
        throw new Error(error.error?.message || 'Failed to parse tasks');
      } catch {
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
      }
    }

    const data = await response.json();
    console.log('✅ Got OpenAI response');
    
    const content = data.choices[0]?.message?.content;
    if (!content) {
      console.error('❌ No content in OpenAI response:', data);
      throw new Error('No content received from OpenAI');
    }
    
    try {
      const parsed = JSON.parse(content);
      console.log('✅ Successfully parsed tasks:', parsed.tasks?.length || 0, 'tasks');

      // Return tasks with AI's scheduling context hints
      // Client-side will handle all scheduling with full user context
      const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];

      // Generate preview scheduling if context provided - SEQUENTIAL to avoid duplicates
      if (userId && boardId) {
        console.log('🔮 Generating SEQUENTIAL preview scheduling for', tasks.length, 'tasks');
        
        // Load user's scheduling config to extract timing hints
        const { data: userConfigData } = await supabaseAdmin
          .from('user_scheduling_config')
          .select('config')
          .eq('user_id', userId)
          .single();
        
        const userConfig = userConfigData?.config || null;
        console.log('📋 Loaded user config for scheduling hints');
        
        // Schedule sequentially to avoid duplicate times
        const tasksWithPreview = [];
        const reservedSlots: any[] = [];
        
        for (let i = 0; i < tasks.length; i++) {
          const task = tasks[i];
          
          try {
            // Extract scheduling context from task using user's rules
            const schedulingContext = extractSchedulingHints(
              task.title,
              task.category,
              task.priority,
              userConfig
            );
            
            console.log(`📅 Task ${i + 1} (${task.title}): scheduling hints =`, schedulingContext);
            
            // Build busy slots including previously scheduled preview tasks
            const allExistingTasks = [...existingTasks, ...reservedSlots];
            
            const schedulerResponse = await fetch(`${supabaseUrl}/functions/v1/smart-calendar-scheduler`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${supabaseServiceKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                taskText: task.title,
                userId,
                existingTasks: allExistingTasks,
                scheduling_context: schedulingContext.context,
                taskCategory: task.category,
                taskPriority: task.priority,
                estimateMinutes: schedulingContext.estimatedDuration,
                dueDate: task.due_date,
                timezone: timezone || 'UTC',
              }),
            });
            
            if (schedulerResponse.ok) {
              const { scheduledTask } = await schedulerResponse.json();
              
              if (scheduledTask?.start_time && scheduledTask?.end_time) {
                console.log(`✅ Task ${i + 1} scheduled: ${scheduledTask.start_time}`);
                
                // Add to reserved slots for next iteration
                reservedSlots.push({
                  start_time: scheduledTask.start_time,
                  end_time: scheduledTask.end_time,
                  title: task.title,
                  is_scheduled: true,
                });
                
                tasksWithPreview.push({
                  ...task,
                  start_time: scheduledTask.start_time,
                  end_time: scheduledTask.end_time,
                  isPreview: true,
                });
              } else {
                console.warn(`⚠️ No time assigned for task ${i + 1}`);
                tasksWithPreview.push(task);
              }
            } else {
              const errorText = await schedulerResponse.text();
              console.warn(`⚠️ Scheduling failed for task ${i + 1}:`, errorText);
              tasksWithPreview.push(task);
            }
          } catch (error) {
            console.error(`❌ Error scheduling task ${i + 1}:`, error);
            tasksWithPreview.push(task);
          }
        }
        
        console.log('✅ Sequential preview scheduling complete');
        
        return new Response(JSON.stringify({ tasks: tasksWithPreview }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Return unscheduled tasks with AI's context hints
      // Client-side will handle all scheduling with full context
      return new Response(JSON.stringify({ tasks }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (parseError) {
      console.error('❌ Error parsing AI response as JSON:', content.substring(0, 200));
      throw new Error('Failed to parse AI response as JSON');
    }

  } catch (error) {
    console.error('❌ Error in ai-task-parser:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    const errorDetails = error instanceof Error ? error.stack : '';
    console.error('Error details:', errorDetails);
    
    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        details: 'Check edge function logs for more information'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});