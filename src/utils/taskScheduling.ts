import { supabase } from "@/integrations/supabase/client";
import { Task } from "@/types/task";
import { toast } from "sonner";

export interface SchedulingResult {
  success: boolean;
  scheduledTask?: Task;
  slot?: {
    start_time: string;
    end_time: string;
    reasoning: string;
  };
  error?: string;
}

export async function scheduleNewTask(task: Partial<Task> & { board_id: string; user_id: string }): Promise<SchedulingResult> {
  try {
    // Get user's existing tasks for context
    const { data: existingTasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', task.user_id);

    // Get external calendar availability if connected
    const { data: calendarConnections } = await supabase
      .from('calendar_connections')
      .select('*')
      .eq('user_id', task.user_id)
      .eq('is_active', true);

    let busySlots: any[] = [];
    
    // Check external calendar availability
    if (calendarConnections && calendarConnections.length > 0) {
      for (const connection of calendarConnections) {
        try {
          const { data: availability } = await supabase.functions.invoke(
            'calendar-integration-manager',
            {
              body: {
                action: 'get_availability',
                connection_id: connection.id,
                start_date: new Date().toISOString(),
                end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
              }
            }
          );
          
          if (availability?.busy_slots) {
            busySlots.push(...availability.busy_slots);
          }
        } catch (error) {
          console.warn('Failed to get availability from calendar connection:', connection.id, error);
        }
      }
    }

    // Use smart calendar scheduler to find optimal time slot
    const { data: scheduleResult, error } = await supabase.functions.invoke(
      'smart-calendar-scheduler',
      {
        body: {
          taskText: `${task.title} - ${task.description || ''}`,
          targetDate: task.due_date || new Date().toISOString(),
          existingTasks: existingTasks || [],
          workingMinutes: 480, // 8 hours default
          busySlots
        }
      }
    );

    if (error) {
      console.error('Scheduling error:', error);
      return { success: false, error: error.message };
    }

    // Update task with scheduled times
    const updatedTask: any = {
      ...task,
      start_time: scheduleResult.scheduledSlot.startTime,
      end_time: scheduleResult.scheduledSlot.endTime,
      is_scheduled: true,
      // Ensure required fields are present
      title: task.title || 'Untitled Task',
      board_id: task.board_id,
      user_id: task.user_id,
      status: task.status || 'TODO',
      priority: task.priority || 'MEDIUM',
      category: task.category || 'LIFE'
    };

    // Save the scheduled task
    const { data: savedTask, error: saveError } = await supabase
      .from('tasks')
      .insert([updatedTask])
      .select()
      .single();

    if (saveError) {
      console.error('Failed to save scheduled task:', saveError);
      return { success: false, error: saveError.message };
    }

    // Send notifications for the scheduled task
    try {
      await supabase.functions.invoke('send-push-notification', {
        body: {
          userId: savedTask.user_id,
          taskId: savedTask.id,
          title: 'Task Scheduled',
          body: `Task "${savedTask.title}" has been scheduled for ${new Date(scheduleResult.scheduledSlot.startTime).toLocaleString()}`,
          type: 'task_scheduled',
          data: {
            scheduledSlot: {
              startTime: scheduleResult.scheduledSlot.startTime,
              endTime: scheduleResult.scheduledSlot.endTime,
              reasoning: scheduleResult.aiReasoning
            }
          }
        }
      });

      // Generate reminders if there's a due date
      if (savedTask.due_date) {
        await supabase.functions.invoke('generate-task-reminders', {
          body: {
            taskId: savedTask.id,
            userId: savedTask.user_id,
            title: savedTask.title,
            dueDate: savedTask.due_date
          }
        });
      }
    } catch (notificationError) {
      console.warn('Failed to send notifications:', notificationError);
    }

    // Optionally create event in external calendars
    if (calendarConnections && calendarConnections.length > 0) {
      for (const connection of calendarConnections) {
        try {
          await supabase.functions.invoke('calendar-integration-manager', {
            body: {
              action: 'create_event',
              connection_id: connection.id,
              task: savedTask
            }
          });
        } catch (error) {
          console.warn('Failed to create event in external calendar:', error);
        }
      }
    }

    return {
      success: true,
      scheduledTask: savedTask,
      slot: {
        start_time: scheduleResult.scheduledSlot.startTime,
        end_time: scheduleResult.scheduledSlot.endTime,
        reasoning: scheduleResult.aiReasoning
      }
    };

  } catch (error) {
    console.error('Task scheduling failed:', error);
    return { success: false, error: 'Failed to schedule task' };
  }
}

export async function getCalendarAvailability(startDate: string, endDate: string) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { busySlots: [], tasks: [] };

    // Get user's scheduled tasks
    const { data: tasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_scheduled', true)
      .gte('start_time', startDate)
      .lte('end_time', endDate);

    // Get external calendar events
    const { data: externalEvents } = await supabase
      .from('external_calendar_events')
      .select('*')
      .eq('user_id', user.id)
      .gte('start_time', startDate)
      .lte('end_time', endDate);

    const busySlots = [
      ...(tasks || []).map(task => ({
        start: task.start_time,
        end: task.end_time,
        type: 'task',
        title: task.title
      })),
      ...(externalEvents || []).map(event => ({
        start: event.start_time,
        end: event.end_time,
        type: 'external',
        title: event.title
      }))
    ];

    return { busySlots, tasks: tasks || [] };
  } catch (error) {
    console.error('Failed to get calendar availability:', error);
    return { busySlots: [], tasks: [] };
  }
}

export async function syncExternalCalendars() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: connections } = await supabase
      .from('calendar_connections')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true);

    if (!connections || connections.length === 0) return;

    const startDate = new Date().toISOString();
    const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

    for (const connection of connections) {
      try {
        await supabase.functions.invoke('calendar-integration-manager', {
          body: {
            action: 'sync_events',
            connection_id: connection.id,
            start_date: startDate,
            end_date: endDate
          }
        });
      } catch (error) {
        console.error(`Failed to sync calendar ${connection.provider}:`, error);
      }
    }

    toast.success('External calendars synced successfully');
  } catch (error) {
    console.error('Failed to sync external calendars:', error);
    toast.error('Failed to sync external calendars');
  }
}