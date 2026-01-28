/**
 * BACKUP: Local tool implementations from RealtimeVoiceAssistant.ts
 * 
 * Created: 2026-01-28
 * Reason: Migrating to centralized execute-tool edge function
 * 
 * This file preserves all the original tool methods in case rollback is needed.
 * DO NOT DELETE - reference for debugging or rollback.
 * 
 * Original file: src/utils/RealtimeVoiceAssistant.ts
 * Lines preserved: 1053-1867
 */

import { supabase } from '@/integrations/supabase/client';

// ============================================================================
// HELPER METHODS
// ============================================================================

export function normalizePriority(priority?: string): 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' {
  if (!priority) return 'MEDIUM';
  const p = priority.toUpperCase();
  if (['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(p)) {
    return p as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  }
  return 'MEDIUM';
}

export function normalizeCategory(category?: string): 'LIFE' | 'CAREER' | 'VENTURES' | 'EDUCATION' {
  if (!category) return 'LIFE';
  const c = category.toLowerCase().replace(/[_\\s-]+/g, '');
  
  // Education-related terms
  if (c.includes('education') || c.includes('professional') || 
      c.includes('mit') || c.includes('emba') || c.includes('degree') || 
      c.includes('college') || c.includes('school') || c.includes('class') || 
      c.includes('coursework') || c.includes('learning') || c.includes('study')) {
    return 'EDUCATION';
  }
  
  // Career-related terms
  if (c.includes('career') || c.includes('work') || c.includes('job')) {
    return 'CAREER';
  }
  
  // Ventures-related terms
  if (c.includes('venture') || c.includes('startup') || c.includes('business')) {
    return 'VENTURES';
  }
  
  return 'LIFE';
}

// ============================================================================
// TASK MANAGEMENT TOOLS
// ============================================================================

