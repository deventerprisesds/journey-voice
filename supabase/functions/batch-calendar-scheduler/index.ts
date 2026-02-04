import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizeDateTime, getTodayInTimezone } from "../_shared/timezone.ts";

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
    const { tasks, userId, timezone = 'UTC', targetDate, allowOverflow = false } = await req.json();
    
    console.log(`📦 Batch scheduling ${tasks?.length || 0} tasks for user ${userId}${targetDate ? ` (target: ${targetDate})` : ''}${allowOverflow ? ' (overflow allowed)' : ''}`);
    
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

    // Determine date range for busy slots
    const now = new Date();
    
    // =============================================================
    // EXPLICIT DATE CONTEXT - Use centralized timezone utility
    // =============================================================
    const todayISO = getTodayInTimezone(timezone);  // Correct date in user's timezone
    const todayReadable = now.toLocaleDateString('en-US', {
      timeZone: timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });  // "Tuesday, February 4, 2026"
    
    // Parse targetDate in user's timezone (avoid UTC midnight shift)
    let targetDateISO = targetDate || todayISO;
    if (targetDate) {
      // Validate: use the string directly, don't parse with new Date()
      // which would interpret as UTC midnight and shift the date
      targetDateISO = targetDate;
    }
    
    console.log(`[BATCH-SCHEDULER] Timezone: ${timezone}, todayISO: ${todayISO}, targetDateISO: ${targetDateISO}`);
    
    // If allowOverflow, fetch busy slots for target date + next day
    // Otherwise, fetch for the next 14 days
    // Parse targetDateISO safely without new Date() UTC shift
    let busySlotsEndDate: Date;
    if (targetDate && allowOverflow) {
      // Parse target date from YYYY-MM-DD string directly
      const [year, month, day] = targetDateISO.split('-').map(Number);
      const targetAsDate = new Date(year, month - 1, day, 23, 59, 59, 999);
      // Get end of next day after target
      const nextDay = new Date(targetAsDate);
      nextDay.setDate(nextDay.getDate() + 2); // target + 1 day buffer
      busySlotsEndDate = nextDay;
    } else if (targetDate) {
      // Just the target date - parse from string
      const [year, month, day] = targetDateISO.split('-').map(Number);
      busySlotsEndDate = new Date(year, month - 1, day, 23, 59, 59, 999);
    } else {
      // Default: 14 days
      busySlotsEndDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    }

    // Single DB load for busy slots
    console.log(`📅 Loading busy slots until ${busySlotsEndDate.toISOString()}...`);
    
    const [tasksResult, eventsResult] = await Promise.all([
      supabase
        .from('tasks')
        .select('title, start_time, end_time')
        .eq('user_id', userId)
        .eq('is_scheduled', true)
        .gte('start_time', now.toISOString())
        .lte('start_time', busySlotsEndDate.toISOString()),
      supabase
        .from('external_calendar_events')
        .select('title, start_time, end_time')
        .eq('user_id', userId)
        .gte('start_time', now.toISOString())
        .lte('end_time', busySlotsEndDate.toISOString())
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

    // Determine target date for scheduling (human-readable for AI context)
    const targetDateStr = targetDateObj 
      ? targetDateObj.toLocaleDateString('en-US', { timeZone: timezone, dateStyle: 'full' })
      : 'today or tomorrow based on current time';

    // Build overflow instructions
    const overflowInstructions = allowOverflow 
      ? `
OVERFLOW RULES:
- Primary target date: ${targetDateISO} (${targetDateStr})
- If there isn't enough time remaining on ${targetDateISO}, schedule remaining tasks for the NEXT DAY
- Mark overflow tasks with reasoning like "Scheduled for tomorrow - today fully booked"
- Prioritize HIGH/URGENT priority tasks for the target date
- Tasks with earlier due dates should also be prioritized for the target date`
      : '';

    // Current time in user's timezone for AI context
    const currentTimeStr = now.toLocaleTimeString('en-US', { 
      timeZone: timezone, 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true
    });

    const batchPrompt = `You are a scheduling assistant. Schedule ALL ${tasks.length} tasks efficiently, avoiding conflicts.

=== CRITICAL DATE CONTEXT (READ CAREFULLY) ===
TODAY'S DATE (ISO format): ${todayISO}
TODAY'S DATE (readable): ${todayReadable}
TARGET SCHEDULING DATE (ISO): ${targetDateISO}
TARGET SCHEDULING DATE (readable): ${targetDateStr}
CURRENT TIME: ${currentTimeStr}
TIMEZONE: ${timezone}

⚠️ IMPORTANT: ALL scheduled times MUST use date ${targetDateISO} or later.
⚠️ NEVER schedule anything before ${todayISO}.
⚠️ Use ISO format for all times: "${targetDateISO}T10:00:00-05:00"
==============================================

TASKS TO SCHEDULE:
${tasksList}

EXISTING BUSY SLOTS (MUST AVOID):
${busySlotsStr}

SCHEDULING RULES:
1. ${targetDateObj ? `IMPORTANT: Schedule ALL tasks for ${targetDateISO} first. Start from current time if today, or from 9am if future date.` : 'Schedule each task in its preferred time window based on category'}
2. NEVER double-book - each new task must not overlap with busy slots OR other new tasks
3. Higher priority tasks should get better time slots
4. Respect due dates - schedule before deadline
5. Leave 15-minute buffer between tasks when possible
6. ${targetDateObj ? `Try to fit all tasks on ${targetDateISO}` : 'Start from tomorrow if today is mostly over'}
${overflowInstructions}

CATEGORY TIME WINDOWS:
- CAREER: 9am-5pm weekdays (business_hours)
- PROF_EDUCATION/EDUCATION: 5pm-10pm weekdays (after_work) 
- VENTURES: 5pm-10pm weekdays (after_work)
- LIFE: 9am-10pm any day (flexible)

CRITICAL TIME FORMAT REQUIREMENTS:
- Return ALL times as ISO 8601 strings WITH EXPLICIT TIMEZONE OFFSET
- Example for ${timezone}: "${targetDateISO}T12:00:00-05:00" (noon Eastern with offset)
- Or use UTC with Z suffix: "${targetDateISO}T17:00:00Z" (same moment as noon Eastern)
- NEVER return naive timestamps like "${targetDateISO}T12:00:00" without offset
- The offset must reflect the actual timezone (${timezone})

Return a JSON array with one entry per task in order:
[
  { "taskIndex": 0, "start_time": "${targetDateISO}T10:00:00-05:00", "end_time": "${targetDateISO}T11:00:00-05:00", "reasoning": "brief reason" },
  { "taskIndex": 1, "start_time": "${targetDateISO}T14:00:00-05:00", "end_time": "${targetDateISO}T15:00:00-05:00", "reasoning": "brief reason" },
  ...
]

IMPORTANT: Return ONLY the JSON array, no other text. All times MUST include timezone offset or Z suffix.`;

    // ===============================================
    // TRACING: Log AI input for debugging
    // ===============================================
    console.log('=== BATCH SCHEDULER AI INPUT ===');
    console.log('Today ISO:', todayISO);
    console.log('Today Readable:', todayReadable);
    console.log('Target Date ISO:', targetDateISO);
    console.log('Target Date Readable:', targetDateStr);
    console.log('Timezone:', timezone);
    console.log('Tasks count:', tasks.length);
    console.log('Prompt length:', batchPrompt.length);
    console.log('First 800 chars of prompt:', batchPrompt.substring(0, 800));
    console.log('=================================');

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

    // ===============================================
    // TRACING: Log raw AI output for debugging
    // ===============================================
    console.log('=== BATCH SCHEDULER AI OUTPUT ===');
    console.log('Raw AI response (first 1500 chars):', aiContent?.substring(0, 1500));
    console.log('==================================');

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
      
      // ===============================================
      // TRACING: Log parsed results with date validation
      // ===============================================
      console.log('=== BATCH SCHEDULER PARSED RESULTS ===');
      scheduledResults.forEach((r, i) => {
        const dateFromResult = r.start_time?.split('T')[0];
        console.log(`  Slot ${i}: taskIndex=${r.taskIndex}, start=${r.start_time}, end=${r.end_time}`);
        if (dateFromResult && dateFromResult < todayISO) {
          console.error(`  ⚠️ WARNING: Slot ${i} has PAST date ${dateFromResult} (today is ${todayISO})`);
        }
      });
      console.log('======================================');
      
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

    // Map results back to task IDs, normalizing times as a safety net
    // This catches any naive timestamps the AI might return despite prompt instructions
    const scheduledTasks = scheduledResults.map(result => {
      const originalTask = tasks[result.taskIndex];
      
      // Normalize times - if AI returned naive ISO, treat as local to user's timezone
      const normalizedStart = normalizeDateTime(result.start_time, timezone);
      const normalizedEnd = normalizeDateTime(result.end_time, timezone);
      
      if (result.start_time !== normalizedStart) {
        console.log(`⚠️ Normalized start_time: ${result.start_time} → ${normalizedStart}`);
      }
      
      return {
        taskId: originalTask?.id,
        taskIndex: result.taskIndex,
        start_time: normalizedStart,
        end_time: normalizedEnd,
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
