import React, { useState, useEffect } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { itineraryEngine } from '@/utils/ItineraryEngine';
import { useToast } from '@/hooks/use-toast';
import { Task } from '@/types/task';
import EditableTaskSuggestion from './EditableTaskSuggestion';
import { fetchPendingAssignments } from '@/utils/assignmentFetching';
import { useAssignmentSelection } from '@/contexts/AssignmentSelectionContext';

interface SmartTaskInputProps {
  tasks: Task[];
  targetDate?: Date;
  onTaskScheduled?: (task: any, slot: any) => void;
}

interface TaskSuggestion {
  title: string;
  description?: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  category: 'LIFE' | 'CAREER' | 'VENTURES' | 'EDUCATION' | 'PROF_EDUCATION';
  estimate_minutes: number;
  scheduledStart: string;
  aiReasoning: string;
}

// Helper to map category to status
const mapCategoryToStatus = (category: string): Task['status'] => {
  switch (category) {
    case 'LIFE':
      return 'LIFE';
    case 'CAREER':
      return 'CAREER';
    case 'VENTURES':
      return 'VENTURES';
    case 'EDUCATION':
    case 'PROF_EDUCATION':
      return 'PROF_EDUCATION';
    default:
      return 'BACKLOG';
  }
};

const SmartTaskInput: React.FC<SmartTaskInputProps> = ({
  tasks,
  targetDate,
  onTaskScheduled
}) => {
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastSuggestion, setLastSuggestion] = useState<any>(null);
  const [busySlots, setBusySlots] = useState<Array<{start: string; end: string; title: string; type: string}>>([]);
  const [includeAssignments, setIncludeAssignments] = useState(false);
  const { toast } = useToast();
  const { selectedAssignmentIds } = useAssignmentSelection();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;

    setIsProcessing(true);
    setLastSuggestion(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Fetch selected assignments if toggle is enabled
      let allTasks = tasks || [];
      if (includeAssignments && selectedAssignmentIds.size > 0) {
        const assignments = await fetchPendingAssignments(user.id);
        // Filter to only selected assignments
        const selectedAssignments = assignments.filter(a => 
          selectedAssignmentIds.has(a.id)
        );
        allTasks = [...allTasks, ...selectedAssignments];
      }

      const suggestion = await itineraryEngine.findOptimalTimeSlot(
        input,
        targetDate,
        allTasks
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
          category: (editedSuggestion.category === 'PROF_EDUCATION' ? 'EDUCATION' : editedSuggestion.category) as any,
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          estimate_minutes: editedSuggestion.estimate_minutes,
          is_scheduled: true,
          status: mapCategoryToStatus(editedSuggestion.category),
          user_id: user.id,
          board_id: boards[0].id,
          reminder_minutes: 15
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
    <div className="space-y-3">
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe your task... (e.g., 'Review project tomorrow 2pm')"
          disabled={isProcessing}
          className="flex-1"
        />
        
        {/* Compact assignment toggle */}
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-muted/50 rounded-md shrink-0">
          <Switch 
            checked={includeAssignments} 
            onCheckedChange={setIncludeAssignments}
            id="include-assignments"
            className="scale-90"
          />
          <Label 
            htmlFor="include-assignments" 
            className="cursor-pointer text-xs text-muted-foreground whitespace-nowrap"
            title="Include pending homework assignments in scheduling context"
          >
            + Homework ({selectedAssignmentIds.size})
          </Label>
        </div>
        
        <Button type="submit" disabled={isProcessing || !input.trim()} size="icon">
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