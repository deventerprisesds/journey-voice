import React, { useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { getDefaultTimezone } from '@/lib/date';

interface QuickTaskInputProps {
  onTaskCreated?: () => void;
}

const QuickTaskInput: React.FC<QuickTaskInputProps> = ({ onTaskCreated }) => {
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;

    setIsProcessing(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const userTimezone = getDefaultTimezone();

      // Call execute-tool with parse_and_create_tasks
      // target_date: 'today' ensures due_date defaults to today
      const { data, error } = await supabase.functions.invoke('execute-tool', {
        body: {
          toolName: 'parse_and_create_tasks',
          toolArgs: {
            text: input.trim(),
            target_date: 'today',
            auto_schedule: true
          },
          userId: user.id,
          context: {
            timezone: userTimezone
          }
        }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to create task');

      const createdCount = data.result?.createdTasks?.length || 1;
      toast({
        title: "Task Created",
        description: `Added ${createdCount} task${createdCount !== 1 ? 's' : ''} to today's schedule`,
      });

      setInput('');
      onTaskCreated?.();

    } catch (error) {
      console.error('Failed to create task:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create task",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Add a task for today..."
        disabled={isProcessing}
        className="flex-1"
      />
      <Button type="submit" disabled={isProcessing || !input.trim()} size="icon">
        {isProcessing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
      </Button>
    </form>
  );
};

export default QuickTaskInput;
