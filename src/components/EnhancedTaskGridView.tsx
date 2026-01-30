import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  CalendarIcon, 
  Clock, 
  Edit3, 
  Flag, 
  Target,
  ChevronRight,
  ChevronDown,
  Plus,
  FolderOpen,
  FolderClosed,
  Trash2,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  Play
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { formatDateOnly, formatDuration } from '@/lib/date';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

import { Task } from '@/types/task';

interface TaskGridViewProps {
  tasks: Task[];
  onTaskEdit?: (task: Task) => void;
  onTaskUpdate?: () => void;
  onStatusChange?: (taskId: string, newStatus: Task['status']) => void;
}

type GroupByType = 'category' | 'status' | 'priority' | 'due_date';

const priorityColors = {
  LOW: 'bg-gray-100 text-gray-700 border-gray-300',
  MEDIUM: 'bg-blue-100 text-blue-700 border-blue-300',
  HIGH: 'bg-orange-100 text-orange-700 border-orange-300',
  URGENT: 'bg-red-100 text-red-700 border-red-300',
};

const statusColors = {
  BLOCKED: 'bg-red-50 text-red-700',
  LIFE: 'bg-pink-50 text-pink-700',
  BACKLOG: 'bg-gray-50 text-gray-700',
  TODO: 'bg-blue-50 text-blue-700',
  READY: 'bg-green-50 text-green-700',
  UP_NEXT: 'bg-purple-50 text-purple-700',
  DOING: 'bg-yellow-50 text-yellow-700',
  DONE: 'bg-emerald-50 text-emerald-700',
  CAREER: 'bg-blue-50 text-blue-700',
  PROF_EDUCATION: 'bg-purple-50 text-purple-700',
  VENTURES: 'bg-green-50 text-green-700',
  PLANNING: 'bg-yellow-50 text-yellow-700',
};

const categoryColors = {
  LIFE: 'bg-pink-100 text-pink-700 border-pink-300',
  CAREER: 'bg-blue-100 text-blue-700 border-blue-300',
  VENTURES: 'bg-green-100 text-green-700 border-green-300',
  EDUCATION: 'bg-purple-100 text-purple-700 border-purple-300',
  PROF_EDUCATION: 'bg-purple-100 text-purple-700 border-purple-300',
};

