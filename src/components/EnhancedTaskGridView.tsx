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
  FolderClosed
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

import { Task } from '@/types/task';

interface TaskGridViewProps {
  tasks: Task[];
  onTaskEdit?: (task: Task) => void;
  onTaskUpdate?: () => void;
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
};

const TaskGridView: React.FC<TaskGridViewProps> = ({ tasks, onTaskEdit, onTaskUpdate }) => {
  const { toast } = useToast();
  const { isDemoMode } = useAuth();
  const [sortBy, setSortBy] = useState<string>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [groupBy, setGroupBy] = useState<GroupByType>('category');
  const [editingCell, setEditingCell] = useState<{ taskId: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState<string>('');

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

  const formatDate = (dateString?: string): string => {
    if (!dateString) return '-';
    try {
      return format(new Date(dateString), 'MMM dd, yyyy');
    } catch {
      return '-';
    }
  };

  // Group tasks by the selected groupBy field
  const groupedTasks = useMemo(() => {
    const groups: { [key: string]: Task[] } = {};
    
    tasks.forEach(task => {
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
  }, [tasks, groupBy, sortBy, sortOrder]);

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

  const startEditing = (taskId: string, field: string, currentValue: string) => {
    setEditingCell({ taskId, field });
    setEditValue(currentValue);
  };

  const saveEdit = async (taskId: string, field: string) => {
    try {
      const updateData: any = { [field]: editValue };
      
      if (isDemoMode) {
        // Update localStorage for demo mode
        const demoTasks = localStorage.getItem('kanban-demo-tasks');
        if (demoTasks) {
          const tasks = JSON.parse(demoTasks);
          const updatedTasks = tasks.map((task: Task) => 
            task.id === taskId ? { ...task, ...updateData } : task
          );
          localStorage.setItem('kanban-demo-tasks', JSON.stringify(updatedTasks));
        }
      } else {
        const { error } = await supabase
          .from('tasks')
          .update(updateData)
          .eq('id', taskId);

        if (error) {
          console.error('Error updating task:', error);
          toast({
            title: "Error",
            description: "Failed to update task",
            variant: "destructive",
          });
          return;
        }
      }

      if (onTaskUpdate) {
        onTaskUpdate();
      }

      toast({
        title: "Task updated",
        description: "Task has been updated successfully",
      });
    } catch (error) {
      console.error('Error saving edit:', error);
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

  // Quick add task functionality
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [isAddingTask, setIsAddingTask] = useState(false);

  const handleQuickAddTask = async () => {
    if (!newTaskTitle.trim()) return;

    try {
      const newTask = {
        id: crypto.randomUUID(),
        title: newTaskTitle.trim(),
        status: 'BACKLOG' as const,
        priority: 'MEDIUM' as const,
        category: groupBy === 'category' && tasks.length > 0 ? tasks[0].category : 'LIFE' as const,
        user_id: isDemoMode ? 'demo-user' : '',
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
          .eq('is_default', true)
          .limit(1);

        if (boards && boards.length > 0) {
          const { error } = await supabase
            .from('tasks')
            .insert([{ ...newTask, board_id: boards[0].id }]);

          if (error) {
            console.error('Error creating task:', error);
            toast({
              title: "Error",
              description: "Failed to create task",
              variant: "destructive",
            });
            return;
          }
        }
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
          <Badge variant="outline" className="px-3 py-1">
            {tasks.length} Total Tasks
          </Badge>
          <Badge variant="outline" className="px-3 py-1">
            {tasks.filter(t => t.status === 'DONE').length} Completed
          </Badge>
        </div>
      </div>

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
                           <TableHead className="w-8"></TableHead>
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
                          <TableHead className="w-16">Actions</TableHead>
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
                                  <div className="font-medium">
                                    {renderEditableCell(task, 'title', task.title)}
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
                                        {formatDate(task.due_date)}
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
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => onTaskEdit?.(task)}
                                    className="h-8 w-8 p-0"
                                  >
                                    <Edit3 className="h-3 w-3" />
                                  </Button>
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
                                            {formatDate(task.created_at)}
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
                                              {formatDate(task.completed_at)}
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