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
      userId,
      threadId,
      userSchedulingConfig, // NEW: User's custom config
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
    console.log('User config received:', !!userSchedulingConfig);
    console.log('Custom AI instructions:', userSchedulingConfig?.customAIInstructions);

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
        PROF_EDUCATION: { defaultTimeWindow: 'business_hours', defaultStatus: 'PROF_EDUCATION', estimatedDuration: 90 },
        EDUCATION: { defaultTimeWindow: 'business_hours', defaultStatus: 'PROF_EDUCATION', estimatedDuration: 90 },
        VENTURES: { defaultTimeWindow: 'after_work', defaultStatus: 'VENTURES', estimatedDuration: 120 },
        LIFE: { defaultTimeWindow: 'flexible', defaultStatus: 'LIFE', estimatedDuration: 60 },
      },
    };

    // Merge user config with defaults - user values take precedence
    const config: SchedulingConfig = {
      timezone: userSchedulingConfig?.timezone || DEFAULT_CONFIG.timezone,
      timeWindows: {
        ...DEFAULT_CONFIG.timeWindows,
        ...userSchedulingConfig?.timeWindows,
      },
      workingHours: {
        ...DEFAULT_CONFIG.workingHours,
        ...userSchedulingConfig?.workingHours,
      },
      workloadBalance: {
        ...DEFAULT_CONFIG.workloadBalance,
        ...userSchedulingConfig?.workloadBalance,
      },
      categoryMappings: {
        ...DEFAULT_CONFIG.categoryMappings,
        ...userSchedulingConfig?.categoryMappings,
      },
    };
    
    console.log('🔧 User config received:', userSchedulingConfig ? 'YES' : 'NO');
    console.log('📋 Time windows being used:', JSON.stringify(config.timeWindows, null, 2));
    console.log('🌍 Timezone:', config.timezone);

    // Extract time window and status from scheduling context
    let timeWindow = 'flexible';
    let suggestedStatus = 'TODO';
    let estimatedDuration = 60;
    let preferredTimeMinutes: number | null = null;

    // Check if context specifies time window
    const timeWindowContext = scheduling_context.find((ctx: string) => ctx.startsWith('timeWindow:'));
    if (timeWindowContext) {
      timeWindow = timeWindowContext.split(':')[1];
    } else if (taskCategory && config.categoryMappings[taskCategory]) {
      // Use category mapping
      const mapping = config.categoryMappings[taskCategory];
      timeWindow = mapping.defaultTimeWindow;
      suggestedStatus = mapping.defaultStatus;
      estimatedDuration = mapping.estimatedDuration;
    }

    // Override with explicit estimate from caller if provided
    if (typeof estimateMinutes === 'number' && !Number.isNaN(estimateMinutes)) {
      estimatedDuration = estimateMinutes;
    }

    // Extract suggested time (e.g., "suggested_time:12:0" for noon)
    const suggestedTimeContext = scheduling_context?.find(c => c.startsWith('suggested_time:'));
    if (suggestedTimeContext) {
      const timeParts = suggestedTimeContext.split(':');
      const suggestedHour = parseInt(timeParts[1]);
      const suggestedMinute = parseInt(timeParts[2] || '0');
      preferredTimeMinutes = suggestedHour * 60 + suggestedMinute;
      console.log(`⏰ Preferred time: ${suggestedHour}:${suggestedMinute.toString().padStart(2, '0')} (${preferredTimeMinutes} minutes from midnight)`);
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

    // Parse target date (or use due date, or today)
    let searchStartDate = targetDate ? new Date(targetDate) : new Date();

    // Calculate max search date (don't schedule past due date if provided)
    const dueDateObj = dueDate ? new Date(dueDate) : null;
    const maxSearchDays = 7;
    
    // Collect ALL candidate slots across search window
    const candidateSlots: Array<{
      slot: BusySlot;
      dayOffset: number;
      date: Date;
      score: number;
    }> = [];
    
    // Start from current time in user's timezone
    const nowUtc = new Date();
    const nowZoned = getZonedDayParts(nowUtc, timezone);
    
    for (let dayOffset = 0; dayOffset < maxSearchDays; dayOffset++) {
      // Calculate the date in user's timezone
      const checkDateLocal = new Date(nowZoned.year, nowZoned.month, nowZoned.day + dayOffset);
      const zonedParts = getZonedDayParts(checkDateLocal, timezone);
      
      // Build UTC start/end for this day in user's timezone
      const dayStartUTC = zonedTimeToUtc(zonedParts.year, zonedParts.month, zonedParts.day, constraints.start, 0, timezone);
      const dayEndUTC = zonedTimeToUtc(zonedParts.year, zonedParts.month, zonedParts.day, constraints.end, 0, timezone);
      
      // Don't schedule past due date
      if (dueDateObj && dayStartUTC > dueDateObj) {
        console.log(`Skipping day ${dayOffset} - past due date`);
        break;
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
        preferredStartUTC = zonedTimeToUtc(zonedParts.year, zonedParts.month, zonedParts.day, prefHour, prefMinute, timezone);
      }
      
      // Find BEST available slot (in UTC)
      const slot = findBestSlotForDay(
        dayStartUTC,
        dayEndUTC,
        dayBusySlots,
        estimatedDuration,
        preferredStartUTC,
        timezone
      );

      if (slot) {
        // Score this slot
        let score = 0;
        
        // STRONG preference for earlier days (exponential penalty)
        score -= dayOffset * dayOffset * 10;
        
        // If preferred time is set, score by proximity
        if (preferredStartUTC !== null) {
          const timeDiffMinutes = Math.abs((slot.start.getTime() - preferredStartUTC.getTime()) / 60000);
          
          // STRONG preference for suggested time (exponential penalty for distance)
          score += Math.max(0, 100 - (timeDiffMinutes / 15) ** 2);
        } else {
          // No suggested time - prefer earlier times in the window
          const slotLocalParts = getZonedDayParts(slot.start, timezone);
          const slotHour = parseInt(slot.start.toLocaleTimeString('en-US', { timeZone: timezone, hour: '2-digit', hour12: false }));
          score -= slotHour;
        }
        
        // Priority boost for earlier slots (URGENT tasks get best slots)
        const priorityBonus: Record<string, number> = { 
          URGENT: 20, 
          HIGH: 10, 
          MEDIUM: 5, 
          LOW: 0 
        };
        score += priorityBonus[taskPriority] || 0;
        
        const localTimeStr = slot.start.toLocaleString('en-US', { timeZone: timezone });
        
        candidateSlots.push({
          slot,
          dayOffset,
          date: dayStartUTC,
          score
        });
        
        console.log(`Found slot on day ${dayOffset} at ${localTimeStr} (${timezone}) - score: ${score}`);
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
      console.log(`✅ Selected best slot: ${localTime} (${timezone}) = ${utcTime} (score: ${candidateSlots[0].score})`);
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
        scheduledTask: {
          start_time: scheduledSlot.start.toISOString(),
          end_time: scheduledSlot.end.toISOString(),
          estimate_minutes: estimatedDuration,
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

  // Add existing scheduled tasks that overlap this day
  existingTasks.forEach((task) => {
    if (task.start_time) {
      const taskStart = new Date(task.start_time);
      const taskEnd = task.end_time
        ? new Date(task.end_time)
        : new Date(taskStart.getTime() + (task.estimate_minutes || 60) * 60000);
      
      // Check for overlap
      if (taskStart < dayEndUTC && taskEnd > dayStartUTC) {
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
  return busySlots.sort((a, b) => a.start.getTime() - b.start.getTime());
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
  timezone: string
): BusySlot | null {

  // Find ALL available gaps (all times in UTC)
  const availableGaps: BusySlot[] = [];

  // If no busy slots, entire day is available
  if (busySlots.length === 0) {
    availableGaps.push({ start: dayStartUTC, end: dayEndUTC });
  } else {
    // Gap before first busy slot
    if (busySlots[0].start > dayStartUTC) {
      availableGaps.push({ start: dayStartUTC, end: busySlots[0].start });
    }

    // Gaps between busy slots
    for (let i = 0; i < busySlots.length - 1; i++) {
      availableGaps.push({ start: busySlots[i].end, end: busySlots[i + 1].start });
    }

    // Gap after last busy slot
    if (busySlots[busySlots.length - 1].end < dayEndUTC) {
      availableGaps.push({ start: busySlots[busySlots.length - 1].end, end: dayEndUTC });
    }
  }

  // Find candidate slots within each gap
  const candidateSlots: Array<{ slot: BusySlot; score: number }> = [];

  for (const gap of availableGaps) {
    const gapDurationMinutes = (gap.end.getTime() - gap.start.getTime()) / 60000;
    
    if (gapDurationMinutes < durationMinutes) continue; // Gap too small

    // If we have a preferred time, try to fit the slot at that time
    if (preferredStartUTC !== null) {
      const preferredEnd = new Date(preferredStartUTC.getTime() + durationMinutes * 60000);

      // Check if preferred slot fits in this gap
      if (preferredStartUTC >= gap.start && preferredEnd <= gap.end) {
        candidateSlots.push({
          slot: { start: preferredStartUTC, end: preferredEnd },
          score: 1000 // Perfect match gets highest score
        });
        continue; // Found perfect fit, skip other candidates in this gap
      }

      // Otherwise, find closest fit within gap
      let bestInGap: Date | null = null;
      let bestScore = -Infinity;

      // Try slots at 15-minute intervals
      for (let offset = 0; offset <= gapDurationMinutes - durationMinutes; offset += 15) {
        const slotStart = new Date(gap.start.getTime() + offset * 60000);
        const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60000);
        
        if (slotEnd > gap.end) break;

        const timeDiffMs = Math.abs(slotStart.getTime() - preferredStartUTC.getTime());
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
      // No preferred time - use earliest slot in gap
      candidateSlots.push({
        slot: { start: gap.start, end: new Date(gap.start.getTime() + durationMinutes * 60000) },
        score: 0
      });
    }
  }

  // Return best candidate
  if (candidateSlots.length === 0) return null;
  
  candidateSlots.sort((a, b) => b.score - a.score);
  return candidateSlots[0].slot;
}
