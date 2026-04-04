import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizeDateTime, getTodayInTimezone, getTzOffsetMinutesAt } from "../_shared/timezone.ts";
import { DEFAULT_TIME_WINDOWS, DEFAULT_CATEGORY_MAPPINGS, resolveConfig, validateTaskWindow } from "../_shared/scheduling-defaults.ts";

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

    // Build category mappings from user config (authoritative), falling back to shared defaults
    const { timeWindows: resolvedTimeWindows, categoryMappings: resolvedCategoryMappings } = resolveConfig(userConfig);

    const userTimeWindows = resolvedTimeWindows;
    const userCategoryMappings = resolvedCategoryMappings;

    // [CONFIG-TRACE] Log what config was resolved
    console.log('[CONFIG-TRACE] Raw userConfig type:', typeof userConfig);
    console.log('[CONFIG-TRACE] Raw userConfig keys:', userConfig ? Object.keys(userConfig) : 'null');
    console.log('[CONFIG-TRACE] has categoryMappings:', !!userConfig?.categoryMappings);
    if (userConfig?.categoryMappings) {
      console.log('[CONFIG-TRACE] categoryMappings keys:', Object.keys(userConfig.categoryMappings));
      console.log('[CONFIG-TRACE] EDUCATION mapping:', JSON.stringify(userConfig.categoryMappings.EDUCATION || userConfig.categoryMappings.PROF_EDUCATION));
      console.log('[CONFIG-TRACE] LIFE mapping:', JSON.stringify(userConfig.categoryMappings.LIFE));
      console.log('[CONFIG-TRACE] VENTURES mapping:', JSON.stringify(userConfig.categoryMappings.VENTURES));
    }
    console.log('[CONFIG-TRACE] resolved EDUCATION:', JSON.stringify(resolvedCategoryMappings.EDUCATION || resolvedCategoryMappings.PROF_EDUCATION));
    console.log('[CONFIG-TRACE] using defaults?', resolvedCategoryMappings === DEFAULT_CATEGORY_MAPPINGS ? 'YES' : 'NO');

    // ===============================================
    // DAY-OF-WEEK FILTERING: Remove inapplicable windows
    // On a weekday, "weekends" is irrelevant.
    // On a weekend, "business_hours"/"after_work"/"morning" are irrelevant.
    // ===============================================
    // Timezone-aware day-of-week: parse targetDateISO in user's timezone
    const targetDayOfWeek = (() => {
      if (targetDateISO) {
        const [y, m, d] = targetDateISO.split('-').map(Number);
        // Create a date at noon UTC to avoid edge effects, then format in user TZ
        const noonUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
        const dayStr = noonUtc.toLocaleDateString('en-US', { timeZone: timezone, weekday: 'short' });
        const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        return dayMap[dayStr] ?? noonUtc.getDay();
      }
      return now.getDay();
    })();
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
      return `${i}. "${task.title}" (taskIndex: ${i})
   - Category: ${task.category} (default window: ${catInfo.windows}: ${catInfo.hours})
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

    // Day name for context-aware scheduling
    const dayName = new Date(`${targetDateISO}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: timezone, weekday: 'long' }).toUpperCase();
    
    const batchPrompt = `You are a scheduling assistant. Schedule ALL ${tasks.length} tasks efficiently, avoiding conflicts.

=== CRITICAL DATE CONTEXT (READ CAREFULLY) ===
TODAY'S DATE (ISO format): ${todayISO}
TODAY'S DATE (readable): ${todayReadable}
TARGET SCHEDULING DATE (ISO): ${targetDateISO}
TARGET SCHEDULING DATE (readable): ${targetDateStr}
DAY OF WEEK: This is a ${dayName}
CURRENT TIME: ${currentTimeStr}
TIMEZONE: ${timezone}

⚠️ IMPORTANT: ALL scheduled times MUST use date ${targetDateISO} or later.
⚠️ NEVER schedule anything before ${todayISO}.
⚠️ Use ISO format for all times: "${targetDateISO}T10:00:00${tzOffset}"

=== DAY-SPECIFIC RULES ===
${dayName === 'SATURDAY' || dayName === 'SUNDAY' ? '- This is a WEEKEND day. Use weekend-appropriate scheduling.\n' : '- This is a WEEKDAY. Use business-hour scheduling.\n'}
=== RULE 1c: COMMON-SENSE DAY/TIME MATCHING ===
Consider whether the ACTIVITY described in each task title makes sense on ${dayName} at the time you pick. Apply general knowledge:
- Weekly religious/worship activities belong on their traditional day (e.g., church on Sunday, mosque on Friday)
- "Weekend" activities should not be placed on weekdays and vice versa
- Business errands (bank, post office, government offices) should be on weekdays during business hours
- Social dinners, parties, and gatherings are evening activities, not early morning
- Outdoor exercise and gym are typically morning or late afternoon, not midnight
- Grocery shopping and personal errands fit daytime hours, not late night
If the activity clearly does NOT belong on ${dayName} or at the time you'd place it, mark as OVERFLOW with a reason explaining the mismatch.
==============================================

TASKS TO SCHEDULE:
${tasksList}

EXISTING BUSY SLOTS (MUST AVOID):
${busySlotsStr}

SCHEDULING RULES (FOLLOW IN THIS EXACT ORDER):

=== RULE 1: HARD WINDOW CONSTRAINTS (MANDATORY) ===
Each task's category has ALLOWED time windows listed above. You MUST schedule every task within its allowed windows. This is NOT optional.

- If a category says "after_work or weekends", the task MUST be placed in one of those windows.
- If a category says "flexible", you may use any window between 9am and 10pm — NEVER outside that range.
- NEVER place a task outside its allowed windows, even if it seems logical.
- NEVER schedule ANY task before 6am or after 10pm regardless of category.
- If the allowed window is full, mark the task as OVERFLOW (see Rule 6).

=== RULE 1b: ACTIVITY CONTEXT HINTS ===
Use common sense about WHAT the task involves to pick the best slot WITHIN its allowed window:
- Gym / workout / exercise → morning window (6-9am weekdays) or early weekends (10am-12pm)
- Bank / post office / doctor / errands → business hours only (9am-5pm weekdays)
- Dinner / family / social → evening window (7-10pm)
- Study / homework / reading → after_work or weekends, not early morning
- Grocery / shopping → daytime business hours or early evening
- Calls / emails / follow-ups → business hours preferred

These are hints for SLOT SELECTION within the allowed window — they do NOT override the hard window constraint.

=== RULE 2: PRIORITY RANKING WITHIN WINDOWS ===
Within the allowed windows, use these heuristics to determine ORDER (earliest slot first):

A) FINANCIAL IMPACT — tasks involving money (payments, bills, taxes, subscriptions):
   → Schedule EARLIEST within the task's allowed windows. Treat as HIGH priority.

B) PEOPLE / COMMUNICATION — tasks involving contacting or coordinating with others:
   → Schedule EARLIEST within the task's allowed windows. Treat as HIGH priority.

C) TIME-SENSITIVE — tasks due within 48 hours:
   → EARLIEST available slot within allowed windows.

D) Higher priority tasks (URGENT > HIGH > MEDIUM > LOW) get earlier slots within their window.

=== RULE 3: NO CONFLICTS ===
NEVER double-book — each task must not overlap with busy slots OR other scheduled tasks.

=== RULE 4: DUE DATES ===
Respect due dates — schedule before deadline. Tasks due within 48 hours get priority placement.

=== RULE 5: BUFFERS AND CONSOLIDATION ===
Leave 15-minute buffer between tasks when possible.
Group similar-category tasks into contiguous blocks when possible (e.g., all CAREER tasks together).
If shifting an earlier task by 15-30 minutes creates room for an additional task, prefer the shift.

=== RULE 6: OVERFLOW ===
${targetDateObj ? `If a task cannot fit within its ALLOWED windows on ${targetDateISO} (window is full or no time left), mark it with reasoning "OVERFLOW: [window_name] full on ${targetDateISO}" and DO NOT schedule it. Do NOT force it into a different window.` : 'Schedule each task in its allowed time window based on category.'}
${overflowInstructions}

CRITICAL TIME FORMAT REQUIREMENTS:
- Return ALL times as ISO 8601 strings WITH EXPLICIT TIMEZONE OFFSET
- Example for ${timezone}: "${targetDateISO}T12:00:00${tzOffset}" (noon in ${timezone} with offset)
- Or use UTC with Z suffix — but the offset form is preferred
- NEVER return naive timestamps like "${targetDateISO}T12:00:00" without offset
- The offset must reflect the actual timezone (${timezone})

Return a JSON array with one entry per task in order:
[
  { "taskIndex": 0, "start_time": "${targetDateISO}T10:00:00${tzOffset}", "end_time": "${targetDateISO}T11:00:00${tzOffset}", "reasoning": "brief reason" },
  { "taskIndex": 1, "start_time": "${targetDateISO}T14:00:00${tzOffset}", "end_time": "${targetDateISO}T15:00:00${tzOffset}", "reasoning": "brief reason" },
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
    // Then validate each task against its allowed windows (HARD CONSTRAINT)
    const scheduledTasks = [];
    const rejectedTasks = [];
    const acceptedSlots: Array<{ start: number; end: number }> = [];
    
    for (const result of scheduledResults) {
      // Handle off-by-one: AI sometimes returns 1-based index despite prompt saying 0-based
      const rawIdx = result.taskIndex;
      const idx = (rawIdx >= 1 && rawIdx > tasks.length - 1) ? rawIdx - 1 : rawIdx;
      if (idx !== rawIdx) {
        console.warn(`⚠️ Corrected taskIndex from ${rawIdx} to ${idx} (1-based → 0-based)`);
      }
      const originalTask = tasks[idx];
      if (!originalTask) {
        console.warn(`⚠️ No task found for taskIndex=${rawIdx} (corrected=${idx}), skipping`);
        continue;
      }
      
      // Normalize times - if AI returned naive ISO, treat as local to user's timezone
      const normalizedStart = normalizeDateTime(result.start_time, timezone);
      const normalizedEnd = normalizeDateTime(result.end_time, timezone);
      
      if (result.start_time !== normalizedStart) {
        console.log(`⚠️ Normalized start_time: ${result.start_time} → ${normalizedStart}`);
      }
      
      // POST-AI VALIDATION 1: Check window constraints
      const validation = validateTaskWindow(
        normalizedStart,
        originalTask.category,
        userTimeWindows,
        filteredCategoryMappings,
        timezone
      );
      
      if (!validation.valid) {
        console.warn(`🚫 WINDOW VIOLATION: "${originalTask.title}" (${originalTask.category}) scheduled in "${validation.actualWindow}" but allowed: [${validation.allowedWindows.join(', ')}] — REJECTED`);
        rejectedTasks.push({
          taskId: originalTask.id,
          taskIndex: result.taskIndex,
          reason: `Window violation: placed in ${validation.actualWindow}, allowed: ${validation.allowedWindows.join(', ')}`,
          reasoning: result.reasoning,
        });
        continue;
      }

      // POST-AI VALIDATION 2: Check overlap with previously accepted slots in this batch
      const slotStartMs = new Date(normalizedStart).getTime();
      const slotEndMs = new Date(normalizedEnd).getTime();
      const hasOverlap = acceptedSlots.some(s => slotStartMs < s.end && slotEndMs > s.start);
      
      if (hasOverlap) {
        console.warn(`🚫 OVERLAP: "${originalTask.title}" [${normalizedStart} - ${normalizedEnd}] overlaps a previously accepted slot — REJECTED`);
        rejectedTasks.push({
          taskId: originalTask.id,
          taskIndex: result.taskIndex,
          reason: `Overlaps previously accepted task in this batch`,
          reasoning: result.reasoning,
        });
        continue;
      }

      acceptedSlots.push({ start: slotStartMs, end: slotEndMs });
      
      scheduledTasks.push({
        taskId: originalTask?.id,
        taskIndex: result.taskIndex,
        start_time: normalizedStart,
        end_time: normalizedEnd,
        reasoning: result.reasoning,
      });
    }
    
    if (rejectedTasks.length > 0) {
      console.log(`🚫 Post-AI validation rejected ${rejectedTasks.length} tasks for window violations`);
    }

    // ============================================================
    // POST-VALIDATION 3: Common-sense sanity check via lightweight AI call
    // Catches nonsensical placements that window constraints can't detect
    // (e.g., church on Saturday, grocery at 3 AM, business call Sunday night)
    // ============================================================
    if (scheduledTasks.length > 0) {
      try {
        const sanityItems = scheduledTasks.map((st, i) => {
          const task = tasks[st.taskIndex];
          const startDt = new Date(st.start_time);
          const dayOfWeek = startDt.toLocaleDateString('en-US', { timeZone: timezone, weekday: 'long' });
          const timeStr = startDt.toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true });
          return `${i}: "${task?.title || 'Unknown'}" → ${dayOfWeek} ${timeStr}`;
        }).join('\n');

        const sanityPrompt = `Review these scheduled tasks for common-sense issues. Flag any task where the scheduled day or time is clearly wrong for the activity described.

