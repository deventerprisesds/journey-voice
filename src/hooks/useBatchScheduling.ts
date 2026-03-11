import { useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface TaskToSchedule {
  id?: string;
  title: string;
  category: string;
  priority: string;
  estimate_minutes?: number;
  due_date?: string;
  schedulingHints?: {
    context: string[];
    estimatedDuration: number;
  };
}

interface ScheduledResult {
  taskId?: string;
  taskIndex: number;
  start_time: string;
  end_time: string;
  reasoning?: string;
}

interface BatchSchedulingResult {
  scheduled: ScheduledResult[];
  tasksCount: number;
  processingTimeMs?: number;
  error?: string;
}

export const useBatchScheduling = () => {
  const { toast } = useToast();
  const [isScheduling, setIsScheduling] = useState(false);

  const scheduleBatch = useCallback(async (
    tasks: TaskToSchedule[],
    userId: string,
    timezone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
    targetDate?: Date
  ): Promise<BatchSchedulingResult> => {
    if (!tasks || tasks.length === 0) {
      return { scheduled: [], tasksCount: 0 };
    }

    setIsScheduling(true);
    console.log(`🚀 Starting batch scheduling for ${tasks.length} tasks${targetDate ? ` (target: ${targetDate.toDateString()})` : ''}`);

    try {
      const { data, error } = await supabase.functions.invoke('batch-calendar-scheduler', {
        body: {
          tasks,
          userId,
          timezone,
          targetDate: targetDate ? targetDate.toISOString().split('T')[0] : undefined
        }
      });

      if (error) {
        console.error('❌ Batch scheduling error:', error);
        toast({
          title: "Scheduling Error",
          description: error.message || "Failed to schedule tasks",
          variant: "destructive"
        });
        return { scheduled: [], tasksCount: tasks.length, error: error.message };
      }

      if (data?.error) {
        console.error('❌ Batch scheduling returned error:', data.error);
        
        // Handle rate limits gracefully
        if (data.error.includes('Rate limit')) {
          toast({
            title: "Rate Limit",
            description: "Too many requests. Please wait a moment and try again.",
            variant: "destructive"
          });
        } else if (data.error.includes('credits')) {
          toast({
            title: "Credits Exhausted",
            description: "AI credits exhausted. Please add credits to continue.",
            variant: "destructive"
          });
        } else {
          toast({
            title: "Scheduling Error",
            description: data.error,
            variant: "destructive"
          });
        }
        
        return { scheduled: [], tasksCount: tasks.length, error: data.error };
      }

      const result: BatchSchedulingResult = {
        scheduled: data?.scheduled || [],
        tasksCount: data?.tasksCount || tasks.length,
        processingTimeMs: data?.processingTimeMs
      };

      console.log(`✅ Batch scheduling complete: ${result.scheduled.length}/${result.tasksCount} tasks scheduled in ${result.processingTimeMs}ms`);
      
      // === TRACE: Raw edge function response ===
      console.log('=== BATCH SCHEDULER RAW RESPONSE ===');
      result.scheduled.forEach((s, i) => {
        console.log(`  [${i}] taskIndex=${s.taskIndex} taskId=${s.taskId || 'N/A'} start=${s.start_time} end=${s.end_time} reason=${s.reasoning}`);
      });
      console.log('====================================');

      if (result.scheduled.length > 0) {
        toast({
          title: "Tasks Scheduled",
          description: `${result.scheduled.length} tasks have been scheduled`
        });
      }

      return result;

    } catch (error) {
      console.error('❌ Batch scheduling exception:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast({
        title: "Scheduling Failed",
        description: errorMessage,
        variant: "destructive"
      });
      return { scheduled: [], tasksCount: tasks.length, error: errorMessage };
    } finally {
      setIsScheduling(false);
    }
  }, [toast]);

  const updateTasksWithSchedule = useCallback(async (
    scheduled: ScheduledResult[],
    savedTaskIds: string[]
  ): Promise<void> => {
    if (!scheduled || scheduled.length === 0) {
      console.log('⏭️ No scheduled times to update');
      return;
    }

    console.log(`📝 Updating ${scheduled.length} tasks with scheduled times`);

    const updates = scheduled
      .filter(s => s.start_time && s.end_time)
      .map(s => {
        const taskId = s.taskId || savedTaskIds[s.taskIndex];
        if (!taskId) return null;
        
        return supabase
          .from('tasks')
          .update({
            start_time: s.start_time,
            end_time: s.end_time,
            is_scheduled: true
          })
          .eq('id', taskId);
      })
      .filter(Boolean);

    const results = await Promise.all(updates);
    const errors = results.filter((r: any) => r?.error);
    
    if (errors.length > 0) {
      console.warn(`⚠️ ${errors.length} task updates failed`);
    } else {
      console.log(`✅ All ${scheduled.length} tasks updated with schedule`);
    }
  }, []);

  return {
    scheduleBatch,
    updateTasksWithSchedule,
    isScheduling
  };
};
