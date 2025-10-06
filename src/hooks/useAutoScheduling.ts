import { useCallback } from 'react';
import { Task } from '@/types/task';
import { scheduleNewTask } from '@/utils/taskScheduling';
import { useToast } from '@/hooks/use-toast';
import { extractSchedulingContext } from '@/services/schedulingService';

export const useAutoScheduling = () => {
  const { toast } = useToast();

  const autoScheduleTask = useCallback(async (task: Task): Promise<Task | null> => {
    try {
      // Extract keyword hints ONLY as fallback context
      const { context, estimatedDuration } = extractSchedulingContext(
        `${task.title} ${task.description || ''}`,
        task.category,
        task.priority
      );
      
      const result = await scheduleNewTask({
        id: task.id,
        title: task.title,
        description: task.description,
        board_id: task.board_id,
        user_id: task.user_id,
        category: task.category,
        priority: task.priority,
        due_date: task.due_date,
        estimate_minutes: task.estimate_minutes || estimatedDuration,
        scheduling_context: context // REMOVED timeWindow override
      });

      if (result.success && result.scheduledTask) {
        toast({
          title: "Task Scheduled",
          description: `"${task.title}" has been automatically scheduled for ${result.slot?.start_time}`,
        });
        return result.scheduledTask;
      } else {
        throw new Error(result.error || 'Failed to schedule task');
      }
    } catch (error) {
      console.error('Auto-scheduling failed:', error);
      toast({
        title: "Scheduling Failed",
        description: "Could not automatically schedule the task. Please try manually selecting a time.",
        variant: "destructive",
      });
      return null;
    }
  }, [toast]);

  return { autoScheduleTask };
};