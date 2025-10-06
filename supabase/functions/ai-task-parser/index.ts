import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
- description: Optional detailed description with context clues for scheduling
- priority: LOW, MEDIUM, HIGH, or URGENT
- category: LIFE, CAREER, VENTURES, or EDUCATION
- due_date: ISO date string ONLY if user specifies deadline (otherwise null)
- start_time: null (DO NOT SET - scheduler will assign)
- end_time: null (DO NOT SET - scheduler will assign)
- estimate_minutes: Estimated duration in minutes
- status: BACKLOG, TODO, READY, UP_NEXT, DOING
- scheduling_context: Array of context clues for intelligent scheduling

INTELLIGENT TIME SLOT ASSIGNMENT:
Determine SPECIFIC start_time and end_time for tasks based on typical timing patterns.

TYPICAL ACTIVITY TIMINGS:
Work & Meetings:
- Standup meetings: 9:00-9:30 AM (start of workday)
- Team sync: 10:00-10:30 AM or 2:00-2:30 PM (mid-morning/afternoon)
- Meetings: 10:00 AM - 4:00 PM (business hours)
- Work calls: 9:00 AM - 5:00 PM (business hours)

Meals:
- Breakfast: 7:00-8:00 AM
- Brunch: 10:00-11:00 AM
- Lunch: 12:00-1:00 PM or 12:30-1:30 PM (not at 3pm!)
- Dinner: 7:00-8:30 PM (NOT 9-10pm - that's too late!)
- Coffee meetings: 10:00-11:00 AM or 2:00-3:00 PM

Exercise:
- Morning workout: 6:30-7:30 AM (before work)
- Gym session: 5:30-6:30 PM (after work)
- Exercise class: 6:00-7:00 PM

Errands & Appointments:
- Grocery shopping: 5:30-6:30 PM (AFTER work, NOT during) or weekends 10:00-11:00 AM
- Bank appointments: 12:00-12:45 PM (lunch break) - banks close at 5pm
- Doctor appointments: 9:00-10:00 AM or 12:00-1:00 PM (business hours, avoid work conflicts)
- Post office: 12:15-1:00 PM (lunch break) or after 5:00 PM
- Shopping/errands: 5:30-6:30 PM (after work hours)

Social & Personal:
- Family time: 7:00-9:00 PM
- Social activities: 7:00-9:00 PM
- Hobbies: Weekends 2:00-4:00 PM or after work 6:00-8:00 PM

DURATION ESTIMATES:
- Standup/quick sync: 30 minutes
- Regular meetings: 60 minutes
- Meals: 60-90 minutes (lunch 60min, dinner 90min)
- Quick errands: 30-45 minutes
- Grocery shopping: 45-60 minutes
- Appointments: 45-60 minutes
- Workouts: 60 minutes
- Social events: 120 minutes

CRITICAL CONSTRAINTS:
1. DON'T schedule errands/shopping during work hours (9am-5pm weekdays)
2. DON'T schedule meals at weird times (dinner at 10pm, lunch at 4pm)
3. DON'T schedule work meetings outside business hours unless specified
4. Banks/post offices close at 5pm - schedule during lunch or right after 5pm
5. Respect typical human schedules - dinner at 7pm, not 9pm

CRITICAL INSTRUCTIONS:
- NEVER set start_time or end_time fields - always return null
- Add intelligent hints to scheduling_context array instead:
  - For meals: ["suggested_time:19:0"] for dinner, ["suggested_time:12:0"] for lunch
  - For standups: ["suggested_time:9:0"]  
  - For workouts: ["suggested_time:6:30"] or ["suggested_time:17:30"]
  - For errands: ["after_work", "suggested_time:17:30"]
- Add time window hints: "business_hours", "evening", "after_work", "morning"
- Set estimate_minutes based on duration guidance above
- Only set due_date if user explicitly mentions a deadline
- The smart scheduler will find the next available slot based on your hints

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

      // Generate preview scheduling if context provided
      if (userId && boardId) {
        console.log('🔮 Generating preview scheduling for', tasks.length, 'tasks');
        
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        
        const tasksWithPreview = await Promise.all(
          tasks.map(async (task, index) => {
            try {
              const schedulerResponse = await fetch(`${supabaseUrl}/functions/v1/smart-calendar-scheduler`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${supabaseKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  task: {
                    ...task,
                    board_id: boardId,
                    user_id: userId,
                  },
                  userId,
                  existingTasks,
                }),
              });
              
              if (schedulerResponse.ok) {
                const { scheduledTask } = await schedulerResponse.json();
                console.log(`✅ Preview scheduled task ${index + 1}:`, scheduledTask?.start_time);
                return {
                  ...task,
                  start_time: scheduledTask?.start_time || null,
                  end_time: scheduledTask?.end_time || null,
                  isPreview: true, // Mark as preview
                };
              } else {
                const errorText = await schedulerResponse.text();
                console.warn(`⚠️ Preview scheduling failed for task ${index + 1}:`, errorText);
              }
            } catch (error) {
              console.error(`❌ Preview scheduling error for task ${index + 1}:`, error);
            }
            return task;
          })
        );
        
        console.log('✅ Preview scheduling complete');
        
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