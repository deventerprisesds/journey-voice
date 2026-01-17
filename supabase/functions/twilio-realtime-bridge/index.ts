import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// G.711 μ-law encoding/decoding tables
const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

// μ-law to linear PCM decoding table (8-bit -> 16-bit)
const mulawToLinearTable: Int16Array = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  let sample = ~i;
  const sign = sample & 0x80;
  const exponent = (sample >> 4) & 0x07;
  let mantissa = sample & 0x0F;
  mantissa = (mantissa << 1) + 33;
  mantissa = mantissa << exponent;
  mantissa -= 33;
  mulawToLinearTable[i] = sign !== 0 ? -mantissa : mantissa;
}

// Linear PCM to μ-law encoding
function linearToMulaw(sample: number): number {
  const sign = sample < 0 ? 0x80 : 0;
  sample = Math.abs(sample);
  if (sample > MULAW_CLIP) sample = MULAW_CLIP;
  sample = sample + MULAW_BIAS;
  
  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1);
  
  const mantissa = (sample >> (exponent + 3)) & 0x0F;
  const mulawByte = ~(sign | (exponent << 4) | mantissa);
  return mulawByte & 0xFF;
}

// Decode μ-law audio to PCM16 (8kHz -> needs upsampling to 24kHz)
function decodeMulaw(mulawData: Uint8Array): Int16Array {
  const pcm = new Int16Array(mulawData.length);
  for (let i = 0; i < mulawData.length; i++) {
    pcm[i] = mulawToLinearTable[mulawData[i]];
  }
  return pcm;
}

// Encode PCM16 to μ-law
function encodeMulaw(pcmData: Int16Array): Uint8Array {
  const mulaw = new Uint8Array(pcmData.length);
  for (let i = 0; i < pcmData.length; i++) {
    mulaw[i] = linearToMulaw(pcmData[i]);
  }
  return mulaw;
}

// Upsample from 8kHz to 24kHz (3x) using linear interpolation
function upsample8to24(pcm8k: Int16Array): Int16Array {
  const pcm24k = new Int16Array(pcm8k.length * 3);
  for (let i = 0; i < pcm8k.length; i++) {
    const current = pcm8k[i];
    const next = i < pcm8k.length - 1 ? pcm8k[i + 1] : current;
    const idx = i * 3;
    pcm24k[idx] = current;
    pcm24k[idx + 1] = Math.round(current + (next - current) / 3);
    pcm24k[idx + 2] = Math.round(current + (2 * (next - current)) / 3);
  }
  return pcm24k;
}

// Downsample from 24kHz to 8kHz (1/3) by averaging
function downsample24to8(pcm24k: Int16Array): Int16Array {
  const pcm8k = new Int16Array(Math.floor(pcm24k.length / 3));
  for (let i = 0; i < pcm8k.length; i++) {
    const idx = i * 3;
    pcm8k[i] = Math.round((pcm24k[idx] + pcm24k[idx + 1] + pcm24k[idx + 2]) / 3);
  }
  return pcm8k;
}

// Convert Int16Array to base64
function int16ToBase64(pcmData: Int16Array): string {
  const uint8 = new Uint8Array(pcmData.buffer);
  let binary = '';
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary);
}

// Convert base64 to Int16Array
function base64ToInt16(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

// Helper: Normalize priority to database enum
function normalizePriority(priority?: string): 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' {
  if (!priority) return 'MEDIUM';
  const p = priority.toUpperCase();
  if (['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(p)) {
    return p as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  }
  return 'MEDIUM';
}

// Helper: Normalize category to database enum
function normalizeCategory(category?: string): 'LIFE' | 'CAREER' | 'VENTURES' | 'EDUCATION' {
  if (!category) return 'LIFE';
  const c = category.toLowerCase().replace(/[_\s-]+/g, '');
  
  if (c.includes('education') || c.includes('professional') || 
      c.includes('mit') || c.includes('emba') || c.includes('degree') || 
      c.includes('college') || c.includes('school') || c.includes('class') || 
      c.includes('coursework') || c.includes('learning') || c.includes('study')) {
    return 'EDUCATION';
  }
  
  if (c.includes('career') || c.includes('work') || c.includes('job')) {
    return 'CAREER';
  }
  
  if (c.includes('venture') || c.includes('startup') || c.includes('business')) {
    return 'VENTURES';
  }
  
  return 'LIFE';
}

// Full tool definitions matching generate-realtime-token.ts
const realtimeTools = [
  {
    type: "function",
    name: "get_tasks",
    description: "Retrieve tasks and chat history. Can search by time period, keywords, or status. Use this for any historical queries like 'tasks from last week' or 'what did I work on yesterday'.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query or keywords to find in tasks/messages" },
        time_filter: { type: "string", description: "Time period like 'past week', 'last month', 'yesterday', 'last 7 days'" },
        status: { type: "string", enum: ["BACKLOG", "TODO", "DOING", "DONE"], description: "Filter by task status" }
      }
    }
  },
  {
    type: "function",
    name: "get_today_tasks",
    description: "Get all tasks for today, including both scheduled and unscheduled tasks. Shows what the user has planned for today.",
    parameters: { type: "object", properties: {} }
  },
  {
    type: "function",
    name: "get_upcoming_tasks",
    description: "Get upcoming tasks for the next few days",
    parameters: { 
      type: "object", 
      properties: {
        days: { type: "number", description: "Number of days to look ahead (default 3)" }
      }
    }
  },
  {
    type: "function",
    name: "create_task",
    description: "Create a new task. Use UPPERCASE for priority (LOW, MEDIUM, HIGH, URGENT). For education/school tasks, use category 'EDUCATION'.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title" },
        description: { type: "string", description: "Task description" },
        priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"], description: "Task priority level" },
        category: { type: "string", enum: ["LIFE", "CAREER", "VENTURES", "EDUCATION"], description: "Task category" }
      },
      required: ["title"]
    }
  },
  {
    type: "function",
    name: "update_task",
    description: "Update an existing task's properties. Use UPPERCASE for priority and status.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "ID of the task to update" },
        title: { type: "string", description: "New task title" },
        description: { type: "string", description: "New task description" },
        status: { type: "string", enum: ["BACKLOG", "TODO", "DOING", "DONE"], description: "New task status" },
        priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"], description: "New task priority" },
        category: { type: "string", enum: ["LIFE", "CAREER", "VENTURES", "EDUCATION"], description: "New task category" }
      },
      required: ["task_id"]
    }
  },
  {
    type: "function",
    name: "complete_task",
    description: "Mark a task as completed",
    parameters: {
      type: "object",
      properties: {
        task_title: { type: "string", description: "Title or partial title of the task to complete" }
      },
      required: ["task_title"]
    }
  },
  {
    type: "function",
    name: "reschedule_task",
    description: "Move a task to a different date or time. Use this when user says 'move task to tomorrow', 'reschedule for next week', etc.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "ID of the task to reschedule (optional if task_title provided)" },
        task_title: { type: "string", description: "Title or partial title of the task" },
        new_date: { type: "string", description: "New date in YYYY-MM-DD format" },
        new_start_time: { type: "string", description: "New start time in HH:MM format (24-hour)" },
        reason: { type: "string", description: "Optional reason for rescheduling" }
      },
      required: ["new_date"]
    }
  },
  {
    type: "function",
    name: "schedule_task",
    description: "Schedule an unscheduled task to a specific date and time. Automatically finds optimal time slot based on category preferences if time not specified.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "ID of the task to schedule" },
        date: { type: "string", description: "Date to schedule in YYYY-MM-DD format, defaults to today" },
        start_time: { type: "string", description: "Optional start time in HH:MM format (24-hour)" },
        duration_minutes: { type: "number", description: "Duration in minutes, defaults to task estimate or 60" }
      },
      required: ["task_id"]
    }
  },
  {
    type: "function",
    name: "unschedule_task",
    description: "Remove a task from the calendar schedule. The task will remain in backlog.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "ID of the task to unschedule" }
      },
      required: ["task_id"]
    }
  },
  {
    type: "function",
    name: "end_call",
    description: "End the phone call when the user says goodbye, 'that's all', 'disconnect', 'I'm done', or similar farewell phrases.",
    parameters: { type: "object", properties: {} }
  }
];

