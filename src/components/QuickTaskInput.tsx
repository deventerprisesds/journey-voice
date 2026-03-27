import React, { useState, useRef } from 'react';
import { Send, Loader2, Mic, MicOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { getDefaultTimezone } from '@/lib/date';
import { logToErrorLog } from '@/utils/directLog';

interface QuickTaskInputProps {
  onTaskCreated?: () => void;
}

const QuickTaskInput: React.FC<QuickTaskInputProps> = ({ onTaskCreated }) => {
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<any>(null);
  const { toast } = useToast();

  const toggleMic = () => {
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast({ title: "Not supported", description: "Speech recognition is not available in this browser", variant: "destructive" });
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(prev => prev ? `${prev} ${transcript}` : transcript);
    };
    recognition.onend = () => setIsRecording(false);
    recognition.onerror = () => setIsRecording(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;

    setIsProcessing(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const userTimezone = getDefaultTimezone();

      // Trace: log the request
      logToErrorLog({
        component: 'QuickTaskInput',
        error_type: 'task_create_request',
        error_message: 'Sending task creation request',
        context: { input: input.trim(), userId: user.id, timezone: userTimezone }
      });

      const { data, error } = await supabase.functions.invoke('execute-tool', {
        body: {
          toolName: 'parse_and_create_tasks',
          args: {
            text: input.trim(),
            target_date: 'today',
            auto_schedule: true,
            default_status: 'UP_NEXT'
          },
          userId: user.id,
          context: {
            timezone: userTimezone
          }
        }
      });

      // Trace: log the response
      logToErrorLog({
        component: 'QuickTaskInput',
        error_type: 'task_create_response',
        error_message: `Response: success=${data?.success}, error=${data?.error || 'none'}`,
        context: {
          success: data?.success,
          resultKeys: data?.result ? Object.keys(data.result) : [],
          taskCount: data?.result?.tasks?.length,
          error: error?.message || data?.error,
          fullResult: data?.result
        }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to create task');

      const createdCount = data.result?.tasks?.length || 1;
      toast({
        title: "Task Created",
        description: `Added ${createdCount} task${createdCount !== 1 ? 's' : ''} to today's schedule`,
      });

      setInput('');
      onTaskCreated?.();

    } catch (error) {
      console.error('Failed to create task:', error);
      logToErrorLog({
        component: 'QuickTaskInput',
        error_type: 'task_create_error',
        error_message: error instanceof Error ? error.message : String(error),
        stack_trace: error instanceof Error ? error.stack : undefined,
        context: { input: input.trim() }
      });
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
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={toggleMic}
        disabled={isProcessing}
        className={isRecording ? 'text-destructive animate-pulse' : ''}
      >
        {isRecording ? (
          <MicOff className="h-4 w-4" />
        ) : (
          <Mic className="h-4 w-4" />
        )}
      </Button>
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