export async function createTask(
  args: any,
  onMessage?: (msg: any) => void
) {
  try {
    onMessage?.({ type: 'client.processing', status: 'Creating task...' });

    const userId = (await supabase.auth.getUser()).data.user?.id;
    if (!userId) {
      onMessage?.({ 
        type: 'client.error', 
        message: 'Please log in to create tasks' 
      });
      return { 
        success: false, 
        error: 'Please log in to create tasks',
        message: 'You need to be logged in to create tasks'
      };
    }

    // Validate title
    const title = args.title?.trim();
    if (!title) {
      onMessage?.({ 
        type: 'client.error', 
        message: 'Task title is required' 
      });
      return { 
        success: false, 
        error: 'Task title is required',
        message: 'Please provide a title for the task'
      };
    }

    console.log('Looking for user boards...');

    // First try to find user's default board
    let { data: defaultBoard, error } = await supabase
      .from('boards')
      .select('id, name')
      .eq('user_id', userId)
      .eq('is_default', true)
      .maybeSingle();

    if (error) {
      console.error('Error finding default board:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    // If no default board, find any user board
    if (!defaultBoard) {
      console.log('No default board found, looking for any user board...');
      
      const { data: anyBoard, error: anyBoardError } = await supabase
        .from('boards')
        .select('id, name')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();

      if (anyBoardError) {
        console.error('Error finding any board:', anyBoardError);
        throw new Error(`Database error: ${anyBoardError.message}`);
      }

      if (anyBoard) {
        console.log('Found existing board:', anyBoard.name);
        defaultBoard = anyBoard;
      }
    } else {
      console.log('Found default board:', defaultBoard.name);
    }

    // Only create a new board if user has no boards at all
    if (!defaultBoard) {
      console.log('No boards found for user, creating new default board...');
      
      const { data: newBoard, error: createError } = await supabase
        .from('boards')
        .insert({
          name: 'My Tasks',
          description: 'Default task board',
          is_default: true,
          user_id: userId
        })
        .select('id, name')
        .single();

      if (createError) {
        console.error('Failed to create board:', createError);
        throw new Error(`Failed to create default board: ${createError.message}`);
      }

      defaultBoard = newBoard;
      console.log('Created default board:', defaultBoard.name);

      // Create default columns for the new board
      const defaultColumns = [
        { name: 'Backlog', status: 'BACKLOG' as const, position: 0 },
        { name: 'To Do', status: 'TODO' as const, position: 1 },
        { name: 'Doing', status: 'DOING' as const, position: 2 },
        { name: 'Done', status: 'DONE' as const, position: 3 }
      ];

      const { error: columnsError } = await supabase
        .from('columns')
        .insert(
          defaultColumns.map(col => ({
            ...col,
            board_id: defaultBoard.id
          }))
        );

      if (columnsError) {
        console.warn('Failed to create default columns:', columnsError);
      } else {
        console.log('Created default columns for board');
      }
    }

    // Normalize and prepare task data
    const normalizedPriority = normalizePriority(args.priority);
    const normalizedCategory = normalizeCategory(args.category);
    
    console.log('📝 Creating task with normalized values:', {
      title,
      priority: `${args.priority} → ${normalizedPriority}`,
      category: `${args.category} → ${normalizedCategory}`
    });

    const taskData: {
      title: string;
      description: string | null;
      priority: 'HIGH' | 'LOW' | 'MEDIUM' | 'URGENT';
      category: 'CAREER' | 'EDUCATION' | 'LIFE' | 'VENTURES';
      status: 'BLOCKED' | 'LIFE' | 'CAREER' | 'PROF_EDUCATION' | 'VENTURES' | 'PLANNING' | 'READY' | 'UP_NEXT' | 'DOING' | 'DONE' | 'BACKLOG' | 'TODO';
      board_id: string;
      user_id: string;
    } = {
      title,
      description: args.description?.trim() || null,
      priority: normalizedPriority,
      category: normalizedCategory,
      status: normalizedCategory === 'EDUCATION' ? 'PROF_EDUCATION' : normalizedCategory,
      board_id: defaultBoard.id,
      user_id: userId
    };

    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .insert([taskData])
      .select()
      .single();

    if (taskError) {
      console.error('❌ Task insert failed:', taskError);
      const errorMessage = taskError.message || 'Failed to create task';
      onMessage?.({ 
        type: 'client.error', 
        message: `Failed to create task: ${errorMessage}` 
      });
      return {
        success: false,
        error: errorMessage,
        message: `I couldn't create that task. ${errorMessage}`
      };
    }

    console.log('✅ Task created successfully:', task.title);
    onMessage?.({ type: 'client.done', status: 'Task created' });
    
    return { 
      success: true, 
      task,
      message: `Created \"${task.title}\" in Backlog with ${normalizedPriority} priority`
    };
  } catch (error) {
    console.error('❌ Error creating task:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error creating task';
    onMessage?.({ 
      type: 'client.error', 
      message: `Task creation failed: ${errorMessage}` 
    });
    return {
      success: false,
      error: errorMessage,
      message: `I couldn't create that task. ${errorMessage}`
    };
  }
}

export async function updateTask(
  args: any,
  onMessage?: (msg: any) => void
) {
  try {
    onMessage?.({ type: 'client.processing', status: 'Updating task...' });

    const updateData: any = {};
    if (args.title) updateData.title = args.title.trim();
    if (args.description !== undefined) updateData.description = args.description?.trim() || null;
    if (args.priority) updateData.priority = normalizePriority(args.priority);
    if (args.status) updateData.status = args.status.toUpperCase();
    if (args.category) updateData.category = normalizeCategory(args.category);

    console.log('📝 Updating task with normalized values:', updateData);

    const { data, error } = await supabase
      .from('tasks')
      .update(updateData)
      .eq('id', args.task_id)
      .select()
      .single();

    if (error) {
      console.error('❌ Task update failed:', error);
      const errorMessage = error.message || 'Failed to update task';
      onMessage?.({ 
        type: 'client.error', 
        message: `Failed to update task: ${errorMessage}` 
      });
      return { 
        success: false, 
        error: errorMessage,
        message: `I couldn't update that task. ${errorMessage}`
      };
    }

    console.log('✅ Task updated successfully');
    onMessage?.({ type: 'client.done', status: 'Task updated' });
    return { 
      success: true, 
      task: data,
      message: `Updated \"${data.title}\" successfully`
    };
  } catch (error) {
    console.error('❌ Error updating task:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    onMessage?.({ 
      type: 'client.error', 
      message: errorMessage 
    });
    return { 
      success: false, 
      error: errorMessage,
      message: `I couldn't update that task. ${errorMessage}`
    };
  }
}

export async function getTasks(
  args: any,
  onMessage?: (msg: any) => void
) {
  try {
    onMessage?.({ type: 'client.processing', status: 'Loading your tasks...' });
    
    console.log('🔍 Getting tasks with args:', args);
    
    // Query tasks directly from database
    let query = supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(args?.limit || 10);

    if (args?.status_filter) {
      query = query.eq('status', args.status_filter);
    }

    const { data: tasks, error } = await query;
    
    if (error) {
      console.error('❌ Tasks query error:', error);
      onMessage?.({ 
        type: 'client.error', 
        message: `Failed to load tasks: ${error.message}` 
      });
      throw error;
    }

    console.log('✅ Got tasks from database:', tasks?.length || 0);
    onMessage?.({ type: 'client.done', status: `Loaded ${tasks?.length || 0} task(s)` });
    
    return {
      success: true,
      tasks: tasks || []
    };
  } catch (error) {
    console.error('❌ Error getting tasks:', error);
    onMessage?.({ 
      type: 'client.error', 
      message: error instanceof Error ? error.message : 'Unknown error loading tasks'
    });
    return {
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export async function getTodayTasks(
  args: any,
  onMessage?: (msg: any) => void
) {
  try {
    onMessage?.({ type: 'client.processing', status: 'Loading today\'s tasks...' });
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const userId = (await supabase.auth.getUser()).data.user?.id;
    if (!userId) {
      return { success: false, error: 'Not authenticated' };
    }

    // Get scheduled tasks for today
    const { data: scheduledTasks, error: scheduledError } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .gte('start_time', today.toISOString())
      .lt('start_time', tomorrow.toISOString())
      .order('start_time', { ascending: true });

    if (scheduledError) throw scheduledError;

    // Get unscheduled tasks
    const { data: unscheduledTasks, error: unscheduledError } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .is('start_time', null)
      .neq('status', 'DONE')
      .order('priority', { ascending: false })
      .limit(10);

    if (unscheduledError) throw unscheduledError;

    const totalTasks = (scheduledTasks?.length || 0) + (unscheduledTasks?.length || 0);
    onMessage?.({ type: 'client.done', status: `Found ${totalTasks} task(s) for today` });

    return {
      success: true,
      scheduled: scheduledTasks || [],
      unscheduled: unscheduledTasks || [],
      date: today.toISOString(),
      summary: `You have ${scheduledTasks?.length || 0} scheduled tasks and ${unscheduledTasks?.length || 0} unscheduled tasks for today.`
    };
  } catch (error) {
    console.error('❌ Error getting today\'s tasks:', error);
    onMessage?.({ type: 'client.error', message: 'Failed to load today\'s tasks' });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function rescheduleTask(
  args: any,
  onMessage?: (msg: any) => void
) {
  try {
    onMessage?.({ type: 'client.processing', status: 'Rescheduling task...' });

    if (!args.task_id) {
      return { success: false, error: 'Task ID is required' };
    }

    const userId = (await supabase.auth.getUser()).data.user?.id;
    if (!userId) {
      return { success: false, error: 'Not authenticated' };
    }

    // Parse new date
    const newDate = new Date(args.new_date);
    if (isNaN(newDate.getTime())) {
      return { success: false, error: 'Invalid date format' };
    }

    // If new_start_time provided, parse it
    let newStartTime = new Date(newDate);
    let newEndTime = new Date(newDate);
    
    if (args.new_start_time) {
      const [hours, minutes] = args.new_start_time.split(':').map(Number);
      newStartTime.setHours(hours, minutes, 0, 0);
      
      // Get original task to maintain duration
      const { data: originalTask } = await supabase
        .from('tasks')
        .select('start_time, end_time')
        .eq('id', args.task_id)
        .eq('user_id', userId)
        .single();

      if (originalTask?.start_time && originalTask?.end_time) {
        const originalDuration = new Date(originalTask.end_time).getTime() - new Date(originalTask.start_time).getTime();
        newEndTime = new Date(newStartTime.getTime() + originalDuration);
      } else {
        // Default 1 hour
        newEndTime.setHours(hours + 1, minutes, 0, 0);
      }
    } else {
      // Keep same time, just change date
      const { data: originalTask } = await supabase
        .from('tasks')
        .select('start_time, end_time')
        .eq('id', args.task_id)
        .eq('user_id', userId)
        .single();

      if (originalTask?.start_time) {
        const origStart = new Date(originalTask.start_time);
        newStartTime.setHours(origStart.getHours(), origStart.getMinutes(), 0, 0);
        
        if (originalTask.end_time) {
          const origEnd = new Date(originalTask.end_time);
          newEndTime.setHours(origEnd.getHours(), origEnd.getMinutes(), 0, 0);
        } else {
          newEndTime.setHours(origStart.getHours() + 1, origStart.getMinutes(), 0, 0);
        }
      } else {
        // Default to 9 AM - 10 AM
        newStartTime.setHours(9, 0, 0, 0);
        newEndTime.setHours(10, 0, 0, 0);
      }
    }

    const { data, error } = await supabase
      .from('tasks')
      .update({
        start_time: newStartTime.toISOString(),
        end_time: newEndTime.toISOString(),
      })
      .eq('id', args.task_id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;

    onMessage?.({ type: 'client.done', status: 'Task rescheduled successfully' });

    return {
      success: true,
      task: data,
      message: `Task rescheduled to ${newStartTime.toLocaleDateString()} at ${newStartTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    };
  } catch (error) {
    console.error('❌ Error rescheduling task:', error);
    onMessage?.({ type: 'client.error', message: 'Failed to reschedule task' });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function scheduleTask(
  args: any,
  onMessage?: (msg: any) => void
) {
  try {
    onMessage?.({ type: 'client.processing', status: 'Scheduling task...' });

    if (!args.task_id) {
      return { success: false, error: 'Task ID is required' };
    }

    const userId = (await supabase.auth.getUser()).data.user?.id;
    if (!userId) {
      return { success: false, error: 'Not authenticated' };
    }

    // Get the task to schedule
    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', args.task_id)
      .eq('user_id', userId)
      .single();

    if (taskError) throw taskError;
    if (!task) return { success: false, error: 'Task not found' };

    // Load user scheduling preferences to get timezone
    const { data: prefs } = await supabase
      .from('user_scheduling_prefs')
      .select('config')
      .eq('user_id', userId)
      .single();

    const config = prefs?.config as any;
    const timezone = config?.timezone || 
      Intl.DateTimeFormat().resolvedOptions().timeZone || 
      'UTC';

    console.log('User timezone:', timezone);

    // Fetch existing tasks for context
    const { data: existingTasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .neq('status', 'DONE')
      .order('start_time', { ascending: true });

    // Calculate targetDate if user specified a date
    let targetDate: string | undefined;
    if (args.date) {
      const requestedDate = new Date(args.date);
      const year = requestedDate.getFullYear();
      const month = String(requestedDate.getMonth() + 1).padStart(2, '0');
      const day = String(requestedDate.getDate()).padStart(2, '0');
      targetDate = `${year}-${month}-${day}`;
      console.log('Target date specified:', targetDate);
    }

    // Build complete scheduler payload
    const schedulerPayload = {
      taskText: `${task.title}${task.description ? ' - ' + task.description : ''}`,
      existingTasks: existingTasks || [],
      dueDate: task.due_date || undefined,
      estimateMinutes: args.duration_minutes || task.estimate_minutes || 60,
      taskCategory: task.category,
      taskPriority: task.priority,
      scheduling_context: [],
      userId: userId,
      userSchedulingConfig: config || {},
      timezone: timezone,
      targetDate: targetDate
    };

    console.log('Calling smart-calendar-scheduler with payload:', schedulerPayload);

    const { data: schedulerResult, error: schedulerError } = await supabase.functions.invoke(
      'smart-calendar-scheduler',
      {
        body: schedulerPayload
      }
    );

    if (schedulerError || !schedulerResult?.success) {
      console.error('Scheduler error:', schedulerError || schedulerResult);
      
      // Fallback only if user explicitly requested a specific date
      if (targetDate && args.date) {
        console.log('Using fallback scheduling for specified date:', targetDate);
        const requestedDate = new Date(args.date);
        const year = requestedDate.getFullYear();
        const month = requestedDate.getMonth();
        const day = requestedDate.getDate();
        
        const startTime = new Date(year, month, day, 9, 0, 0);
        const endTime = new Date(year, month, day, 10, 0, 0);
        
        const { data: updatedTask, error: updateError } = await supabase
          .from('tasks')
          .update({
            start_time: startTime.toISOString(),
            end_time: endTime.toISOString(),
            estimate_minutes: args.duration_minutes || task.estimate_minutes || 60,
            is_scheduled: true,
          })
          .eq('id', args.task_id)
          .eq('user_id', userId)
          .select()
          .single();

        if (updateError) {
          console.error('Error updating task with fallback:', updateError);
          throw updateError;
        }

        onMessage?.({ type: 'client.done', status: 'Task scheduled with fallback' });

        return {
          success: true,
          task: updatedTask,
          message: `I've scheduled \"${task.title}\" for 9:00 AM on ${targetDate}.`
        };
      }
      
      throw new Error('Scheduler failed and no fallback available');
    }

    const slot = schedulerResult.slot;
    console.log('Scheduler returned slot:', slot);

    const { data: updatedTask, error: updateError } = await supabase
      .from('tasks')
      .update({
        start_time: slot.start_time,
        end_time: slot.end_time,
        estimate_minutes: slot.duration_minutes,
        is_scheduled: true,
      })
      .eq('id', args.task_id)
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating task:', updateError);
      throw updateError;
    }

    onMessage?.({ type: 'client.done', status: 'Task scheduled successfully' });

    const startTime = new Date(slot.start_time).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    return {
      success: true,
      task: updatedTask,
      message: `I've scheduled \"${task.title}\" for ${startTime}.`
    };
  } catch (error) {
    console.error('❌ Error scheduling task:', error);
    onMessage?.({ type: 'client.error', message: 'Failed to schedule task' });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function unscheduleTask(
  args: any,
  onMessage?: (msg: any) => void
) {
  try {
    onMessage?.({ type: 'client.processing', status: 'Unscheduling task...' });

    if (!args.task_id) {
      return { success: false, error: 'Task ID is required' };
    }

    const userId = (await supabase.auth.getUser()).data.user?.id;
    if (!userId) {
      return { success: false, error: 'Not authenticated' };
    }

    const { data, error } = await supabase
      .from('tasks')
      .update({
        start_time: null,
        end_time: null,
        is_scheduled: false,
        status: 'BACKLOG'
      })
      .eq('id', args.task_id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw error;

    onMessage?.({ type: 'client.done', status: 'Task unscheduled' });

    return {
      success: true,
      task: data,
      message: 'Task has been removed from the schedule and moved to backlog'
    };
  } catch (error) {
    console.error('❌ Error unscheduling task:', error);
    onMessage?.({ type: 'client.error', message: 'Failed to unschedule task' });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ============================================================================
// COMMUNICATION TOOLS
// ============================================================================

export async function handleDisconnectTool(
  args: any,
  onMessage?: (msg: any) => void,
  disconnectFn?: () => void
) {
  console.log('🔴 Disconnect tool called with args:', args);
  onMessage?.({ 
    type: 'assistant.disconnect', 
    message: args.farewell_message || "Goodbye!" 
  });
  // Give the assistant time to speak the farewell, then disconnect
  if (disconnectFn) {
    setTimeout(() => disconnectFn(), 2000);
  }
  return { success: true, message: "Disconnecting..." };
}

export async function initiatePhoneCall(
  args: { delay_minutes?: number; context?: string },
  onMessage?: (msg: any) => void
) {
  console.log('📞 Initiate phone call with args:', args);
  
  try {
    onMessage?.({ type: 'client.processing', status: 'Initiating phone call...' });

    const userId = (await supabase.auth.getUser()).data.user?.id;
    if (!userId) {
      onMessage?.({ type: 'client.error', message: 'Not authenticated' });
      return { success: false, error: 'Not authenticated' };
    }

    const { data, error } = await supabase.functions.invoke('twilio-voice-handler', {
      body: {
        action: 'trigger-call',
        userId,
        delay_minutes: args.delay_minutes,
        context: args.context
      }
    });

    if (error) {
      console.error('❌ Error initiating phone call:', error);
      onMessage?.({ type: 'client.error', message: 'Failed to initiate phone call' });
      return { 
        success: false, 
        error: error.message || 'Failed to initiate phone call'
      };
    }

    if (!data?.success) {
      onMessage?.({ type: 'client.error', message: data?.error || 'Call failed' });
      return { 
        success: false, 
        error: data?.error || 'Failed to initiate phone call'
      };
    }

    const message = args.delay_minutes 
      ? `I'll call you in ${args.delay_minutes} minute${args.delay_minutes > 1 ? 's' : ''}`
      : 'Calling you now';

    onMessage?.({ type: 'client.done', status: message });

    return {
      success: true,
      message,
      call_sid: data.call_sid
    };
  } catch (error) {
    console.error('❌ Error initiating phone call:', error);
    onMessage?.({ type: 'client.error', message: 'Failed to initiate phone call' });
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

export async function webSearch(
  args: { query: string },
  onMessage?: (msg: any) => void
) {
  console.log('🔍 Web search with query:', args.query);
  
  try {
    onMessage?.({ type: 'client.processing', status: 'Searching the web...' });

    const { data, error } = await supabase.functions.invoke('web-search', {
      body: { query: args.query }
    });

    if (error) {
      console.error('❌ Web search error:', error);
      onMessage?.({ type: 'client.error', message: 'Search failed' });
      return { 
        success: false, 
        error: error.message || 'Web search failed',
        answer: "I couldn't search for that information right now."
      };
    }

    onMessage?.({ type: 'client.done', status: 'Search complete' });

    return {
      success: data?.success ?? false,
      answer: data?.answer || "No results found.",
      sources: data?.sources || [],
      query: args.query
    };
  } catch (error) {
    console.error('❌ Web search error:', error);
    onMessage?.({ type: 'client.error', message: 'Search failed' });
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      answer: "I encountered an error while searching."
    };
  }
}