// Execute tool calls server-side with full capabilities
async function executeTool(
  toolName: string, 
  args: Record<string, unknown>, 
  userId: string, 
  timezone: string,
  threadId?: string
): Promise<string> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const now = new Date();
  const userNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const todayStr = userNow.toISOString().split('T')[0];

  console.log(`[TOOL] Executing: ${toolName}`, args);

  switch (toolName) {
    case 'get_tasks': {
      // Handle historical task queries with time filtering
      let startDate: Date | null = null;
      const timeFilter = args.time_filter as string;
      
      if (timeFilter) {
        const tf = timeFilter.toLowerCase();
        if (tf.includes('yesterday')) {
          startDate = new Date(userNow);
          startDate.setDate(startDate.getDate() - 1);
        } else if (tf.includes('last week') || tf.includes('past week') || tf.includes('7 days')) {
          startDate = new Date(userNow);
          startDate.setDate(startDate.getDate() - 7);
        } else if (tf.includes('last month') || tf.includes('past month') || tf.includes('30 days')) {
          startDate = new Date(userNow);
          startDate.setDate(startDate.getDate() - 30);
        }
      }

      let query = supabase
        .from('tasks')
        .select('id, title, description, status, priority, category, start_time, end_time, due_date, completed_at, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(15);

      if (startDate) {
        query = query.gte('created_at', startDate.toISOString());
      }
      
      if (args.status) {
        query = query.eq('status', args.status as string);
      }

      const { data: tasks, error } = await query;

      if (error) {
        console.error('[TOOL] Error fetching tasks:', error);
        return 'I had trouble fetching your tasks.';
      }

      if (!tasks || tasks.length === 0) {
        return timeFilter 
          ? `No tasks found for ${timeFilter}.`
          : 'No tasks found matching your criteria.';
      }

      // Filter by keyword if provided
      let filteredTasks = tasks;
      if (args.query) {
        const keyword = (args.query as string).toLowerCase();
        filteredTasks = tasks.filter(t => 
          t.title.toLowerCase().includes(keyword) || 
          (t.description && t.description.toLowerCase().includes(keyword))
        );
      }

      const taskList = filteredTasks.slice(0, 5).map((t, i) => {
        const status = t.status === 'DONE' ? '✓' : '○';
        return `${status} ${t.title} (${t.priority} priority)`;
      }).join('. ');

      return `Found ${filteredTasks.length} task${filteredTasks.length > 1 ? 's' : ''}: ${taskList}`;
    }

    case 'get_today_tasks': {
      const startOfDay = `${todayStr}T00:00:00`;
      const endOfDay = `${todayStr}T23:59:59`;
      
      // Get scheduled tasks
      const { data: scheduledTasks, error: schedError } = await supabase
        .from('tasks')
        .select('id, title, description, status, priority, start_time, end_time, due_date')
        .eq('user_id', userId)
        .gte('start_time', startOfDay)
        .lte('start_time', endOfDay)
        .neq('status', 'DONE')
        .order('start_time', { ascending: true });

      // Get unscheduled tasks
      const { data: unscheduledTasks, error: unschedError } = await supabase
        .from('tasks')
        .select('id, title, description, status, priority, due_date')
        .eq('user_id', userId)
        .is('start_time', null)
        .neq('status', 'DONE')
        .order('priority', { ascending: false })
        .limit(5);

      if (schedError || unschedError) {
        console.error('[TOOL] Error fetching tasks:', schedError || unschedError);
        return 'I had trouble fetching your tasks.';
      }

      const scheduled = scheduledTasks || [];
      const unscheduled = unscheduledTasks || [];

      if (scheduled.length === 0 && unscheduled.length === 0) {
        return 'You have no tasks for today. Your schedule is clear!';
      }

      let response = '';
      
      if (scheduled.length > 0) {
        const schedList = scheduled.map((t) => {
          const time = new Date(t.start_time!).toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit',
            timeZone: timezone 
          });
          return `${t.title} at ${time}`;
        }).join('. ');
        response += `Scheduled: ${schedList}`;
      }

      if (unscheduled.length > 0) {
        const unschedList = unscheduled.slice(0, 3).map(t => t.title).join(', ');
        response += response ? `. Unscheduled: ${unschedList}` : `Unscheduled tasks: ${unschedList}`;
      }

      return response;
    }

    case 'get_upcoming_tasks': {
      const days = (args.days as number) || 3;
      const futureDate = new Date(userNow);
      futureDate.setDate(futureDate.getDate() + days);
      const futureDateStr = futureDate.toISOString().split('T')[0];
      
      const { data: tasks, error } = await supabase
        .from('tasks')
        .select('id, title, status, priority, start_time, due_date')
        .eq('user_id', userId)
        .gte('start_time', `${todayStr}T00:00:00`)
        .lte('start_time', `${futureDateStr}T23:59:59`)
        .neq('status', 'DONE')
        .order('start_time', { ascending: true });

      if (error) {
        console.error('[TOOL] Error fetching tasks:', error);
        return 'I had trouble fetching your upcoming tasks.';
      }

      if (!tasks || tasks.length === 0) {
        return `You have no scheduled tasks for the next ${days} days.`;
      }

      const taskList = tasks.slice(0, 5).map((t) => {
        const date = t.start_time ? new Date(t.start_time).toLocaleDateString('en-US', { 
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          timeZone: timezone 
        }) : 'TBD';
        return `${t.title} on ${date}`;
      }).join('. ');

      return `Upcoming tasks: ${taskList}${tasks.length > 5 ? `. And ${tasks.length - 5} more` : ''}`;
    }

    case 'create_task': {
      const { data: board } = await supabase
        .from('boards')
        .select('id')
        .eq('user_id', userId)
        .eq('is_default', true)
        .maybeSingle();

      let boardId = board?.id;

      if (!boardId) {
        // Try any board
        const { data: anyBoard } = await supabase
          .from('boards')
          .select('id')
          .eq('user_id', userId)
          .limit(1)
          .maybeSingle();
        
        boardId = anyBoard?.id;
      }

      if (!boardId) {
        return 'I could not find your task board. Please set up a default board in the app.';
      }

      const normalizedPriority = normalizePriority(args.priority as string);
      const normalizedCategory = normalizeCategory(args.category as string);
      
      // Map category to status for proper Kanban lane placement
      const status = normalizedCategory === 'EDUCATION' ? 'PROF_EDUCATION' : normalizedCategory;

      const { data: task, error } = await supabase
        .from('tasks')
        .insert({
          user_id: userId,
          board_id: boardId,
          title: args.title as string,
          description: (args.description as string) || null,
          priority: normalizedPriority,
          category: normalizedCategory,
          status
        })
        .select()
        .single();

      if (error) {
        console.error('[TOOL] Error creating task:', error);
        return 'I had trouble creating that task.';
      }

      return `Done! Created "${task.title}" with ${normalizedPriority} priority in ${normalizedCategory}`;
    }

    case 'update_task': {
      const taskId = args.task_id as string;
      if (!taskId) return 'Task ID is required to update a task.';

      const updateData: Record<string, unknown> = {};
      if (args.title) updateData.title = (args.title as string).trim();
      if (args.description !== undefined) updateData.description = args.description || null;
      if (args.priority) updateData.priority = normalizePriority(args.priority as string);
      if (args.status) updateData.status = (args.status as string).toUpperCase();
      if (args.category) updateData.category = normalizeCategory(args.category as string);

      const { data, error } = await supabase
        .from('tasks')
        .update(updateData)
        .eq('id', taskId)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        console.error('[TOOL] Error updating task:', error);
        return 'I had trouble updating that task.';
      }

      return `Updated "${data.title}" successfully`;
    }

    case 'complete_task': {
      const { data: tasks } = await supabase
        .from('tasks')
        .select('id, title')
        .eq('user_id', userId)
        .neq('status', 'DONE')
        .ilike('title', `%${args.task_title}%`)
        .limit(1);

      if (!tasks || tasks.length === 0) {
        return `I couldn't find a task matching "${args.task_title}"`;
      }

      const { error } = await supabase
        .from('tasks')
        .update({ status: 'DONE', completed_at: new Date().toISOString() })
        .eq('id', tasks[0].id);

      if (error) {
        console.error('[TOOL] Error completing task:', error);
        return 'I had trouble completing that task.';
      }

      return `Marked "${tasks[0].title}" as complete. Nice work!`;
    }

    case 'reschedule_task': {
      // Support both task_id and task_title
      let taskId = args.task_id as string;
      
      if (!taskId && args.task_title) {
        const { data: tasks } = await supabase
          .from('tasks')
          .select('id, title, start_time, end_time')
          .eq('user_id', userId)
          .neq('status', 'DONE')
          .ilike('title', `%${args.task_title}%`)
          .limit(1);
        
        if (!tasks || tasks.length === 0) {
          return `I couldn't find a task matching "${args.task_title}"`;
        }
        taskId = tasks[0].id;
      }

      if (!taskId) {
        return 'Please specify which task to reschedule.';
      }

      // Get original task for duration preservation
      const { data: originalTask } = await supabase
        .from('tasks')
        .select('id, title, start_time, end_time')
        .eq('id', taskId)
        .eq('user_id', userId)
        .single();

      if (!originalTask) {
        return 'Task not found.';
      }

      const newDate = args.new_date as string;
      let newStartTime: Date;
      let newEndTime: Date;

      if (args.new_start_time) {
        const [hours, minutes] = (args.new_start_time as string).split(':').map(Number);
        newStartTime = new Date(`${newDate}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`);
      } else if (originalTask.start_time) {
        const origTime = new Date(originalTask.start_time);
        newStartTime = new Date(`${newDate}T${String(origTime.getHours()).padStart(2, '0')}:${String(origTime.getMinutes()).padStart(2, '0')}:00`);
      } else {
        newStartTime = new Date(`${newDate}T09:00:00`);
      }

      // Preserve duration
      if (originalTask.start_time && originalTask.end_time) {
        const duration = new Date(originalTask.end_time).getTime() - new Date(originalTask.start_time).getTime();
        newEndTime = new Date(newStartTime.getTime() + duration);
      } else {
        newEndTime = new Date(newStartTime.getTime() + 60 * 60 * 1000); // 1 hour default
      }

      const { error } = await supabase
        .from('tasks')
        .update({ 
          start_time: newStartTime.toISOString(), 
          end_time: newEndTime.toISOString(),
          is_scheduled: true 
        })
        .eq('id', taskId);

      if (error) {
        console.error('[TOOL] Error rescheduling task:', error);
        return 'I had trouble rescheduling that task.';
      }

      const formattedDate = newStartTime.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        timeZone: timezone
      });

      const formattedTime = newStartTime.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: timezone
      });

      return `Rescheduled "${originalTask.title}" to ${formattedDate} at ${formattedTime}`;
    }

    case 'schedule_task': {
      const taskId = args.task_id as string;
      if (!taskId) return 'Task ID is required to schedule a task.';

      // Get the task
      const { data: task } = await supabase
        .from('tasks')
        .select('*')
        .eq('id', taskId)
        .eq('user_id', userId)
        .single();

      if (!task) return 'Task not found.';

      // Get user scheduling preferences
      const { data: prefs } = await supabase
        .from('user_scheduling_prefs')
        .select('config')
        .eq('user_id', userId)
        .maybeSingle();

      const config = prefs?.config as Record<string, unknown> || {};
      const targetDate = (args.date as string) || todayStr;

      // Get existing tasks for context
      const { data: existingTasks } = await supabase
        .from('tasks')
        .select('*')
        .eq('user_id', userId)
        .neq('status', 'DONE')
        .order('start_time', { ascending: true });

      // Call smart-calendar-scheduler
      try {
        const response = await fetch(`${supabaseUrl}/functions/v1/smart-calendar-scheduler`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            taskText: `${task.title}${task.description ? ' - ' + task.description : ''}`,
            existingTasks: existingTasks || [],
            dueDate: task.due_date || undefined,
            estimateMinutes: (args.duration_minutes as number) || task.estimate_minutes || 60,
            taskCategory: task.category,
            taskPriority: task.priority,
            userId,
            userSchedulingConfig: config,
            timezone,
            targetDate
          })
        });

        const result = await response.json();
        
        if (!result.success || !result.slot) {
          // Fallback: schedule at 9 AM
          const startTime = new Date(`${targetDate}T09:00:00`);
          const endTime = new Date(`${targetDate}T10:00:00`);
          
          await supabase
            .from('tasks')
            .update({
              start_time: startTime.toISOString(),
              end_time: endTime.toISOString(),
              is_scheduled: true
            })
            .eq('id', taskId);
          
          return `Scheduled "${task.title}" for 9 AM on ${targetDate}`;
        }

        // Update task with scheduled slot
        await supabase
          .from('tasks')
          .update({
            start_time: result.slot.start_time,
            end_time: result.slot.end_time,
            estimate_minutes: result.slot.duration_minutes,
            is_scheduled: true
          })
          .eq('id', taskId);

        const startTimeStr = new Date(result.slot.start_time).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          timeZone: timezone
        });

        return `Scheduled "${task.title}" for ${startTimeStr}`;
      } catch (e) {
        console.error('[TOOL] Smart scheduler error:', e);
        return 'I had trouble finding an optimal time slot.';
      }
    }

    case 'unschedule_task': {
      const taskId = args.task_id as string;
      if (!taskId) return 'Task ID is required.';

      const { data, error } = await supabase
        .from('tasks')
        .update({
          start_time: null,
          end_time: null,
          is_scheduled: false,
          status: 'BACKLOG'
        })
        .eq('id', taskId)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        console.error('[TOOL] Error unscheduling task:', error);
        return 'I had trouble unscheduling that task.';
      }

      return `Removed "${data.title}" from the schedule and moved to backlog`;
    }

    case 'end_call': {
      return 'ENDING_CALL';
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}

