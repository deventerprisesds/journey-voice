import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  AlertCircle,
  CheckCircle2,
  Circle,
  BarChart3
} from 'lucide-react';
import { format, addDays, startOfDay, differenceInDays, isAfter, isBefore } from 'date-fns';
import { cn } from '@/lib/utils';

interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'BLOCKED' | 'CAREER' | 'PROF_EDUCATION' | 'VENTURES' | 'PLANNING' | 'READY' | 'UP_NEXT' | 'DOING' | 'DONE' | 'BACKLOG' | 'TODO';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  category: 'LIFE' | 'CAREER' | 'VENTURES' | 'EDUCATION' | 'PROF_EDUCATION';
  due_date?: string;
  start_time?: string;
  end_time?: string;
  estimate_minutes?: number;
  blocked_by?: string[];
  board_id: string;
  user_id: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

interface GanttChartProps {
  tasks: Task[];
  onTaskEdit: (task: Task) => void;
  className?: string;
}

const statusColors = {
  BLOCKED: { bg: 'bg-red-500', text: 'text-red-700', border: 'border-red-300' },
  CAREER: { bg: 'bg-blue-500', text: 'text-blue-700', border: 'border-blue-300' },
  PROF_EDUCATION: { bg: 'bg-purple-500', text: 'text-purple-700', border: 'border-purple-300' },
  VENTURES: { bg: 'bg-green-500', text: 'text-green-700', border: 'border-green-300' },
  PLANNING: { bg: 'bg-yellow-500', text: 'text-yellow-700', border: 'border-yellow-300' },
  READY: { bg: 'bg-orange-500', text: 'text-orange-700', border: 'border-orange-300' },
  UP_NEXT: { bg: 'bg-indigo-500', text: 'text-indigo-700', border: 'border-indigo-300' },
  DOING: { bg: 'bg-primary', text: 'text-primary', border: 'border-primary/30' },
  DONE: { bg: 'bg-emerald-500', text: 'text-emerald-700', border: 'border-emerald-300' },
  BACKLOG: { bg: 'bg-gray-500', text: 'text-gray-700', border: 'border-gray-300' },
  TODO: { bg: 'bg-slate-500', text: 'text-slate-700', border: 'border-slate-300' },
};

const priorityColors = {
  LOW: 'bg-slate-200 text-slate-700',
  MEDIUM: 'bg-blue-200 text-blue-700',
  HIGH: 'bg-orange-200 text-orange-700',
  URGENT: 'bg-red-200 text-red-700',
};