const TaskGridView: React.FC<TaskGridViewProps> = ({ tasks, onTaskEdit, onTaskUpdate, onStatusChange }) => {
  const { toast } = useToast();
  const { isDemoMode, user } = useAuth();
  const [sortBy, setSortBy] = useState<string>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [groupBy, setGroupBy] = useState<GroupByType>('category');
  const [editingCell, setEditingCell] = useState<{ taskId: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [optimisticTasks, setOptimisticTasks] = useState<Task[]>([]);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [showCompletedTasks, setShowCompletedTasks] = useState(() => {
    const stored = localStorage.getItem('grid-show-completed');
    return stored ? JSON.parse(stored) : true;
  });

  // Calculate progress percentage based on status
  const getProgressPercentage = (status: string): number => {
    const progressMap: { [key: string]: number } = {
      BLOCKED: 0,
      LIFE: 25,
      BACKLOG: 0,
      TODO: 10,
      READY: 20,
      UP_NEXT: 30,
      PLANNING: 40,
      DOING: 60,
      CAREER: 70,
      PROF_EDUCATION: 70,
      VENTURES: 70,
      DONE: 100,
    };
    return progressMap[status] || 0;
  };

  const formatDuration = (minutes?: number): string => {
    if (!minutes) return '-';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours === 0) return `${mins}m`;
    if (mins === 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
  };

  // Using utility function for consistent date formatting

  // Use optimistic tasks if available, otherwise use the provided tasks
  const currentTasks = optimisticTasks.length > 0 ? optimisticTasks : tasks;

  // Toggle show/hide completed tasks
  const toggleShowCompletedTasks = () => {
    const newValue = !showCompletedTasks;
    setShowCompletedTasks(newValue);
    localStorage.setItem('grid-show-completed', JSON.stringify(newValue));
  };

  // Group tasks by the selected groupBy field
  const groupedTasks = useMemo(() => {
    // Filter out completed tasks if toggle is off
    const filteredByCompletion = showCompletedTasks 
      ? currentTasks 
      : currentTasks.filter(task => task.status !== 'DONE');
    
    const groups: { [key: string]: Task[] } = {};
    
    filteredByCompletion.forEach(task => {
      let groupKey = '';
      switch (groupBy) {
        case 'category':
          groupKey = task.category;
          break;
        case 'status':
          groupKey = task.status;
          break;
        case 'priority':
          groupKey = task.priority;
          break;
        case 'due_date':
          if (task.due_date) {
            const date = new Date(task.due_date);
            groupKey = format(date, 'MMM yyyy');
          } else {
            groupKey = 'No Due Date';
          }
          break;
        default:
          groupKey = 'All Tasks';
      }
      
      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(task);
    });

    // Sort tasks within each group
    Object.keys(groups).forEach(groupKey => {
      groups[groupKey].sort((a, b) => {
        let aValue: any = a[sortBy as keyof Task];
        let bValue: any = b[sortBy as keyof Task];

        // Handle date sorting
        if (sortBy === 'due_date' || sortBy === 'created_at') {
          aValue = aValue ? new Date(aValue).getTime() : 0;
          bValue = bValue ? new Date(bValue).getTime() : 0;
        }

        // Handle string sorting
        if (typeof aValue === 'string') {
          aValue = aValue.toLowerCase();
          bValue = bValue?.toLowerCase() || '';
        }

        if (sortOrder === 'asc') {
          return aValue > bValue ? 1 : -1;
        } else {
          return aValue < bValue ? 1 : -1;
        }
      });
    });

    return groups;
  }, [currentTasks, groupBy, sortBy, sortOrder, showCompletedTasks]);

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
  };

  const toggleTaskExpanded = (taskId: string) => {
    const newExpanded = new Set(expandedTasks);
    if (newExpanded.has(taskId)) {
      newExpanded.delete(taskId);
    } else {
      newExpanded.add(taskId);
    }
    setExpandedTasks(newExpanded);
  };

  const toggleGroupExpanded = (groupKey: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupKey)) {
      newExpanded.delete(groupKey);
    } else {
      newExpanded.add(groupKey);
    }
    setExpandedGroups(newExpanded);
  };

  const handleCheckboxChange = (taskId: string, checked: boolean) => {
    if (!onStatusChange) return;
    
    if (checked) {
      onStatusChange(taskId, 'DONE');
    } else {
      onStatusChange(taskId, 'TODO');
    }
  };

  const startEditing = (taskId: string, field: string, currentValue: string) => {
    setEditingCell({ taskId, field });
    setEditValue(currentValue);
  };

  const saveEdit = async (taskId: string, field: string) => {
    try {
      const updateData: any = { [field]: editValue };
      console.log(`Updating task ${taskId} field ${field} to:`, editValue);
      
      // Optimistic update - immediately update the UI
      const updatedTasks = currentTasks.map((task: Task) => 
        task.id === taskId ? { ...task, ...updateData, updated_at: new Date().toISOString() } : task
      );
      setOptimisticTasks(updatedTasks);
      
      if (isDemoMode) {
        // Update localStorage for demo mode
        const demoTasks = localStorage.getItem('kanban-demo-tasks');
        if (demoTasks) {
          const tasks = JSON.parse(demoTasks);
          const updatedDemoTasks = tasks.map((task: Task) => 
            task.id === taskId ? { ...task, ...updateData } : task
          );
          localStorage.setItem('kanban-demo-tasks', JSON.stringify(updatedDemoTasks));
        }
      } else {
        const { error } = await supabase
          .from('tasks')
          .update(updateData)
          .eq('id', taskId);

        if (error) {
          console.error('Error updating task:', error);
          // Rollback optimistic update
          setOptimisticTasks([]);
          toast({
            title: "Error",
            description: "Failed to update task",
            variant: "destructive",
          });
          return;
        }
      }

      // Clear optimistic updates and refresh data
      setTimeout(() => {
        setOptimisticTasks([]);
        if (onTaskUpdate) {
          console.log('Calling onTaskUpdate to refresh data');
          onTaskUpdate();
        }
      }, 100);

      toast({
        title: "Task updated",
        description: "Task has been updated successfully",
      });
    } catch (error) {
      console.error('Error saving edit:', error);
      // Rollback optimistic update
      setOptimisticTasks([]);
    } finally {
      setEditingCell(null);
      setEditValue('');
    }
  };

  const cancelEdit = () => {
    setEditingCell(null);
    setEditValue('');
  };

  const renderEditableCell = (task: Task, field: string, value: string, type: 'text' | 'select' = 'text', options?: string[]) => {
    const isEditing = editingCell?.taskId === task.id && editingCell?.field === field;
    
    if (isEditing) {
      if (type === 'select' && options) {
        return (
          <Select value={editValue} onValueChange={setEditValue}>
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map(option => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      } else {
        return (
          <Input
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                saveEdit(task.id, field);
              } else if (e.key === 'Escape') {
                cancelEdit();
              }
            }}
            onBlur={() => saveEdit(task.id, field)}
            className="h-8"
            autoFocus
          />
        );
      }
    }

    return (
      <span
        className="cursor-pointer hover:bg-muted/50 p-1 rounded"
        onClick={() => startEditing(task.id, field, value)}
      >
        {value}
      </span>
    );
  };

  // Initialize all groups as expanded
  React.useEffect(() => {
    setExpandedGroups(new Set(Object.keys(groupedTasks)));
  }, [groupedTasks]);

  // Clear optimistic updates when tasks prop changes
  React.useEffect(() => {
    setOptimisticTasks([]);
  }, [tasks]);

  // Quick add task functionality
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [isAddingTask, setIsAddingTask] = useState(false);

  const handleQuickAddTask = async () => {
    if (!newTaskTitle.trim()) return;

    try {
      if (!isDemoMode && !user?.id) {
        toast({
          title: "Error",
          description: "You must be logged in to create tasks",
          variant: "destructive",
        });
        return;
      }

      const newTask = {
        id: crypto.randomUUID(),
        title: newTaskTitle.trim(),
        status: 'BACKLOG' as const,
        priority: 'MEDIUM' as const,
        category: groupBy === 'category' && tasks.length > 0 ? tasks[0].category : 'LIFE' as const,
        user_id: isDemoMode ? '00000000-0000-0000-0000-000000000001' : user!.id,
        board_id: isDemoMode ? 'demo-board' : '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (isDemoMode) {
        const demoTasks = localStorage.getItem('kanban-demo-tasks');
        const tasks = demoTasks ? JSON.parse(demoTasks) : [];
        tasks.unshift(newTask);
        localStorage.setItem('kanban-demo-tasks', JSON.stringify(tasks));
      } else {
        // Get the user's default board
        const { data: boards } = await supabase
          .from('boards')
          .select('id')
          .eq('user_id', user!.id)
          .eq('is_default', true)
          .limit(1);

        let boardId = '';
        if (boards && boards.length > 0) {
          boardId = boards[0].id;
        } else {
          // Create a default board if none exists
          const { data: newBoard, error: boardError } = await supabase
            .from('boards')
            .insert([{
              name: 'My Board',
              description: 'Default board',
              user_id: user!.id,
              is_default: true,
              position: 0
            }])
            .select('id')
            .single();

          if (boardError || !newBoard) {
            console.error('Error creating board:', boardError);
            toast({
              title: "Error",
              description: "Failed to create default board",
              variant: "destructive",
            });
            return;
          }
          boardId = newBoard.id;
        }

        const { error } = await supabase
          .from('tasks')
          .insert([{ ...newTask, board_id: boardId, category: (newTask.category === 'PROF_EDUCATION' ? 'EDUCATION' : newTask.category) as any }]);

        if (error) {
          console.error('Error creating task:', error);
          toast({
            title: "Error",
            description: "Failed to create task",
            variant: "destructive",
          });
          return;
        }

        // TESTING: Commented out to test if database trigger handles notifications
        // If duplicates stop, remove this block entirely
        /*
        // Send notifications for the newly created task
        try {
          await supabase.functions.invoke('send-push-notification', {
            body: {
              userId: user!.id,
              taskId: '', // Will be set by the function
              title: 'New Task Created',
              body: `Task "${newTaskTitle}" has been created`,
              type: 'task_created'
            }
          });
        } catch (notificationError) {
          console.warn('Failed to send notifications:', notificationError);
        }
        */
      }

      setNewTaskTitle('');
      setIsAddingTask(false);
      onTaskUpdate?.();

      toast({
        title: "Task created",
        description: "New task added to Backlog",
      });
    } catch (error) {
      console.error('Error creating task:', error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleQuickAddTask();
    } else if (e.key === 'Escape') {
      setNewTaskTitle('');
      setIsAddingTask(false);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      if (isDemoMode) {
        const demoTasks = localStorage.getItem('kanban-demo-tasks');
        if (demoTasks) {
          const tasks = JSON.parse(demoTasks);
          const updatedTasks = tasks.filter((task: Task) => task.id !== taskId);
          localStorage.setItem('kanban-demo-tasks', JSON.stringify(updatedTasks));
        }
      } else {
        const { error } = await supabase
          .from('tasks')
          .delete()
          .eq('id', taskId)
          .eq('user_id', user?.id);

        if (error) throw error;
      }

      onTaskUpdate?.();
      toast({
        title: "Task deleted",
        description: "Task successfully removed",
      });
    } catch (error) {
      console.error('Error deleting task:', error);
      toast({
        title: "Error",
        description: "Failed to delete task",
        variant: "destructive",
      });
    }
  };

  const handleBulkDelete = async () => {
    if (selectedTasks.size === 0) return;

    try {
      const taskIds = Array.from(selectedTasks);
      
      if (isDemoMode) {
        const demoTasks = localStorage.getItem('kanban-demo-tasks');
        if (demoTasks) {
          const tasks = JSON.parse(demoTasks);
          const updatedTasks = tasks.filter((task: Task) => !taskIds.includes(task.id));
          localStorage.setItem('kanban-demo-tasks', JSON.stringify(updatedTasks));
        }
      } else {
        const { error } = await supabase
          .from('tasks')
          .delete()
          .in('id', taskIds)
          .eq('user_id', user?.id);

        if (error) throw error;
      }

      setSelectedTasks(new Set());
      setIsSelectMode(false);
      onTaskUpdate?.();

      toast({
        title: "Tasks deleted",
        description: `Successfully deleted ${taskIds.length} task${taskIds.length > 1 ? 's' : ''}`,
      });
    } catch (error) {
      console.error('Error deleting tasks:', error);
      toast({
        title: "Error",
        description: "Failed to delete tasks",
        variant: "destructive",
      });
    }
  };

  const handleSelectTask = (taskId: string, selected: boolean) => {
    setSelectedTasks(prev => {
      const newSet = new Set(prev);
      if (selected) {
        newSet.add(taskId);
      } else {
        newSet.delete(taskId);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    const allTaskIds = tasks.map(t => t.id);
    setSelectedTasks(new Set(allTaskIds));
  };

  const handleDeselectAll = () => {
    setSelectedTasks(new Set());
  };

  if (tasks.length === 0 && !isAddingTask) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <Target className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">No Tasks Found</h3>
          <p className="text-muted-foreground text-center max-w-sm mb-4">
            Get started by creating your first task with rapid-fire entry below.
          </p>
          <Button onClick={() => setIsAddingTask(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Add First Task
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Task Grid</h2>
          <p className="text-muted-foreground">
            Manage your tasks in a structured grid view with grouping
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={isSelectMode ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setIsSelectMode(!isSelectMode);
              if (isSelectMode) setSelectedTasks(new Set());
            }}
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            {isSelectMode ? 'Cancel' : 'Select'}
          </Button>
          <Button
            variant={showCompletedTasks ? "default" : "outline"}
            size="sm"
            onClick={toggleShowCompletedTasks}
            title={showCompletedTasks ? "Hide completed tasks" : "Show completed tasks"}
          >
            {showCompletedTasks ? (
              <><Eye className="h-4 w-4 mr-2" />Hide Completed</>
            ) : (
              <><EyeOff className="h-4 w-4 mr-2" />Show Completed</>
            )}
          </Button>
          <Badge variant="outline" className="px-3 py-1">
            {tasks.length} Total Tasks
          </Badge>
          <Badge variant="outline" className="px-3 py-1">
            {tasks.filter(t => t.status === 'DONE').length} Completed
          </Badge>
        </div>
      </div>

      {/* Bulk Action Bar */}
      {isSelectMode && selectedTasks.size > 0 && (
        <div className="bg-primary/10 border border-primary rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="font-medium">{selectedTasks.size} task{selectedTasks.size > 1 ? 's' : ''} selected</span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSelectAll}
              >
                Select All ({tasks.length})
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDeselectAll}
              >
                Deselect All
              </Button>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleBulkDelete}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Selected
            </Button>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Group by:</span>
          <Select value={groupBy} onValueChange={(value: GroupByType) => setGroupBy(value)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="category">Category</SelectItem>
              <SelectItem value="status">Status</SelectItem>
              <SelectItem value="priority">Priority</SelectItem>
              <SelectItem value="due_date">Due Date</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Sort by:</span>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="title">Name</SelectItem>
              <SelectItem value="priority">Priority</SelectItem>
              <SelectItem value="status">Status</SelectItem>
              <SelectItem value="due_date">Due Date</SelectItem>
              <SelectItem value="created_at">Created</SelectItem>
              <SelectItem value="estimate_minutes">Duration</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
        >
          {sortOrder === 'asc' ? '↑' : '↓'} {sortOrder.toUpperCase()}
        </Button>
      </div>

      {/* Grouped Task Grid */}
      <div className="space-y-4">
        {Object.entries(groupedTasks).map(([groupKey, groupTasks]) => {
          const isGroupExpanded = expandedGroups.has(groupKey);
          
          return (
            <Card key={groupKey}>
              <Collapsible
                open={isGroupExpanded}
                onOpenChange={() => toggleGroupExpanded(groupKey)}
              >
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {isGroupExpanded ? (
                          <FolderOpen className="h-5 w-5 text-muted-foreground" />
                        ) : (
                          <FolderClosed className="h-5 w-5 text-muted-foreground" />
                        )}
                        <CardTitle className="text-lg">
                          {groupKey}
                        </CardTitle>
                        <Badge variant="secondary" className="ml-2">
                          {groupTasks.length} task{groupTasks.length !== 1 ? 's' : ''}
                        </Badge>
                      </div>
                      <ChevronRight className={cn(
                        "h-4 w-4 transition-transform",
                        isGroupExpanded && "rotate-90"
                      )} />
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                
                <CollapsibleContent>
                  <CardContent className="p-0">
                    <Table>
                       <TableHeader>
                         <TableRow>
                           {isSelectMode && <TableHead className="w-12"></TableHead>}
                           <TableHead className="w-8"></TableHead>
                           <TableHead className="w-10">Done</TableHead>
                           <TableHead 
                             className="cursor-pointer hover:bg-muted/50"
                             onClick={() => handleSort('title')}
                           >
                             Task Name
                             {sortBy === 'title' && (
                               <span className="ml-1">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                             )}
                           </TableHead>
                          <TableHead 
                            className="cursor-pointer hover:bg-muted/50 w-32"
                            onClick={() => handleSort('status')}
                          >
                            Status
                            {sortBy === 'status' && (
                              <span className="ml-1">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                            )}
                          </TableHead>
                          <TableHead 
                            className="cursor-pointer hover:bg-muted/50 w-24"
                            onClick={() => handleSort('priority')}
                          >
                            Priority
                            {sortBy === 'priority' && (
                              <span className="ml-1">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                            )}
                          </TableHead>
                          <TableHead className="w-32">Progress</TableHead>
                          <TableHead 
                            className="cursor-pointer hover:bg-muted/50 w-32"
                            onClick={() => handleSort('due_date')}
                          >
                            Due Date
                            {sortBy === 'due_date' && (
                              <span className="ml-1">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                            )}
                          </TableHead>
                          <TableHead 
                            className="cursor-pointer hover:bg-muted/50 w-24"
                            onClick={() => handleSort('estimate_minutes')}
                          >
                            Duration
                            {sortBy === 'estimate_minutes' && (
                              <span className="ml-1">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                            )}
                          </TableHead>
                          <TableHead className="w-24">Actions</TableHead>
                        </TableRow>
                       </TableHeader>
                       <TableBody>
                         {/* Quick Add Row */}
                         {(isAddingTask || tasks.length === 0) && (
                           <TableRow className="bg-muted/30 border-dashed">
                             <TableCell>
                               <Plus className="h-4 w-4 text-muted-foreground" />
                             </TableCell>
                             <TableCell>
                               <Input
                                 value={newTaskTitle}
                                 onChange={(e) => setNewTaskTitle(e.target.value)}
                                 onKeyDown={handleKeyDown}
                                 onBlur={() => newTaskTitle.trim() ? handleQuickAddTask() : setIsAddingTask(false)}
                                 placeholder="Enter task title and press Enter..."
                                 className="border-none shadow-none focus-visible:ring-0 bg-transparent"
                                 autoFocus
                               />
                             </TableCell>
                             <TableCell>
                               <Badge variant="outline" className="bg-gray-50 text-gray-700">
                                 Backlog
                               </Badge>
                             </TableCell>
                             <TableCell>
                               <Badge variant="outline" className="bg-blue-100 text-blue-700">
                                 Medium
                               </Badge>
                             </TableCell>
                             <TableCell>
                               <Progress value={0} className="h-2" />
                             </TableCell>
                             <TableCell>-</TableCell>
                             <TableCell>-</TableCell>
                             <TableCell>
                               <Button
                                 variant="ghost"
                                 size="sm"
                                 onClick={() => {
                                   setNewTaskTitle('');
                                   setIsAddingTask(false);
                                 }}
                                 className="h-8 w-8 p-0"
                               >
                                 ×
                               </Button>
                             </TableCell>
                           </TableRow>
                         )}

                         {/* Add Task Button Row (when not actively adding) */}
                         {!isAddingTask && tasks.length > 0 && (
                           <TableRow className="hover:bg-muted/20">
                             <TableCell colSpan={8}>
                               <Button
                                 variant="ghost"
                                 size="sm"
                                 onClick={() => setIsAddingTask(true)}
                                 className="w-full justify-start gap-2 text-muted-foreground"
                               >
                                 <Plus className="h-4 w-4" />
                                 Add new task...
                               </Button>
                             </TableCell>
                           </TableRow>
                         )}
                         {groupTasks.map((task) => {
                          const isExpanded = expandedTasks.has(task.id);
                          const progress = getProgressPercentage(task.status);
                          
                          return (
                            <React.Fragment key={task.id}>
                              <TableRow className="hover:bg-muted/50">
                                {isSelectMode && (
                                  <TableCell>
                                    <Checkbox
                                      checked={selectedTasks.has(task.id)}
                                      onCheckedChange={(checked) => handleSelectTask(task.id, !!checked)}
                                    />
                                  </TableCell>
                                )}
                                <TableCell>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 p-0"
                                    onClick={() => toggleTaskExpanded(task.id)}
                                  >
                                    {isExpanded ? (
                                      <ChevronDown className="h-3 w-3" />
                                    ) : (
                                      <ChevronRight className="h-3 w-3" />
                                    )}
                                  </Button>
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-1">
                                    {onStatusChange && (
                                      <Checkbox
                                        checked={task.status === 'DONE'}
                                        onCheckedChange={(checked) => handleCheckboxChange(task.id, !!checked)}
                                      />
                                    )}
                                    {onStatusChange && task.status !== 'UP_NEXT' && task.status !== 'DONE' && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="p-1 h-6 w-6 rounded-full bg-orange-500 hover:bg-orange-600 text-white"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onStatusChange(task.id, 'UP_NEXT');
                                        }}
                                        title="Move to Up Next"
                                      >
                                        <Play className="h-3 w-3" />
                                      </Button>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div className="space-y-1">
                                    <div className={cn(
                                      "font-medium",
                                      task.status === 'DONE' && "line-through text-muted-foreground"
                                    )}>
                                      {renderEditableCell(task, 'title', task.title)}
                                    </div>
                                    {task.assignment_url && (
                                      <a
                                        href={task.assignment_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                                      >
                                        <ExternalLink className="h-3 w-3" />
                                        Assignment
                                      </a>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  {renderEditableCell(
                                    task, 
                                    'status', 
                                    task.status, 
                                    'select', 
                                    ['BLOCKED', 'BACKLOG', 'LIFE', 'CAREER', 'PROF_EDUCATION', 'VENTURES', 'PLANNING', 'READY', 'UP_NEXT', 'DOING', 'DONE']
                                  )}
                                  {editingCell?.taskId !== task.id || editingCell?.field !== 'status' ? (
                                    <Badge 
                                      variant="outline" 
                                      className={cn("capitalize cursor-pointer", statusColors[task.status as keyof typeof statusColors])}
                                      onClick={() => startEditing(task.id, 'status', task.status)}
                                    >
                                      {task.status.toLowerCase().replace('_', ' ')}
                                    </Badge>
                                  ) : null}
                                </TableCell>
                                <TableCell>
                                  {renderEditableCell(
                                    task, 
                                    'priority', 
                                    task.priority, 
                                    'select', 
                                    ['LOW', 'MEDIUM', 'HIGH', 'URGENT']
                                  )}
                                  {editingCell?.taskId !== task.id || editingCell?.field !== 'priority' ? (
                                    <Badge 
                                      variant="outline" 
                                      className={cn("capitalize cursor-pointer", priorityColors[task.priority])}
                                      onClick={() => startEditing(task.id, 'priority', task.priority)}
                                    >
                                      <Flag className="h-3 w-3 mr-1" />
                                      {task.priority.toLowerCase()}
                                    </Badge>
                                  ) : null}
                                </TableCell>
                                <TableCell>
                                  <div className="space-y-1">
                                    <Progress value={progress} className="h-2" />
                                    <div className="text-xs text-muted-foreground">
                                      {progress}%
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-1 text-sm">
                                    {task.due_date ? (
                                      <>
                                        <CalendarIcon className="h-3 w-3 text-muted-foreground" />
                                        {formatDateOnly(task.due_date)}
                                      </>
                                    ) : (
                                      <span className="text-muted-foreground">-</span>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-1 text-sm">
                                    <Clock className="h-3 w-3 text-muted-foreground" />
                                    {formatDuration(task.estimate_minutes)}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-1">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => onTaskEdit?.(task)}
                                      className="h-8 w-8 p-0"
                                      title="Edit task"
                                    >
                                      <Edit3 className="h-3 w-3" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleDeleteTask(task.id)}
                                      className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                                      title="Delete task"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                              
                              {/* Expanded Row */}
                              {isExpanded && (
                                <TableRow>
                                  <TableCell colSpan={8} className="bg-muted/20 p-4">
                                    <div className="space-y-3">
                                      {task.description && (
                                        <div>
                                          <h4 className="text-sm font-medium mb-1">Description</h4>
                                          <p className="text-sm text-muted-foreground">{task.description}</p>
                                        </div>
                                      )}
                                      
                                      <div className="grid grid-cols-3 gap-4 text-sm">
                                        <div>
                                          <span className="font-medium">Created:</span>
                                          <p className="text-muted-foreground">
                                            {formatDateOnly(task.created_at)}
                                          </p>
                                        </div>
                                         <div>
                                           <span className="font-medium">Category:</span>
                                           <div className="text-muted-foreground">
                                             {renderEditableCell(
                                               task, 
                                               'category', 
                                               task.category, 
                                               'select', 
                                               ['LIFE', 'CAREER', 'VENTURES', 'EDUCATION']
                                             )}
                                             {editingCell?.taskId !== task.id || editingCell?.field !== 'category' ? (
                                               <Badge 
                                                 variant="secondary" 
                                                 className={cn("capitalize cursor-pointer", categoryColors[task.category])}
                                                 onClick={() => startEditing(task.id, 'category', task.category)}
                                               >
                                                 {task.category.toLowerCase()}
                                               </Badge>
                                             ) : null}
                                           </div>
                                         </div>
                                        {task.completed_at && (
                                          <div>
                                            <span className="font-medium">Completed:</span>
                                            <p className="text-muted-foreground">
                                              {formatDateOnly(task.completed_at)}
                                            </p>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default TaskGridView;