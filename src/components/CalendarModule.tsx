import React, { useState, useEffect } from 'react';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, addDays, isSameDay, isSameMonth, isToday, startOfDay, endOfDay, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, Plus, Brain, RefreshCw, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { Task, ExternalCalendarEvent } from '@/types/task';
import SmartTaskInput from './SmartTaskInput';
import TimeSlotGrid from './TimeSlotGrid';
import { getCalendarAvailability, syncExternalCalendars } from '@/utils/taskScheduling';
import { useAutoScheduling } from '@/hooks/useAutoScheduling';
import { toast } from 'sonner';
import { CalendarConnectionModal } from './CalendarConnectionModal';
import { CalendarSelectionPanel } from './CalendarSelectionPanel';
import { supabase } from '@/integrations/supabase/client';

interface CalendarModuleProps {
  tasks: Task[];
  onTaskEdit?: (task: Task) => void;
  onCreateTask?: (date: Date) => void;
  onTaskScheduled?: () => void;
}

interface TimeSlotClickHandler {
  (date: Date, hour?: number): void;
}

type ViewType = 'day' | 'week' | 'month';

const CalendarModule: React.FC<CalendarModuleProps> = ({
  tasks,
  onTaskEdit,
  onCreateTask,
  onTaskScheduled,
}) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<ViewType>('month');
  const [externalEvents, setExternalEvents] = useState<ExternalCalendarEvent[]>([]);
  const [busySlots, setBusySlots] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showConnectionModal, setShowConnectionModal] = useState(false);
  const { autoScheduleTask } = useAutoScheduling();

  const timeSlots = Array.from({ length: 17 }, (_, i) => i + 6); // 6 AM to 11 PM

  useEffect(() => {
    loadCalendarData();
  }, [currentDate, view]);

  const loadCalendarData = async () => {
    setIsLoading(true);
    try {
      const startDate = view === 'month' 
        ? startOfMonth(currentDate).toISOString()
        : view === 'week'
        ? startOfWeek(currentDate).toISOString()
        : new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate()).toISOString();
      
      const endDate = view === 'month'
        ? endOfMonth(currentDate).toISOString()
        : view === 'week'
        ? endOfWeek(currentDate).toISOString()
        : new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() + 1).toISOString();

      // Load external events directly from database
      const { data: dbEvents, error: eventsError } = await supabase
        .from('external_calendar_events')
        .select('*')
        .gte('start_time', startDate)
        .lte('end_time', endDate);

      if (eventsError) {
        console.error('Failed to load external events:', eventsError);
      } else {
        console.log('Loaded external events:', dbEvents);
        
        // Filter based on calendar preferences
        const preferences = JSON.parse(localStorage.getItem('calendar_preferences') || '{}');
        const filteredEvents = dbEvents?.filter(event => 
          preferences[event.calendar_id] !== false
        ) || [];
        
        setExternalEvents(filteredEvents);
      }

      // Also load busy slots for conflict detection
      const { busySlots: availability } = await getCalendarAvailability(startDate, endDate);
      setBusySlots(availability);
    } catch (error) {
      console.error('Failed to load calendar data:', error);
      toast.error('Failed to load calendar data');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSyncCalendars = async () => {
    setIsLoading(true);
    try {
      await syncExternalCalendars();
      await loadCalendarData();
    } catch (error) {
      toast.error('Failed to sync calendars');
    } finally {
      setIsLoading(false);
    }
  };

  const handleReOrganize = async () => {
    setIsLoading(true);
    try {
      const now = new Date();
      
      // Find incomplete scheduled tasks that are in the past or need reorganization
      const tasksToReorganize = tasks.filter(task => {
        if (task.status === 'DONE' || task.completed_at) return false;
        if (!task.start_time) return false;
        
        const taskStart = new Date(task.start_time);
        return taskStart < now; // Past scheduled tasks that weren't completed
      });

      if (tasksToReorganize.length === 0) {
        toast.success('All scheduled tasks are up to date!');
        setIsLoading(false);
        return;
      }

      toast.info(`Re-organizing ${tasksToReorganize.length} task${tasksToReorganize.length > 1 ? 's' : ''}...`);

      // Call scheduler with reschedule action for each task
      for (const task of tasksToReorganize) {
        try {
          const { data, error } = await supabase.functions.invoke('smart-calendar-scheduler', {
            body: {
              task: {
                ...task,
                start_time: null, // Clear old time to force rescheduling
                end_time: null,
                is_scheduled: false
              },
              action: 'reschedule',
              startFromNow: true
            }
          });

          if (error) throw error;

          if (data?.scheduledTask) {
            // Update task in database
            await supabase
              .from('tasks')
              .update({
                start_time: data.scheduledTask.start_time,
                end_time: data.scheduledTask.end_time,
                is_scheduled: true
              })
              .eq('id', task.id);
          }
        } catch (err) {
          console.error(`Failed to reschedule task ${task.id}:`, err);
        }
      }

      await loadCalendarData();
      toast.success(`Successfully re-organized ${tasksToReorganize.length} task${tasksToReorganize.length > 1 ? 's' : ''}!`);
    } catch (error) {
      console.error('Re-organize error:', error);
      toast.error('Failed to re-organize tasks');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFillGaps = async () => {
    setIsLoading(true);
    try {
      // Find unscheduled tasks
      const unscheduledTasks = tasks.filter(task => 
        !task.is_scheduled && 
        !task.start_time && 
        task.status !== 'DONE' && 
        !task.completed_at
      );

      if (unscheduledTasks.length === 0) {
        toast.success('No unscheduled tasks to fill gaps with!');
        setIsLoading(false);
        return;
      }

      toast.info(`Filling gaps with ${unscheduledTasks.length} unscheduled task${unscheduledTasks.length > 1 ? 's' : ''}...`);

      let filledCount = 0;

      // Call scheduler with fill_gaps action for each unscheduled task
      for (const task of unscheduledTasks) {
        try {
          const { data, error } = await supabase.functions.invoke('smart-calendar-scheduler', {
            body: {
              task,
              action: 'fill_gaps',
              startFromNow: true,
              useScoring: true
            }
          });

          if (error) throw error;

          if (data?.scheduledTask) {
            // Update task in database
            await supabase
              .from('tasks')
              .update({
                start_time: data.scheduledTask.start_time,
                end_time: data.scheduledTask.end_time,
                is_scheduled: true
              })
              .eq('id', task.id);
            
            filledCount++;
          }
        } catch (err) {
          console.error(`Failed to fill gap for task ${task.id}:`, err);
        }
      }

      await loadCalendarData();
      
      if (filledCount > 0) {
        toast.success(`Filled gaps with ${filledCount} task${filledCount > 1 ? 's' : ''}!`);
      } else {
        toast.info('No suitable gaps found for scheduling tasks');
      }
    } catch (error) {
      console.error('Fill gaps error:', error);
      toast.error('Failed to fill gaps');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTaskScheduled = async (task: any, slot: any) => {
    console.log('Task scheduled:', task, slot);
    
    // If the task wasn't auto-scheduled, try to schedule it now
    if (!task.is_scheduled && (!task.start_time || !task.end_time)) {
      const scheduledTask = await autoScheduleTask(task);
      if (scheduledTask && onTaskScheduled) {
        onTaskScheduled();
      }
    }
    
    loadCalendarData();
  };

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
      // Include tasks with start_time or due_date on this date
      if (task.start_time) {
        const taskDate = new Date(task.start_time);
        return isSameDay(taskDate, date);
      }
      if (task.due_date) {
        const dueDate = new Date(task.due_date);
        return isSameDay(dueDate, date);
      }
      return false;
    });
  };

  const getEventsForDate = (date: Date) => {
    return externalEvents.filter(event => 
      isSameDay(parseISO(event.start_time), date)
    );
  };

  // Get tasks for date range
  const getTasksForRange = (startDate: Date, endDate: Date) => {
    return tasks.filter(task => {
      if (!task.due_date) return false;
      const taskDate = new Date(task.due_date);
      return taskDate >= startDate && taskDate <= endDate;
    });
  };

  const handleTimeSlotClick: TimeSlotClickHandler = (date: Date, hour?: number) => {
    if (hour !== undefined) {
      // Create a new task at the specific time slot
      const taskDate = new Date(date);
      taskDate.setHours(hour, 0, 0, 0);
      onCreateTask?.(taskDate);
    } else {
      onCreateTask?.(date);
    }
  };

  // Day View Component with Time Slots
  const DayView = () => {
    const dayTasks = getTasksForDate(currentDate);
    const dayEvents = getEventsForDate(currentDate);
    
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
          <TimeSlotGrid
            dates={[currentDate]}
            tasks={tasks}
            externalEvents={externalEvents}
            onTimeSlotClick={handleTimeSlotClick}
            onTaskClick={onTaskEdit}
            className="border rounded-lg"
          />
          {/* Show unscheduled tasks for this date */}
          <div className="mt-4">
            {getTasksForDate(currentDate).filter(task => !task.start_time).map(task => (
              <div key={task.id} className="p-2 mb-2 bg-muted/50 rounded border-l-4 border-warning">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{task.title}</span>
                  <span className="text-xs text-muted-foreground">Needs scheduling</span>
                </div>
                {task.description && (
                  <p className="text-sm text-muted-foreground mt-1">{task.description}</p>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    );
  };

  // Week View Component with Time Slots
  const WeekView = () => {
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
    const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });
    
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">
          {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}
        </h3>
        
        <ScrollArea className="h-[600px]">
          <TimeSlotGrid
            dates={weekDays}
            tasks={tasks}
            externalEvents={externalEvents}
            onTimeSlotClick={handleTimeSlotClick}
            onTaskClick={onTaskEdit}
            className="border rounded-lg"
          />
        </ScrollArea>
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
                    {dayTasks.slice(0, 3).map(task => (
                      <div
                        key={task.id}
                        className={cn(
                          "px-1 py-0.5 rounded text-xs truncate cursor-pointer",
                          task.start_time 
                            ? (priorityColors[task.priority] || 'bg-muted')
                            : 'bg-warning/20 border border-warning/50'
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          onTaskEdit?.(task);
                        }}
                        title={`${task.title}${!task.start_time ? ' (Needs scheduling)' : ''}`}
                      >
                        {!task.start_time && '⏰ '}
                        {task.title}
                      </div>
                    ))}
                    {dayTasks.length > 3 && (
                      <p className="text-xs text-muted-foreground">
                        +{dayTasks.length - 3} more
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
    <div className="space-y-6">
      {/* Smart Task Input */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            AI-Powered Task Scheduling
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SmartTaskInput
            tasks={tasks}
            targetDate={currentDate}
            onTaskScheduled={() => onTaskScheduled?.()}
          />
        </CardContent>
      </Card>

      {/* Calendar View */}
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
              onClick={() => setShowConnectionModal(true)}
            >
              <CalendarIcon className="h-4 w-4 mr-1" />
              Connect Calendar
            </Button>
            
            <Button
              variant="outline"
              size="sm"
              onClick={handleSyncCalendars}
              disabled={isLoading}
            >
              <RefreshCw className={cn("h-4 w-4 mr-1", isLoading && "animate-spin")} />
              Sync
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleReOrganize}
              disabled={isLoading}
              title="Re-schedule incomplete tasks starting from now"
            >
              <CalendarIcon className="h-4 w-4 mr-1" />
              Re-Organize
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleFillGaps}
              disabled={isLoading}
              title="Fill empty time slots with unscheduled tasks"
            >
              <Sparkles className="h-4 w-4 mr-1" />
              Fill
            </Button>
            
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

    <CalendarConnectionModal
      isOpen={showConnectionModal}
      onClose={() => setShowConnectionModal(false)}
      onConnectionSuccess={() => {
        setShowConnectionModal(false);
        handleSyncCalendars();
      }}
    />

    <CalendarSelectionPanel onSelectionChange={loadCalendarData} />
    </div>
  );
};

export default CalendarModule;