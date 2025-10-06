import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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
      timezone, // IANA timezone identifier (e.g., 'America/New_York')
      tzOffsetMinutes = 0 // Browser timezone offset (e.g., 240 for ET = UTC-4)
    } = await req.json();
    
    console.log('🌍 Scheduling in timezone:', timezone ?? 'UTC', '(offset:', tzOffsetMinutes, 'minutes)');
    
    if (!taskText) {
      throw new Error('Task text is required');
    }

    console.log('Smart scheduling task:', taskText);
    console.log('User config received:', !!userSchedulingConfig);
    console.log('Custom AI instructions:', userSchedulingConfig?.customAIInstructions);

    // Use user config or fallback to defaults
    const config: SchedulingConfig = userSchedulingConfig || {
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
      workloadBalance: {
        projectToTaskRatio: 0.6,
        oneOffTaskRatio: 0.3,
        bufferRatio: 0.1,
      },
      categoryMappings: {
        CAREER: { defaultTimeWindow: 'business_hours', defaultStatus: 'CAREER', estimatedDuration: 120 },
        EDUCATION: { defaultTimeWindow: 'business_hours', defaultStatus: 'PROF_EDUCATION', estimatedDuration: 90 },
        VENTURES: { defaultTimeWindow: 'after_work', defaultStatus: 'VENTURES', estimatedDuration: 120 },
        LIFE: { defaultTimeWindow: 'flexible', defaultStatus: 'LIFE', estimatedDuration: 60 },
      },
    };

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
    
    for (let dayOffset = 0; dayOffset < maxSearchDays; dayOffset++) {
      const checkDate = new Date(searchStartDate);
      checkDate.setDate(checkDate.getDate() + dayOffset);
      
      // Don't schedule past due date
      if (dueDateObj && checkDate > dueDateObj) {
        console.log(`Skipping ${checkDate.toDateString()} - past due date ${dueDateObj.toDateString()}`);
        break;
      }
      
      // Check if day is allowed
      const dayOfWeek = checkDate.getDay();
      if (!constraints.days.includes(dayOfWeek)) {
        console.log(`Day ${dayOfWeek} not allowed for time window ${timeWindow}, skipping`);
        continue;
      }

      // Get all busy slots for this day
      const dayBusySlots = getAllBusySlotsForDay(checkDate, existingTasks, busySlots);
      
      // Find BEST available slot (closest to preferred time if specified)
      const slot = findBestSlotForDay(
        checkDate,
        dayBusySlots,
        estimatedDuration,
        constraints.start,
        constraints.end,
        preferredTimeMinutes,
        tzOffsetMinutes
      );

      if (slot) {
        // Score this slot
        let score = 0;
        
        // STRONG preference for earlier days (exponential penalty)
        score -= dayOffset * dayOffset * 10;
        
        // If preferred time is set, score by proximity
        if (preferredTimeMinutes !== null) {
          const slotTimeMinutes = slot.start.getHours() * 60 + slot.start.getMinutes();
          const timeDiffMinutes = Math.abs(slotTimeMinutes - preferredTimeMinutes);
          
          // STRONG preference for suggested time (exponential penalty for distance)
          score += Math.max(0, 100 - (timeDiffMinutes / 15) ** 2);
        } else {
          // No suggested time - use default time window preferences
          const slotHour = slot.start.getHours();
          const isInPreferredWindow = 
            slotHour >= constraints.start && 
            slotHour < constraints.end;
          if (isInPreferredWindow) score += 50;
          
          // Prefer earlier times within the day
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
        
        candidateSlots.push({
          slot,
          dayOffset,
          date: checkDate,
          score
        });
        
        console.log(`Found slot on ${checkDate.toDateString()} at ${slot.start.toLocaleTimeString()} - score: ${score}`);
      } else {
        console.log(`No slot found on ${checkDate.toDateString()}, trying next day`);
      }
    }
    
    // Sort by score (highest first) and pick best
    candidateSlots.sort((a, b) => b.score - a.score);
    const scheduledSlot = candidateSlots.length > 0 ? candidateSlots[0].slot : null;
    
    if (scheduledSlot && candidateSlots.length > 0) {
      console.log(`Selected best slot: ${scheduledSlot.start.toLocaleString()} (score: ${candidateSlots[0].score})`);
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
 * Get all busy slots for a specific day
 */
function getAllBusySlotsForDay(
  date: Date,
  existingTasks: Task[],
  externalBusySlots: any[]
): BusySlot[] {
  const dateStr = date.toDateString();
  const busySlots: BusySlot[] = [];

  // Add existing scheduled tasks
  existingTasks.forEach((task) => {
    if (task.start_time) {
      const taskStart = new Date(task.start_time);
      if (taskStart.toDateString() === dateStr) {
        const taskEnd = task.end_time
          ? new Date(task.end_time)
          : new Date(taskStart.getTime() + (task.estimate_minutes || 60) * 60000);
        busySlots.push({ start: taskStart, end: taskEnd });
      }
    }
  });

  // Add external calendar busy slots
  externalBusySlots.forEach((slot) => {
    const slotStart = new Date(slot.start);
    if (slotStart.toDateString() === dateStr) {
      busySlots.push({
        start: slotStart,
        end: new Date(slot.end),
      });
    }
  });

  // Sort by start time
  return busySlots.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Find the BEST available time slot on a given day, preferring slots near preferredTimeMinutes
 */
function findBestSlotForDay(
  date: Date,
  busySlots: BusySlot[],
  durationMinutes: number,
  startHour: number,
  endHour: number,
  preferredTimeMinutes: number | null,
  tzOffsetMinutes: number
): BusySlot | null {
  // Work in local time by adjusting UTC dates
  const localOffset = -tzOffsetMinutes; // Convert browser offset to UTC adjustment
  
  // Create time range for the day in LOCAL time
  const dayStart = new Date(date);
  dayStart.setHours(startHour, 0, 0, 0);
  
  const dayEnd = new Date(date);
  dayEnd.setHours(endHour, 0, 0, 0);

  // Find ALL available gaps
  const availableGaps: BusySlot[] = [];

  // If no busy slots, entire day is available
  if (busySlots.length === 0) {
    availableGaps.push({ start: dayStart, end: dayEnd });
  } else {
    // Gap before first busy slot
    if (busySlots[0].start > dayStart) {
      availableGaps.push({ start: dayStart, end: busySlots[0].start });
    }

    // Gaps between busy slots
    for (let i = 0; i < busySlots.length - 1; i++) {
      availableGaps.push({ start: busySlots[i].end, end: busySlots[i + 1].start });
    }

    // Gap after last busy slot
    if (busySlots[busySlots.length - 1].end < dayEnd) {
      availableGaps.push({ start: busySlots[busySlots.length - 1].end, end: dayEnd });
    }
  }

  // Find candidate slots within each gap
  const candidateSlots: Array<{ slot: BusySlot; score: number }> = [];

  for (const gap of availableGaps) {
    const gapDurationMinutes = (gap.end.getTime() - gap.start.getTime()) / 60000;
    
    if (gapDurationMinutes < durationMinutes) continue; // Gap too small

    // If we have a preferred time, try to fit the slot centered around it
    if (preferredTimeMinutes !== null) {
      const preferredStart = new Date(date);
      const preferredHour = Math.floor(preferredTimeMinutes / 60);
      const preferredMinute = preferredTimeMinutes % 60;
      preferredStart.setHours(preferredHour, preferredMinute, 0, 0);

      const preferredEnd = new Date(preferredStart.getTime() + durationMinutes * 60000);

      // Check if preferred slot fits in this gap
      if (preferredStart >= gap.start && preferredEnd <= gap.end) {
        const slotTimeMinutes = preferredStart.getHours() * 60 + preferredStart.getMinutes();
        const timeDiff = Math.abs(slotTimeMinutes - preferredTimeMinutes);
        candidateSlots.push({
          slot: { start: preferredStart, end: preferredEnd },
          score: 1000 - timeDiff // Perfect match gets highest score
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

        const slotTimeMinutes = slotStart.getHours() * 60 + slotStart.getMinutes();
        const timeDiff = Math.abs(slotTimeMinutes - preferredTimeMinutes);
        const score = 500 - timeDiff;

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
