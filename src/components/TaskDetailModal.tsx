import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { CalendarIcon, X, Plus, Clock, AlertTriangle, Timer, GitBranch } from 'lucide-react';
import DependencyTree from './DependencyTree';
import TimeTracker from './TimeTracker';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Task } from '@/types/task';
import { useMemo } from 'react';
import { toLocalTimeHHMM, fromHHMMToISO } from '@/lib/date';

interface TaskDetailModalProps {
  task: Task | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (task: Task) => void;
  allTasks?: Task[];
}

const TaskDetailModal: React.FC<TaskDetailModalProps> = ({
  task,
  isOpen,
  onClose,
  onSave,
  allTasks = []
}) => {
  console.log('TaskDetailModal render:', { 
    taskId: task?.id, 
    isOpen, 
    taskTitle: task?.title 
  });
  
  const { toast } = useToast();
  const [editedTask, setEditedTask] = useState<Partial<Task>>({});
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [estimateHours, setEstimateHours] = useState<string>('');
  const [estimateMinutes, setEstimateMinutes] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  // Initialize form when task changes
  useEffect(() => {
    console.log('TaskDetailModal useEffect - task changed:', task?.id);
    if (task) {
      setEditedTask(task);
      setDueDate(task.due_date ? new Date(task.due_date) : undefined);
      
      // Use the new date utility for consistent time conversion
      setStartTime(task.start_time ? toLocalTimeHHMM(task.start_time) : '');
      setEndTime(task.end_time ? toLocalTimeHHMM(task.end_time) : '');
      
      if (task.estimate_minutes) {
        const hours = Math.floor(task.estimate_minutes / 60);
        const minutes = task.estimate_minutes % 60;
        setEstimateHours(hours > 0 ? hours.toString() : '');
        setEstimateMinutes(minutes > 0 ? minutes.toString() : '');
      } else {
        setEstimateHours('');
        setEstimateMinutes('');
      }
    }
  }, [task]);

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

  const handleDelete = async () => {
    if (!task) return;

    setIsSaving(true);
    try {
      // Check if this is a demo task (ID starts with 'demo-')
      const isDemoTask = task.id.startsWith('demo-');
      
      if (isDemoTask) {
        // For demo tasks, remove from localStorage instead of Supabase
        const demoTasks = JSON.parse(localStorage.getItem('kanban-demo-tasks') || '[]');
        const filteredTasks = demoTasks.filter((t: Task) => t.id !== task.id);
        localStorage.setItem('kanban-demo-tasks', JSON.stringify(filteredTasks));
      } else {
        // For real tasks, delete from Supabase
        const { error } = await supabase
          .from('tasks')
          .delete()
          .eq('id', task.id);

        if (error) {
          console.error('Error deleting task:', error);
          toast({
            title: "Error",
            description: "Failed to delete task",
            variant: "destructive",
          });
          return;
        }
      }

      toast({
        title: "Task deleted",
        description: "Task has been permanently removed",
      });
      onSave({ ...task, deleted: true } as any); // Trigger parent update
      onClose();
    } catch (error) {
      console.error('Error deleting task:', error);
      toast({
        title: "Error",
        description: "Failed to delete task",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    if (!task) return;

    setIsSaving(true);
    try {
      // Calculate total estimate in minutes
      const hours = parseInt(estimateHours) || 0;
      const minutes = parseInt(estimateMinutes) || 0;
      const totalMinutes = hours * 60 + minutes;

      // Use the new date utility for consistent time conversion
      const baseDate = dueDate || new Date();
      const startTimeISO = startTime ? fromHHMMToISO(baseDate, startTime) : null;
      const endTimeISO = endTime ? fromHHMMToISO(baseDate, endTime) : null;

      console.log('Time conversion debug:', {
        startTimeInput: startTime,
        endTimeInput: endTime,
        startTimeISO,
        endTimeISO,
        dueDate: dueDate?.toISOString()
      });

      const updatedTask = {
        ...editedTask,
        due_date: dueDate ? dueDate.toISOString() : null,
        start_time: startTimeISO,
        end_time: endTimeISO,
        estimate_minutes: totalMinutes > 0 ? totalMinutes : null,
      };

      // Check if this is a demo task (ID starts with 'demo-')
      const isDemoTask = task.id.startsWith('demo-');
      
      if (isDemoTask) {
        // For demo tasks, update localStorage instead of Supabase
        const demoTasks = JSON.parse(localStorage.getItem('kanban-demo-tasks') || '[]');
        const taskIndex = demoTasks.findIndex((t: Task) => t.id === task.id);
        
        if (taskIndex !== -1) {
          demoTasks[taskIndex] = { ...task, ...updatedTask };
          localStorage.setItem('kanban-demo-tasks', JSON.stringify(demoTasks));
        }
      } else {
        // For real tasks, update Supabase
        const { error } = await supabase
          .from('tasks')
          .update(updatedTask as any)
          .eq('id', task.id);

        if (error) {
          console.error('Error updating task:', error);
          toast({
            title: "Error",
            description: "Failed to update task",
            variant: "destructive",
          });
          return;
        }
        
        // Generate reminders for tasks with due dates or start times after update
        if (updatedTask.due_date || updatedTask.start_time) {
          try {
            await supabase.functions.invoke('generate-task-reminders', {
              body: {
                taskId: task.id,
                userId: task.user_id,
                dueDate: updatedTask.due_date,
                startTime: updatedTask.start_time,
                title: updatedTask.title,
                reminderMinutes: 15
              }
            });
            
            // Process pending notifications immediately
            await supabase.functions.invoke('notification-delivery', {
              body: { immediate: true }
            });
          } catch (error) {
            console.error('Error generating reminders after task update:', error);
          }
        }
      }

      onSave({ ...task, ...updatedTask } as Task);
      toast({
        title: "Task updated",
        description: "Your task has been saved successfully",
      });
      onClose();
    } catch (error) {
      console.error('Error saving task:', error);
      toast({
        title: "Error",
        description: "Failed to save task",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddDependency = (dependencyId: string) => {
    const currentBlocked = editedTask.blocked_by || [];
    if (!currentBlocked.includes(dependencyId)) {
      setEditedTask({
        ...editedTask,
        blocked_by: [...currentBlocked, dependencyId]
      });
    }
  };

  const handleRemoveDependency = (dependencyId: string) => {
    const currentBlocked = editedTask.blocked_by || [];
    setEditedTask({
      ...editedTask,
      blocked_by: currentBlocked.filter(id => id !== dependencyId)
    });
  };

  const availableTasks = allTasks.filter(t => 
    t.id !== task?.id && 
    t.status !== 'DONE' && 
    !(editedTask.blocked_by || []).includes(t.id)
  );

  const blockedByTasks = allTasks.filter(t => 
    (editedTask.blocked_by || []).includes(t.id)
  );

  // Move useMemo BEFORE the conditional return to follow Rules of Hooks
  const taskMap = useMemo(() => {
    return allTasks.reduce((map, t) => {
      map[t.id] = t;
      return map;
    }, {} as Record<string, Task>);
  }, [allTasks]);

  if (!task) return null;

  const validateDependencies = (newDependencies: string[]): boolean => {
    // Check for circular dependencies using DFS
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    
    const hasCycle = (taskId: string): boolean => {
      if (recursionStack.has(taskId)) return true;
      if (visited.has(taskId)) return false;
      
      visited.add(taskId);
      recursionStack.add(taskId);
      
      const taskDeps = taskId === task.id ? newDependencies : (taskMap[taskId]?.blocked_by || []);
      
      for (const depId of taskDeps) {
        if (hasCycle(depId)) return true;
      }
      
      recursionStack.delete(taskId);
      return false;
    };
    
    return !hasCycle(task.id);
  };

  const handleAddDependencyWithValidation = (dependencyId: string) => {
    const currentBlocked = editedTask.blocked_by || [];
    const newDependencies = [...currentBlocked, dependencyId];
    
    if (validateDependencies(newDependencies)) {
      setEditedTask({
        ...editedTask,
        blocked_by: newDependencies
      });
    } else {
      toast({
        title: "Circular dependency detected",
        description: "Adding this dependency would create a circular reference",
        variant: "destructive",
      });
    }
  };

  // Error boundary fallback
  if (!task && isOpen) {
    console.error('TaskDetailModal: Task is null but modal is open');
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Error</DialogTitle>
            <DialogDescription>
              Unable to load task details. Please try again.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-6">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Don't render anything if modal is closed
  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Task</DialogTitle>
          <DialogDescription>
            Make changes to your task details, dependencies, and time tracking.
          </DialogDescription>
        </DialogHeader>

        {!task ? (
          <>
            <div className="flex items-center justify-center py-8">
              <div className="text-center">
                <h3 className="text-lg font-medium text-muted-foreground">No task selected</h3>
                <p className="text-sm text-muted-foreground">Please select a task to edit.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </div>
          </>
        ) : (
          <>
            <Tabs defaultValue="details" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="dependencies">
              <GitBranch className="h-4 w-4 mr-1" />
              Dependencies
            </TabsTrigger>
            <TabsTrigger value="time">
              <Timer className="h-4 w-4 mr-1" />
              Time Tracking
            </TabsTrigger>
            <TabsTrigger value="tree">Dependency Tree</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-6">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={editedTask.title || ''}
              onChange={(e) => setEditedTask({ ...editedTask, title: e.target.value })}
              placeholder="Task title"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={editedTask.description || ''}
              onChange={(e) => setEditedTask({ ...editedTask, description: e.target.value })}
              placeholder="Task description"
              rows={3}
            />
          </div>

          {/* Status, Priority, Category Row */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={editedTask.status || ''}
                onValueChange={(value) => setEditedTask({ ...editedTask, status: value as Task['status'] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BACKLOG">Backlog</SelectItem>
                  <SelectItem value="TODO">To Do</SelectItem>
                  <SelectItem value="DOING">In Progress</SelectItem>
                  <SelectItem value="DONE">Done</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Priority</Label>
              <Select
                value={editedTask.priority || ''}
                onValueChange={(value) => setEditedTask({ ...editedTask, priority: value as Task['priority'] })}
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
                value={editedTask.category || ''}
                onValueChange={(value) => setEditedTask({ ...editedTask, category: value as Task['category'] })}
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
          </div>

          {/* Due Date */}
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
                  className="pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Start & End Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start-time">Start Time</Label>
              <Input
                id="start-time"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end-time">End Time</Label>
              <Input
                id="end-time"
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

          {/* Time Estimate */}
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

          {/* Dependencies */}
          <div className="space-y-2">
            <Label>Dependencies</Label>
            <p className="text-sm text-muted-foreground">
              Tasks that must be completed before this one
            </p>
            
            {/* Current dependencies */}
            {blockedByTasks.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {blockedByTasks.map((dep) => (
                  <Badge key={dep.id} variant="secondary" className="flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {dep.title}
                    <button
                      onClick={() => handleRemoveDependency(dep.id)}
                      className="ml-1 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            {/* Add dependency dropdown */}
            {availableTasks.length > 0 && (
              <Select onValueChange={handleAddDependencyWithValidation}>
                <SelectTrigger>
                  <SelectValue placeholder="Add a dependency..." />
                </SelectTrigger>
                <SelectContent>
                  {availableTasks.map((availableTask) => (
                    <SelectItem key={availableTask.id} value={availableTask.id}>
                      {availableTask.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex justify-between">
            <Button variant="destructive" onClick={handleDelete} disabled={isSaving}>
              {isSaving ? 'Deleting...' : 'Delete Task'}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
          </TabsContent>

          <TabsContent value="dependencies" className="space-y-4">
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium mb-2">Manage Dependencies</h3>
                <p className="text-xs text-muted-foreground mb-4">
                  Tasks that must be completed before this one can start
                </p>
                
                {/* Current dependencies */}
                {blockedByTasks.length > 0 && (
                  <div className="space-y-2 mb-4">
                    <Label className="text-xs font-medium">Current Dependencies</Label>
                    <div className="flex flex-wrap gap-2">
                      {blockedByTasks.map((dep) => (
                        <Badge key={dep.id} variant="secondary" className="flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          {dep.title}
                          <button
                            onClick={() => handleRemoveDependency(dep.id)}
                            className="ml-1 hover:text-destructive"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Add dependency */}
                {availableTasks.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs font-medium">Add Dependency</Label>
                    <Select onValueChange={handleAddDependencyWithValidation}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a task to depend on..." />
                      </SelectTrigger>
                      <SelectContent>
                        {availableTasks.map((availableTask) => (
                          <SelectItem key={availableTask.id} value={availableTask.id}>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                {availableTask.priority.toLowerCase()}
                              </Badge>
                              {availableTask.title}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                
                {availableTasks.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No available tasks to add as dependencies
                  </p>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="time">
            {task && <TimeTracker task={task} onTimeUpdate={() => {}} />}
          </TabsContent>

          <TabsContent value="tree">
            <DependencyTree tasks={allTasks} selectedTaskId={task?.id} />
          </TabsContent>
            </Tabs>

            <div className="flex justify-between mt-6">
              <Button variant="destructive" onClick={handleDelete} disabled={isSaving}>
                {isSaving ? 'Deleting...' : 'Delete Task'}
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose} disabled={isSaving}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default TaskDetailModal;