import React, { useState, useMemo } from 'react';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, addDays, isSameDay, isSameMonth, isToday, startOfDay, endOfDay } from 'date-fns';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, Plus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { Task } from '@/types/task';

interface CalendarModuleProps {
  tasks: Task[];
  onTaskEdit?: (task: Task) => void;
  onCreateTask?: (date: Date) => void;
}

type ViewType = 'day' | 'week' | 'month';

const CalendarModule: React.FC<CalendarModuleProps> = ({
  tasks,
  onTaskEdit,
  onCreateTask,
}) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<ViewType>('month');

  // Priority colors
  const priorityColors = {
    URGENT: 'bg-destructive text-destructive-foreground',
    HIGH: 'bg-orange-500 text-white',
    MEDIUM: 'bg-yellow-500 text-white',
    LOW: 'bg-blue-500 text-white',
  };

  // Status colors
  const statusColors = {
    BACKLOG: 'bg-muted text-muted-foreground',
    TODO: 'bg-blue-500 text-white',
    DOING: 'bg-primary text-primary-foreground',
    DONE: 'bg-green-500 text-white',
    BLOCKED: 'bg-destructive text-destructive-foreground',
  };

  // Navigation functions
  const navigateDate = (direction: 'prev' | 'next') => {
    setCurrentDate(prev => {
      const newDate = new Date(prev);
      if (view === 'day') {
        newDate.setDate(newDate.getDate() + (direction === 'next' ? 1 : -1));
      } else if (view === 'week') {
        newDate.setDate(newDate.getDate() + (direction === 'next' ? 7 : -7));
      } else {
        newDate.setMonth(newDate.getMonth() + (direction === 'next' ? 1 : -1));
      }
      return newDate;
    });
  };

  // Get tasks for a specific date
  const getTasksForDate = (date: Date) => {
    return tasks.filter(task => {
      if (!task.due_date) return false;
      const taskDate = new Date(task.due_date);
      return isSameDay(taskDate, date);
    });
  };

  // Get tasks for date range
  const getTasksForRange = (startDate: Date, endDate: Date) => {
    return tasks.filter(task => {
      if (!task.due_date) return false;
      const taskDate = new Date(task.due_date);
      return taskDate >= startDate && taskDate <= endDate;
    });
  };

  // Day View Component
  const DayView = () => {
    const dayTasks = getTasksForDate(currentDate);
    
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            {format(currentDate, 'EEEE, MMMM d, yyyy')}
          </h3>
          <Button
            onClick={() => onCreateTask?.(currentDate)}
            size="sm"
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Task
          </Button>
        </div>
        
        <ScrollArea className="h-[600px]">
          <div className="space-y-2">
            {dayTasks.length === 0 ? (
              <Card>
                <CardContent className="pt-6">
                  <p className="text-center text-muted-foreground">
                    No tasks scheduled for this day
                  </p>
                </CardContent>
              </Card>
            ) : (
              dayTasks.map(task => (
                <Card
                  key={task.id}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => onTaskEdit?.(task)}
                >
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h4 className="font-medium">{task.title}</h4>
                        {task.description && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {task.description}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-2">
                          <Badge className={priorityColors[task.priority]}>
                            {task.priority}
                          </Badge>
                          <Badge className={statusColors[task.status]}>
                            {task.status}
                          </Badge>
                          {task.estimate_minutes && (
                            <Badge variant="outline" className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {task.estimate_minutes}m
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    );
  };

  // Week View Component
  const WeekView = () => {
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
    const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });
    
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">
          {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}
        </h3>
        
        <div className="grid grid-cols-7 gap-2">
          {weekDays.map(day => {
            const dayTasks = getTasksForDate(day);
            const isCurrentDay = isToday(day);
            
            return (
              <Card key={day.toISOString()} className={cn(
                "min-h-[200px]",
                isCurrentDay && "ring-2 ring-primary"
              )}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">
                      {format(day, 'EEE d')}
                    </CardTitle>
                    <Button
                      onClick={() => onCreateTask?.(day)}
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0"
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <ScrollArea className="h-[140px]">
                    <div className="space-y-1">
                      {dayTasks.slice(0, 3).map(task => (
                        <div
                          key={task.id}
                          className="p-1 rounded text-xs cursor-pointer hover:bg-muted/50"
                          onClick={() => onTaskEdit?.(task)}
                        >
                          <div className={cn(
                            "px-2 py-1 rounded text-white text-xs truncate",
                            priorityColors[task.priority]
                          )}>
                            {task.title}
                          </div>
                        </div>
                      ))}
                      {dayTasks.length > 3 && (
                        <p className="text-xs text-muted-foreground px-1">
                          +{dayTasks.length - 3} more
                        </p>
                      )}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    );
  };

  // Month View Component
  const MonthView = () => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });
    
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">
          {format(currentDate, 'MMMM yyyy')}
        </h3>
        
        {/* Day headers */}
        <div className="grid grid-cols-7 gap-2 mb-2">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
            <div key={day} className="text-center text-sm font-medium text-muted-foreground p-2">
              {day}
            </div>
          ))}
        </div>
        
        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-2">
          {calendarDays.map(day => {
            const dayTasks = getTasksForDate(day);
            const isCurrentDay = isToday(day);
            const isCurrentMonth = isSameMonth(day, currentDate);
            
            return (
              <Card key={day.toISOString()} className={cn(
                "min-h-[120px] cursor-pointer hover:bg-muted/50 transition-colors",
                !isCurrentMonth && "opacity-50",
                isCurrentDay && "ring-2 ring-primary"
              )}>
                <CardContent className="p-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className={cn(
                      "text-sm font-medium",
                      isCurrentDay && "text-primary"
                    )}>
                      {format(day, 'd')}
                    </span>
                    <Button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCreateTask?.(day);
                      }}
                      size="sm"
                      variant="ghost"
                      className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100"
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                  
                  <div className="space-y-1">
                    {dayTasks.slice(0, 2).map(task => (
                      <div
                        key={task.id}
                        className={cn(
                          "px-1 py-0.5 rounded text-xs truncate cursor-pointer",
                          priorityColors[task.priority]
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          onTaskEdit?.(task);
                        }}
                      >
                        {task.title}
                      </div>
                    ))}
                    {dayTasks.length > 2 && (
                      <p className="text-xs text-muted-foreground">
                        +{dayTasks.length - 2}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <CardTitle className="flex items-center gap-2">
              <CalendarIcon className="h-5 w-5" />
              Calendar
            </CardTitle>
            
            <Tabs value={view} onValueChange={(value) => setView(value as ViewType)}>
              <TabsList>
                <TabsTrigger value="day">Day</TabsTrigger>
                <TabsTrigger value="week">Week</TabsTrigger>
                <TabsTrigger value="month">Month</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigateDate('prev')}
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
              onClick={() => navigateDate('next')}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent>
        <Tabs value={view} className="w-full">
          <TabsContent value="day" className="mt-0">
            <DayView />
          </TabsContent>
          <TabsContent value="week" className="mt-0">
            <WeekView />
          </TabsContent>
          <TabsContent value="month" className="mt-0">
            <MonthView />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default CalendarModule;