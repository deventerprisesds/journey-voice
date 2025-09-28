import { useCallback } from 'react';
import { Task } from '@/types/task';
import { scheduleNewTask } from '@/utils/taskScheduling';
import { useToast } from '@/hooks/use-toast';

export const useAutoScheduling = () => {
  const { toast } = useToast();

  // Helper function to extract scheduling context from task
  const extractSchedulingContext = (task: Task): string[] => {
    const context: string[] = [];
    const text = `${task.title} ${task.description || ''}`.toLowerCase();
    
    // Add context based on task category
    if (task.category === 'CAREER' || task.category === 'VENTURES') {
      context.push('business_hours');
      context.push('weekdays_only');
    }
    
    // Business ventures context
    if (task.category === 'VENTURES' || text.includes('business') || text.includes('venture') || 
        text.includes('startup') || text.includes('investment') || text.includes('pitch')) {
      context.push('business_hours');
      context.push('weekdays_only');
    }
    
    // General business context
    if (text.includes('meeting') || text.includes('call') || text.includes('bank') || text.includes('office')) {
      context.push('business_hours');
    }
    
    // Time preferences
    if (text.includes('morning')) {
      context.push('morning_preferred');
    } else if (text.includes('afternoon')) {
      context.push('afternoon_preferred');
    } else if (text.includes('evening')) {
      context.push('evening_preferred');
    }
    
    if (text.includes('urgent') || task.priority === 'HIGH') {
      context.push('urgent');
    }
    
    return context;
  };

  const autoScheduleTask = useCallback(async (task: Task): Promise<Task | null> => {
    try {
      const scheduling_context = extractSchedulingContext(task);
      
      const result = await scheduleNewTask({
        id: task.id,
        title: task.title,
        description: task.description,
        board_id: task.board_id,
        user_id: task.user_id,
        category: task.category,
        priority: task.priority,
        due_date: task.due_date,
        estimate_minutes: task.estimate_minutes,
        scheduling_context
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
  }, [toast, extractSchedulingContext]);

  return { autoScheduleTask };
};