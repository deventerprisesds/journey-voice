import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// ===== Timezone Helpers =====

/**
 * Parse a GMT offset like "GMT-4" or "GMT+05:30" into minutes
 */
function parseGmtOffsetToMinutes(gmt: string): number {
  const m = /GMT([+\-])(\d{1,2})(?::(\d{2}))?/.exec(gmt);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  const hh = parseInt(m[2] || '0', 10);
  const mm = parseInt(m[3] || '0', 10);
  return sign * (hh * 60 + mm);
}

/**
 * Get timezone offset in minutes for a UTC instant when viewed in a given IANA timezone.
 */
function getTzOffsetMinutesAt(utcInstant: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    timeZoneName: 'shortOffset',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const parts = fmt.formatToParts(utcInstant);
  const tzName = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT+0';
  return parseGmtOffsetToMinutes(tzName);
}

/**
 * Convert a local date/time in the user's timezone to the corresponding UTC Date.
 */
function zonedTimeToUtc(
  localYear: number,
  localMonth: number,
  localDay: number,
  localHour: number,
  localMinute: number,
  tz: string
): Date {
  // Start with a UTC guess of the same wall-clock components
  const utcGuessMs = Date.UTC(localYear, localMonth, localDay, localHour, localMinute, 0);
  const utcGuess = new Date(utcGuessMs);
  // Determine the offset (in minutes) for that instant in the target TZ
  const offsetMin = getTzOffsetMinutesAt(utcGuess, tz);
  // Local time = UTC + offset ⇒ UTC = Local - offset
  return new Date(utcGuessMs - offsetMin * 60000);
}

/**
 * Get day-of-week (0=Sun..6=Sat) for a UTC date in the user's timezone
 */
function getDayOfWeekInTz(utcDate: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(utcDate);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[parts] ?? 0;
}

/**
 * Get year, month, day in the user's timezone from a UTC Date
 */
function getZonedDayParts(utcDate: Date, tz: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(utcDate);
  const year = parseInt(parts.find(p => p.type === 'year')?.value || '0', 10);
  const month = parseInt(parts.find(p => p.type === 'month')?.value || '1', 10) - 1;
  const day = parseInt(parts.find(p => p.type === 'day')?.value || '1', 10);
  return { year, month, day };
}

/**
 * Safely add minutes to a Date (returns a new Date)
 */
function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60000);
}

interface Task {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  category: 'LIFE' | 'CAREER' | 'VENTURES' | 'EDUCATION';
  due_date?: string;
  start_time?: string;
  end_time?: string;
  estimate_minutes?: number;
  blocked_by?: string[];
  board_id: string;
  user_id: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
  is_scheduled?: boolean;
  scheduling_context?: string[];
}

interface TimeWindow {
  start: number;
  end: number;
  days: number[];
}

interface SchedulingConfig {
  timeWindows: {
    [key: string]: TimeWindow;
  };
  workingHours: {
    defaultStart: number;
    defaultEnd: number;
    breakMinutes: number;
    maxDailyHours: number;
  };
  workloadBalance: {
    projectToTaskRatio: number;
    oneOffTaskRatio: number;
    bufferRatio: number;
  };
  categoryMappings: {
    [category: string]: {
      defaultTimeWindow: string;
      defaultStatus: string;
      estimatedDuration: number;
      maxPerDay?: number;
    };
  };
  customAIInstructions?: string;
}

