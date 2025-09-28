import { useCallback } from 'react';
import { Task } from '@/types/task';
import { scheduleNewTask } from '@/utils/taskScheduling';
import { useToast } from '@/hooks/use-toast';

export const useAutoScheduling = () => {
  const { toast } = useToast();

  const autoScheduleTask = useCallback(async (task: Task): Promise<Task | null> => {
    try {
      const scheduleResult = await scheduleNewTask({
        ...task,
        scheduling_context: extractSchedulingContext(task)
      });

      if (scheduleResult.success && scheduleResult.scheduledTask) {
        toast({
          title: "Task Auto-Scheduled",
          description: `"${task.title}" has been intelligently scheduled based on context`,
        });
        return scheduleResult.scheduledTask;
      }
    } catch (error) {
      console.warn('Auto-scheduling failed:', error);
      toast({
        title: "Scheduling Note",
        description: "Task created but could not be auto-scheduled",
        variant: "default",
      });
    }
    return null;
  }, [toast]);

  const extractSchedulingContext = (task: Task): string[] => {
    const context: string[] = [];
    const taskText = `${task.title} ${task.description || ''}`.toLowerCase();

    // Extract context clues from task content
    if (taskText.includes('bank') || taskText.includes('financial')) {
      context.push('business_hours', 'weekdays_only');
    }
    if (taskText.includes('store') || taskText.includes('shop') || taskText.includes('grocery')) {
      context.push('flexible_hours', 'prefer_morning_evening');
    }
    if (taskText.includes('work') && (taskText.includes('commute') || taskText.includes('way to'))) {
      context.push('commute_time', 'weekdays_only');
    }
    if (taskText.includes('read') || taskText.includes('study') || taskText.includes('learn')) {
      context.push('quiet_time', 'evening_preferred');
    }
    if (taskText.includes('gym') || taskText.includes('exercise') || taskText.includes('workout')) {
      context.push('morning_evening', 'avoid_meals');
    }
    if (taskText.includes('meeting') || taskText.includes('appointment')) {
      context.push('specific_time', 'business_hours');
    }
    if (taskText.includes('personal') || taskText.includes('family')) {
      context.push('flexible', 'weekend_ok');
    }

    return context;
  };

  return { autoScheduleTask, extractSchedulingContext };
};