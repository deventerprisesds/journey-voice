import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { 
  CalendarIcon, 
  Wand2, 
  Plus, 
  X, 
  Loader2, 
  Mic, 
  Type,
  Sparkles,
  Check,
  AlertCircle,
  Clock
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Task } from '@/types/task';
import { fromHHMMToISO } from '@/lib/date';

interface ParsedTask {
  title: string;
  description?: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  category: 'LIFE' | 'CAREER' | 'VENTURES' | 'EDUCATION';
  due_date?: string;
  start_time?: string;
  end_time?: string;
  estimate_minutes?: number;
  status: 'BACKLOG' | 'TODO' | 'READY' | 'UP_NEXT' | 'DOING';
}

interface TaskCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTasksCreated: (tasks: Task[]) => void;
  boardId: string;
  userId: string;
}

const TaskCreationModal: React.FC<TaskCreationModalProps> = ({
  isOpen,
  onClose,
  onTasksCreated,
  boardId,
  userId
}) => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'ai' | 'manual'>('ai');
  
  // AI Mode State
  const [aiInput, setAiInput] = useState('');
  const [isParsingAI, setIsParsingAI] = useState(false);
  const [parsedTasks, setParsedTasks] = useState<ParsedTask[]>([]);
  
  // Manual Mode State  
  const [manualTask, setManualTask] = useState<Partial<Task>>({
    title: '',
    description: '',
    priority: 'MEDIUM',
    category: 'LIFE',
    status: 'BACKLOG'
  });
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [estimateHours, setEstimateHours] = useState('');
  const [estimateMinutes, setEstimateMinutes] = useState('');
  
  // Common State
  const [isCreating, setIsCreating] = useState(false);

  // Helper function to calculate duration
  const calculateDuration = (start: string, end: string): string => {
    if (!start || !end) return '';
    
    const [startHour, startMin] = start.split(':').map(Number);
    const [endHour, endMin] = end.split(':').map(Number);
    
    const startTotalMin = startHour * 60 + startMin;
    const endTotalMin = endHour * 60 + endMin;
    
    let duration = endTotalMin - startTotalMin;
    if (duration < 0) duration += 24 * 60; // Handle next day
    
    const hours = Math.floor(duration / 60);
    const minutes = duration % 60;
    
    if (hours === 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
  };

  // Calculate and update estimate when times change
  useEffect(() => {
    if (startTime && endTime) {
      const [startHour, startMin] = startTime.split(':').map(Number);
      const [endHour, endMin] = endTime.split(':').map(Number);
      
      const startTotalMin = startHour * 60 + startMin;
      const endTotalMin = endHour * 60 + endMin;
      
      let duration = endTotalMin - startTotalMin;
      if (duration < 0) duration += 24 * 60; // Handle next day
      
      const hours = Math.floor(duration / 60);
      const minutes = duration % 60;
      
      setEstimateHours(hours > 0 ? hours.toString() : '');
      setEstimateMinutes(minutes > 0 ? minutes.toString() : '');
    }
  }, [startTime, endTime]);

  const handleAIParseTask = async () => {
    if (!aiInput.trim()) {
      toast({
        title: "Input Required",
        description: "Please enter a task description",
        variant: "destructive",
      });
      return;
    }

    setIsParsingAI(true);
    try {
      console.log('Parsing AI input:', aiInput);
      
      const { data, error } = await supabase.functions.invoke('ai-task-parser', {
        body: { text: aiInput, mode: 'multiple' }
      });

      if (error) {
        throw new Error(error.message);
      }

      if (!data?.tasks || data.tasks.length === 0) {
        throw new Error('No tasks could be parsed from the input');
      }

      setParsedTasks(data.tasks);
      toast({
        title: "Tasks Parsed Successfully",
        description: `Found ${data.tasks.length} task${data.tasks.length > 1 ? 's' : ''}`,
      });
    } catch (error) {
      console.error('Error parsing tasks:', error);
      toast({
        title: "Parsing Error",
        description: error instanceof Error ? error.message : 'Failed to parse tasks',
        variant: "destructive",
      });
    } finally {
      setIsParsingAI(false);
    }
  };

  const handleCreateTasks = async (tasksToCreate: ParsedTask[]) => {
    setIsCreating(true);
    try {
      // Check if this is demo mode (board ID starts with 'demo-')
      const isDemoMode = boardId.startsWith('demo-');
      
      const tasksWithMeta = tasksToCreate.map(task => ({
        ...task,
        id: isDemoMode ? `demo-task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` : undefined,
        board_id: boardId,
        user_id: userId,
        due_date: task.due_date || null,
        start_time: task.start_time || null,
        end_time: task.end_time || null,
        estimate_minutes: task.estimate_minutes || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      let createdTasks;
      
      if (isDemoMode) {
        // For demo mode, store in localStorage
        const demoTasks = JSON.parse(localStorage.getItem('kanban-demo-tasks') || '[]');
        createdTasks = tasksWithMeta;
        demoTasks.push(...createdTasks);
        localStorage.setItem('kanban-demo-tasks', JSON.stringify(demoTasks));
      } else {
        // For real mode, use Supabase
        const { data, error } = await supabase
          .from('tasks')
          .insert(tasksWithMeta)
          .select();

        if (error) {
          throw new Error(error.message);
        }
        createdTasks = data;
      }

      // Auto-schedule tasks with date/time information or context clues
      const tasksToSchedule = createdTasks.filter(task => 
        (!task.start_time && !task.end_time) && // Not already scheduled
        (task.due_date || task.scheduling_context) // Has date or context for scheduling
      );

      for (const task of tasksToSchedule) {
        if (!isDemoMode) {
          try {
            const { scheduleNewTask } = await import('@/utils/taskScheduling');
            const scheduleResult = await scheduleNewTask({
              ...task,
              scheduling_context: task.scheduling_context
            });
            
            if (scheduleResult.success && scheduleResult.scheduledTask) {
              // Update the task in createdTasks with scheduled times
              const taskIndex = createdTasks.findIndex(t => t.id === task.id);
              if (taskIndex !== -1) {
                createdTasks[taskIndex] = scheduleResult.scheduledTask;
              }
            }
          } catch (error) {
            console.warn('Failed to auto-schedule task:', task.id, error);
          }
        }
      }

      onTasksCreated(createdTasks);
      
      // Send immediate task creation notifications to enabled channels
      for (const task of createdTasks) {
        try {
          await supabase.functions.invoke('send-push-notification', {
            body: {
              userId: task.user_id,
              title: 'New Task Created',
              body: `"${task.title}" has been added to your tasks`,
              data: {
                type: 'task_created',
                taskId: task.id
              }
            }
          });
        } catch (error) {
          console.error('Error sending task creation notification:', task.id, error);
        }
        
        // Auto-generate reminders for tasks with due dates OR scheduled times
        if (task.due_date || task.start_time) {
          try {
            await supabase.functions.invoke('generate-task-reminders', {
              body: {
                taskId: task.id,
                userId: task.user_id,
                dueDate: task.due_date,
                startTime: task.start_time,
                title: task.title,
                reminderMinutes: 15 // Default Slack reminder 15 minutes before
              }
            });
          } catch (error) {
            console.error('Error generating reminders for task:', task.id, error);
          }
        }
      }
      
      toast({
        title: "Tasks Created",
        description: `Successfully created ${createdTasks.length} task${createdTasks.length > 1 ? 's' : ''} with automatic reminders`,
      });
      
      handleClose();
    } catch (error) {
      console.error('Error creating tasks:', error);
      toast({
        title: "Creation Error",
        description: error instanceof Error ? error.message : 'Failed to create tasks',
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreateManualTask = async () => {
    if (!manualTask.title?.trim()) {
      toast({
        title: "Title Required",
        description: "Please enter a task title",
        variant: "destructive",
      });
      return;
    }

    const hours = parseInt(estimateHours) || 0;
    const minutes = parseInt(estimateMinutes) || 0;
    const totalMinutes = hours * 60 + minutes;

    const taskToCreate: ParsedTask = {
      title: manualTask.title!,
      description: manualTask.description || undefined,
      priority: manualTask.priority as ParsedTask['priority'],
      category: manualTask.category as ParsedTask['category'],
      status: manualTask.status as ParsedTask['status'],
      due_date: dueDate ? dueDate.toISOString() : undefined,
      start_time: startTime ? fromHHMMToISO(dueDate || new Date(), startTime) : undefined,
      end_time: endTime ? fromHHMMToISO(dueDate || new Date(), endTime) : undefined,
      estimate_minutes: totalMinutes > 0 ? totalMinutes : undefined,
    };

    await handleCreateTasks([taskToCreate]);
  };

  const handleClose = () => {
    // Reset state
    setActiveTab('ai');
    setAiInput('');
    setParsedTasks([]);
    setManualTask({
      title: '',
      description: '',
      priority: 'MEDIUM',
      category: 'LIFE',
      status: 'BACKLOG'
    });
    setDueDate(undefined);
    setEstimateHours('');
    setEstimateMinutes('');
    onClose();
  };

  const removeParsedTask = (index: number) => {
    setParsedTasks(prev => prev.filter((_, i) => i !== index));
  };

  const editParsedTask = (index: number, field: keyof ParsedTask, value: any) => {
    setParsedTasks(prev => prev.map((task, i) => 
      i === index ? { ...task, [field]: value } : task
    ));
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Create New Tasks
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'ai' | 'manual')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="ai" className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              AI Assistant
            </TabsTrigger>
            <TabsTrigger value="manual" className="flex items-center gap-2">
              <Type className="h-4 w-4" />
              Manual Entry
            </TabsTrigger>
          </TabsList>

          {/* AI Mode */}
          <TabsContent value="ai" className="space-y-6">
            <div className="space-y-4">
              <div>
                <Label htmlFor="ai-input">Describe your tasks</Label>
                <p className="text-sm text-muted-foreground mb-2">
                  Tell the AI what you need to do. You can include multiple tasks, priorities, due dates, and time estimates.
                </p>
                <Textarea
                  id="ai-input"
                  placeholder="e.g., Schedule dentist appointment for next Tuesday, finish project proposal by Friday (urgent, 3 hours), learn React and Vue.js..."
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  rows={4}
                  className="resize-none"
                />
              </div>

              <div className="flex gap-2">
                <Button 
                  onClick={handleAIParseTask}
                  disabled={isParsingAI || !aiInput.trim()}
                  className="flex-1"
                >
                  {isParsingAI ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Parsing Tasks...
                    </>
                  ) : (
                    <>
                      <Wand2 className="h-4 w-4 mr-2" />
                      Parse Tasks with AI
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Parsed Tasks Preview */}
            {parsedTasks.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-medium">Parsed Tasks ({parsedTasks.length})</h3>
                  <Button
                    onClick={() => handleCreateTasks(parsedTasks)}
                    disabled={isCreating}
                    className="bg-primary hover:bg-primary/90"
                  >
                    {isCreating ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <Check className="h-4 w-4 mr-2" />
                        Create All Tasks
                      </>
                    )}
                  </Button>
                </div>

                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {parsedTasks.map((task, index) => (
                    <div key={index} className="border rounded-lg p-4 space-y-2">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 space-y-2">
                          <Input
                            value={task.title}
                            onChange={(e) => editParsedTask(index, 'title', e.target.value)}
                            className="font-medium"
                          />
                          {task.description && (
                            <Textarea
                              value={task.description}
                              onChange={(e) => editParsedTask(index, 'description', e.target.value)}
                              rows={2}
                              className="text-sm"
                            />
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeParsedTask(index)}
                          className="ml-2"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>

                      {/* Editable Task Properties */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
                        {/* Priority */}
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">Priority</Label>
                          <Select
                            value={task.priority}
                            onValueChange={(value) => editParsedTask(index, 'priority', value)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="LOW">Low</SelectItem>
                              <SelectItem value="MEDIUM">Medium</SelectItem>
                              <SelectItem value="HIGH">High</SelectItem>
                              <SelectItem value="URGENT">Urgent</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Category */}
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">Category</Label>
                          <Select
                            value={task.category}
                            onValueChange={(value) => editParsedTask(index, 'category', value)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="LIFE">Life</SelectItem>
                              <SelectItem value="CAREER">Career</SelectItem>
                              <SelectItem value="VENTURES">Ventures</SelectItem>
                              <SelectItem value="EDUCATION">Education</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Status */}
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">Status</Label>
                          <Select
                            value={task.status}
                            onValueChange={(value) => editParsedTask(index, 'status', value)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="BACKLOG">Backlog</SelectItem>
                              <SelectItem value="TODO">To Do</SelectItem>
                              <SelectItem value="READY">Ready</SelectItem>
                              <SelectItem value="UP_NEXT">Up Next</SelectItem>
                              <SelectItem value="DOING">Doing</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Due Date */}
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">Due Date</Label>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                className={cn(
                                  "h-8 justify-start text-left font-normal text-xs",
                                  !task.due_date && "text-muted-foreground"
                                )}
                              >
                                <CalendarIcon className="mr-1 h-3 w-3" />
                                {task.due_date ? format(new Date(task.due_date), "MMM d") : "Set date"}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                              <Calendar
                                mode="single"
                                selected={task.due_date ? new Date(task.due_date) : undefined}
                                onSelect={(date) => editParsedTask(index, 'due_date', date?.toISOString())}
                                initialFocus
                                className={cn("p-3 pointer-events-auto")}
                              />
                            </PopoverContent>
                          </Popover>
                        </div>

                        {/* Time Estimate */}
                        <div className="space-y-2 col-span-2">
                          <Label className="text-xs font-medium">Time Estimate</Label>
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                placeholder="0"
                                value={task.estimate_minutes ? Math.floor(task.estimate_minutes / 60) : ''}
                                onChange={(e) => {
                                  const hours = parseInt(e.target.value) || 0;
                                  const minutes = task.estimate_minutes ? task.estimate_minutes % 60 : 0;
                                  editParsedTask(index, 'estimate_minutes', hours * 60 + minutes);
                                }}
                                className="w-16 h-8 text-xs"
                                min="0"
                              />
                              <span className="text-xs text-muted-foreground">h</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                placeholder="0"
                                value={task.estimate_minutes ? task.estimate_minutes % 60 : ''}
                                onChange={(e) => {
                                  const minutes = parseInt(e.target.value) || 0;
                                  const hours = task.estimate_minutes ? Math.floor(task.estimate_minutes / 60) : 0;
                                  editParsedTask(index, 'estimate_minutes', hours * 60 + minutes);
                                }}
                                className="w-16 h-8 text-xs"
                                min="0"
                                max="59"
                              />
                              <span className="text-xs text-muted-foreground">m</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Manual Mode */}
          <TabsContent value="manual" className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="manual-title">Title *</Label>
                <Input
                  id="manual-title"
                  value={manualTask.title || ''}
                  onChange={(e) => setManualTask({ ...manualTask, title: e.target.value })}
                  placeholder="Enter task title"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="manual-description">Description</Label>
                <Textarea
                  id="manual-description"
                  value={manualTask.description || ''}
                  onChange={(e) => setManualTask({ ...manualTask, description: e.target.value })}
                  placeholder="Enter task description"
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Select
                    value={manualTask.priority}
                    onValueChange={(value) => setManualTask({ ...manualTask, priority: value as Task['priority'] })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LOW">Low</SelectItem>
                      <SelectItem value="MEDIUM">Medium</SelectItem>
                      <SelectItem value="HIGH">High</SelectItem>
                      <SelectItem value="URGENT">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select
                    value={manualTask.category}
                    onValueChange={(value) => setManualTask({ ...manualTask, category: value as Task['category'] })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LIFE">Life</SelectItem>
                      <SelectItem value="CAREER">Career</SelectItem>
                      <SelectItem value="VENTURES">Ventures</SelectItem>
                      <SelectItem value="EDUCATION">Education</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select
                    value={manualTask.status}
                    onValueChange={(value) => setManualTask({ ...manualTask, status: value as Task['status'] })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BACKLOG">Backlog</SelectItem>
                      <SelectItem value="TODO">To Do</SelectItem>
                      <SelectItem value="READY">Ready</SelectItem>
                      <SelectItem value="UP_NEXT">Up Next</SelectItem>
                      <SelectItem value="DOING">Doing</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Due Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !dueDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dueDate ? format(dueDate, "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={dueDate}
                      onSelect={setDueDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Start & End Time */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="manual-start-time">Start Time</Label>
                  <Input
                    id="manual-start-time"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="manual-end-time">End Time</Label>
                  <Input
                    id="manual-end-time"
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full"
                  />
                </div>
              </div>

              {/* Calculated Duration */}
              {startTime && endTime && (
                <div className="space-y-2">
                  <Label>Calculated Duration</Label>
                  <div className="px-3 py-2 bg-muted rounded-md text-sm">
                    <Clock className="inline h-4 w-4 mr-1" />
                    {calculateDuration(startTime, endTime)}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>Time Estimate</Label>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      placeholder="0"
                      value={estimateHours}
                      onChange={(e) => setEstimateHours(e.target.value)}
                      className="w-20"
                      min="0"
                    />
                    <span className="text-sm text-muted-foreground">hours</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      placeholder="0"
                      value={estimateMinutes}
                      onChange={(e) => setEstimateMinutes(e.target.value)}
                      className="w-20"
                      min="0"
                      max="59"
                    />
                    <span className="text-sm text-muted-foreground">minutes</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleCreateManualTask} disabled={isCreating || !manualTask.title?.trim()}>
                {isCreating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Task
                  </>
                )}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default TaskCreationModal;