import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
    const { taskText, targetDate, existingTasks = [], workingMinutes = 420, busySlots = [], scheduling_context = [] } = await req.json();
    
    if (!taskText) {
      throw new Error('Task text is required');
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    console.log('Smart scheduling task:', taskText);
    console.log('Scheduling context:', scheduling_context);

    // Determine task type from context or content
    let taskType = 'personal';
    
    if (scheduling_context && Array.isArray(scheduling_context)) {
      if (scheduling_context.includes('business_hours') || scheduling_context.includes('weekdays_only')) taskType = 'bank';
      if (scheduling_context.includes('commute_time')) taskType = 'commute';
      if (scheduling_context.includes('quiet_time')) taskType = 'reading';
      if (scheduling_context.includes('morning_evening')) taskType = 'exercise';
      if (scheduling_context.includes('flexible_hours')) taskType = 'errands';
    } else {
      // Fallback to text analysis
      const lowerText = taskText.toLowerCase();
      if (lowerText.includes('bank') || lowerText.includes('financial')) taskType = 'bank';
      else if (lowerText.includes('business') || lowerText.includes('venture') || lowerText.includes('investment')) taskType = 'work';
      else if (lowerText.includes('store') || lowerText.includes('shop') || lowerText.includes('grocery')) taskType = 'errands';
      else if (lowerText.includes('work') && (lowerText.includes('commute') || lowerText.includes('way to'))) taskType = 'commute';
      else if (lowerText.includes('read') || lowerText.includes('study') || lowerText.includes('learn')) taskType = 'reading';
      else if (lowerText.includes('gym') || lowerText.includes('exercise') || lowerText.includes('workout')) taskType = 'exercise';
      else if (lowerText.includes('meeting') || lowerText.includes('appointment')) taskType = 'work';
    }

    // Step 1: Parse the task using AI with enhanced context  
    let parsedTask;
    try {
      console.log('Parsing task with AI:', taskText, 'Type:', taskType);
      
      const parseResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `Analyze this task for intelligent scheduling. Consider:
              - Task type: ${taskType}
              - Current context: ${scheduling_context ? scheduling_context.join(', ') : 'none'}
              
              Return ONLY a JSON object with these exact fields:
              {"estimatedDuration": number, "timePreference": "string", "dayPreference": "string", "urgencyLevel": number}
              
              Guidelines:
              - estimatedDuration: minutes (default 60 if unclear)
              - timePreference: morning, afternoon, evening, business_hours, or flexible
              - dayPreference: weekdays, weekends, or any
              - urgencyLevel: 1-5 (5 being most urgent)`
            },
            {
              role: 'user',
              content: `Task: "${taskText}"\nContext: ${scheduling_context?.join(', ') || 'general task'}\nCategory: ${taskType || 'general'}`
            }
          ],
          temperature: 0.3,
        }),
      });

      if (!parseResponse.ok) {
        throw new Error(`OpenAI API error: ${parseResponse.status}`);
      }

      const parseData = await parseResponse.json();
      const aiContent = parseData.choices[0]?.message?.content?.trim();
      
      if (!aiContent) {
        throw new Error('Empty AI response');
      }

      // Try to extract JSON from the response
      let jsonStr = aiContent;
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      parsedTask = JSON.parse(jsonStr);
      
      // Validate and set defaults
      parsedTask = {
        estimatedDuration: typeof parsedTask.estimatedDuration === 'number' ? parsedTask.estimatedDuration : 60,
        timePreference: ['morning', 'afternoon', 'evening', 'business_hours', 'flexible'].includes(parsedTask.timePreference) ? parsedTask.timePreference : 'flexible',
        dayPreference: ['weekdays', 'weekends', 'any'].includes(parsedTask.dayPreference) ? parsedTask.dayPreference : 'any',
        urgencyLevel: typeof parsedTask.urgencyLevel === 'number' ? Math.max(1, Math.min(5, parsedTask.urgencyLevel)) : 3
      };
      
      console.log('Parsed task details:', parsedTask);

    } catch (e) {
      console.error('Failed to parse AI response:', e);
      // Fallback values based on task type and context
      const duration = taskType === 'bank' ? 30 : taskType === 'errands' ? 45 : 60;
      parsedTask = {
        estimatedDuration: duration,
        timePreference: taskType === 'bank' ? 'business_hours' : 'flexible',
        dayPreference: taskType === 'bank' ? 'weekdays' : 'any',
        urgencyLevel: 3
      };
      console.log('Using fallback task details:', parsedTask);
    }

    // Step 2: Analyze workload balance
    const workloadBalance = analyzeWorkloadBalance(existingTasks);
    
    // Step 3: Find optimal time slot using enhanced business logic
    const optimalSlot = findOptimalTimeSlotWithBusinessRules(
      taskType,
      parsedTask,
      new Date(targetDate || new Date()),
      existingTasks,
      busySlots,
      workingMinutes,
      businessRules
    );

    // Step 4: Generate AI reasoning
    const reasoningResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Explain why this time slot was chosen for the task. Be concise but informative. Consider workload balance, task type, and scheduling preferences.`
          },
          {
            role: 'user',
            content: `Task: ${parsedTask.task.title}
Scheduled time: ${optimalSlot.scheduledStart}
Workload balance: ${JSON.stringify(workloadBalance)}
Existing tasks today: ${existingTasks.filter((t: Task) => isSameDay(new Date(t.due_date || ''), optimalSlot.scheduledStart)).length}`
          }
        ],
        temperature: 0.3,
      }),
    });

    const reasoningData = await reasoningResponse.json();
    const aiReasoning = reasoningData.choices[0].message.content;

    return new Response(JSON.stringify({
      parsedTask,
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
  taskType: string,
  parsedTask: any,
  targetDate: Date,
  existingTasks: Task[],
  busySlots: any[],
  workingMinutes: number,
  rules: BusinessRules
): ScheduledTask {
  const duration = parsedTask.estimatedDuration || 60;
  let startHour = 14; // Default afternoon
  let allowedDays = [0, 1, 2, 3, 4, 5, 6]; // All days
  
  // Apply business rules based on task type
  switch (taskType) {
    case 'bank':
      startHour = rules.bankTasks.hours[0];
      allowedDays = rules.bankTasks.days;
      break;
    case 'errands':
      // Choose morning or evening based on existing schedule
      const morningSlots = existingTasks.filter(t => {
        if (!t.start_time) return false;
        const hour = new Date(t.start_time).getHours();
        return hour >= 7 && hour <= 9;
      }).length;
      const eveningSlots = existingTasks.filter(t => {
        if (!t.start_time) return false;
        const hour = new Date(t.start_time).getHours();
        return hour >= 17 && hour <= 19;
      }).length;
      startHour = morningSlots <= eveningSlots ? 7 : 17;
      allowedDays = rules.errands.days;
      break;
    case 'commute':
      // Default to morning commute
      startHour = rules.commuteTasks.hours[0][0];
      allowedDays = rules.commuteTasks.days;
      break;
    case 'reading':
      startHour = rules.readingTasks.hours[0];
      allowedDays = rules.readingTasks.days;
      break;
    case 'exercise':
      // Choose morning or evening based on preference
      const exerciseHours = rules.exerciseTasks.hours;
      startHour = exerciseHours[0][0]; // Default to morning
      allowedDays = rules.exerciseTasks.days;
      break;
    case 'work':
      startHour = rules.workTasks.hours[0];
      allowedDays = rules.workTasks.days;
      break;
    default:
      startHour = rules.personalTasks.hours[0];
      allowedDays = rules.personalTasks.days;
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