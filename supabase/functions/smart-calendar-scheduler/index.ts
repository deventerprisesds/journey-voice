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
      existingTasks = [],
      workingMinutes = 420,
      busySlots = [],
      scheduling_context = [],
      userId,
      threadId,
      userSchedulingConfig, // NEW: User's custom config
      taskCategory,
      taskPriority
    } = await req.json();
    
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
    let searchStartDate = new Date();
    if (targetDate) {
      searchStartDate = new Date(targetDate);
    } else if (dueDate) {
      // Start searching from today, but don't go past due date
      searchStartDate = new Date();
    }
    
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
      
      // Find available slot
      const slot = findFirstAvailableSlot(
        checkDate,
        dayBusySlots,
        estimatedDuration,
        constraints.start,
        constraints.end
      );

      if (slot) {
        // Score this slot
        let score = 0;
        
        // STRONG preference for earlier days (exponential penalty)
        score -= dayOffset * dayOffset * 10;
        
        // Prefer slots within preferred time window
        const slotHour = slot.start.getHours();
        const isInPreferredWindow = 
          slotHour >= constraints.start && 
          slotHour < constraints.end;
        if (isInPreferredWindow) score += 50;
        
        // Prefer earlier times within the day
        score -= slotHour;
        
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
 * Find the first available time slot on a given day
 */
function findFirstAvailableSlot(
  date: Date,
  busySlots: BusySlot[],
  durationMinutes: number,
  startHour: number,
  endHour: number
): BusySlot | null {
  // Create time range for the day
  const dayStart = new Date(date);
  dayStart.setHours(startHour, 0, 0, 0);

  const dayEnd = new Date(date);
  dayEnd.setHours(endHour, 0, 0, 0);

  // If no busy slots, return earliest slot
  if (busySlots.length === 0) {
    const slotEnd = new Date(dayStart.getTime() + durationMinutes * 60000);
    if (slotEnd <= dayEnd) {
      return { start: dayStart, end: slotEnd };
    }
    return null;
  }

  // Check gap before first busy slot
  if (busySlots[0].start > dayStart) {
    const gapMinutes = (busySlots[0].start.getTime() - dayStart.getTime()) / 60000;
    if (gapMinutes >= durationMinutes) {
      return {
        start: dayStart,
        end: new Date(dayStart.getTime() + durationMinutes * 60000),
      };
    }
  }

  // Check gaps between busy slots
  for (let i = 0; i < busySlots.length - 1; i++) {
    const gapStart = busySlots[i].end;
    const gapEnd = busySlots[i + 1].start;
    const gapMinutes = (gapEnd.getTime() - gapStart.getTime()) / 60000;

    if (gapMinutes >= durationMinutes) {
      const slotEnd = new Date(gapStart.getTime() + durationMinutes * 60000);
      if (slotEnd <= dayEnd) {
        return { start: gapStart, end: slotEnd };
      }
    }
  }

  // Check gap after last busy slot
  const lastEnd = busySlots[busySlots.length - 1].end;
  if (lastEnd < dayEnd) {
    const gapMinutes = (dayEnd.getTime() - lastEnd.getTime()) / 60000;
    if (gapMinutes >= durationMinutes) {
      return {
        start: lastEnd,
        end: new Date(lastEnd.getTime() + durationMinutes * 60000),
      };
    }
  }

  return null;
}
