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
  estimate_minutes?: number;
  blocked_by?: string[];
  board_id: string;
  user_id: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { taskText, targetDate, existingTasks = [], workingMinutes = 420 } = await req.json();
    
    if (!taskText) {
      throw new Error('Task text is required');
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    console.log('Smart scheduling task:', taskText);

    // Step 1: Parse the task using AI
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
            content: `You are a smart calendar AI that parses tasks and determines optimal scheduling. Parse the task and return JSON with:
{
  "task": {
    "title": "clear title",
    "description": "description",
    "priority": "LOW|MEDIUM|HIGH|URGENT",
    "category": "LIFE|CAREER|VENTURES|EDUCATION",
    "estimate_minutes": number,
    "is_project_task": boolean,
    "is_one_off": boolean
  },
  "scheduling_preference": {
    "specific_time": "ISO date string or null",
    "time_of_day_preference": "morning|afternoon|evening|any",
    "urgency_level": 1-5,
    "can_split": boolean
  }
}`
          },
          { role: 'user', content: taskText }
        ],
        temperature: 0.1,
      }),
    });

    const parseData = await parseResponse.json();
    const parsedTask = JSON.parse(parseData.choices[0].message.content);

    // Step 2: Analyze workload balance
    const workloadBalance = analyzeWorkloadBalance(existingTasks);
    
    // Step 3: Find optimal time slot
    const optimalSlot = findOptimalTimeSlot(
      parsedTask,
      new Date(targetDate || new Date()),
      existingTasks,
      workloadBalance,
      workingMinutes
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
      parsedTask: parsedTask.task,
      scheduledSlot: optimalSlot,
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

function findOptimalTimeSlot(
  parsedTask: any,
  targetDate: Date,
  existingTasks: Task[],
  workloadBalance: WorkloadBalance,
  workingMinutes: number
): ScheduledTask {
  const task = parsedTask.task;
  const preference = parsedTask.scheduling_preference;
  
  // If specific time requested, try to honor it
  if (preference.specific_time) {
    const requestedTime = new Date(preference.specific_time);
    return {
      task: task as Task,
      scheduledStart: requestedTime,
      scheduledEnd: new Date(requestedTime.getTime() + (task.estimate_minutes || 60) * 60000),
      canStart: true,
      blockedByTasks: []
    };
  }

  // Find next available slot based on workload balance and preferences
  let startTime = new Date(targetDate);
  
  // Apply time preference
  if (preference.time_of_day_preference === 'morning') {
    startTime.setHours(9, 0, 0, 0);
  } else if (preference.time_of_day_preference === 'afternoon') {
    startTime.setHours(13, 0, 0, 0);
  } else if (preference.time_of_day_preference === 'evening') {
    startTime.setHours(16, 0, 0, 0);
  } else {
    // Smart placement based on workload balance
    if (task.is_project_task && workloadBalance.ongoingProjects < 300) { // <5 hours
      startTime.setHours(9, 0, 0, 0); // Morning for deep work
    } else if (task.is_one_off && workloadBalance.oneOffTasks < 120) { // <2 hours
      startTime.setHours(14, 0, 0, 0); // Afternoon for quick tasks
    } else {
      // Find next available slot
      startTime = findNextAvailableSlot(targetDate, existingTasks, task.estimate_minutes || 60);
    }
  }

  const endTime = new Date(startTime.getTime() + (task.estimate_minutes || 60) * 60000);

  return {
    task: task as Task,
    scheduledStart: startTime,
    scheduledEnd: endTime,
    canStart: true,
    blockedByTasks: []
  };
}

function findNextAvailableSlot(date: Date, existingTasks: Task[], durationMinutes: number): Date {
  const dayTasks = existingTasks
    .filter(task => task.due_date && isSameDay(new Date(task.due_date), date))
    .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime());

  let currentTime = new Date(date);
  currentTime.setHours(9, 0, 0, 0); // Start at 9 AM

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