// Get or create thread for phone sessions
async function getOrCreateThread(userId: string): Promise<string> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const { data: existing } = await supabase
    .from('ai_threads')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();
  
  if (existing) {
    return existing.id;
  }
  
  const { data: newThread } = await supabase
    .from('ai_threads')
    .insert({ user_id: userId, openai_thread_id: `phone-${Date.now()}` })
    .select('id')
    .single();
  
  return newThread?.id || `temp-${Date.now()}`;
}

// Store conversation message for RAG
async function storeMessage(
  userId: string, 
  threadId: string, 
  role: 'user' | 'assistant', 
  content: string
): Promise<void> {
  if (!content || content.length < 3) return;
  
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  try {
    await supabase.from('conversation_messages').insert({
      user_id: userId,
      thread_id: threadId,
      role,
      content
    });
    console.log(`[MEMORY] Stored ${role} message: ${content.substring(0, 50)}...`);
  } catch (e) {
    console.warn('[MEMORY] Failed to store message:', e);
  }
}

// Get RAG context from past conversations
async function getRAGContext(userId: string, threadId: string): Promise<string> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/rag-context-retrieval`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'get_context',
        userInput: 'phone call context retrieval',
        userId,
        threadId,
        baseInstructions: ''
      })
    });
    
    const data = await response.json();
    
    if (data.context?.conversationContext?.length > 0) {
      const history = data.context.conversationContext
        .slice(0, 3)
        .map((c: any) => `[${c.message_type}] ${c.content}`)
        .join('\n');
      return history;
    }
  } catch (e) {
    console.warn('[RAG] Failed to get context:', e);
  }
  
  return '';
}

// Get user context from phone number or userId with robust phone lookup
async function getUserContext(
  phoneNumber?: string,
  userId?: string
): Promise<{ 
  userId: string | null; 
  timezone: string; 
  instructions: string;
  threadId: string;
  ragContext: string;
}> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  let resolvedUserId = userId || null;
  
  // Try to resolve user from phone number with multiple formats
  if (!resolvedUserId && phoneNumber) {
    // Decode URL-encoded phone number (e.g., %2B14434150606 -> +14434150606)
    const decodedPhone = decodeURIComponent(phoneNumber);
    console.log(`[BRIDGE] Looking up user for phone: ${decodedPhone}`);
    
    // Try multiple phone formats
    const digitsOnly = decodedPhone.replace(/\D/g, '');
    const phonesToTry = [
      decodedPhone,                    // Original decoded
      digitsOnly,                      // Digits only
      '+' + digitsOnly,               // +digits
      '+1' + digitsOnly.slice(-10),   // +1 + last 10 digits
    ];
    
    for (const phone of phonesToTry) {
      console.log(`[BRIDGE] Trying phone format: ${phone}`);
      const { data: profile } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('phone', phone)
        .maybeSingle();
      
      if (profile?.user_id) {
        console.log(`[BRIDGE] ✓ Found user ${profile.user_id} for phone ${phone}`);
        resolvedUserId = profile.user_id;
        break;
      }
    }
    
    // Fallback: If phone matches MY_PHONE_NUMBER secret, use default user
    if (!resolvedUserId) {
      const myPhone = Deno.env.get('MY_PHONE_NUMBER');
      const myPhoneDigits = myPhone?.replace(/\D/g, '');
      
      if (myPhone && (digitsOnly === myPhoneDigits || digitsOnly.endsWith(myPhoneDigits?.slice(-10) || ''))) {
        console.log('[BRIDGE] Phone matches MY_PHONE_NUMBER, using default user');
        
        // Get the first user with scheduling prefs (the primary user)
        const { data: prefs } = await supabase
          .from('user_scheduling_prefs')
          .select('user_id')
          .limit(1)
          .maybeSingle();
        
        if (prefs?.user_id) {
          console.log(`[BRIDGE] ✓ Using default user ${prefs.user_id} from MY_PHONE_NUMBER match`);
          resolvedUserId = prefs.user_id;
        }
      }
    }
    
    if (!resolvedUserId) {
      console.warn(`[BRIDGE] ✗ No user found for phone: ${decodedPhone}`);
    }
  }

  if (!resolvedUserId) {
    console.warn('[BRIDGE] No user resolved - phone calls will have limited functionality');
    return { 
      userId: null, 
      timezone: 'America/New_York', 
      instructions: '',
      threadId: '',
      ragContext: ''
    };
  }

  // Get or create thread
  const threadId = await getOrCreateThread(resolvedUserId);
  
  // Get RAG context from past conversations
  const ragContext = await getRAGContext(resolvedUserId, threadId);

  // Fetch full user preferences like generate-realtime-token does
  const { data: prefs } = await supabase
    .from('user_scheduling_prefs')
    .select('timezone, core_instructions, realtime_extensions, config')
    .eq('user_id', resolvedUserId)
    .maybeSingle();

  // Build full instructions combining all sources
  const coreInstructions = prefs?.core_instructions || '';
  const realtimeExtensions = prefs?.realtime_extensions || '';
  const customInstructions = (prefs?.config as any)?.customAIInstructions || '';
  
  const fullInstructions = [
    coreInstructions,
    realtimeExtensions,
    customInstructions ? `Scheduling Philosophy:\n${customInstructions}` : ''
  ].filter(Boolean).join('\n\n');

  return {
    userId: resolvedUserId,
    timezone: prefs?.timezone || 'America/New_York',
    instructions: fullInstructions,
    threadId,
    ragContext
  };
}

// Build system instructions for OpenAI with full Iris persona
function buildSystemInstructions(
  timezone: string, 
  userInstructions: string,
  ragContext?: string,
  direction?: string,
  callContext?: string
): string {
  const now = new Date();
  const userTime = now.toLocaleString('en-US', { timeZone: timezone });
  
  // Start with user's custom instructions or default Iris persona
  let instructions = userInstructions || `You are Iris Chase, a proactive executive assistant for task and schedule management. You execute requests immediately with brief confirmations and offer follow-up suggestions.