const GanttChart: React.FC<GanttChartProps> = ({ tasks, onTaskEdit, className }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [timeRange, setTimeRange] = useState(7); // days

  // Generate date range for timeline
  const dateRange = useMemo(() => {
    const start = startOfDay(currentDate);
    return Array.from({ length: timeRange }, (_, i) => addDays(start, i));
  }, [currentDate, timeRange]);

  // Process tasks with timeline data
  const processedTasks = useMemo(() => {
    return tasks
      .filter(task => task.due_date || task.start_time || task.end_time)
      .map(task => {
        const dueDate = task.due_date ? new Date(task.due_date) : null;
        const startDate = task.start_time ? new Date(task.start_time) : dueDate;
        const endDate = task.end_time ? new Date(task.end_time) : dueDate;
        
        // Calculate position and width for timeline
        let position = 0;
        let width = 1;
        
        if (startDate) {
          const daysDiff = differenceInDays(startDate, dateRange[0]);
          position = Math.max(0, daysDiff);
          
          if (endDate && startDate.getTime() !== endDate.getTime()) {
            const duration = differenceInDays(endDate, startDate) + 1;
            width = Math.max(1, duration);
          }
        }
        
        // Check if task is in visible range
        const isVisible = startDate && (
          (position >= 0 && position < timeRange) || 
          (position < 0 && position + width > 0)
        );
        
        return {
          ...task,
          startDate,
          endDate,
          dueDate,
          position,
          width,
          isVisible,
          isOverdue: dueDate && isAfter(new Date(), dueDate) && task.status !== 'DONE',
          isToday: dueDate && format(dueDate, 'yyyy-MM-dd') === new Date().toLocaleDateString('en-CA')
        };
      })
      .sort((a, b) => {
        // Sort by due date, then by priority
        if (a.dueDate && b.dueDate) {
          return a.dueDate.getTime() - b.dueDate.getTime();
        }
        if (a.dueDate) return -1;
        if (b.dueDate) return 1;
        
        const priorityOrder = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });
  }, [tasks, dateRange, timeRange]);

  const visibleTasks = processedTasks.filter(task => task.isVisible);

  const navigateDate = (days: number) => {
    setCurrentDate(prev => addDays(prev, days));
  };

  const getStatusIcon = (status: string, isCompleted: boolean) => {
    if (isCompleted) return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
    if (status === 'BLOCKED') return <AlertCircle className="h-4 w-4 text-red-600" />;
    if (status === 'DOING') return <Clock className="h-4 w-4 text-primary" />;
    return <Circle className="h-4 w-4 text-muted-foreground" />;
  };

  if (processedTasks.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Gantt Chart
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12">
            <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-medium mb-2">No Tasks with Dates</h3>
            <p className="text-muted-foreground">
              Add due dates or time estimates to your tasks to see them in the Gantt chart.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Gantt Chart
          </CardTitle>
          
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTimeRange(7)}
                className={timeRange === 7 ? "bg-primary text-primary-foreground" : ""}
              >
                Week
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTimeRange(30)}
                className={timeRange === 30 ? "bg-primary text-primary-foreground" : ""}
              >
                Month
              </Button>
            </div>
            
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigateDate(-timeRange)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentDate(new Date())}
              >
                Today
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigateDate(timeRange)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-4">
          {/* Timeline Header */}
          <div className="flex">
            <div className="w-64 flex-shrink-0 pr-4">
              <div className="h-8 flex items-center">
                <span className="text-sm font-medium text-muted-foreground">Task</span>
              </div>
            </div>
            <div className="flex-1 grid grid-flow-col auto-cols-fr gap-px">
              {dateRange.map((date, index) => (
                <div
                  key={index}
                  className="h-8 flex items-center justify-center bg-muted/50 text-xs font-medium border-l first:border-l-0"
                >
                  <div className="text-center">
                    <div>{format(date, 'EEE')}</div>
                    <div className={cn(
                      "text-muted-foreground",
                      format(date, 'yyyy-MM-dd') === new Date().toLocaleDateString('en-CA') && "text-primary font-semibold"
                    )}>
                      {format(date, 'dd')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Task Rows */}
          <ScrollArea className="h-[400px]">
            <div className="space-y-2">
              {visibleTasks.map((task) => {
                const statusColor = statusColors[task.status];
                const isCompleted = task.status === 'DONE';
                
                return (
                  <div key={task.id} className="flex group hover:bg-muted/50 transition-colors">
                    {/* Task Info */}
                    <div className="w-64 flex-shrink-0 pr-4">
                      <div 
                        className="p-3 cursor-pointer hover:bg-background border rounded-lg transition-colors"
                        onClick={() => onTaskEdit(task)}
                      >
                        <div className="flex items-start gap-2">
                          {getStatusIcon(task.status, isCompleted)}
                          <div className="flex-1 min-w-0">
                            <div className={cn(
                              "font-medium text-sm truncate",
                              isCompleted && "line-through text-muted-foreground"
                            )}>
                              {task.title}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge 
                                variant="secondary" 
                                className={cn("text-xs", priorityColors[task.priority])}
                              >
                                {task.priority}
                              </Badge>
                              {task.isOverdue && (
                                <Badge variant="destructive" className="text-xs">
                                  Overdue
                                </Badge>
                              )}
                              {task.isToday && (
                                <Badge variant="default" className="text-xs bg-primary/90">
                                  Today
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Timeline Bar */}
                    <div className="flex-1 relative">
                      <div className="h-full grid grid-flow-col auto-cols-fr gap-px">
                        {dateRange.map((date, index) => (
                          <div
                            key={index}
                            className="relative h-[60px] border-l first:border-l-0 border-border/30"
                          >
                            {/* Task bar */}
                            {index >= task.position && index < task.position + task.width && (
                              <div
                                className={cn(
                                  "absolute top-1/2 -translate-y-1/2 h-6 rounded",
                                  statusColor.bg,
                                  isCompleted && "opacity-60",
                                  "group-hover:shadow-md transition-shadow cursor-pointer"
                                )}
                                style={{
                                  left: task.position === index ? '4px' : '0px',
                                  right: (task.position + task.width - 1) === index ? '4px' : '0px',
                                }}
                                onClick={() => onTaskEdit(task)}
                              >
                                {task.position === index && (
                                  <div className="h-full flex items-center px-2">
                                    <span className="text-white text-xs font-medium truncate">
                                      {task.title}
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}
                            
                            {/* Today indicator */}
                            {format(date, 'yyyy-MM-dd') === new Date().toLocaleDateString('en-CA') && (
                              <div className="absolute top-0 bottom-0 left-1/2 w-px bg-primary/50 -translate-x-1/2 z-10" />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          {/* Legend */}
          <div className="flex items-center gap-4 pt-4 border-t">
            <span className="text-sm font-medium">Status:</span>
            {Object.entries(statusColors).slice(0, 6).map(([status, colors]) => (
              <div key={status} className="flex items-center gap-1">
                <div className={cn("w-3 h-3 rounded", colors.bg)} />
                <span className="text-xs text-muted-foreground">
                  {status.charAt(0) + status.slice(1).toLowerCase()}
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default GanttChart;