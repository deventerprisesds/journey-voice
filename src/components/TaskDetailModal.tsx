import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { CalendarIcon, X, Plus, Clock, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'BACKLOG' | 'TODO' | 'DOING' | 'DONE';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  category: 'LIFE' | 'CAREER' | 'VENTURES' | 'EDUCATION';
  due_date?: string;
  estimate_minutes?: number;
  blocked_by?: string[];
  board_id: string;
  user_id: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

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
  const { toast } = useToast();
  const [editedTask, setEditedTask] = useState<Partial<Task>>({});
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);
  const [estimateHours, setEstimateHours] = useState<string>('');
  const [estimateMinutes, setEstimateMinutes] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  // Initialize form when task changes
  useEffect(() => {
    if (task) {
      setEditedTask(task);
      setDueDate(task.due_date ? new Date(task.due_date) : undefined);
      
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

  const handleSave = async () => {
    if (!task) return;

    setIsSaving(true);
    try {
      // Calculate total estimate in minutes
      const hours = parseInt(estimateHours) || 0;
      const minutes = parseInt(estimateMinutes) || 0;
      const totalMinutes = hours * 60 + minutes;

      const updatedTask = {
        ...editedTask,
        due_date: dueDate ? dueDate.toISOString() : null,
        estimate_minutes: totalMinutes > 0 ? totalMinutes : null,
      };

      const { error } = await supabase
        .from('tasks')
        .update(updatedTask)
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

  if (!task) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Task</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
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
                value={editedTask.status}
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
                value={editedTask.priority}
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
                value={editedTask.category}
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
              <Select onValueChange={handleAddDependency}>
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
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TaskDetailModal;