When users ask about historical information like "tasks from last week" or "what did I work on yesterday", use the get_tasks function with appropriate time_filter parameters.

Available functions:
- get_tasks: Retrieve tasks with time/keyword filtering for historical queries
- get_today_tasks: Get all tasks for today (scheduled and unscheduled)
- get_upcoming_tasks: Get tasks for the next few days
- create_task: Create new tasks with title, description, priority, and category
- update_task: Update existing task properties
- complete_task: Mark a task as completed
- reschedule_task: Move a task to a different date or time
- schedule_task: Schedule an unscheduled task (finds optimal time slot)
- unschedule_task: Remove a task from the calendar
- end_call: End the phone call when user says goodbye

Always confirm actions and provide helpful feedback.`;

  // Add current time context
  instructions += `\n\nCurrent time in user's timezone (${timezone}): ${userTime}`;

  // Add RAG context if available
  if (ragContext) {
    instructions += `\n\n--- RELEVANT CONVERSATION HISTORY ---\n${ragContext}\n\nUse this context when relevant to provide personalized responses.`;
  }

  // Add phone-specific guidelines
  instructions += `\n\n--- PHONE CALL GUIDELINES ---
- Keep responses SHORT and natural (1-2 sentences max)
- This is a phone call - be warm but efficient
- Speak conversationally, not robotically
- Use tools to get REAL task data - never make up information
- When the user says goodbye, use end_call immediately
- Confirm actions briefly: "Done", "Got it", "Created"
- Do NOT proactively call tools or fetch data unless the user asks for it

VOICE STYLE:
- Natural pauses between thoughts
- Friendly and professional tone
- Brief confirmations`;

  // Add CRITICAL direction-specific behavior
  if (direction === 'outbound') {
    instructions += `\n\n--- CRITICAL: OUTBOUND CALL ---
YOU initiated this call to the user${callContext ? ` regarding: ${callContext}` : ''}.
BEHAVIOR:
1. WAIT SILENTLY until the user speaks (they will say "hello" or similar)
2. When they greet you, respond: "Hi!" followed by ONE brief sentence explaining why you called
3. Examples:
   - "Hi! Just checking in on your schedule for today."
   - "Hi! I'm calling about ${callContext || 'your tasks'}."
4. Then WAIT for their response
5. Do NOT fetch tasks or call any tools until they ask`;
  } else {
    instructions += `\n\n--- CRITICAL: INBOUND CALL ---
The user called YOU.
BEHAVIOR:
1. You already greeted them with "Good [morning/afternoon/evening], sir."
2. Now WAIT SILENTLY for them to tell you what they need
3. Do NOT proactively offer information or fetch tasks
4. Do NOT call any tools until they ask for something
5. Respond ONLY when they speak`;
  }

  return instructions;
}