interface BusySlot {
  start: Date;
  end: Date;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      taskText,
      targetDate,
      dueDate, // optional: ISO string deadline
      existingTasks = [],
      workingMinutes = 420,
      busySlots = [],
      scheduling_context = [],
      userId, // NEW: Required for loading user config
      threadId,
      userSchedulingConfig, // DEPRECATED: Will be loaded from DB if userId provided
      taskCategory,
      taskPriority,
      estimateMinutes,
      timezone = 'UTC' // IANA timezone identifier (e.g., 'America/New_York')
    } = await req.json();
    
    console.log('🌍 Scheduling in timezone:', timezone);
    
    if (!taskText) {
      throw new Error('Task text is required');
    }

    console.log('Smart scheduling task:', taskText);
    console.log('🔧 User ID received:', userId);

    // Load user config from database if userId provided
    let loadedUserConfig = userSchedulingConfig;
    if (userId && !userSchedulingConfig) {
      try {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        const { data: configData, error: configError } = await supabase
          .from('user_scheduling_prefs')
          .select('*')
          .eq('user_id', userId)
          .single();
        
        if (!configError && configData) {
          loadedUserConfig = configData.config;
          console.log('✅ Loaded user config from database');
        }
      } catch (error) {
        console.warn('Failed to load user config, using defaults:', error);
      }
    }
    
    console.log('🔧 RAW user config:', JSON.stringify(loadedUserConfig, null, 2));

    // Define default config constants
    const DEFAULT_CONFIG: SchedulingConfig = {
      timezone: 'America/New_York',
      timeWindows: {
        morning: { start: 6, end: 9, days: [1, 2, 3, 4, 5] },
        business_hours: { start: 9, end: 17, days: [1, 2, 3, 4, 5] },
        after_work: { start: 17, end: 22, days: [1, 2, 3, 4, 5, 6] },
        evening: { start: 19, end: 22, days: [0, 1, 2, 3, 4, 5, 6] },
        flexible: { start: 9, end: 22, days: [0, 1, 2, 3, 4, 5, 6] },
        weekends: { start: 10, end: 20, days: [0, 6] },
      },
      workingHours: {
        defaultStart: 9,
        defaultEnd: 17,
        breakMinutes: 60,
        maxDailyHours: 7,
      },
      workloadBalance: { projectToTaskRatio: 0.6, oneOffTaskRatio: 0.3, bufferRatio: 0.1 },
      categoryMappings: {
        CAREER: { defaultTimeWindow: 'business_hours', defaultStatus: 'CAREER', estimatedDuration: 120 },
        PROF_EDUCATION: { defaultTimeWindow: 'after_work', defaultStatus: 'PROF_EDUCATION', estimatedDuration: 90 },
        EDUCATION: { defaultTimeWindow: 'after_work', defaultStatus: 'PROF_EDUCATION', estimatedDuration: 90 },
        VENTURES: { defaultTimeWindow: 'after_work', defaultStatus: 'VENTURES', estimatedDuration: 120 },
        LIFE: { defaultTimeWindow: 'flexible', defaultStatus: 'LIFE', estimatedDuration: 60 },
      },
    };

    // Merge user config with defaults - user values take precedence
    const config: SchedulingConfig = {
      timezone: loadedUserConfig?.timezone || DEFAULT_CONFIG.timezone,
      
      // Deep merge time windows - use custom values if they exist, otherwise defaults
      timeWindows: loadedUserConfig?.timeWindows 
        ? {
            morning: loadedUserConfig.timeWindows.morning || DEFAULT_CONFIG.timeWindows.morning,
            business_hours: loadedUserConfig.timeWindows.business_hours || DEFAULT_CONFIG.timeWindows.business_hours,
            after_work: loadedUserConfig.timeWindows.after_work || DEFAULT_CONFIG.timeWindows.after_work,
            evening: loadedUserConfig.timeWindows.evening || DEFAULT_CONFIG.timeWindows.evening,
            flexible: loadedUserConfig.timeWindows.flexible || DEFAULT_CONFIG.timeWindows.flexible,
            weekends: loadedUserConfig.timeWindows.weekends || DEFAULT_CONFIG.timeWindows.weekends,
          }
        : DEFAULT_CONFIG.timeWindows,
      
      // Deep merge working hours
      workingHours: loadedUserConfig?.workingHours 
        ? {
            defaultStart: loadedUserConfig.workingHours.defaultStart ?? DEFAULT_CONFIG.workingHours.defaultStart,
            defaultEnd: loadedUserConfig.workingHours.defaultEnd ?? DEFAULT_CONFIG.workingHours.defaultEnd,
            breakMinutes: loadedUserConfig.workingHours.breakMinutes ?? DEFAULT_CONFIG.workingHours.breakMinutes,
            maxDailyHours: loadedUserConfig.workingHours.maxDailyHours ?? DEFAULT_CONFIG.workingHours.maxDailyHours,
          }
        : DEFAULT_CONFIG.workingHours,
      
      // Deep merge workload balance
      workloadBalance: loadedUserConfig?.workloadBalance
        ? {
            projectToTaskRatio: loadedUserConfig.workloadBalance.projectToTaskRatio ?? DEFAULT_CONFIG.workloadBalance.projectToTaskRatio,
            oneOffTaskRatio: loadedUserConfig.workloadBalance.oneOffTaskRatio ?? DEFAULT_CONFIG.workloadBalance.oneOffTaskRatio,
            bufferRatio: loadedUserConfig.workloadBalance.bufferRatio ?? DEFAULT_CONFIG.workloadBalance.bufferRatio,
          }
        : DEFAULT_CONFIG.workloadBalance,
      
      // Deep merge category mappings
      categoryMappings: loadedUserConfig?.categoryMappings
        ? {
            CAREER: loadedUserConfig.categoryMappings.CAREER || DEFAULT_CONFIG.categoryMappings.CAREER,
            PROF_EDUCATION: loadedUserConfig.categoryMappings.PROF_EDUCATION || DEFAULT_CONFIG.categoryMappings.PROF_EDUCATION,
            EDUCATION: loadedUserConfig.categoryMappings.EDUCATION || DEFAULT_CONFIG.categoryMappings.EDUCATION,
            VENTURES: loadedUserConfig.categoryMappings.VENTURES || DEFAULT_CONFIG.categoryMappings.VENTURES,
            LIFE: loadedUserConfig.categoryMappings.LIFE || DEFAULT_CONFIG.categoryMappings.LIFE,
          }
        : DEFAULT_CONFIG.categoryMappings,
    };
    
    console.log('🔧 User config loaded:', loadedUserConfig ? 'YES' : 'NO');

    // ===== AI-ENHANCED TIME WINDOW DETECTION =====
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    let aiSuggestion: any = null;

    if (LOVABLE_API_KEY && userId) {
      try {
        console.log('🤖 Fetching calendar data for AI enhancement...');
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        
        // Get scheduled tasks (next 14 days)
        const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        const { data: scheduledTasks } = await supabase
          .from('tasks')
          .select('title, start_time, end_time')
          .eq('user_id', userId)
          .eq('is_scheduled', true)
          .gte('start_time', new Date().toISOString())
          .lte('start_time', futureDate.toISOString());
        
        // Get external calendar events
        const { data: calendarEvents } = await supabase
          .from('external_calendar_events')
          .select('title, start_time, end_time')
          .eq('user_id', userId)
          .gte('start_time', new Date().toISOString())
          .lte('end_time', futureDate.toISOString());
        
        const allBusySlots = [
          ...(scheduledTasks || []),
          ...(calendarEvents || [])
        ];
        
        console.log(`📅 Loaded ${allBusySlots.length} busy slots for AI context`);
        
        // Get user's custom AI instructions (will be loaded from config later)
        const customInstructions = loadedUserConfig?.customAIInstructions || '';
        
        // Build AI prompt with calendar context
        const basePrompt = customInstructions || `You are a time scheduling expert. When analyzing tasks for scheduling:

1. Consider typical timing for the activity type (meals, meetings, errands, workouts, etc.)
2. Find the NEXT AVAILABLE slot that matches natural timing patterns
3. Avoid all user's busy times
4. Respect category defaults (CAREER during business_hours, EDUCATION/VENTURES after_work, LIFE flexible)
5. If a suggested time is in the past or conflicted, propose the next logical occurrence

Return your suggestion with reasoning that explains why this time makes sense for this specific activity.`;

        const aiPrompt = `${basePrompt}

CURRENT CONTEXT:
- Current date/time (${timezone}): ${new Date().toLocaleString('en-US', { timeZone: timezone })}
- User's timezone: ${timezone}
- Task: "${taskText}"
- Category: ${taskCategory || 'unknown'}
- Priority: ${taskPriority || 'MEDIUM'}
- Estimated duration: ${estimateMinutes || estimatedDuration || 60} minutes
- Due date: ${dueDate || 'none specified'}

USER'S BUSY TIMES (avoid these):
${allBusySlots.length > 0 ? allBusySlots.map(slot => {
  const start = new Date(slot.start_time).toLocaleString('en-US', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' });
  const end = new Date(slot.end_time).toLocaleString('en-US', { timeZone: timezone, timeStyle: 'short' });
  return `- ${slot.title}: ${start} to ${end}`;
}).join('\n') : 'No conflicts'}

TYPICAL ACTIVITY TIMING PATTERNS:
Work & Meetings:
- Standup meetings: 9:00-9:30 AM
- Team sync/calls: 10:00 AM - 4:00 PM
- Work focus time: 9:00 AM - 5:00 PM

Meals:
- Breakfast: 7:00-8:00 AM
- Brunch: 10:00-11:00 AM
- Lunch: 12:00-1:00 PM (peak at 12:00 PM, NOT 4pm!)
- Dinner: 7:00-8:00 PM (NOT 9-10pm - too late!)
- Coffee meetings: 10:00-11:00 AM or 2:00-3:00 PM

Exercise:
- Morning workout: 6:30-7:30 AM
- Gym session: 5:30-6:30 PM (after work)

Errands & Appointments:
- Bank: 12:00-1:00 PM (lunch break, they close at 5pm) or 5:00-5:30 PM
- Post office: Similar to banks
- Grocery shopping: After 5:30 PM or weekends 10:00-11:00 AM
- Doctor: 9:00-10:00 AM or 12:00-1:00 PM

Social & Personal:
- Family time: 7:00-9:00 PM
- Hobbies: Weekends 2:00-4:00 PM or weekday evenings 6:00-8:00 PM

CATEGORY-SPECIFIC DEFAULTS:
${Object.entries(config.categoryMappings).map(([category, mapping]) => {
  const windowName = mapping.defaultTimeWindow;
  const window = config.timeWindows[windowName];
  const timeDesc = window ? `${window.start}:00-${window.end}:00` : windowName;
  return `- ${category}: ${windowName} (${timeDesc})`;
}).join('\n')}

INSTRUCTIONS:
1. Consider typical timing for this activity type
2. Find the NEXT AVAILABLE slot that matches the pattern
3. Avoid all listed busy times
4. If suggested time is past/busy, propose next occurrence
5. Respect category defaults (e.g., CAREER during business hours)

Return ONLY valid JSON (no markdown):
{
  "suggested_time_window": "business_hours|after_work|morning|evening|flexible|weekends",
  "ideal_hour": 12,
  "ideal_minute": 0,
  "reasoning": "brief explanation why this time makes sense",
  "flexibility": "strict|flexible"
}`;

        // Call Lovable AI
        const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              { role: 'system', content: 'You are a scheduling assistant. Return only JSON.' },
              { role: 'user', content: aiPrompt }
            ],
            temperature: 0.3,
          }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const content = aiData.choices[0]?.message?.content;
          
          // Parse AI suggestion
          const jsonMatch = content?.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            aiSuggestion = JSON.parse(jsonMatch[0]);
            console.log('🤖 AI Scheduling Suggestion:', aiSuggestion);
            console.log(`   Reasoning: ${aiSuggestion.reasoning}`);
          }
        }
      } catch (aiError) {
        console.warn('⚠️ AI enhancement failed, falling back to rules:', aiError);
      }
    }
    console.log('📋 Time windows being used:', JSON.stringify(config.timeWindows, null, 2));
    console.log('🌍 Timezone:', config.timezone);
    
    // 🔍 Log how many tasks we're considering
    console.log('📊 Tasks to consider for busy slots:', {
      existingTasksCount: existingTasks?.length || 0,
      tasksWithTimes: existingTasks?.filter(t => t.start_time && t.end_time).length || 0,
      busySlotsCount: busySlots?.length || 0
    });
    
    // 🔍 Log how many tasks we're considering
    console.log('📊 Tasks to consider for busy slots:', {
      existingTasksCount: existingTasks?.length || 0,
      tasksWithTimes: existingTasks?.filter(t => t.start_time && t.end_time).length || 0,
      busySlotsCount: busySlots?.length || 0
    });

    // Extract time window and status from scheduling context
    let timeWindow = 'flexible';
    let suggestedStatus = 'TODO';
    let estimatedDuration = 60;
    let preferredTimeMinutes: number | null = null;

    // PRIORITY 1: Use AI suggestion if available
    if (aiSuggestion) {
      timeWindow = aiSuggestion.suggested_time_window || timeWindow;
      preferredTimeMinutes = (aiSuggestion.ideal_hour * 60) + (aiSuggestion.ideal_minute || 0);
      console.log(`🤖 AI suggests: ${timeWindow} window, preferred time: ${aiSuggestion.ideal_hour}:${(aiSuggestion.ideal_minute || 0).toString().padStart(2, '0')}`);
    }
    // PRIORITY 2: Check if context specifies time window
    else if (scheduling_context.find((ctx: string) => ctx.startsWith('timeWindow:'))) {
      const timeWindowContext = scheduling_context.find((ctx: string) => ctx.startsWith('timeWindow:'));
      timeWindow = timeWindowContext!.split(':')[1];
    } 
    // PRIORITY 3: Use category mapping
    else if (taskCategory && config.categoryMappings[taskCategory]) {
      const mapping = config.categoryMappings[taskCategory];
      timeWindow = mapping.defaultTimeWindow;
      suggestedStatus = mapping.defaultStatus;
      estimatedDuration = mapping.estimatedDuration;
    }

    // Override with explicit estimate from caller if provided
    if (typeof estimateMinutes === 'number' && !Number.isNaN(estimateMinutes)) {
      estimatedDuration = estimateMinutes;
    }

    // Extract suggested time (e.g., "suggested_time:12:0" for noon) - only if AI didn't provide one
    if (preferredTimeMinutes === null) {
      const suggestedTimeContext = scheduling_context?.find(c => c.startsWith('suggested_time:'));
      if (suggestedTimeContext) {
        const timeParts = suggestedTimeContext.split(':');
        const suggestedHour = parseInt(timeParts[1]);
        const suggestedMinute = parseInt(timeParts[2] || '0');
        preferredTimeMinutes = suggestedHour * 60 + suggestedMinute;
        console.log(`⏰ Preferred time from context: ${suggestedHour}:${suggestedMinute.toString().padStart(2, '0')} (${preferredTimeMinutes} minutes from midnight)`);
      }
    }

    // Check if context specifies status
    const statusContext = scheduling_context.find((ctx: string) => ctx.startsWith('status:'));
    if (statusContext) {
      suggestedStatus = statusContext.split(':')[1];
    }

    console.log('Determined time window:', timeWindow);
    console.log('Suggested status:', suggestedStatus);

    // Get time window constraints
    const constraints = config.timeWindows[timeWindow] || config.timeWindows.flexible;

    // CRITICAL: Always start from NOW unless targetDate explicitly provided
    // This ensures we find the "next available slot" from current moment
    // dueDate is a DEADLINE, not a search start date
    let searchStartDate = targetDate ? new Date(targetDate) : new Date();
    
    console.log('🔍 Search parameters:', {
      targetDate: targetDate || 'undefined (starting from NOW)',
      dueDate: dueDate || 'undefined (no deadline)',
      searchStartDate: searchStartDate.toISOString(),
      timezone,
      willSearchFrom: 'next available slot from current moment'
    });

    // Calculate max search date (don't schedule past due date if provided)
    const dueDateObj = dueDate ? new Date(dueDate) : null;
    const maxSearchDays = 14;
    
    // Collect ALL candidate slots across search window
    const candidateSlots: Array<{
      slot: BusySlot;
      dayOffset: number;
      date: Date;
      score: number;
    }> = [];
    
