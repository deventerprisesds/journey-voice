import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { loadUserSchedulingConfig, saveUserSchedulingConfig, type SchedulingConfigWithInstructions } from '@/services/schedulingService';
import { Loader2, RotateCcw, Save } from 'lucide-react';

const DEFAULT_CORE_INSTRUCTIONS = `You are a helpful task management assistant. You can help users create, update, and manage their tasks through voice commands.

When users ask about historical information like "tasks from last week" or "what did I work on yesterday", use the get_tasks function with appropriate time_filter parameters.

Available functions:
- get_tasks: Retrieve tasks and chat history with time/keyword filtering
- get_today_tasks: Get all tasks scheduled for today
- create_task: Create new tasks with title, description, priority, and category
- update_task: Update existing tasks (status, title, description, priority)
- reschedule_task: Move a task to a different date or time
- schedule_task: Schedule an unscheduled task (automatically finds optimal time slot)
- unschedule_task: Remove a task from the calendar
- disconnect: Disconnect when user says goodbye, "that's all", "disconnect", "I'm done", or similar farewell phrases

When users ask about "today's tasks" or "what's on my schedule today", use get_today_tasks.
When users want to move tasks around, use reschedule_task with the new date/time.
When users want to add unscheduled tasks to today, use schedule_task which will automatically find the best time slot.

Always confirm actions you take and provide helpful feedback about task management.

When the user says goodbye phrases like 'that's all', 'thanks that's it', 'disconnect', 'I'm done', 'goodbye', or similar, call the disconnect function with a friendly farewell message.`;

const VoiceAssistantSettings: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [coreInstructions, setCoreInstructions] = useState('');
  const [schedulingPhilosophy, setSchedulingPhilosophy] = useState('');
  const [realtimeExtensions, setRealtimeExtensions] = useState('');
  const [assistantExtensions, setAssistantExtensions] = useState('');
  const [autoGreetingTimeout, setAutoGreetingTimeout] = useState('5');

  useEffect(() => {
    if (user?.id) {
      loadConfig();
    }
  }, [user?.id]);

  const loadConfig = async () => {
    if (!user?.id) return;
    
    setLoading(true);
    try {
      const config = await loadUserSchedulingConfig(user.id);
      setCoreInstructions(config.core_instructions || DEFAULT_CORE_INSTRUCTIONS);
      setSchedulingPhilosophy(config.customAIInstructions || '');
      setRealtimeExtensions(config.realtime_extensions || '');
      setAssistantExtensions(config.assistant_extensions || '');
      setAutoGreetingTimeout(config.auto_greeting_timeout?.toString() || '5');
    } catch (error) {
      console.error('Failed to load AI instructions:', error);
      toast({
        title: "Error",
        description: "Failed to load AI instructions",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!user?.id) return;
    
    setSaving(true);
    try {
      const success = await saveUserSchedulingConfig(user.id, {
        core_instructions: coreInstructions,
        customAIInstructions: schedulingPhilosophy,
        realtime_extensions: realtimeExtensions,
        assistant_extensions: assistantExtensions,
        auto_greeting_timeout: parseInt(autoGreetingTimeout) || 5,
      } as any);

      if (success) {
        toast({
          title: "Saved",
          description: "AI instruction settings updated successfully",
        });
      } else {
        throw new Error('Save failed');
      }
    } catch (error) {
      console.error('Failed to save AI instructions:', error);
      toast({
        title: "Error",
        description: "Failed to save AI instructions",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setCoreInstructions(DEFAULT_CORE_INSTRUCTIONS);
    setSchedulingPhilosophy('');
    setRealtimeExtensions('');
    setAssistantExtensions('');
    setAutoGreetingTimeout('5');
    toast({
      title: "Reset",
      description: "All instructions reset to defaults",
    });
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>AI Instructions</CardTitle>
          <CardDescription>Loading...</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Instructions</CardTitle>
        <CardDescription>
          Customize how your AI assistants behave across voice, text, and scheduling
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="core" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="core">Core</TabsTrigger>
            <TabsTrigger value="scheduling">Scheduling</TabsTrigger>
            <TabsTrigger value="voice">Voice</TabsTrigger>
            <TabsTrigger value="assistant">Assistant</TabsTrigger>
          </TabsList>

          <TabsContent value="core" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="core-instructions">Core Instructions</Label>
              <p className="text-sm text-muted-foreground">
                Shared instructions used by all AI systems (voice assistant, text assistant, and scheduler)
              </p>
              <Textarea
                id="core-instructions"
                value={coreInstructions}
                onChange={(e) => setCoreInstructions(e.target.value)}
                className="min-h-[400px] font-mono text-sm"
                placeholder="Enter core AI instructions..."
              />
            </div>
          </TabsContent>

          <TabsContent value="scheduling" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="scheduling-philosophy">Scheduling Philosophy</Label>
              <p className="text-sm text-muted-foreground">
                Custom scheduling preferences and philosophy used by the smart scheduler
              </p>
              <Textarea
                id="scheduling-philosophy"
                value={schedulingPhilosophy}
                onChange={(e) => setSchedulingPhilosophy(e.target.value)}
                className="min-h-[400px] font-mono text-sm"
                placeholder="E.g., 'Prioritize deep work in the morning, schedule meetings in the afternoon...'"
              />
            </div>
          </TabsContent>

          <TabsContent value="voice" className="space-y-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="auto-greeting-timeout">Auto-Greeting Timeout (seconds)</Label>
                <p className="text-sm text-muted-foreground">
                  If no speech is detected within this time after connecting, the assistant will greet you
                </p>
                <Input
                  id="auto-greeting-timeout"
                  type="number"
                  min="1"
                  max="30"
                  value={autoGreetingTimeout}
                  onChange={(e) => setAutoGreetingTimeout(e.target.value)}
                  className="max-w-xs"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="realtime-extensions">Voice-Specific Extensions</Label>
                <p className="text-sm text-muted-foreground">
                  Additional instructions specific to the realtime voice assistant (WebRTC)
                </p>
                <Textarea
                  id="realtime-extensions"
                  value={realtimeExtensions}
                  onChange={(e) => setRealtimeExtensions(e.target.value)}
                  className="min-h-[300px] font-mono text-sm"
                  placeholder="E.g., 'Use casual language when responding to voice commands...'"
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="assistant" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="assistant-extensions">Text Assistant Extensions</Label>
              <p className="text-sm text-muted-foreground">
                Additional instructions for the text-based assistant (used for complex reasoning)
              </p>
              <Textarea
                id="assistant-extensions"
                value={assistantExtensions}
                onChange={(e) => setAssistantExtensions(e.target.value)}
                className="min-h-[400px] font-mono text-sm"
                placeholder="E.g., 'When analyzing tasks, provide detailed breakdowns...'"
              />
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex items-center gap-3 mt-6 pt-6 border-t">
          <Button
            variant="outline"
            onClick={handleReset}
            disabled={saving}
            className="flex items-center gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            Reset to Defaults
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Save Preferences
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default VoiceAssistantSettings;
