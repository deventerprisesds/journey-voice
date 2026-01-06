import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface TaskToSchedule {
  id?: string;
  title: string;
  category: string;
  priority: string;
  estimate_minutes?: number;
  due_date?: string;
  schedulingHints?: {
    context: string[];
    estimatedDuration: number;
  };
}

interface ScheduledResult {
  taskIndex: number;
  start_time: string;
  end_time: string;
  reasoning?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const { tasks, userId, timezone = 'UTC', targetDate } = await req.json();
    
    console.log(`📦 Batch scheduling ${tasks?.length || 0} tasks for user ${userId}${targetDate ? ` (target: ${targetDate})` : ''}`);
    
    if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
      throw new Error('Tasks array is required');
    }
    
    if (!userId) {
      throw new Error('userId is required');
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Single DB load for user config
    console.log('📋 Loading user config...');
    const { data: userConfigData } = await supabase
      .from('user_scheduling_prefs')
      .select('*')
      .eq('user_id', userId)
      .single();
    
    const userConfig = userConfigData?.config || null;

    // Single DB load for busy slots (next 14 days)
    console.log('📅 Loading busy slots...');
    const now = new Date();
    const futureDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    
    const [tasksResult, eventsResult] = await Promise.all([
      supabase
        .from('tasks')
        .select('title, start_time, end_time')
        .eq('user_id', userId)
        .eq('is_scheduled', true)
        .gte('start_time', now.toISOString())
        .lte('start_time', futureDate.toISOString()),
      supabase
        .from('external_calendar_events')
        .select('title, start_time, end_time')
        .eq('user_id', userId)
        .gte('start_time', now.toISOString())
        .lte('end_time', futureDate.toISOString())
    ]);

    const existingBusySlots = [
      ...(tasksResult.data || []),
      ...(eventsResult.data || [])
    ];

    console.log(`📊 Found ${existingBusySlots.length} existing busy slots`);

    // Build category mappings info for AI
    const defaultCategoryMappings: Record<string, { window: string; hours: string }> = {
      CAREER: { window: 'business_hours', hours: '9am-5pm' },
      PROF_EDUCATION: { window: 'after_work', hours: '5pm-10pm' },
      EDUCATION: { window: 'after_work', hours: '5pm-10pm' },
      VENTURES: { window: 'after_work', hours: '5pm-10pm' },
      LIFE: { window: 'flexible', hours: '9am-10pm' },
    };

    // Build the batch scheduling prompt
    const tasksList = tasks.map((task: TaskToSchedule, i: number) => {
      const duration = task.estimate_minutes || task.schedulingHints?.estimatedDuration || 60;
      const categoryInfo = defaultCategoryMappings[task.category] || defaultCategoryMappings.LIFE;
      return `${i + 1}. "${task.title}" 
   - Category: ${task.category} (prefer ${categoryInfo.window}: ${categoryInfo.hours})
   - Priority: ${task.priority}
   - Duration: ${duration} minutes
   - Due: ${task.due_date || 'none'}`;
    }).join('\n');

    const busySlotsStr = existingBusySlots.length > 0 
      ? existingBusySlots.map(slot => {
          const start = new Date(slot.start_time).toLocaleString('en-US', { 
            timeZone: timezone, 
            dateStyle: 'short', 
            timeStyle: 'short' 
          });
          const end = new Date(slot.end_time).toLocaleString('en-US', { 
            timeZone: timezone, 
            timeStyle: 'short' 
          });
          return `- ${slot.title}: ${start} to ${end}`;
        }).join('\n')
      : 'No existing conflicts';

    // Determine target date for scheduling
    const targetDateObj = targetDate ? new Date(targetDate) : null;
    const targetDateStr = targetDateObj 
      ? targetDateObj.toLocaleDateString('en-US', { timeZone: timezone, dateStyle: 'full' })
      : 'today or tomorrow based on current time';

    const batchPrompt = `You are a scheduling assistant. Schedule ALL ${tasks.length} tasks efficiently, avoiding conflicts.

TARGET DATE: ${targetDateStr}
CURRENT TIME: ${now.toLocaleString('en-US', { timeZone: timezone })}
TIMEZONE: ${timezone}

TASKS TO SCHEDULE:
${tasksList}

EXISTING BUSY SLOTS (MUST AVOID):
${busySlotsStr}

SCHEDULING RULES:
1. ${targetDateObj ? `IMPORTANT: Schedule ALL tasks for ${targetDateStr}, starting from ${now.toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' })} or later` : 'Schedule each task in its preferred time window based on category'}
2. NEVER double-book - each new task must not overlap with busy slots OR other new tasks
3. Higher priority tasks should get better time slots
4. Respect due dates - schedule before deadline
5. Leave 15-minute buffer between tasks when possible
6. ${targetDateObj ? `All tasks MUST be scheduled on ${targetDateStr}` : 'Start from tomorrow if today is mostly over'}

CATEGORY TIME WINDOWS:
- CAREER: 9am-5pm weekdays (business_hours)
- PROF_EDUCATION/EDUCATION: 5pm-10pm weekdays (after_work) 
- VENTURES: 5pm-10pm weekdays (after_work)
- LIFE: 9am-10pm any day (flexible)

Return a JSON array with one entry per task in order:
[
  { "taskIndex": 0, "start_time": "ISO string", "end_time": "ISO string", "reasoning": "brief reason" },
  { "taskIndex": 1, "start_time": "ISO string", "end_time": "ISO string", "reasoning": "brief reason" },
  ...
]

IMPORTANT: Return ONLY the JSON array, no other text.`;

    console.log('🤖 Calling AI for batch scheduling...');
    const aiStartTime = Date.now();

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'user', content: batchPrompt }
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('❌ AI API error:', aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ 
          error: 'Rate limit exceeded. Please try again in a moment.',
          scheduled: [] 
        }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ 
          error: 'AI credits exhausted. Please add credits to continue.',
          scheduled: [] 
        }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const aiContent = aiData.choices?.[0]?.message?.content;
    
    console.log(`✅ AI responded in ${Date.now() - aiStartTime}ms`);

    if (!aiContent) {
      throw new Error('No content in AI response');
    }

    // Parse the AI response
    let scheduledResults: ScheduledResult[] = [];
    try {
      // Extract JSON from response (handle markdown code blocks)
      let jsonStr = aiContent;
      const jsonMatch = aiContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }
      
      scheduledResults = JSON.parse(jsonStr.trim());
      
      if (!Array.isArray(scheduledResults)) {
        throw new Error('Response is not an array');
      }
      
      console.log(`✅ Parsed ${scheduledResults.length} scheduled slots`);
    } catch (parseError) {
      console.error('❌ Failed to parse AI response:', aiContent.substring(0, 500));
      // Return empty schedule on parse error - tasks can be scheduled manually
      return new Response(JSON.stringify({ 
        scheduled: [],
        error: 'Failed to parse scheduling response',
        tasksCount: tasks.length
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Map results back to task IDs
    const scheduledTasks = scheduledResults.map(result => {
      const originalTask = tasks[result.taskIndex];
      return {
        taskId: originalTask?.id,
        taskIndex: result.taskIndex,
        start_time: result.start_time,
        end_time: result.end_time,
        reasoning: result.reasoning,
      };
    });

    const totalTime = Date.now() - startTime;
    console.log(`✅ Batch scheduling complete in ${totalTime}ms for ${tasks.length} tasks`);

    return new Response(JSON.stringify({ 
      scheduled: scheduledTasks,
      tasksCount: tasks.length,
      processingTimeMs: totalTime
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ Error in batch-calendar-scheduler:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      scheduled: []
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