Examples of issues to flag:
- Religious services on the wrong day of the week
- Outdoor activities or gym scheduled at midnight or very late hours
- Business calls, bank visits, or errands on Sunday evening
- Social dinner at 6 AM, grocery shopping at 3 AM
- Any activity where the timing is obviously nonsensical for what the activity is

Tasks:
${sanityItems}

Return a JSON array of objects with "index" (number) and "reason" (string) for ONLY the tasks that have issues.
Return [] if all placements look reasonable.
IMPORTANT: Only flag truly nonsensical placements. Do NOT flag tasks just because a slightly better time exists.`;

        const sanityResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: sanityPrompt }],
            response_format: { type: 'json_object' },
            temperature: 0.1,
            max_tokens: 500,
          }),
        });

        if (sanityResponse.ok) {
          const sanityData = await sanityResponse.json();
          const sanityContent = sanityData.choices?.[0]?.message?.content;
          if (sanityContent) {
            const parsed = JSON.parse(sanityContent);
            const flagged: { index: number; reason: string }[] = Array.isArray(parsed) ? parsed : (parsed.flagged || parsed.issues || []);
            
            if (flagged.length > 0) {
              console.log(`🧠 Sanity check flagged ${flagged.length} tasks`);
              // Remove flagged items from scheduledTasks (iterate in reverse to preserve indices)
              const flaggedIndices = new Set(flagged.map(f => f.index));
              const removedTasks: typeof scheduledTasks = [];
              
              for (let i = scheduledTasks.length - 1; i >= 0; i--) {
                if (flaggedIndices.has(i)) {
                  const removed = scheduledTasks.splice(i, 1)[0];
                  const reason = flagged.find(f => f.index === i)?.reason || 'common-sense violation';
                  console.warn(`🧠 SANITY REJECT: "${tasks[removed.taskIndex]?.title}" — ${reason}`);
                  rejectedTasks.push({
                    taskId: removed.taskId,
                    taskIndex: removed.taskIndex,
                    reason: `common-sense: ${reason}`,
                    reasoning: removed.reasoning,
                  });
                }
              }
            } else {
              console.log('🧠 Sanity check: all placements look reasonable');
            }
          }
        } else {
          console.warn('🧠 Sanity check API call failed, skipping (tasks pass through):', sanityResponse.status);
        }
      } catch (sanityErr) {
        console.warn('🧠 Sanity check error (non-fatal, tasks pass through):', sanityErr);
      }
    }

    const totalTime = Date.now() - startTime;
    console.log(`✅ Batch scheduling complete in ${totalTime}ms for ${tasks.length} tasks`);

    return new Response(JSON.stringify({ 
      scheduled: scheduledTasks,
      rejected: rejectedTasks,
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
