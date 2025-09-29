import React, { useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { itineraryEngine } from '@/utils/ItineraryEngine';
import { useToast } from '@/hooks/use-toast';
import { Task } from '@/types/task';
import EditableTaskSuggestion from './EditableTaskSuggestion';

interface SmartTaskInputProps {
  tasks: Task[];
  targetDate?: Date;
  onTaskScheduled?: (task: any, slot: any) => void;
}

interface TaskSuggestion {
  title: string;
  description?: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  category: 'LIFE' | 'CAREER' | 'VENTURES' | 'EDUCATION';
  estimate_minutes: number;
  scheduledStart: string;
  aiReasoning: string;
}

const SmartTaskInput: React.FC<SmartTaskInputProps> = ({
  tasks,
  targetDate,
  onTaskScheduled
}) => {
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastSuggestion, setLastSuggestion] = useState<any>(null);
  const [busySlots, setBusySlots] = useState<Array<{start: string; end: string; title: string; type: string}>>([]);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;

    setIsProcessing(true);
    setLastSuggestion(null);

    try {
      const suggestion = await itineraryEngine.findOptimalTimeSlot(
        input,
        targetDate,
        tasks || []
      );
      
      if (suggestion) {
        setLastSuggestion(suggestion);
        setBusySlots(suggestion.busySlots || []);
        setInput('');
        
        toast({
          title: "Task Analyzed",
          description: "AI has found the optimal time slot for your task. Review and edit if needed.",
        });
      } else {
        throw new Error('No scheduling suggestion received');
      }
    } catch (error) {
      console.error('Failed to get task suggestion:', error);
      toast({
        title: "Scheduling Error",
        description: "Failed to get AI scheduling suggestion. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAcceptSuggestion = async (editedSuggestion: TaskSuggestion) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Get user's default board
      const { data: boards } = await supabase
        .from('boards')
        .select('id')
        .eq('user_id', user.id)
        .eq('is_default', true)
        .limit(1);

      if (!boards || boards.length === 0) {
        throw new Error('No default board found');
      }

      // Calculate end time based on duration
      const startTime = new Date(editedSuggestion.scheduledStart);
      const endTime = new Date(startTime.getTime() + editedSuggestion.estimate_minutes * 60000);

      // Create the task with edited details
      const { data: newTask, error } = await supabase
        .from('tasks')
        .insert({
          title: editedSuggestion.title,
          description: editedSuggestion.description,
          priority: editedSuggestion.priority,
          category: editedSuggestion.category,
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          estimate_minutes: editedSuggestion.estimate_minutes,
          is_scheduled: true,
          status: 'TODO',
          user_id: user.id,
          board_id: boards[0].id
        })
        .select()
        .single();

      if (error) throw error;

      // Send notifications for the newly created task
      try {
        await supabase.functions.invoke('send-push-notification', {
          body: {
            userId: user.id,
            taskId: newTask.id,
            title: 'Smart Task Scheduled',
            body: `Task "${editedSuggestion.title}" has been scheduled`,
            type: 'task_scheduled',
            data: {
              scheduledSlot: {
                startTime: startTime.toISOString(),
                endTime: endTime.toISOString(),
                reasoning: editedSuggestion.aiReasoning
              }
            }
          }
        });

        // Generate reminders if there's a start time
        if (startTime) {
          await supabase.functions.invoke('generate-task-reminders', {
            body: {
              taskId: newTask.id,
              userId: user.id,
              title: editedSuggestion.title,
              startTime: startTime.toISOString()
            }
          });
          
          // Process pending notifications immediately
          await supabase.functions.invoke('notification-delivery', {
            body: { immediate: true }
          });
        }
      } catch (notificationError) {
        console.warn('Failed to send notifications:', notificationError);
      }

      onTaskScheduled?.(newTask, {
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        reasoning: editedSuggestion.aiReasoning
      });
      setLastSuggestion(null);
      setBusySlots([]);

      toast({
        title: "Task Scheduled",
        description: `Task scheduled for ${startTime.toLocaleString()}`,
      });

    } catch (error) {
      console.error('Error creating task:', error);
      toast({
        title: "Error",
        description: "Failed to create task. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe your task... (e.g., 'Review project proposal tomorrow morning for 2 hours')"
          disabled={isProcessing}
          className="flex-1"
        />
        <Button type="submit" disabled={isProcessing || !input.trim()}>
          {isProcessing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </form>

      {lastSuggestion && lastSuggestion.taskSuggestion && (
        <EditableTaskSuggestion
          suggestion={lastSuggestion.taskSuggestion}
          onAccept={handleAcceptSuggestion}
          onDismiss={() => {
            setLastSuggestion(null);
            setBusySlots([]);
          }}
          busySlots={busySlots}
        />
      )}
    </div>
  );
};

export default SmartTaskInput;