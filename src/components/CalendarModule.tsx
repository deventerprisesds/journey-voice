import React, { useState, useEffect } from 'react';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, addDays, isSameDay, isSameMonth, isToday, startOfDay, endOfDay, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, Plus, Brain, RefreshCw, Sparkles, Eye, EyeOff, AlertTriangle } from 'lucide-react';
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
import { getDateInTimezone, getTodayInTimezone } from '@/lib/date';
import { selectSchedulingCandidates } from '@/lib/schedulingCandidates';

interface CalendarModuleProps {
  tasks: Task[];
  onTaskEdit?: (task: Task) => void;
  onCreateTask?: (date: Date) => void;
  onTaskScheduled?: () => void;
  onStatusChange?: (taskId: string, newStatus: Task['status']) => void;
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
  onStatusChange,
}) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<ViewType>('month');
  const [externalEvents, setExternalEvents] = useState<ExternalCalendarEvent[]>([]);
  const [busySlots, setBusySlots] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showConnectionModal, setShowConnectionModal] = useState(false);
  const { autoScheduleTask } = useAutoScheduling();
  
  const [showCompletedTasks, setShowCompletedTasks] = useState(() => {
    const stored = localStorage.getItem('calendar-show-completed');
    return stored ? JSON.parse(stored) : true;
  });

  const toggleShowCompletedTasks = () => {
    const newValue = !showCompletedTasks;
    setShowCompletedTasks(newValue);
    localStorage.setItem('calendar-show-completed', JSON.stringify(newValue));
  };

  // Filter tasks based on showCompletedTasks toggle
  const visibleTasks = showCompletedTasks 
    ? tasks 
    : tasks.filter(task => task.status !== 'DONE');

  const timeSlots = Array.from({ length: 17 }, (_, i) => i + 6); // 6 AM to 11 PM

  // Delta sync on mount to pull latest external events
  useEffect(() => {
    const runDeltaSync = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user?.id) return;
        await supabase.functions.invoke('calendar-delta-sync', { body: { user_id: user.id } });
        console.log('[CalendarModule] Delta sync completed on mount');
      } catch (e) {
        console.warn('[CalendarModule] Delta sync failed (non-blocking):', e);
      }
    };
    runDeltaSync();
  }, []);

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
      const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      
      // Find incomplete tasks that need reorganization
      const tasksToReorganize = tasks.filter(task => {
        if (task.status === 'DONE' || task.completed_at) return false;
        
        // Case 1: Scheduled work in the past
        if (task.start_time) {
          const taskStart = new Date(task.start_time);
          if (taskStart < now) return true;
          // Case 2: Scheduled work within next 7 days (pull forward if possible)
          if (taskStart <= sevenDaysFromNow) return true;
        }
        
        // Case 3: Unscheduled task with past due date
        if (task.due_date && !task.start_time) {
          const dueDate = new Date(task.due_date);
          return dueDate < now;
        }
        
        return false;
      });

      if (tasksToReorganize.length === 0) {
        toast.success('All scheduled tasks are up to date!');
        setIsLoading(false);
        return;
      }

      // Sort by due_date (asc, nulls last), then priority, then created_at
      tasksToReorganize.sort((a, b) => {
        if (a.due_date && !b.due_date) return -1;
        if (!a.due_date && b.due_date) return 1;
        if (a.due_date && b.due_date) {
          const dateDiff = new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
          if (dateDiff !== 0) return dateDiff;
        }
        
        const priorityOrder = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (priorityDiff !== 0) return priorityDiff;
        
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });

      toast.info(`Re-organizing ${tasksToReorganize.length} task${tasksToReorganize.length > 1 ? 's' : ''}...`);

      let successCount = 0;
      let failedCount = 0;
      const errors: Array<{ task: string; error: string }> = [];
      
      // Create working copy of tasks for sequential scheduling
      let workingTasks = tasks.map(t => ({
        id: t.id,
        title: t.title,
        start_time: t.start_time,
        end_time: t.end_time,
        priority: t.priority,
        category: t.category,
        status: t.status
      }));

      for (const task of tasksToReorganize) {
        try {
          // Build existingTasks excluding the current task (so it doesn't block itself)
          const existingTasksPayload = workingTasks.filter(t => t.id !== task.id);
          
          const { data, error } = await supabase.functions.invoke('smart-calendar-scheduler', {
            body: {
              taskText: `${task.title}${task.description ? ' - ' + task.description : ''}`,
              taskCategory: task.category,
              taskPriority: task.priority,
              estimateMinutes: task.estimate_minutes || 60,
              dueDate: task.due_date,
              userId: task.user_id,
              existingTasks: existingTasksPayload,
              busySlots: busySlots,
              scheduling_context: task.scheduling_context || [],
              targetDate: now.toISOString(),
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
            }
          });

          if (error) {
            console.error(`❌ Failed to schedule task "${task.title}":`, error);
            failedCount++;
            errors.push({ task: task.title, error: error.message || 'Unknown error' });
            continue;
          }

          if (data?.success && data?.scheduledSlot) {
            console.log(`✅ Rescheduled "${task.title}" to ${data.scheduledSlot.startTime}`);
            
            // Update working tasks with new slot
            const taskIndex = workingTasks.findIndex(t => t.id === task.id);
            if (taskIndex !== -1) {
              workingTasks[taskIndex].start_time = data.scheduledSlot.startTime;
              workingTasks[taskIndex].end_time = data.scheduledSlot.endTime;
            }
            
            // Update task in database with new schedule
            await supabase
              .from('tasks')
              .update({
                start_time: data.scheduledSlot.startTime,
                end_time: data.scheduledSlot.endTime,
                is_scheduled: true
              })
              .eq('id', task.id);
            
            successCount++;
          } else {
            console.error(`❌ No valid schedule returned for task "${task.title}". Response:`, data);
            failedCount++;
            errors.push({ task: task.title, error: data?.error || 'No valid schedule returned' });
          }
        } catch (err) {
          console.error(`❌ Exception scheduling task "${task.title}":`, err);
          failedCount++;
          errors.push({ task: task.title, error: err instanceof Error ? err.message : 'Unknown error' });
        }
      }

      await loadCalendarData();
      if (onTaskScheduled) onTaskScheduled();
      
      if (successCount > 0 && failedCount === 0) {
        toast.success(`✅ Successfully re-organized ${successCount} task${successCount > 1 ? 's' : ''}!`);
      } else if (successCount > 0 && failedCount > 0) {
        toast.warning(`Partially complete: ${successCount} succeeded, ${failedCount} failed. Check console for details.`);
        console.error('Failed tasks:', errors);
      } else {
        toast.error(`Failed to reschedule ${failedCount} task${failedCount > 1 ? 's' : ''}. Check console for details.`);
        console.error('All tasks failed:', errors);
      }
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        toast.error('You must be signed in to fill schedule gaps');
        return;
      }

      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const targetDate = new Date();
      const targetDateStr = targetDate.toLocaleDateString('en-CA', { timeZone: timezone });

      const [mappedTasksResponse, readyTasksResponse] = await Promise.all([
        supabase
          .from('task_topic_mappings' as never)
          .select('task_id')
          .eq('user_id', user.id),
        supabase
          .from('tasks')
          .select('*')
          .eq('user_id', user.id)
          .in('status', ['READY', 'UP_NEXT', 'TODO'])
          .is('completed_at', null),
      ]);

      const mappedIds = new Set(((mappedTasksResponse.data as Array<{ task_id: string }> | null) || []).map((item) => item.task_id));

      const scopedCandidates = ((readyTasksResponse.data as Task[] | null) || []).filter((task) => {
        if (task.is_scheduled && task.start_time) {
          return getDateInTimezone(task.start_time, timezone) !== targetDateStr;
        }
        return true;
      });

      const unscheduledTasks = selectSchedulingCandidates(scopedCandidates, {
        priorityBoardIds: mappedIds,
        targetDate,
        targetDateStr,
        timezone,
      });

      if (unscheduledTasks.length === 0) {
        toast.success('No unscheduled tasks to fill gaps with!');
        setIsLoading(false);
        return;
      }

      toast.info(`Filling gaps with ${unscheduledTasks.length} unscheduled task${unscheduledTasks.length > 1 ? 's' : ''}...`);

      const batchPayload = unscheduledTasks.map((task) => ({
        id: task.id,
        title: task.title,
        category: task.category,
        priority: task.priority,
        estimate_minutes: task.estimate_minutes || 60,
        due_date: task.due_date,
      }));

      const { data, error } = await supabase.functions.invoke('batch-calendar-scheduler', {
        body: {
          tasks: batchPayload,
          userId: user.id,
          timezone,
          targetDate: targetDateStr,
        },
      });

      if (error || data?.error) {
        throw error || new Error(data?.error || 'Failed to batch schedule tasks');
      }

      const scheduled = (data?.scheduled || []) as Array<{ taskIndex: number; start_time: string; end_time: string }>;
      const updates = scheduled
        .map((slot) => {
          const task = unscheduledTasks[slot.taskIndex];
          if (!task?.id) return null;
          return supabase
            .from('tasks')
            .update({
              start_time: slot.start_time,
              end_time: slot.end_time,
              is_scheduled: true,
            })
            .eq('id', task.id);
        })
        .filter(Boolean);

      const results = await Promise.all(updates);
      const filledCount = results.filter((result: any) => !result?.error).length;

      await loadCalendarData();
      if (onTaskScheduled) onTaskScheduled();
      
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
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
    const dateKey = date.toLocaleDateString('en-CA', { timeZone: tz });
    const dateTasks = tasks.filter(task => {
      // Priority 1: Show on start_time date if scheduled
      if (task.start_time) {
        return getDateInTimezone(task.start_time, tz) === dateKey;
      }
      // Priority 2: Show on due_date only if NOT yet scheduled
      if (task.due_date && !task.start_time) {
        return getDateInTimezone(task.due_date, tz) === dateKey;
      }
      return false;
    });
    
    // Filter out completed tasks if toggle is off
    return showCompletedTasks 
      ? dateTasks 
      : dateTasks.filter(task => task.status !== 'DONE' && !task.completed_at);
  };

  const getEventsForDate = (date: Date) => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
    const dateKey = date.toLocaleDateString('en-CA', { timeZone: tz });
    return externalEvents.filter(event => 
      getDateInTimezone(event.start_time, tz) === dateKey
    );
  };

  // Get tasks for date range
  const getTasksForRange = (startDate: Date, endDate: Date) => {
    const rangeTasks = tasks.filter(task => {
      if (!task.due_date) return false;
      const taskDate = new Date(task.due_date);
      return taskDate >= startDate && taskDate <= endDate;
    });
    
    // Filter out completed tasks if toggle is off
    return showCompletedTasks 
      ? rangeTasks 
      : rangeTasks.filter(task => task.status !== 'DONE' && !task.completed_at);
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
            tasks={visibleTasks}
            externalEvents={externalEvents}
            onTimeSlotClick={handleTimeSlotClick}
            onTaskClick={onTaskEdit}
            onStatusChange={onStatusChange}
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
            tasks={visibleTasks}
            externalEvents={externalEvents}
            onTimeSlotClick={handleTimeSlotClick}
            onTaskClick={onTaskEdit}
            onStatusChange={onStatusChange}
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
            const isCurrentDay = getDateInTimezone(day.toISOString(), Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York') === getTodayInTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York');
            const isCurrentMonth = isSameMonth(day, currentDate);
            
            return (
              <Card 
                key={day.toISOString()} 
                className={cn(
                  "min-h-[120px] cursor-pointer hover:bg-muted/50 transition-colors",
                  !isCurrentMonth && "opacity-50",
                  isCurrentDay && "ring-2 ring-primary"
                )}
                onClick={() => {
                  setCurrentDate(day);
                  setView('day');
                }}
              >
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
                    {dayTasks.slice(0, 3).map(task => {
                      const isWorkBlock = !!task.start_time;
                      const isReminder = !task.start_time && task.due_date;
                      const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'DONE';
                      
                      return (
                        <div
                          key={task.id}
                          className={cn(
                            "rounded text-xs truncate cursor-pointer",
                            // Work blocks: solid color with left border
                            isWorkBlock && "px-1 py-0.5 " + (priorityColors[task.priority] || 'bg-muted'),
                            // Overdue reminders: red styling
                            isOverdue && "px-2 py-1 bg-gradient-to-r from-red-50 to-red-100 border border-red-400 flex items-center gap-1.5 shadow-sm",
                            // Due soon reminders: amber styling
                            (isReminder && !isOverdue) && "px-2 py-1 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-300 flex items-center gap-1.5 shadow-sm"
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            onTaskEdit?.(task);
                          }}
                          title={isOverdue ? `OVERDUE: ${task.title}` : isReminder ? `Due: ${task.title} (Click to schedule work time)` : task.title}
                        >
                          {(isReminder || isOverdue) && (
                            <div className={cn(
                              "flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center",
                              isOverdue ? "bg-red-500" : "bg-amber-400"
                            )}>
                              <AlertTriangle className="h-2.5 w-2.5 text-white" />
                            </div>
                          )}
                          <span className={cn(
                            "truncate",
                            (isReminder || isOverdue) && "font-medium",
                            isOverdue ? "text-red-900" : isReminder && "text-amber-900"
                          )}>
                            {isOverdue && "OVERDUE: "}
                            {isReminder && !isOverdue && "DUE: "}
                            {task.title}
                          </span>
                        </div>
                      );
                    })}
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
              title="Pull forward and re-optimize tasks scheduled in the next 7 days"
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
              onClick={toggleShowCompletedTasks}
              title={showCompletedTasks ? "Hide completed tasks" : "Show completed tasks"}
              className="h-9 w-9 p-0"
            >
              {showCompletedTasks ? (
                <Eye className="h-4 w-4" />
              ) : (
                <EyeOff className="h-4 w-4" />
              )}
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