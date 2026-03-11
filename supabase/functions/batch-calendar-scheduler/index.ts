import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizeDateTime, getTodayInTimezone, getTzOffsetMinutesAt } from "../_shared/timezone.ts";

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
    
    // =============================================================
    // DYNAMIC TIMEZONE OFFSET — replaces hardcoded -05:00
    // Correctly handles DST (e.g., EDT = -04:00, EST = -05:00)
    // =============================================================
    const targetNoon = new Date(`${targetDateISO}T12:00:00Z`);
    const offsetMin = getTzOffsetMinutesAt(targetNoon, timezone);
    const offsetSign = offsetMin >= 0 ? '+' : '-';
    const absH = String(Math.floor(Math.abs(offsetMin) / 60)).padStart(2, '0');
    const absM = String(Math.abs(offsetMin) % 60).padStart(2, '0');
    const tzOffset = `${offsetSign}${absH}:${absM}`; // e.g., "-04:00" for EDT, "-05:00" for EST
    
    console.log(`[BATCH-SCHEDULER] Timezone: ${timezone}, todayISO: ${todayISO}, targetDateISO: ${targetDateISO}, computed offset: ${tzOffset}`);
    
    // If allowOverflow, fetch busy slots for target date + next day
    // Otherwise, fetch for the next 14 days
    // Parse targetDateISO safely without new Date() UTC shift
    let busySlotsEndDate: Date;
    let targetDateObj: Date | null = null;
    
    if (targetDate && allowOverflow) {
      // Parse target date from YYYY-MM-DD string directly
      const [year, month, day] = targetDateISO.split('-').map(Number);
      const targetAsDate = new Date(year, month - 1, day, 23, 59, 59, 999);
      targetDateObj = targetAsDate;
      // Get end of next day after target
      const nextDay = new Date(targetAsDate);
      nextDay.setDate(nextDay.getDate() + 2); // target + 1 day buffer
      busySlotsEndDate = nextDay;
    } else if (targetDate) {
      // Just the target date - parse from string
      const [year, month, day] = targetDateISO.split('-').map(Number);
      busySlotsEndDate = new Date(year, month - 1, day, 23, 59, 59, 999);
      targetDateObj = busySlotsEndDate;
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

    // Build category mappings from user config (authoritative), falling back to defaults
    const userTimeWindows = userConfig?.timeWindows || {
      morning: { start: 6, end: 9 },
      business_hours: { start: 9, end: 17 },
      after_work: { start: 17, end: 22 },
      evening: { start: 19, end: 22 },
      flexible: { start: 9, end: 22 },
      weekends: { start: 10, end: 20 },
    };

    const userCategoryMappings = userConfig?.categoryMappings || {
      CAREER: { defaultTimeWindow: ['business_hours'], estimatedDuration: 120 },
      PROF_EDUCATION: { defaultTimeWindow: ['after_work', 'weekends'], estimatedDuration: 90 },
      EDUCATION: { defaultTimeWindow: ['flexible'], estimatedDuration: 90 },
      VENTURES: { defaultTimeWindow: ['after_work', 'weekends'], estimatedDuration: 120 },
      LIFE: { defaultTimeWindow: ['flexible'], estimatedDuration: 60 },
      PERSONAL: { defaultTimeWindow: ['flexible'], estimatedDuration: 60 },
    };

    // ===============================================
    // DAY-OF-WEEK FILTERING: Remove inapplicable windows
    // On a weekday, "weekends" is irrelevant.
    // On a weekend, "business_hours"/"after_work"/"morning" are irrelevant.
    // ===============================================
    const targetDayOfWeek = targetDateObj
      ? targetDateObj.getDay()
      : now.getDay();
    const isWeekendDay = targetDayOfWeek === 0 || targetDayOfWeek === 6;

    const filteredCategoryMappings: Record<string, any> = {};
    for (const [cat, mapping] of Object.entries(userCategoryMappings)) {
      const wins: string[] = Array.isArray(mapping.defaultTimeWindow)
        ? mapping.defaultTimeWindow
        : [mapping.defaultTimeWindow];
      const validWins = wins.filter((w: string) => {
        if (isWeekendDay && ['morning', 'business_hours', 'after_work'].includes(w)) return false;
        if (!isWeekendDay && w === 'weekends') return false;
        return true;
      });
      filteredCategoryMappings[cat] = {
        ...mapping,
        defaultTimeWindow: validWins.length > 0 ? validWins : ['flexible'],
      };
    }

    console.log(`📆 Day-of-week filter: ${isWeekendDay ? 'WEEKEND' : 'WEEKDAY'} (day=${targetDayOfWeek})`);
    console.log('📋 Filtered category mappings:', JSON.stringify(filteredCategoryMappings));

    // Helper to format hour range from time window config
    const formatWindowHours = (windowName: string): string => {
      const w = userTimeWindows[windowName];
      if (!w) return windowName;
      const fmtHr = (h: number) => {
        if (h === 0) return '12am';
        if (h < 12) return `${h}am`;
        if (h === 12) return '12pm';
        return `${h - 12}pm`;
      };
      return `${fmtHr(w.start)}-${fmtHr(w.end)}`;
    };

    // Build flat lookup for AI prompt per-task lines (using FILTERED mappings)
    const categoryWindowLookup: Record<string, { windows: string; hours: string }> = {};
    for (const [cat, mapping] of Object.entries(filteredCategoryMappings)) {
      const wins = Array.isArray(mapping.defaultTimeWindow) ? mapping.defaultTimeWindow : [mapping.defaultTimeWindow];
      categoryWindowLookup[cat] = {
        windows: wins.join(' or '),
        hours: wins.map((w: string) => `${w}: ${formatWindowHours(w)}`).join(', '),
      };
    }

    console.log('📋 Using category mappings from user config:', JSON.stringify(categoryWindowLookup));

    // Build the batch scheduling prompt
    const tasksList = tasks.map((task: TaskToSchedule, i: number) => {
      const duration = task.estimate_minutes || task.schedulingHints?.estimatedDuration || 60;
      const catInfo = categoryWindowLookup[task.category] || categoryWindowLookup.LIFE || { windows: 'flexible', hours: 'flexible: 9am-10pm' };
      return `${i + 1}. "${task.title}" 
   - Category: ${task.category} (MUST schedule within ${catInfo.windows}: ${catInfo.hours})
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

SCHEDULING RULES (FOLLOW IN THIS EXACT ORDER):

=== RULE 1: STRICT WINDOW ENFORCEMENT (HARD CONSTRAINT) ===
Each task MUST be placed within its category's designated time window. This is NOT a suggestion — it is a HARD CONSTRAINT. Do NOT place tasks outside their window under any circumstances.
If a category's required window is fully booked, DO NOT place the task in a different window. Instead, mark it with reasoning "OVERFLOW - no available slot in required window" and leave start_time/end_time as empty strings.

CATEGORY → REQUIRED TIME WINDOW (already filtered for ${isWeekendDay ? 'weekend' : 'weekday'}):
${Object.entries(filteredCategoryMappings).map(([cat, mapping]) => {
      const wins = Array.isArray(mapping.defaultTimeWindow) ? mapping.defaultTimeWindow : [mapping.defaultTimeWindow];
      const windowDescs = wins.map((w: string) => `${w}: ${formatWindowHours(w)}`).join(', OR ');
      return `- ${cat} tasks → ${windowDescs}`;
    }).join('\n')}

=== RULE 2: KEYWORD OVERRIDE (TRUMPS CATEGORY WINDOW) ===
If the task TITLE contains any of these keywords, override the category window:
- "shopping", "mall", "grocery", "groceries", "errands" → after_work (5:00pm–10:00pm) regardless of category
- "email", "emails", "meeting", "call", "interview", "review", "invoice", "contract" → business_hours (9:00am–5:00pm) regardless of category
- "workout", "exercise", "gym", "breakfast", "morning routine" → morning (6:00am–9:00am) regardless of category
- "dinner", "family", "social", "relax" → evening (7:00pm–10:00pm) regardless of category
- "lunch", "brunch" → keep within 11:00am–1:30pm regardless of category
- "doctor", "dentist", "bank", "post office" → business_hours (9:00am–5:00pm) regardless of category

=== RULE 3: NO CONFLICTS ===
NEVER double-book — each task must not overlap with busy slots OR other scheduled tasks.

=== RULE 4: PRIORITY WITHIN WINDOW ===
Higher priority tasks get EARLIER slots WITHIN their designated window. Urgent > High > Medium > Low.

=== RULE 5: DUE DATES ===
Respect due dates — schedule before deadline. Tasks due within 48 hours get priority placement.

=== RULE 6: BUFFERS ===
Leave 15-minute buffer between tasks when possible.

=== RULE 7: OVERFLOW ===
${targetDateObj ? `If a task cannot fit within its required window on ${targetDateISO} (window is full or no time left), mark it with reasoning "OVERFLOW: [window_name] full on ${targetDateISO}" and DO NOT schedule it. Do not force it into a different window.` : 'Schedule each task in its preferred time window based on category.'}
${overflowInstructions}

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
