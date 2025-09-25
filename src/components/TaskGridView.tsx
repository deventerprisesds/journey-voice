import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  Plus
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface Task {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  category: 'LIFE' | 'CAREER' | 'VENTURES' | 'EDUCATION';
  due_date?: string;
  start_time?: string;
  end_time?: string;
  estimate_minutes?: number;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

interface TaskGridViewProps {
  tasks: Task[];
  onTaskEdit?: (task: Task) => void;
}

const priorityColors = {
  LOW: 'bg-gray-100 text-gray-700 border-gray-300',
  MEDIUM: 'bg-blue-100 text-blue-700 border-blue-300',
  HIGH: 'bg-orange-100 text-orange-700 border-orange-300',
  URGENT: 'bg-red-100 text-red-700 border-red-300',
};

const statusColors = {
  BLOCKED: 'bg-red-50 text-red-700',
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

const TaskGridView: React.FC<TaskGridViewProps> = ({ tasks, onTaskEdit }) => {
  const [sortBy, setSortBy] = useState<string>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

  // Calculate progress percentage based on status
  const getProgressPercentage = (status: string): number => {
    const progressMap: { [key: string]: number } = {
      BLOCKED: 0,
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

  const sortedTasks = [...tasks].sort((a, b) => {
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

  if (tasks.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <Target className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">No Tasks Found</h3>
          <p className="text-muted-foreground text-center max-w-sm">
            Get started by creating your first task. Switch to Kanban view to add tasks using the AI assistant or manual entry.
          </p>
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
            Manage your tasks in a structured grid view
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

      {/* Sort Controls */}
      <div className="flex items-center gap-4">
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

      {/* Task Grid Table */}
      <Card>
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
                <TableHead className="w-24">Category</TableHead>
                <TableHead className="w-16">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedTasks.map((task) => {
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
                        <div className="font-medium">{task.title}</div>
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant="outline" 
                          className={cn("capitalize", statusColors[task.status as keyof typeof statusColors])}
                        >
                          {task.status.toLowerCase().replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant="outline" 
                          className={cn("capitalize", priorityColors[task.priority])}
                        >
                          <Flag className="h-3 w-3 mr-1" />
                          {task.priority.toLowerCase()}
                        </Badge>
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
                        <Badge variant="secondary" className="capitalize">
                          {task.category.toLowerCase()}
                        </Badge>
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
                        <TableCell colSpan={9} className="bg-muted/20 p-4">
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
                              {task.start_time && (
                                <div>
                                  <span className="font-medium">Start Time:</span>
                                  <p className="text-muted-foreground">
                                    {formatDate(task.start_time)}
                                  </p>
                                </div>
                              )}
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
      </Card>
    </div>
  );
};

export default TaskGridView;