// Determine base date in user's timezone from searchStartDate
const baseParts = getZonedDayParts(searchStartDate, timezone);
const now = new Date(); // Current moment for filtering past slots

// Track tasks scheduled per day per category for maxPerDay enforcement
const tasksPerDayPerCategory = new Map<string, Map<string, number>>();

// Initialize counter from existing scheduled tasks
for (const task of existingTasks) {
  if (task.start_time && task.category) {
    const taskStart = new Date(task.start_time);
    const taskParts = getZonedDayParts(taskStart, timezone);
    const dayKey = `${taskParts.year}-${taskParts.month}-${taskParts.day}`;
    
    if (!tasksPerDayPerCategory.has(dayKey)) {
      tasksPerDayPerCategory.set(dayKey, new Map());
    }
    const dayMap = tasksPerDayPerCategory.get(dayKey)!;
    dayMap.set(task.category, (dayMap.get(task.category) || 0) + 1);
  }
}

for (let dayOffset = 0; dayOffset < maxSearchDays; dayOffset++) {
  // Calculate the date in user's timezone
  const checkYear = baseParts.year;
  const checkMonth = baseParts.month;
  const checkDay = baseParts.day + dayOffset;
  const dayKey = `${checkYear}-${checkMonth}-${checkDay}`;
  
  // Check maxPerDay limit for this category
  const categoryConfig = config.categoryMappings[taskCategory];
  if (categoryConfig?.maxPerDay) {
    if (!tasksPerDayPerCategory.has(dayKey)) {
      tasksPerDayPerCategory.set(dayKey, new Map());
    }
    const dayMap = tasksPerDayPerCategory.get(dayKey)!;
    const currentCount = dayMap.get(taskCategory) || 0;
    
    if (currentCount >= categoryConfig.maxPerDay) {
      console.log(`⏭️ Day ${dayKey} already has ${currentCount} ${taskCategory} tasks (max: ${categoryConfig.maxPerDay}), trying next day`);
      continue;
    }
  }
      
      // Build UTC start/end for this day in user's timezone
      const dayStartUTC = zonedTimeToUtc(checkYear, checkMonth, checkDay, constraints.start, 0, timezone);
      const dayEndUTC = zonedTimeToUtc(checkYear, checkMonth, checkDay, constraints.end, 0, timezone);
      
      // CRITICAL: Skip if this entire day is in the past
      if (dayEndUTC <= now) {
        console.log(`Skipping day ${dayOffset} - entire day is in the past`);
        continue;
      }
      
      // Only enforce due date if it's in the future relative to now
      const enforceDueDate = !!dueDateObj && dueDateObj.getTime() >= now.getTime();
      if (enforceDueDate && dayStartUTC > dueDateObj) {
        console.log(`⏭️ Skipping day ${dayOffset} - beyond future due date ${dueDateObj.toISOString()}`);
        break;
      }
      // If due date is already in the past, do NOT restrict search; log it once
      if (!!dueDateObj && dueDateObj.getTime() < now.getTime() && dayOffset === 0) {
        console.log(`⚠️ Due date ${dueDateObj.toISOString()} is in the past – ignoring due-date limit and scheduling forward`);
      }
      
      // Check if day is allowed in user's timezone
      const dayOfWeek = getDayOfWeekInTz(dayStartUTC, timezone);
      if (!constraints.days.includes(dayOfWeek)) {
        console.log(`Day ${dayOfWeek} not allowed for time window ${timeWindow}, skipping`);
        continue;
      }

      // Get all busy slots for this day (in UTC)
      const dayBusySlots = getAllBusySlotsForDay(dayStartUTC, dayEndUTC, existingTasks, busySlots);
      
      // Build preferred start time in UTC if specified
      let preferredStartUTC: Date | null = null;
      if (preferredTimeMinutes !== null) {
        const prefHour = Math.floor(preferredTimeMinutes / 60);
        const prefMinute = preferredTimeMinutes % 60;
        preferredStartUTC = zonedTimeToUtc(checkYear, checkMonth, checkDay, prefHour, prefMinute, timezone);
      }
      
      // Find BEST available slot (in UTC)
      const slot = findBestSlotForDay(
        dayStartUTC,
        dayEndUTC,
        dayBusySlots,
        estimatedDuration,
        preferredStartUTC,
        timezone,
        constraints
      );

      if (slot) {
        // Score this slot
        let score = 0;
        
        // NEW SCORING LOGIC: Respect time windows for time-sensitive tasks
        if (preferredStartUTC !== null) {
          // For tasks with preferred times (e.g., lunch at 12 PM), prioritize TIME over DAY
          const timeDiffMinutes = Math.abs((slot.start.getTime() - preferredStartUTC.getTime()) / 60000);
          
          // STRONG time match bonus (200 points for exact, degrades with distance)
          score += Math.max(0, 200 - timeDiffMinutes * 5);
          
          // MODERATE day penalty (prefer sooner but don't override good time matches)
          score -= dayOffset * 15;
        } else {
          // No preferred time - use "sooner is better" logic within appropriate window
          score -= dayOffset * dayOffset * 30;
          
          // Prefer earlier times in the window
          const slotHour = parseInt(slot.start.toLocaleTimeString('en-US', { timeZone: timezone, hour: '2-digit', hour12: false }));
          score -= slotHour;
        }
        
        // Priority boost for earlier slots (URGENT tasks get best slots)
        const priorityBonus: Record<string, number> = { 
          URGENT: 50, 
          HIGH: 30, 
          MEDIUM: 10, 
          LOW: 0 
        };
        score += priorityBonus[taskPriority] || 0;
        
        const localTimeStr = slot.start.toLocaleString('en-US', { timeZone: timezone });
        
        // 🔍 Check if this slot overlaps with any existing busy slot
        const slotEnd = addMinutes(slot.start, estimatedDuration);
        const allBusySlots = getAllBusySlotsForDay(dayStartUTC, dayEndUTC, existingTasks, busySlots);
        const hasOverlap = allBusySlots.some(busy => {
          return slot.start < busy.end && slotEnd > busy.start;
        });
        
        if (hasOverlap) {
          console.log(`⚠️ Slot on day ${dayOffset} at ${localTimeStr} overlaps with existing task, skipping`);
        } else {
          candidateSlots.push({
            slot,
            dayOffset,
            date: dayStartUTC,
            score
          });
          
          // Update counter for maxPerDay enforcement
          const categoryConfig = config.categoryMappings[taskCategory];
          if (categoryConfig?.maxPerDay) {
            if (!tasksPerDayPerCategory.has(dayKey)) {
              tasksPerDayPerCategory.set(dayKey, new Map());
            }
            const dayMap = tasksPerDayPerCategory.get(dayKey)!;
            dayMap.set(taskCategory, (dayMap.get(taskCategory) || 0) + 1);
          }
          
          console.log(`✅ Found valid slot on day ${dayOffset} at ${localTimeStr} (${timezone}) - score: ${score}`);
        }
      } else {
        console.log(`No slot found on day ${dayOffset}, trying next day`);
      }
    }
    
    // Sort by score (highest first) and pick best
    candidateSlots.sort((a, b) => b.score - a.score);
    const scheduledSlot = candidateSlots.length > 0 ? candidateSlots[0].slot : null;
    
    if (scheduledSlot && candidateSlots.length > 0) {
      const localTime = scheduledSlot.start.toLocaleString('en-US', { timeZone: timezone });
      const utcTime = scheduledSlot.start.toISOString();
      const slotEnd = addMinutes(scheduledSlot.start, estimatedDuration);
      console.log(`✅ FINAL SELECTED SLOT:`, {
        start: utcTime,
        end: slotEnd.toISOString(),
        localStart: localTime,
        score: candidateSlots[0].score,
        duration: estimatedDuration
      });
    }

    if (!scheduledSlot) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No available time slots found in the next 7 days',
          suggestedCategory: taskCategory,
          suggestedStatus: suggestedStatus,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Return successful schedule
    return new Response(
      JSON.stringify({
        success: true,
        scheduledSlot: {
          startTime: scheduledSlot.start.toISOString(),
          endTime: scheduledSlot.end.toISOString(),
          estimateMinutes: estimatedDuration,
        },
        suggestedCategory: taskCategory,
        suggestedStatus: suggestedStatus,
        timeWindow: timeWindow,
        reasoning: `Scheduled in ${timeWindow} time window on ${scheduledSlot.start.toLocaleDateString()} based on category ${taskCategory}`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Scheduling error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

/**
 * Get all busy slots that overlap with the given day range (in UTC)
 */
function getAllBusySlotsForDay(
  dayStartUTC: Date,
  dayEndUTC: Date,
  existingTasks: Task[],
  externalBusySlots: any[]
): BusySlot[] {
  const busySlots: BusySlot[] = [];
  
  console.log(`🔍 Checking busy slots for ${dayStartUTC.toISOString().split('T')[0]}:`, {
    totalTasks: existingTasks.length,
    tasksWithTimes: existingTasks.filter(t => t.start_time).length,
    externalSlots: externalBusySlots.length
  });

  // Add existing scheduled tasks that overlap this day
  existingTasks.forEach((task) => {
    if (task.start_time) {
      const taskStart = new Date(task.start_time);
      const taskEnd = task.end_time
        ? new Date(task.end_time)
        : new Date(taskStart.getTime() + (task.estimate_minutes || 60) * 60000);
      
      // Check for overlap
      if (taskStart < dayEndUTC && taskEnd > dayStartUTC) {
        console.log(`  ✅ Task "${task.title}" occupies ${taskStart.toISOString()} - ${taskEnd.toISOString()}`);
        busySlots.push({ start: taskStart, end: taskEnd });
      }
    }
  });

  // Add external calendar busy slots that overlap this day
  externalBusySlots.forEach((slot) => {
    const slotStart = new Date(slot.start);
    const slotEnd = new Date(slot.end);
    
    // Check for overlap
    if (slotStart < dayEndUTC && slotEnd > dayStartUTC) {
      busySlots.push({ start: slotStart, end: slotEnd });
    }
  });

  // Sort by start time
  const sorted = busySlots.sort((a, b) => a.start.getTime() - b.start.getTime());
  console.log(`  📋 Total busy slots found: ${sorted.length}`);
  
  return sorted;
}

/**
 * Find the BEST available time slot within a UTC day range, preferring slots near preferredStartUTC
 */
function findBestSlotForDay(
  dayStartUTC: Date,
  dayEndUTC: Date,
  busySlots: BusySlot[],
  durationMinutes: number,
  preferredStartUTC: Date | null,
  timezone: string,
  timeWindowConstraints?: TimeWindow
): BusySlot | null {

  // CRITICAL: Get current time to filter past slots
  const now = new Date();
  
  // Find ALL available gaps (all times in UTC)
  const availableGaps: BusySlot[] = [];

  // If no busy slots, entire day is available (but filtered for past times)
  if (busySlots.length === 0) {
    const gapStart = dayStartUTC > now ? dayStartUTC : now;
    if (gapStart < dayEndUTC) {
      availableGaps.push({ start: gapStart, end: dayEndUTC });
    }
  } else {
    // Gap before first busy slot (filtered for past times)
    if (busySlots[0].start > dayStartUTC) {
      const gapStart = dayStartUTC > now ? dayStartUTC : now;
      if (gapStart < busySlots[0].start) {
        availableGaps.push({ start: gapStart, end: busySlots[0].start });
      }
    }

    // Gaps between busy slots (filtered for past times)
    for (let i = 0; i < busySlots.length - 1; i++) {
      const gapStart = busySlots[i].end > now ? busySlots[i].end : now;
      if (gapStart < busySlots[i + 1].start) {
        availableGaps.push({ start: gapStart, end: busySlots[i + 1].start });
      }
    }

    // Gap after last busy slot (filtered for past times)
    if (busySlots[busySlots.length - 1].end < dayEndUTC) {
      const gapStart = busySlots[busySlots.length - 1].end > now ? busySlots[busySlots.length - 1].end : now;
      if (gapStart < dayEndUTC) {
        availableGaps.push({ start: gapStart, end: dayEndUTC });
      }
    }
  }

  // Helper function to snap a date to nearest :00 or :30
  const snapToHalfHour = (date: Date): Date => {
    const snapped = new Date(date);
    const minutes = snapped.getMinutes();
    
    // Round to nearest 0 or 30
    if (minutes < 15) {
      snapped.setMinutes(0, 0, 0);
    } else if (minutes < 45) {
      snapped.setMinutes(30, 0, 0);
    } else {
      snapped.setMinutes(0, 0, 0);
      snapped.setHours(snapped.getHours() + 1);
    }
    
    return snapped;
  };

  // Find candidate slots within each gap
  const candidateSlots: Array<{ slot: BusySlot; score: number }> = [];

  for (const gap of availableGaps) {
    // Filter gap to only include time window hours if constraints provided
    let constrainedGap = gap;
    
    if (timeWindowConstraints) {
      const gapStartHour = parseInt(gap.start.toLocaleTimeString('en-US', { 
        timeZone: timezone, 
        hour: '2-digit', 
        hour12: false 
      }));
      const gapEndHour = parseInt(gap.end.toLocaleTimeString('en-US', { 
        timeZone: timezone, 
        hour: '2-digit', 
        hour12: false 
      }));
      
      // Skip gap if completely outside time window
      if (gapEndHour <= timeWindowConstraints.start || gapStartHour >= timeWindowConstraints.end) {
        continue;
      }
      
      // Constrain gap to time window boundaries
      const dayParts = getZonedDayParts(gap.start, timezone);
      const windowStart = zonedTimeToUtc(dayParts.year, dayParts.month, dayParts.day, timeWindowConstraints.start, 0, timezone);
      const windowEnd = zonedTimeToUtc(dayParts.year, dayParts.month, dayParts.day, timeWindowConstraints.end, 0, timezone);
      
      constrainedGap = {
        start: gap.start > windowStart ? gap.start : windowStart,
        end: gap.end < windowEnd ? gap.end : windowEnd
      };
    }
    
    const gapDurationMinutes = (constrainedGap.end.getTime() - constrainedGap.start.getTime()) / 60000;
    
    if (gapDurationMinutes < durationMinutes) continue; // Gap too small

    // Snap gap start to next :00 or :30
    const snappedGapStart = snapToHalfHour(constrainedGap.start);
    
    // If snapped start is past gap end, skip this gap
    if (snappedGapStart >= constrainedGap.end) continue;

    // If we have a preferred time, try to fit the slot at that time
    if (preferredStartUTC !== null) {
      // Snap preferred time to nearest :00 or :30
      const snappedPreferred = snapToHalfHour(preferredStartUTC);
      const preferredEnd = new Date(snappedPreferred.getTime() + durationMinutes * 60000);

      // Check if snapped preferred slot fits in this gap
      if (snappedPreferred >= constrainedGap.start && preferredEnd <= constrainedGap.end) {
        candidateSlots.push({
          slot: { start: snappedPreferred, end: preferredEnd },
          score: 1000 // Perfect match gets highest score
        });
        continue; // Found perfect fit, skip other candidates in this gap
      }

      // Otherwise, find closest fit within gap (only at :00 or :30)
      let bestInGap: Date | null = null;
      let bestScore = -Infinity;

      // Try slots at 30-minute intervals (ensuring :00 or :30)
      for (let offset = 0; offset <= gapDurationMinutes - durationMinutes; offset += 30) {
        const slotStart = new Date(snappedGapStart.getTime() + offset * 60000);
        const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60000);
        
        if (slotEnd > constrainedGap.end) break;

        const timeDiffMs = Math.abs(slotStart.getTime() - snappedPreferred.getTime());
        const score = 500 - (timeDiffMs / 60000); // Score decreases with distance from preferred

        if (score > bestScore) {
          bestScore = score;
          bestInGap = slotStart;
        }
      }

      if (bestInGap) {
        candidateSlots.push({
          slot: { start: bestInGap, end: new Date(bestInGap.getTime() + durationMinutes * 60000) },
          score: bestScore
        });
      }
    } else {
      // No preferred time - use earliest :00 or :30 slot in gap
      candidateSlots.push({
        slot: { start: snappedGapStart, end: new Date(snappedGapStart.getTime() + durationMinutes * 60000) },
        score: 0
      });
    }
  }

  // Return best candidate
  if (candidateSlots.length === 0) return null;
  
  candidateSlots.sort((a, b) => b.score - a.score);
  return candidateSlots[0].slot;
}
