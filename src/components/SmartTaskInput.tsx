import React, { useState } from 'react';
import { Send, Loader2, Calendar, Brain } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { itineraryEngine } from '@/utils/ItineraryEngine';
import { useToast } from '@/hooks/use-toast';
import { Task } from '@/types/task';

interface SmartTaskInputProps {
  tasks: Task[];
  targetDate?: Date;
  onTaskScheduled?: (task: any, slot: any) => void;
}

const SmartTaskInput: React.FC<SmartTaskInputProps> = ({
  tasks,
  targetDate,
  onTaskScheduled
}) => {
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastSuggestion, setLastSuggestion] = useState<any>(null);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;

    setIsProcessing(true);
    try {
      // Use the smart calendar scheduler
      const result = await itineraryEngine.findOptimalTimeSlot(
        input,
        targetDate,
        tasks
      );

      setLastSuggestion(result);
      setInput('');
      
      toast({
        title: "Task Analyzed",
        description: "AI has found the optimal time slot for your task.",
      });

    } catch (error) {
      console.error('Error processing smart task input:', error);
      toast({
        title: "Error",
        description: "Failed to process task. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAcceptSuggestion = async () => {
    if (!lastSuggestion) return;

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

      // Create the task
      const { data: newTask, error } = await supabase
        .from('tasks')
        .insert({
          title: lastSuggestion.parsedTask.title,
          description: lastSuggestion.parsedTask.description,
          priority: lastSuggestion.parsedTask.priority,
          category: lastSuggestion.parsedTask.category,
          due_date: lastSuggestion.scheduledSlot.scheduledStart,
          estimate_minutes: lastSuggestion.parsedTask.estimate_minutes,
          status: lastSuggestion.parsedTask.status || 'TODO',
          user_id: user.id,
          board_id: boards[0].id
        })
        .select()
        .single();

      if (error) throw error;

      onTaskScheduled?.(newTask, lastSuggestion.scheduledSlot);
      setLastSuggestion(null);

      toast({
        title: "Task Scheduled",
        description: `Task scheduled for ${new Date(lastSuggestion.scheduledSlot.scheduledStart).toLocaleString()}`,
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

      {lastSuggestion && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-primary" />
                <h4 className="font-semibold">AI Scheduling Suggestion</h4>
              </div>
              
              <div className="space-y-2">
                <div>
                  <h5 className="font-medium">{lastSuggestion.parsedTask.title}</h5>
                  {lastSuggestion.parsedTask.description && (
                    <p className="text-sm text-muted-foreground">
                      {lastSuggestion.parsedTask.description}
                    </p>
                  )}
                </div>
                
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {new Date(lastSuggestion.scheduledSlot.scheduledStart).toLocaleString()}
                  </Badge>
                  <Badge variant="outline">
                    {lastSuggestion.parsedTask.priority}
                  </Badge>
                  <Badge variant="outline">
                    {lastSuggestion.parsedTask.category}
                  </Badge>
                  {lastSuggestion.parsedTask.estimate_minutes && (
                    <Badge variant="outline">
                      {lastSuggestion.parsedTask.estimate_minutes}m
                    </Badge>
                  )}
                </div>
                
                <p className="text-sm text-muted-foreground">
                  <strong>AI Reasoning:</strong> {lastSuggestion.aiReasoning}
                </p>
                
                <div className="flex gap-2">
                  <Button onClick={handleAcceptSuggestion} size="sm">
                    Schedule Task
                  </Button>
                  <Button 
                    onClick={() => setLastSuggestion(null)} 
                    variant="outline" 
                    size="sm"
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default SmartTaskInput;