// Main WebSocket handler for Twilio Media Streams
serve(async (req) => {
  const url = new URL(req.url);
  
  // Check if this is a WebSocket upgrade request
  if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
    console.log('[BRIDGE] WebSocket upgrade request received');
    
    // Get parameters from URL
    const userIdParam = url.searchParams.get('userId') || undefined;
    const phoneParam = url.searchParams.get('phone') || undefined;
    const contextParam = url.searchParams.get('context') || '';
    const directionParam = url.searchParams.get('direction') || 'inbound';
    
    console.log('[BRIDGE] Call direction:', directionParam);
    console.log('[BRIDGE] Call context:', contextParam || '(none)');
    
    // Get user context with full Iris capabilities
    const userContext = await getUserContext(phoneParam, userIdParam);
    console.log('[BRIDGE] User context:', { 
      userId: userContext.userId, 
      timezone: userContext.timezone,
      hasInstructions: !!userContext.instructions,
      hasRAGContext: !!userContext.ragContext,
      threadId: userContext.threadId
    });
    
    // Upgrade to WebSocket
    const { socket: twilioWs, response } = Deno.upgradeWebSocket(req);
    
    let openaiWs: WebSocket | null = null;
    let streamSid: string | null = null;
    let isConnectedToOpenAI = false;
    let pendingFunctionCalls: Map<string, { name: string; args: string }> = new Map();
    let hasLoggedFirstAudio = false;
    
    // Connect to OpenAI Realtime API with robust error handling
    const connectToOpenAI = () => {
      const openaiKey = Deno.env.get('OPENAI_API_KEY');
      if (!openaiKey) {
        console.error('[BRIDGE] ✗ CRITICAL: Missing OPENAI_API_KEY secret');
        twilioWs.close();
        return;
      }
      
      console.log('[BRIDGE] Connecting to OpenAI Realtime API...');
      console.log('[BRIDGE] API Key present:', openaiKey ? `${openaiKey.substring(0, 10)}...` : 'MISSING');
      
      try {
        // CRITICAL FIX: Deno WebSocket doesn't support custom headers
        // Use subprotocols to pass API key (official OpenAI workaround for browser/Deno)
        const openaiWsUrl = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17';
        
        openaiWs = new WebSocket(openaiWsUrl, [
          'realtime',
          `openai-insecure-api-key.${openaiKey}`,
          'openai-beta.realtime-v1'
        ]);
        
        console.log('[BRIDGE] WebSocket created with subprotocol auth');
      } catch (wsError) {
        console.error('[BRIDGE] ✗ Failed to create WebSocket:', wsError);
        twilioWs.close();
        return;
      }
      
      openaiWs.onopen = () => {
        console.log('[OPENAI] ✓ Connected to Realtime API successfully');
        console.log('[OPENAI] WebSocket readyState:', openaiWs?.readyState);
        isConnectedToOpenAI = true;
      };
      
      openaiWs.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data as string);
          
          // Log all events with appropriate detail level
          if (data.type === 'error') {
            console.error('[OPENAI] ✗ API Error:', JSON.stringify(data.error, null, 2));
          } else if (data.type.includes('audio')) {
            // Don't log audio deltas to reduce noise
            if (data.type !== 'response.audio.delta' && data.type !== 'input_audio_buffer.committed') {
              console.log('[OPENAI] Event:', data.type);
            }
          } else {
            console.log('[OPENAI] Event:', data.type);
          }
          
          switch (data.type) {
            case 'session.created': {
              console.log('[OPENAI] ✓ Session created, sending configuration...');
              console.log('[OPENAI] Session ID:', data.session?.id);
              
              const sessionConfig = {
                type: 'session.update',
                session: {
                  modalities: ['text', 'audio'],
                  instructions: buildSystemInstructions(
                    userContext.timezone, 
                    userContext.instructions,
                    userContext.ragContext,
                    directionParam,
                    contextParam
                  ),
                  voice: 'alloy',
                  input_audio_format: 'pcm16',
                  output_audio_format: 'pcm16',
                  input_audio_transcription: {
                    model: 'whisper-1'
                  },
                  turn_detection: {
                    type: 'server_vad',
                    threshold: 0.2,           // Lower threshold for phone audio sensitivity
                    prefix_padding_ms: 600,   // More padding for phone latency
                    silence_duration_ms: 1000 // Shorter silence for responsiveness
                  },
                  tools: userContext.userId ? realtimeTools : [],
                  tool_choice: userContext.userId ? 'auto' : 'none',
                  temperature: 0.8
                }
              };
              
              openaiWs!.send(JSON.stringify(sessionConfig));
              console.log('[OPENAI] Session configured with', realtimeTools.length, 'tools');
              console.log('[OPENAI] Direction:', directionParam);
              
              // Direction-aware greeting behavior
              setTimeout(() => {
                const hour = new Date().getHours();
                
                if (directionParam === 'inbound') {
                  // USER CALLED IRIS - Short greeting, then wait silently
                  const greeting = hour < 12 ? 'Good morning, sir.' : 
                                   hour < 17 ? 'Good afternoon, sir.' : 
                                   'Good evening, sir.';
                  
                  console.log('[BRIDGE] Inbound call - sending greeting:', greeting);
                  
                  openaiWs!.send(JSON.stringify({
                    type: 'response.create',
                    response: { 
                      modalities: ['audio', 'text'],
                      instructions: `Say ONLY: "${greeting}" - nothing else. Then wait silently for the user to speak. Do NOT offer help or ask questions.`
                    }
                  }));
                  
                } else {
                  // IRIS CALLED USER (outbound) - Wait for user's hello, then explain why calling
                  console.log('[BRIDGE] Outbound call - waiting for user to speak first');
                  // Don't send any greeting - the system instructions tell the AI to wait
                  // and respond when the user speaks
                }
              }, 500);
              break;
            }
            
            case 'response.audio.delta': {
              if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
                const pcm24k = base64ToInt16(data.delta);
                const pcm8k = downsample24to8(pcm24k);
                const mulaw = encodeMulaw(pcm8k);
                
                twilioWs.send(JSON.stringify({
                  event: 'media',
                  streamSid: streamSid,
                  media: {
                    payload: btoa(String.fromCharCode(...mulaw))
                  }
                }));
              }
              break;
            }
            
            case 'response.function_call_arguments.delta': {
              const callId = data.call_id;
              if (!pendingFunctionCalls.has(callId)) {
                pendingFunctionCalls.set(callId, { name: '', args: '' });
              }
              const pending = pendingFunctionCalls.get(callId)!;
              pending.args += data.delta;
              break;
            }
            
            case 'response.function_call_arguments.done': {
              const callId = data.call_id;
              const functionName = data.name;
              const argsStr = data.arguments;
              
              console.log(`[OPENAI] Function call: ${functionName}(${argsStr})`);
              
              try {
                const args = JSON.parse(argsStr);
                
                if (functionName === 'end_call') {
                  console.log('[BRIDGE] End call requested');
                  
                  openaiWs!.send(JSON.stringify({
                    type: 'conversation.item.create',
                    item: {
                      type: 'function_call_output',
                      call_id: callId,
                      output: 'Call ended at user request'
                    }
                  }));
                  
                  openaiWs!.send(JSON.stringify({
                    type: 'response.create',
                    response: { 
                      modalities: ['audio', 'text'],
                      instructions: 'Say a brief goodbye and end the conversation.'
                    }
                  }));
                  
                  setTimeout(() => {
                    openaiWs?.close();
                    twilioWs.close();
                  }, 3000);
                  
                  break;
                }
                
                if (userContext.userId) {
                  const result = await executeTool(
                    functionName,
                    args,
                    userContext.userId,
                    userContext.timezone,
                    userContext.threadId
                  );
                  
                  console.log(`[TOOL] Result: ${result}`);
                  
                  openaiWs!.send(JSON.stringify({
                    type: 'conversation.item.create',
                    item: {
                      type: 'function_call_output',
                      call_id: callId,
                      output: result
                    }
                  }));
                  
                  openaiWs!.send(JSON.stringify({
                    type: 'response.create',
                    response: { modalities: ['audio', 'text'] }
                  }));
                }
              } catch (e) {
                console.error('[OPENAI] Error executing function:', e);
              }
              
              pendingFunctionCalls.delete(callId);
              break;
            }
            
            case 'input_audio_buffer.speech_started': {
              console.log('[OPENAI] User started speaking');
              if (streamSid) {
                twilioWs.send(JSON.stringify({
                  event: 'clear',
                  streamSid: streamSid
                }));
              }
              break;
            }
            
            case 'input_audio_buffer.speech_started': {
              console.log('[VAD] ✓ Speech STARTED at', new Date().toISOString());
              break;
            }
            
            case 'input_audio_buffer.speech_stopped': {
              console.log('[VAD] ✓ Speech STOPPED at', new Date().toISOString());
              break;
            }
            
            case 'response.audio_transcript.done': {
              console.log('[OPENAI] AI transcript:', data.transcript);
              // Store AI response for RAG
              if (userContext.userId && userContext.threadId && data.transcript) {
                storeMessage(userContext.userId, userContext.threadId, 'assistant', data.transcript);
              }
              break;
            }
            
            case 'conversation.item.input_audio_transcription.completed': {
              console.log('[OPENAI] User said:', data.transcript);
              // Store user message for RAG
              if (userContext.userId && userContext.threadId && data.transcript) {
                storeMessage(userContext.userId, userContext.threadId, 'user', data.transcript);
              }
              break;
            }
            
            case 'error': {
              console.error('[OPENAI] Error:', data.error);
              break;
            }
          }
        } catch (e) {
          console.error('[OPENAI] Error processing message:', e);
        }
      };
      
      openaiWs.onerror = (error: Event) => {
        console.error('[OPENAI] ✗ WebSocket error occurred');
        console.error('[OPENAI] Error type:', error.type);
        console.error('[OPENAI] WebSocket readyState:', openaiWs?.readyState);
        // Note: WebSocket error events don't contain detailed error info for security
        // Check the console for any preceding errors
      };
      
      openaiWs.onclose = (e: CloseEvent) => {
        console.log('[OPENAI] Connection closed');
        console.log('[OPENAI] Close code:', e.code);
        console.log('[OPENAI] Close reason:', e.reason || '(no reason provided)');
        console.log('[OPENAI] Was clean:', e.wasClean);
        isConnectedToOpenAI = false;
        
        // Log common close codes
        const closeCodeMeanings: Record<number, string> = {
          1000: 'Normal closure',
          1001: 'Going away',
          1002: 'Protocol error',
          1003: 'Unsupported data',
          1006: 'Abnormal closure (no close frame)',
          1007: 'Invalid payload',
          1008: 'Policy violation',
          1009: 'Message too big',
          1011: 'Server error',
          1015: 'TLS handshake failure'
        };
        if (closeCodeMeanings[e.code]) {
          console.log('[OPENAI] Close meaning:', closeCodeMeanings[e.code]);
        }
      };
    };
    
    // Handle Twilio WebSocket events
    twilioWs.onopen = () => {
      console.log('[TWILIO] WebSocket connected');
    };
    
    twilioWs.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data as string);
        
        switch (data.event) {
          case 'connected': {
            console.log('[TWILIO] Media stream connected');
            break;
          }
          
          case 'start': {
            streamSid = data.start.streamSid;
            console.log('[TWILIO] Stream started:', streamSid);
            console.log('[TWILIO] Call SID:', data.start.callSid);
            console.log('[TWILIO] Media format:', data.start.mediaFormat);
            
            connectToOpenAI();
            break;
          }
          
          case 'media': {
            if (openaiWs && isConnectedToOpenAI && openaiWs.readyState === WebSocket.OPEN) {
              // Log first audio packet to confirm we're receiving audio from Twilio
              if (!hasLoggedFirstAudio) {
                console.log('[AUDIO] ✓ First audio packet received from Twilio');
                hasLoggedFirstAudio = true;
              }
              
              const mulawBytes = Uint8Array.from(atob(data.media.payload), c => c.charCodeAt(0));
              const pcm8k = decodeMulaw(mulawBytes);
              const pcm24k = upsample8to24(pcm8k);
              const base64Audio = int16ToBase64(pcm24k);
              
              openaiWs.send(JSON.stringify({
                type: 'input_audio_buffer.append',
                audio: base64Audio
              }));
            }
            break;
          }
          
          case 'stop': {
            console.log('[TWILIO] Stream stopped');
            break;
          }
          
          case 'mark': {
            console.log('[TWILIO] Mark received:', data.mark.name);
            break;
          }
        }
      } catch (e) {
        console.error('[TWILIO] Error processing message:', e);
      }
    };
    
    twilioWs.onerror = (e) => {
      console.error('[TWILIO] WebSocket error:', e);
    };
    
    twilioWs.onclose = (e) => {
      console.log('[TWILIO] Connection closed:', e.code, e.reason);
      if (openaiWs) {
        openaiWs.close();
      }
    };
    
    return response;
  }
  
  // Handle health check endpoint
  if (url.pathname.endsWith('/health') || url.searchParams.get('action') === 'health') {
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    const myPhone = Deno.env.get('MY_PHONE_NUMBER');
    const supabaseUrlCheck = Deno.env.get('SUPABASE_URL');
    const serviceKeyCheck = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    const checks = {
      openai_key: openaiKey ? `configured (${openaiKey.substring(0, 10)}...)` : '✗ MISSING',
      my_phone: myPhone ? `configured (${myPhone.replace(/\d(?=\d{4})/g, '*')})` : '✗ MISSING',
      supabase_url: supabaseUrlCheck ? 'configured' : '✗ MISSING',
      supabase_key: serviceKeyCheck ? 'configured' : '✗ MISSING'
    };
    
    const allConfigured = openaiKey && myPhone && supabaseUrlCheck && serviceKeyCheck;
    
    console.log('[HEALTH] Configuration check:', checks);
    
    return new Response(JSON.stringify({
      status: allConfigured ? 'healthy' : 'unhealthy',
      checks,
      timestamp: new Date().toISOString(),
      message: allConfigured 
        ? 'All required secrets configured' 
        : 'Some required secrets are missing - check Supabase Edge Function secrets'
    }), {
      status: allConfigured ? 200 : 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // Non-WebSocket request - return info
  return new Response(JSON.stringify({
    name: 'twilio-realtime-bridge',
    description: 'Full Iris voice assistant over phone via Twilio Media Streams and OpenAI Realtime API',
    websocket: true,
    capabilities: [
      'Full Iris persona and instructions',
      'All task management tools (10 tools)',
      'Smart scheduling via AI',
      'RAG memory from past conversations',
      'Thread persistence',
      'Message storage for future context',
      'Robust phone number lookup with fallback'
    ],
    endpoints: {
      websocket: 'Connect via WebSocket with ?userId= or ?phone= parameters',
      health: 'GET ?action=health to check configuration'
    }
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
