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

interface BusinessRules {
  bankTasks: { hours: [number, number], days: number[] };
  errands: { hours: [number, number][], days: number[] };
  commuteTasks: { hours: [number, number][], days: number[] };
  personalTasks: { hours: [number, number], days: number[] };
  workTasks: { hours: [number, number], days: number[] };
  readingTasks: { hours: [number, number], days: number[] };
  exerciseTasks: { hours: [number, number][], days: number[] };
}

interface ScheduledTask {
  task: Task;
  scheduledStart: Date;
  scheduledEnd: Date;
  canStart: boolean;
  blockedByTasks: string[];
}

interface WorkloadBalance {
  ongoingProjects: number;
  oneOffTasks: number;
  bufferTime: number;
}

const businessRules: BusinessRules = {
  bankTasks: { hours: [9, 17], days: [1, 2, 3, 4, 5] }, // 9 AM - 5 PM, Mon-Fri
  errands: { hours: [[7, 9], [17, 19]], days: [1, 2, 3, 4, 5] }, // Morning/evening, weekdays
  commuteTasks: { hours: [[7.5, 8.5], [17.5, 18.5]], days: [1, 2, 3, 4, 5] }, // Commute times
  personalTasks: { hours: [19, 22], days: [0, 1, 2, 3, 4, 5, 6] }, // Evening, any day
  workTasks: { hours: [9, 17], days: [1, 2, 3, 4, 5] }, // Business hours, weekdays
  readingTasks: { hours: [19, 22], days: [0, 1, 2, 3, 4, 5, 6] }, // Evening, any day
  exerciseTasks: { hours: [[6, 8], [18, 20]], days: [1, 2, 3, 4, 5, 6] } // Morning/evening, not Sunday
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { taskText, targetDate, existingTasks = [], workingMinutes = 420, busySlots = [], scheduling_context = [], userId, threadId } = await req.json();
    
    if (!taskText) {
      throw new Error('Task text is required');
    }

    console.log('Smart scheduling task:', taskText);
    console.log('Scheduling context:', scheduling_context);

    // Step 1: Use AI Assistant to intelligently determine category, time slot, and scheduling
    let parsedTask;
    let aiSuggestedStartHour = null;
    let suggestedCategory = 'LIFE';
    
    try {
      console.log('Calling AI Assistant for intelligent scheduling:', taskText);
      
      const assistantInstructions = `You are an intelligent task scheduler. Analyze the task and determine:
1. **Category/Swim Lane** based on these rules:
   - CAREER: Anything related to career, job, earning money, planning to earn money, being employed (work hours: 9am-5pm weekdays)
   - EDUCATION: Studies, courses, training, learning (after 6pm)
   - VENTURES: Entrepreneurial ventures, own businesses (e.g., Compass), not being full-time CTO/VP at another company (flexible: day or night)
   - LIFE: Personal tasks, family matters, shopping (cologne, weights, etc.) (after work hours)
   - Special: Gym should be 7-8am, 1pm, or 5pm

2. **Time Slot** using common sense:
   - "breakfast" = morning (8-9am)
   - "lunch" = midday (12-1pm)
   - "dinner" = evening (6-8pm)
   - "bank" = banking hours (9am-5pm weekdays)
   - "school" = business hours (9am-3pm weekdays)
   - "coffee meeting" = 10-11am or 2-3pm
   - "gym" = 7-8am, 1pm, or 5pm

3. If unclear about category or time, put in BACKLOG and don't assign specific time.

Current date context: ${targetDate || new Date().toISOString()}
Existing calendar: ${JSON.stringify(existingTasks.slice(0, 5).map(t => ({ title: t.title, start: t.start_time, category: t.category })))}

Return ONLY valid JSON with this exact structure:
{
  "category": "CAREER|EDUCATION|VENTURES|LIFE|BACKLOG",
  "preferredStartHour": number (0-23, or null if BACKLOG),
  "estimatedDuration": number (minutes),
  "reasoning": "brief explanation"
}`;

      // Call hybrid assistant API
      const assistantResponse = await fetch(`${supabaseUrl}/functions/v1/hybrid-assistant-api`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userInput: `Task to schedule: "${taskText}"\n\nPlease analyze this task and provide scheduling recommendations.`,
          userId: userId,
          threadId: threadId || 'smart-scheduler-' + Date.now(),
          assistantId: 'asst_BcZBxlx9zH8VIPvfJrhPP3EF',
          contextualInstructions: assistantInstructions
        })
      });

      if (!assistantResponse.ok) {
        throw new Error(`Assistant API error: ${assistantResponse.status}`);
      }

      const assistantData = await assistantResponse.json();
      console.log('Assistant response:', assistantData);

      if (assistantData.success && assistantData.response) {
        // Try to extract JSON from the response
        let jsonStr = assistantData.response;
        const jsonMatch = assistantData.response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonStr = jsonMatch[0];
        }

        const assistantParsed = JSON.parse(jsonStr);
        
        // Extract category
        if (['CAREER', 'EDUCATION', 'VENTURES', 'LIFE', 'BACKLOG'].includes(assistantParsed.category)) {
          suggestedCategory = assistantParsed.category;
        }
        
        // Extract preferred start hour
        if (typeof assistantParsed.preferredStartHour === 'number' && 
            assistantParsed.preferredStartHour >= 0 && 
            assistantParsed.preferredStartHour <= 23) {
          aiSuggestedStartHour = assistantParsed.preferredStartHour;
          console.log('AI Assistant suggested start hour:', aiSuggestedStartHour);
        }
        
        // Set parsed task details
        parsedTask = {
          estimatedDuration: typeof assistantParsed.estimatedDuration === 'number' ? assistantParsed.estimatedDuration : 60,
          timePreference: aiSuggestedStartHour !== null ? 'specific' : 'flexible',
          dayPreference: 'any',
          urgencyLevel: 3,
          reasoning: assistantParsed.reasoning || 'AI-determined scheduling'
        };
        
        console.log('AI Assistant parsed task:', { suggestedCategory, aiSuggestedStartHour, parsedTask });
      } else {
        throw new Error('No valid response from assistant');
      }

    } catch (e) {
      console.error('Failed to get AI Assistant response:', e);
      // Fallback to basic parsing
      parsedTask = {
        estimatedDuration: 60,
        timePreference: 'flexible',
        dayPreference: 'any',
        urgencyLevel: 3,
        reasoning: 'Fallback scheduling due to AI error'
      };
      console.log('Using fallback task details:', parsedTask);
    }

    // Step 2: Analyze workload balance
    const workloadBalance = analyzeWorkloadBalance(existingTasks);
    
    // Step 3: Find optimal time slot using AI-enhanced business logic
    const optimalSlot = findOptimalTimeSlotWithBusinessRules(
      suggestedCategory,
      parsedTask,
      new Date(targetDate || new Date()),
      existingTasks,
      busySlots,
      workingMinutes,
      businessRules,
      aiSuggestedStartHour
    );

    const aiReasoning = parsedTask.reasoning || `Task scheduled for ${optimalSlot.scheduledStart.toLocaleTimeString()} in ${suggestedCategory} category.`;

    return new Response(JSON.stringify({
      parsedTask,
      suggestedCategory,
      scheduledSlot: {
        startTime: optimalSlot.scheduledStart.toISOString(),
        endTime: optimalSlot.scheduledEnd.toISOString(),
        duration: parsedTask.estimatedDuration || 60
      },
      workloadBalance,
      aiReasoning,
      success: true
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in smart-calendar-scheduler:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

function analyzeWorkloadBalance(tasks: Task[]): WorkloadBalance {
  const today = new Date();
  const todayTasks = tasks.filter(task => 
    task.due_date && isSameDay(new Date(task.due_date), today)
  );

  const projectTasks = todayTasks.filter(task => 
    task.estimate_minutes && task.estimate_minutes > 120 // >2 hours = project task
  );
  
  const oneOffTasks = todayTasks.filter(task => 
    !task.estimate_minutes || task.estimate_minutes <= 120
  );

  const totalProjectMinutes = projectTasks.reduce((sum, task) => 
    sum + (task.estimate_minutes || 0), 0
  );
  
  const totalOneOffMinutes = oneOffTasks.reduce((sum, task) => 
    sum + (task.estimate_minutes || 60), 0
  );

  const totalUsedMinutes = totalProjectMinutes + totalOneOffMinutes;
  const bufferTime = Math.max(0, 420 - totalUsedMinutes); // 7 hours working day

  return {
    ongoingProjects: totalProjectMinutes,
    oneOffTasks: totalOneOffMinutes,
    bufferTime
  };
}

function findOptimalTimeSlotWithBusinessRules(
  category: string,
  parsedTask: any,
  targetDate: Date,
  existingTasks: Task[],
  busySlots: any[],
  workingMinutes: number,
  rules: BusinessRules,
  aiSuggestedStartHour?: number | null
): ScheduledTask {
  const duration = parsedTask.estimatedDuration || 60;
  let startHour = 14; // Default afternoon
  let allowedDays = [0, 1, 2, 3, 4, 5, 6]; // All days
  
  // Prioritize AI-suggested start hour if available
  if (aiSuggestedStartHour !== null && aiSuggestedStartHour !== undefined) {
    startHour = aiSuggestedStartHour;
    console.log('Using AI-suggested start hour:', startHour);
  } else {
    // Apply category-based rules as fallback
    switch (category) {
      case 'CAREER':
        startHour = 9; // Work hours
        allowedDays = [1, 2, 3, 4, 5]; // Weekdays
        break;
      case 'EDUCATION':
        startHour = 18; // After 6pm
        allowedDays = [0, 1, 2, 3, 4, 5, 6]; // Any day
        break;
      case 'VENTURES':
        startHour = 14; // Flexible, default afternoon
        allowedDays = [0, 1, 2, 3, 4, 5, 6]; // Any day
        break;
      case 'LIFE':
        startHour = 18; // After work
        allowedDays = [0, 1, 2, 3, 4, 5, 6]; // Any day
        break;
      case 'BACKLOG':
        // No specific time, just find next available
        startHour = 9;
        allowedDays = [0, 1, 2, 3, 4, 5, 6];
        break;
      default:
        startHour = 14;
        allowedDays = [0, 1, 2, 3, 4, 5, 6];
    }
  }
  
  // Check if target date is allowed
  const dayOfWeek = targetDate.getDay();
  if (!allowedDays.includes(dayOfWeek)) {
    // Find next allowed day
    let nextDate = new Date(targetDate);
    let attempts = 0;
    while (!allowedDays.includes(nextDate.getDay()) && attempts < 7) {
      nextDate.setDate(nextDate.getDate() + 1);
      attempts++;
    }
    targetDate = nextDate;
  }
  
  // Find available slot within business rules
  const startTime = findNextAvailableSlot(targetDate, existingTasks, duration, startHour);
  const endTime = new Date(startTime.getTime() + duration * 60000);
  
  return {
    task: {} as Task,
    scheduledStart: startTime,
    scheduledEnd: endTime,
    canStart: true,
    blockedByTasks: []
  };
}

function findNextAvailableSlot(date: Date, existingTasks: Task[], durationMinutes: number, preferredStartHour = 9): Date {
  const dayTasks = existingTasks
    .filter(task => task.due_date && isSameDay(new Date(task.due_date), date))
    .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime());

  let currentTime = new Date(date);
  currentTime.setHours(preferredStartHour, 0, 0, 0); // Start at preferred hour

  for (const task of dayTasks) {
    const taskStart = new Date(task.due_date!);
    const taskEnd = new Date(taskStart.getTime() + (task.estimate_minutes || 60) * 60000);
    
    // Check if there's enough space before this task
    if (taskStart.getTime() - currentTime.getTime() >= durationMinutes * 60000) {
      return currentTime;
    }
    
    // Move current time to after this task
    currentTime = new Date(taskEnd.getTime() + 15 * 60000); // 15-minute buffer
  }

  return currentTime;
}

function isSameDay(date1: Date, date2: Date): boolean {
  return date1.toDateString() === date2.toDateString();
}