import React, { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { format, parseISO, isToday, isPast, formatDistanceToNow, addMinutes, startOfDay } from 'date-fns';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { 
  Target, 
  Play, 
  Pause, 
  CheckCircle2, 
  Clock, 
  GripVertical,
  Sunrise,
  Coffee,
  Sunset,
  Moon,
  Calendar,
  ListOrdered,
  ChevronDown,
  ChevronUp,
  CalendarPlus,
  Plus,
  RotateCcw,
  X,
  Trash2,
  RefreshCw
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Task, ExternalCalendarEvent } from '@/types/task';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { DEFAULT_SCHEDULING_CONFIG, type SchedulingConfig } from '@/config/schedulingRules';
import { loadUserSchedulingConfig } from '@/services/schedulingService';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useAuth } from '@/hooks/useAuth';
import { useBatchScheduling } from '@/hooks/useBatchScheduling';
import { getTimePartsInTimezone, localTimeToUtcISO, getDefaultTimezone } from '@/lib/date';
import QuickTaskInput from './QuickTaskInput';
import TaskCreationModal from './TaskCreationModal';
import { getOrCreateDefaultBoardId } from '@/utils/demoData';

interface FocusViewProps {
  tasks: Task[];
  onTaskEdit: (task: Task) => void;
  onStatusChange: (taskId: string, newStatus: Task['status']) => void;
  onTaskUpdate: () => void;
}

// Time window visual config matching TimeSlotGrid
const timeWindowStyles: Record<string, { 
  icon: React.ReactNode; 
  label: string; 
  bgClass: string; 
  borderClass: string;
  textClass: string;
}> = {
  morning: { 
    icon: <Sunrise className="h-4 w-4" />, 
    label: 'Morning', 
    bgClass: 'bg-amber-50 dark:bg-amber-950/20',
    borderClass: 'border-l-4 border-l-amber-400',
    textClass: 'text-amber-700 dark:text-amber-300'
  },
  business_hours: { 
    icon: <Coffee className="h-4 w-4" />, 
    label: 'Business Hours', 
    bgClass: 'bg-blue-50 dark:bg-blue-950/20',
    borderClass: 'border-l-4 border-l-blue-400',
    textClass: 'text-blue-700 dark:text-blue-300'
  },
  after_work: { 
    icon: <Sunset className="h-4 w-4" />, 
    label: 'After Work', 
    bgClass: 'bg-orange-50 dark:bg-orange-950/20',
    borderClass: 'border-l-4 border-l-orange-400',
    textClass: 'text-orange-700 dark:text-orange-300'
  },
  evening: { 
    icon: <Moon className="h-4 w-4" />, 
    label: 'Evening', 
    bgClass: 'bg-purple-50 dark:bg-purple-950/20',
    borderClass: 'border-l-4 border-l-purple-400',
    textClass: 'text-purple-700 dark:text-purple-300'
  },
  weekends: {
    icon: <Calendar className="h-4 w-4" />,
    label: 'Weekend',
    bgClass: 'bg-teal-50 dark:bg-teal-950/20',
    borderClass: 'border-l-4 border-l-teal-400',
    textClass: 'text-teal-700 dark:text-teal-300'
  },
};

// Priority colors matching TaskCard
const priorityBadgeColors: Record<string, string> = {
  LOW: 'bg-priority-low/10 text-priority-low border-priority-low/20',
  MEDIUM: 'bg-priority-medium/10 text-priority-medium border-priority-medium/20',
  HIGH: 'bg-priority-high/10 text-priority-high border-priority-high/20',
  URGENT: 'bg-priority-urgent/10 text-priority-urgent border-priority-urgent/20',
};

// Category colors matching TaskCard
const categoryColors: Record<string, string> = {
  LIFE: 'bg-category-life/10 text-category-life border-category-life/20',
  CAREER: 'bg-category-career/10 text-category-career border-category-career/20',
  VENTURES: 'bg-category-ventures/10 text-category-ventures border-category-ventures/20',
  EDUCATION: 'bg-category-education/10 text-category-education border-category-education/20',
  PROF_EDUCATION: 'bg-category-education/10 text-category-education border-category-education/20',
};

// Priority sort order
const priorityOrder: Record<string, number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

const FocusView: React.FC<FocusViewProps> = ({
  tasks,
  onTaskEdit,
  onStatusChange,
  onTaskUpdate
}) => {
  const [showAllUpNext, setShowAllUpNext] = useState(false);
  const [isTimelineExpanded, setIsTimelineExpanded] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createModalHour, setCreateModalHour] = useState<number>(9);
  const [createModalMinute, setCreateModalMinute] = useState<number>(0);
  const [defaultBoardId, setDefaultBoardId] = useState<string>('');
  const [isClearing, setIsClearing] = useState(false);
  const [isRerunning, setIsRerunning] = useState(false);
  const [externalEvents, setExternalEvents] = useState<ExternalCalendarEvent[]>([]);
  const today = new Date();
  const [config, setConfig] = useState<SchedulingConfig>(DEFAULT_SCHEDULING_CONFIG);
  
  const { user } = useAuth();

  // Load user's authoritative scheduling config
  useEffect(() => {
    if (user?.id) {
      loadUserSchedulingConfig(user.id).then(setConfig);
    }
  }, [user?.id]);
  const { scheduleBatch, updateTasksWithSchedule, isScheduling } = useBatchScheduling();

  // Load default board ID
  useEffect(() => {
    if (user?.id) {
      getOrCreateDefaultBoardId(user.id).then(setDefaultBoardId);
    }
  }, [user?.id]);

  // Periodic delta sync + load external calendar events
  useEffect(() => {
    if (!user?.id) return;

    const syncAndLoadExternalEvents = async () => {
      try {
        // Trigger delta sync to pull latest from Google/Outlook
        await supabase.functions.invoke('calendar-delta-sync', { body: { user_id: user.id } });
        console.log('[FocusView] Delta sync completed');
      } catch (e) {
        console.warn('[FocusView] Delta sync failed (non-blocking):', e);
      }

      // Load external events for today from DB
      try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        const { data, error } = await supabase
          .from('external_calendar_events')
          .select('*, calendar_connections!connection_id(provider, provider_account_email)')
          .eq('user_id', user.id)
          .gte('start_time', todayStart.toISOString())
          .lte('start_time', todayEnd.toISOString());

        if (!error && data) {
          setExternalEvents(data as ExternalCalendarEvent[]);
          console.log(`[FocusView] Loaded ${data.length} external events for today`);
        }
      } catch (e) {
        console.warn('[FocusView] Failed to load external events:', e);
      }
    };

    syncAndLoadExternalEvents();
    const interval = setInterval(syncAndLoadExternalEvents, 15 * 60 * 1000); // every 15 min
    return () => clearInterval(interval);
  }, [user?.id]);
  
  // Get user timezone - use browser default as fallback
  const userTimezone = getDefaultTimezone();

  // Filter task groups
  const doingTasks = tasks.filter(t => t.status === 'DOING');
  
  // Helper: Check if task is incomplete and was scheduled in the past (rolled over)
  // Helper: Check if task is incomplete and was scheduled in the past (rolled over)
  // Only valid workflow statuses can roll over - excludes corrupted category values
  const isRolledOver = (t: Task): boolean => {
    const rolloverStatuses = ['UP_NEXT', 'TODO', 'READY', 'BACKLOG'];
    if (!rolloverStatuses.includes(t.status)) return false;
    
    const todayStart = startOfDay(new Date());
    
    // Path 1: Has a start_time from a past day
    if (t.start_time) {
      return parseISO(t.start_time) < todayStart;
    }
    
    // Path 2: Has only a due_date that is in the past (before today)
    if (t.due_date) {
      return parseISO(t.due_date) < todayStart;
    }
    
    return false;
  };
  
  const upNextTasks = tasks
    .filter(t => 
      t.status === 'UP_NEXT' || 
      (t.status === 'READY' && ['URGENT', 'HIGH'].includes(t.priority)) ||
      (t.status === 'TODO' && t.priority === 'URGENT') ||
      // NEW: Include rolled-over tasks (past scheduled, incomplete)
      isRolledOver(t)
    )
    // Exclude tasks already showing in Today's Schedule
    .filter(t => !(t.start_time && isToday(parseISO(t.start_time))))
    .sort((a, b) => {
      // Rolled-over tasks bubble to top
      const aRolled = isRolledOver(a);
      const bRolled = isRolledOver(b);
      if (aRolled && !bRolled) return -1;
      if (!aRolled && bRolled) return 1;
      // Then by priority
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      // Then by due date
      if (a.due_date && b.due_date) {
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      }
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return 0;
    });
  
  const scheduledToday = tasks.filter(t => 
    t.start_time && isToday(parseISO(t.start_time)) && t.status !== 'DONE'
  ).sort((a, b) => {
    if (!a.start_time || !b.start_time) return 0;
    return new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
  });

  // Determine which windows to show based on day of week
  const isWeekend = today.getDay() === 0 || today.getDay() === 6;
  
  // Check if a task violates its allowed time window
  const isWindowViolation = (task: Task): { violation: boolean; actualWindow: string; allowedWindows: string[] } => {
    if (!task.start_time) return { violation: false, actualWindow: '', allowedWindows: [] };
    
    const { hour: taskHour } = getTimePartsInTimezone(task.start_time, userTimezone);
    const dayOfWeek = today.getDay();
    const windows = config.timeWindows;
    
    // Find actual window
    let actualWindow = 'unknown';
    if (isWeekend && windows.weekends?.days?.includes(dayOfWeek) && taskHour >= windows.weekends.start && taskHour < windows.weekends.end) {
      actualWindow = 'weekends';
    } else if (!isWeekend) {
      if (windows.morning.days.includes(dayOfWeek) && taskHour >= windows.morning.start && taskHour < windows.morning.end) actualWindow = 'morning';
      else if (windows.business_hours.days.includes(dayOfWeek) && taskHour >= windows.business_hours.start && taskHour < windows.business_hours.end) actualWindow = 'business_hours';
      else if (windows.after_work.days.includes(dayOfWeek) && taskHour >= windows.after_work.start && taskHour < windows.after_work.end) actualWindow = 'after_work';
      else if (windows.evening.days.includes(dayOfWeek) && taskHour >= windows.evening.start && taskHour < windows.evening.end) actualWindow = 'evening';
    }
    
    // Get allowed windows for this category
    const catMapping = config.categoryMappings[task.category];
    const allowedWindows = catMapping?.defaultTimeWindow || ['flexible'];
    
    // 'flexible' means any window is OK
    if (allowedWindows.includes('flexible')) {
      return { violation: false, actualWindow, allowedWindows };
    }
    
    const violation = !allowedWindows.includes(actualWindow);
    return { violation, actualWindow, allowedWindows };
  };

  const getTimeWindowForTask = (task: Task): string => {
    if (!task.start_time) return isWeekend ? 'weekends' : 'business_hours';
    
    const { hour: taskHour } = getTimePartsInTimezone(task.start_time, userTimezone);
    const dayOfWeek = today.getDay();
    const windows = config.timeWindows;
    
    if (isWeekend) {
      return 'weekends'; // All tasks go to the single weekend window
    }
    
    let assignedWindow = 'after_work'; // default fallback
    
    // Exact match only — NO nearest-window snapping
    if (windows.morning.days.includes(dayOfWeek) && taskHour >= windows.morning.start && taskHour < windows.morning.end) assignedWindow = 'morning';
    else if (windows.business_hours.days.includes(dayOfWeek) && taskHour >= windows.business_hours.start && taskHour < windows.business_hours.end) assignedWindow = 'business_hours';
    else if (windows.after_work.days.includes(dayOfWeek) && taskHour >= windows.after_work.start && taskHour < windows.after_work.end) assignedWindow = 'after_work';
    else if (windows.evening.days.includes(dayOfWeek) && taskHour >= windows.evening.start && taskHour < windows.evening.end) assignedWindow = 'evening';
    // If task is outside ALL windows (e.g., 5 AM), assign to nearest without snapping label
    else if (taskHour < windows.morning.start) assignedWindow = 'morning';
    else if (taskHour >= windows.evening.end) assignedWindow = 'evening';
    
    return assignedWindow;
  };

  // Build the window list based on weekday vs weekend
  const activeWindowNames = isWeekend ? ['weekends'] : ['morning', 'business_hours', 'after_work', 'evening'];
  
  const tasksByWindow: Record<string, Task[]> = {};
  activeWindowNames.forEach(name => { tasksByWindow[name] = []; });

  scheduledToday.forEach(task => {
    const window = getTimeWindowForTask(task);
    if (tasksByWindow[window]) {
      tasksByWindow[window].push(task);
    }
  });

  // Schedule task at specific time using timezone-aware conversion
  const scheduleTaskAtTime = async (taskId: string, hour: number, minute: number) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    // Use timezone-aware conversion to UTC
    const dateStr = format(today, 'yyyy-MM-dd');
    const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    const startTimeISO = localTimeToUtcISO(dateStr, timeStr, userTimezone);
    
    const estimatedMinutes = task.estimate_minutes || 60;
    const endTime = addMinutes(new Date(startTimeISO), estimatedMinutes);

    try {
      const { error } = await supabase
        .from('tasks')
        .update({
          start_time: startTimeISO,
          end_time: endTime.toISOString(),
          status: task.status === 'UP_NEXT' ? 'TODO' : task.status,
          updated_at: new Date().toISOString()
        })
        .eq('id', taskId);

      if (error) throw error;
      
      // Format the display time using timezone
      const displayTime = new Date(startTimeISO).toLocaleTimeString('en-US', {
        timeZone: userTimezone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      toast.success(`Scheduled "${task.title}" for ${displayTime}`);
      onTaskUpdate();
    } catch (error) {
      console.error('Error scheduling task:', error);
      toast.error('Failed to schedule task');
    }
  };

  // Handle drag end
  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return;

    const droppableId = result.destination.droppableId;
    
    // Handle drop on time window
    if (droppableId.startsWith('timeslot-')) {
      const [_, hour, minute] = droppableId.split('-');
      await scheduleTaskAtTime(result.draggableId, parseInt(hour), parseInt(minute));
    }
  };

  // Start a task (move to DOING)
  const handleStartTask = async (taskId: string) => {
    try {
      const { error } = await supabase
        .from('tasks')
        .update({
          status: 'DOING',
          updated_at: new Date().toISOString()
        })
        .eq('id', taskId);

      if (error) throw error;
      
      toast.success('Task started!');
      onTaskUpdate();
    } catch (error) {
      console.error('Error starting task:', error);
      toast.error('Failed to start task');
    }
  };

  // Pause a task (move to UP_NEXT)
  const handlePauseTask = async (taskId: string) => {
    try {
      const { error } = await supabase
        .from('tasks')
        .update({
          status: 'UP_NEXT',
          updated_at: new Date().toISOString()
        })
        .eq('id', taskId);

      if (error) throw error;
      
      toast.success('Task paused');
      onTaskUpdate();
    } catch (error) {
      console.error('Error pausing task:', error);
      toast.error('Failed to pause task');
    }
  };

  // Complete a task
  const handleCompleteTask = async (taskId: string) => {
    try {
      const { error } = await supabase
        .from('tasks')
        .update({
          status: 'DONE',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', taskId);

      if (error) throw error;
      
      toast.success('Task completed!');
      onTaskUpdate();
    } catch (error) {
      console.error('Error completing task:', error);
      toast.error('Failed to complete task');
    }
  };

  // Auto-schedule Up Next tasks into remaining day slots
  const handleAutoSchedule = async () => {
    if (!user?.id || upNextTasks.length === 0) return;
    
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    
    const result = await scheduleBatch(
      upNextTasks.map(task => ({
        id: task.id,
        title: task.title,
        category: task.category,
        priority: task.priority,
        estimate_minutes: task.estimate_minutes || 60,
        due_date: task.due_date
      })),
      user.id,
      timezone,
      new Date()
    );
    
    if (result.scheduled.length > 0) {
      await updateTasksWithSchedule(
        result.scheduled,
        upNextTasks.map(t => t.id)
      );
      onTaskUpdate();
    }
  };

  // Remove a single task from schedule, restoring its original status
  const handleRemoveFromSchedule = async (task: Task) => {
    try {
      const preStatus = (task.scheduling_context as any)?.pre_schedule_status || task.status;
      const restoredStatus = preStatus === 'TODO' ? 'TODO' : preStatus;
      
      const { error } = await supabase
        .from('tasks')
        .update({
          start_time: null,
          end_time: null,
          is_scheduled: false,
          status: restoredStatus,
          scheduling_context: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', task.id);

      if (error) throw error;
      toast.success(`"${task.title}" removed from schedule`);
      onTaskUpdate();
    } catch (error) {
      console.error('Error removing task from schedule:', error);
      toast.error('Failed to remove task');
    }
  };

  // Helper: write trace to error_log table for remote visibility
  const writeTrace = async (checkpoint: string, traceType: string, data: any) => {
    try {
      const { error } = await supabase.from('error_log').insert({
        error_type: traceType,
        error_message: checkpoint,
        source: 'frontend',
        component: 'FocusView',
        user_id: user?.id || null,
        context: data,
        session_id: `focus_${format(new Date(), 'yyyyMMdd_HHmmss')}`,
      });
      if (error) {
        console.warn('[TRACE] DB write failed:', error.message, error.details);
      }
    } catch (e) {
      console.warn('[TRACE] Failed to write trace to DB:', e);
    }
  };

  // Clear all scheduled tasks for today, restoring original statuses
  // BULLETPROOF: queries DB directly instead of relying on React props
  const handleClearAll = async () => {
    if (!user?.id) return;
    
    const tz = userTimezone;
    const todayStart = new Date(format(today, 'yyyy-MM-dd') + 'T00:00:00');
    const tomorrowStart = new Date(format(today, 'yyyy-MM-dd') + 'T00:00:00');
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    
    // Convert to UTC ISO strings for DB query
    const todayStartUTC = localTimeToUtcISO(format(today, 'yyyy-MM-dd'), '00:00', tz);
    const tomorrowStartUTC = localTimeToUtcISO(format(new Date(tomorrowStart), 'yyyy-MM-dd'), '00:00', tz);

    setIsClearing(true);
    try {
      // Step 1: Query DB directly for ALL tasks scheduled today (not from React props)
      const { data: dbTodayTasks, error: fetchError } = await supabase
        .from('tasks')
        .select('id, title, category, start_time, end_time, status, scheduling_context, is_scheduled')
        .eq('user_id', user.id)
        .gte('start_time', todayStartUTC)
        .lt('start_time', tomorrowStartUTC)
        .neq('status', 'DONE');

      if (fetchError) throw fetchError;

      const tasksToClr = dbTodayTasks || [];
      
      // TRACE: Pre-clear state
      await writeTrace('CLEAR_PRE', 'clear_trace', {
        propCount: scheduledToday.length,
        dbCount: tasksToClr.length,
        staleDetected: tasksToClr.length !== scheduledToday.length,
        todayStartUTC,
        tomorrowStartUTC,
        tasks: tasksToClr.map(t => ({
          id: t.id, title: t.title, category: t.category,
          start_time: t.start_time, is_scheduled: t.is_scheduled,
        })),
      });

      if (tasksToClr.length === 0) {
        toast.info('No scheduled tasks found for today');
        setIsClearing(false);
        return;
      }

      if (!window.confirm(`Remove all ${tasksToClr.length} tasks from today's schedule? Their original statuses will be restored.`)) {
        setIsClearing(false);
        return;
      }

      const taskIds = tasksToClr.map(t => t.id);

      // Step 2: Batch clear in a single DB call
      const { error: updateError } = await supabase
        .from('tasks')
        .update({
          start_time: null,
          end_time: null,
          is_scheduled: false,
          scheduling_context: null,
          updated_at: new Date().toISOString(),
        })
        .in('id', taskIds);

      if (updateError) throw updateError;

      // Step 3: Verify - query DB again to confirm zero remaining
      const { count: remaining, error: verifyError } = await supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_scheduled', true)
        .gte('start_time', todayStartUTC)
        .lt('start_time', tomorrowStartUTC)
        .neq('status', 'DONE');

      // TRACE: Post-clear verification
      await writeTrace('CLEAR_POST', 'clear_trace', {
        clearedCount: tasksToClr.length,
        remainingAfterClear: remaining ?? 'unknown',
        verifyError: verifyError?.message || null,
        success: (remaining ?? 0) === 0,
      });

      if ((remaining ?? 0) > 0) {
        console.error(`[CLEAR] VERIFICATION FAILED: ${remaining} tasks still scheduled after clear!`);
        toast.error(`Clear incomplete: ${remaining} tasks may still be scheduled. Try again.`);
      } else {
        toast.success(`Cleared ${tasksToClr.length} tasks from schedule`);
      }

      onTaskUpdate();
    } catch (error) {
      console.error('Error clearing schedule:', error);
      toast.error('Failed to clear schedule');
      await writeTrace('CLEAR_ERROR', 'clear_trace', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsClearing(false);
    }
  };

  // Auto-fill open slots with priority candidates
  const handleAutoFill = async () => {
    if (!user?.id) return;
    setIsRerunning(true);
    try {
      // 1. Fetch priority board task IDs
      const { data: mappedTasks } = await supabase
        .from('task_topic_mappings' as any)
        .select('task_id')
        .eq('user_id', user.id);
      const mappedIds = (mappedTasks || []).map((t: any) => t.task_id);

      // 2. Fetch READY/UP_NEXT/TODO tasks (TODO captures cleared tasks missing pre_schedule_status)
      const { data: readyTasks } = await supabase
        .from('tasks')
        .select('id')
        .eq('user_id', user.id)
        .in('status', ['READY', 'UP_NEXT', 'TODO'])
        .is('completed_at', null);
      const readyIds = (readyTasks || []).map((t: any) => t.id);

      // 3. Merge & dedupe
      const allIds = [...new Set([...mappedIds, ...readyIds])];
      if (allIds.length === 0) {
        toast.info('No candidate tasks found to auto-fill');
        return;
      }

      // 4. Fetch full candidate data (exclude already scheduled today & done/blocked)
      const { data: candidates } = await supabase
        .from('tasks')
        .select('*')
        .in('id', allIds)
        .not('status', 'in', '("DONE","BLOCKED")')
        .is('completed_at', null);

      // Filter out tasks already scheduled for today
      const unscheduledCandidates = (candidates || []).filter((t: any) => {
        if (t.is_scheduled && t.start_time && isToday(parseISO(t.start_time))) return false;
        return true;
      });

      if (unscheduledCandidates.length === 0) {
        toast.info('All candidate tasks are already scheduled');
        return;
      }

      // 5. Score candidates (same heuristics as nightly builder)
      const priorityWeights: Record<string, number> = { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
      const scored = unscheduledCandidates.map((t: any) => {
        let score = priorityWeights[t.priority] || 1;
        score += (t.pushed_count || 0) * 0.5;
        // Due-soon boost
        if (t.due_date) {
          const hoursUntilDue = (new Date(t.due_date).getTime() - Date.now()) / (1000 * 60 * 60);
          if (hoursUntilDue <= 48) score += 3;
          else if (hoursUntilDue <= 96) score += 1;
        }
        // UP_NEXT boost
        if (t.status === 'UP_NEXT') score += 1;
        // Keyword boost for financial/comms tasks
        const titleLower = (t.title || '').toLowerCase();
        if (/pay|invoice|bill|transfer|fee/.test(titleLower)) score += 2;
        if (/email|reply|follow.?up|respond|call|message/.test(titleLower)) score += 1.5;
        return { ...t, _score: score };
      });

      // Sort by score desc, then due_date asc
      scored.sort((a: any, b: any) => {
        if (b._score !== a._score) return b._score - a._score;
        if (a.due_date && b.due_date) return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
        if (a.due_date) return -1;
        if (b.due_date) return 1;
        return 0;
      });

      // Dedup by normalized title — keep only the highest-scored instance
      const seenTitles = new Map<string, string>();
      const dedupedCandidates = scored.filter((t: any) => {
        const key = t.title.toLowerCase().trim();
        if (seenTitles.has(key)) return false;
        seenTitles.set(key, t.id);
        return true;
      });
      const dupesRemoved = scored.length - dedupedCandidates.length;
      if (dupesRemoved > 0) {
        console.log(`[AUTOFILL] Dedup removed ${dupesRemoved} duplicate titles from ${scored.length} candidates`);
      }
      const topCandidates = dedupedCandidates.slice(0, 25);

      // 6. Call batch scheduler
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      
      // === TRACE CHECKPOINT A: Tasks sent to scheduler ===
      await writeTrace('AUTOFILL_A_SENT', 'autofill_trace', {
        candidateCount: topCandidates.length,
        skippedAlreadyScheduled: (candidates || []).length - unscheduledCandidates.length,
        timezone,
        tasks: topCandidates.map((t: any, i: number) => ({
          idx: i, id: t.id, title: t.title, category: t.category, priority: t.priority, score: t._score,
        })),
      });
      
      const result = await scheduleBatch(
        topCandidates.map((t: any) => ({
          id: t.id,
          title: t.title,
          category: t.category,
          priority: t.priority,
          estimate_minutes: t.estimate_minutes || 60,
          due_date: t.due_date,
        })),
        user.id,
        timezone,
        new Date()
      );

      // === TRACE CHECKPOINT B: Raw result from scheduler ===
      await writeTrace('AUTOFILL_B_RESULT', 'autofill_trace', {
        scheduledCount: result.scheduled.length,
        slots: result.scheduled.map((s: any, i: number) => {
          const matchedTask = topCandidates[s.taskIndex];
          return { idx: i, taskIndex: s.taskIndex, title: matchedTask?.title, category: matchedTask?.category, start: s.start_time, end: s.end_time, reason: s.reasoning };
        }),
      });

      // 7. Update tasks with pre_schedule_status preservation
      if (result.scheduled.length > 0) {
        for (const slot of result.scheduled) {
          const taskId = slot.taskId || topCandidates[slot.taskIndex]?.id;
          if (!taskId) continue;
          const candidate = topCandidates.find((c: any) => c.id === taskId) || topCandidates[slot.taskIndex];
          
          // === TRACE CHECKPOINT C: DB update before execution ===
          // (logged in batch at checkpoint D)
          
          await supabase
            .from('tasks')
            .update({
              start_time: slot.start_time,
              end_time: slot.end_time,
              is_scheduled: true,
              scheduling_context: { pre_schedule_status: candidate?.status || 'TODO' },
              status: 'TODO',
              updated_at: new Date().toISOString(),
            })
            .eq('id', taskId);
        }
        
        // === TRACE CHECKPOINT D: Post-save verification ===
        const savedIds = result.scheduled
          .map((s: any) => s.taskId || topCandidates[s.taskIndex]?.id)
          .filter(Boolean);
        const { data: verification } = await supabase
          .from('tasks')
          .select('id, title, category, start_time, end_time, is_scheduled')
          .in('id', savedIds);
        await writeTrace('AUTOFILL_D_VERIFIED', 'autofill_trace', {
          savedCount: savedIds.length,
          verifiedTasks: (verification || []).map((t: any) => ({
            title: t.title, category: t.category, start: t.start_time, end: t.end_time, scheduled: t.is_scheduled,
          })),
        });
        
        toast.success(`Auto-filled ${result.scheduled.length} tasks into today's schedule`);
        onTaskUpdate();
      } else {
        toast.info('No open slots available to fill');
      }
    } catch (error) {
      console.error('Error auto-filling schedule:', error);
      toast.error('Failed to auto-fill schedule');
    } finally {
      setIsRerunning(false);
    }
  };

  // Get drop time slots for a window
  const getDropSlotsForWindow = (windowName: string) => {
    const windowKey = windowName as keyof typeof config.timeWindows;
    const window = config.timeWindows[windowKey];
    if (!window) return [];
    
    const slots: { hour: number; minute: number; label: string }[] = [];
    for (let hour = window.start; hour < window.end; hour++) {
      for (const minute of [0, 30]) {
        // Format time label using timezone-aware formatting
        const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        const dateStr = format(today, 'yyyy-MM-dd');
        const isoTime = localTimeToUtcISO(dateStr, timeStr, userTimezone);
        const label = new Date(isoTime).toLocaleTimeString('en-US', {
          timeZone: userTimezone,
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
        slots.push({ hour, minute, label });
      }
    }
    return slots;
  };

  const displayedUpNext = showAllUpNext ? upNextTasks : upNextTasks.slice(0, 5);

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      {/* Smart Task Input - Own row at top */}
      <Card className="mb-4">
        <CardContent className="pt-4">
          <QuickTaskInput onTaskCreated={onTaskUpdate} />
        </CardContent>
      </Card>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Timeline - 2/3 width on desktop */}
        <div className="lg:col-span-2 order-1">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-primary" />
                  <h2 className="text-lg font-semibold">Today's Schedule</h2>
                  <Badge variant="secondary">{scheduledToday.length + externalEvents.length} items</Badge>
                  {externalEvents.length > 0 && (
                    <Badge variant="outline" className="text-xs">{externalEvents.length} external</Badge>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearAll}
                    disabled={isClearing || scheduledToday.length === 0}
                    className="text-xs h-7 text-destructive hover:text-destructive"
                    title="Clear all tasks from today's schedule"
                  >
                    {isClearing ? <Clock className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3 mr-1" />}
                    {!isClearing && 'Clear All'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleAutoFill}
                    disabled={isRerunning}
                    className="text-xs h-7"
                    title="Auto-fill open slots with priority tasks"
                  >
                    {isRerunning ? <Clock className="h-3 w-3 animate-spin" /> : <CalendarPlus className="h-3 w-3 mr-1" />}
                    {!isRerunning && 'Auto-fill'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      if (!user?.id) return;
                   try {
                        toast.info('Syncing calendar & assignments...');
                        const [calResult, assignResult] = await Promise.allSettled([
                          supabase.functions.invoke('calendar-delta-sync', { body: { user_id: user.id } }),
                          supabase.functions.invoke('nightly-assignment-sync', { body: { userId: user.id } }),
                        ]);
                        // Reload external events
                        const todayStart = new Date(); todayStart.setHours(0,0,0,0);
                        const todayEnd = new Date(); todayEnd.setHours(23,59,59,999);
                        const { data: events } = await supabase
                          .from('external_calendar_events')
                          .select('*, calendar_connections!connection_id(provider, provider_account_email)')
                          .eq('user_id', user.id)
                          .gte('start_time', todayStart.toISOString())
                          .lte('start_time', todayEnd.toISOString());
                        setExternalEvents((events || []) as ExternalCalendarEvent[]);
                        const calData = calResult.status === 'fulfilled' ? calResult.value.data : null;
                        const calCount = calData?.results?.reduce((sum: number, r: any) => sum + (r.events_added || 0), 0) || 0;
                        const assignData = assignResult.status === 'fulfilled' ? assignResult.value.data : null;
                        const assignCount = assignData?.created?.length || 0;
                        toast.success(`Synced — ${calCount} events, ${assignCount} assignments added, ${(events || []).length} events today`);
                        onTaskUpdate();
                      } catch (e) {
                        console.error('Manual sync failed:', e);
                        toast.error('Sync failed');
                      }
                    }}
                    className="text-xs h-7"
                    title="Sync external calendar events now"
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Sync
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsTimelineExpanded(!isTimelineExpanded)}
                    className="lg:hidden"
                  >
                    {isTimelineExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </CardHeader>

            
            <Collapsible open={isTimelineExpanded} onOpenChange={setIsTimelineExpanded}>
              <CollapsibleContent>
                <CardContent className="pt-0">
                  <ScrollArea className="h-[400px] lg:h-[500px]" type="always">
                    <div className="space-y-4 min-w-max">
                      {activeWindowNames.map((windowName) => {
                        const style = timeWindowStyles[windowName] || timeWindowStyles.business_hours;
                        const windowTasks = tasksByWindow[windowName] || [];
                        const dropSlots = getDropSlotsForWindow(windowName);
                        
                        return (
                          <div key={windowName} className={cn("rounded-lg", style.bgClass)}>
                            {/* Window Header */}
                            <div className={cn("p-3 flex items-center justify-between gap-2", style.borderClass)}>
                              <div className="flex items-center gap-2 min-w-0">
                                <span className={cn("flex-shrink-0", style.textClass)}>{style.icon}</span>
                                <span className={cn("font-medium text-sm truncate", style.textClass)}>{style.label}</span>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <span className="text-xs text-muted-foreground whitespace-nowrap">
                                  {config.timeWindows[windowName as keyof typeof config.timeWindows]?.start}:00 - {config.timeWindows[windowName as keyof typeof config.timeWindows]?.end}:00
                                </span>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const windowStart = config.timeWindows[windowName as keyof typeof config.timeWindows]?.start ?? 9;
                                      setCreateModalHour(windowStart);
                                      setIsCreateModalOpen(true);
                                    }}
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                  </Button>
                              </div>
                            </div>
                            
                            {/* Tasks and Open Slots in Window */}
                            <div className="p-2 space-y-2">
                              {(() => {
                                // Build a merged timeline: tasks at their slots + open slots
                                const occupiedSlots = new Set<string>();
                                windowTasks.forEach(task => {
                                  if (task.start_time) {
                                    const { hour, minute } = getTimePartsInTimezone(task.start_time, userTimezone);
                                    const durationMinutes = task.estimate_minutes || 60;
                                    for (let m = 0; m < durationMinutes; m += 30) {
                                      const slotMin = minute + m;
                                      const slotHour = hour + Math.floor(slotMin / 60);
                                      const slotMinute = slotMin % 60 < 30 ? 0 : 30;
                                      occupiedSlots.add(`${slotHour}-${slotMinute}`);
                                    }
                                  }
                                });

                                // Also mark slots occupied by external calendar events
                                const windowCfg = config.timeWindows[windowName as keyof typeof config.timeWindows];
                                const wsStart = windowCfg?.start ?? 0;
                                const wsEnd = windowCfg?.end ?? 24;
                                externalEvents.forEach(evt => {
                                  const evtStart = getTimePartsInTimezone(evt.start_time, userTimezone);
                                  const evtEnd = getTimePartsInTimezone(evt.end_time, userTimezone);
                                  if (evtStart.hour >= wsStart && evtStart.hour < wsEnd) {
                                    const startMin = evtStart.hour * 60 + evtStart.minute;
                                    const endMin = evtEnd.hour * 60 + evtEnd.minute;
                                    for (let m = startMin; m < endMin; m += 30) {
                                      const slotH = Math.floor(m / 60);
                                      const slotM = m % 60 < 30 ? 0 : 30;
                                      occupiedSlots.add(`${slotH}-${slotM}`);
                                    }
                                  }
                                });

                                const openSlots = dropSlots.filter(s => !occupiedSlots.has(`${s.hour}-${s.minute}`));

                                // If no tasks and no slots, show simple placeholder
                                if (windowTasks.length === 0 && openSlots.length === 0) {
                                  return (
                                    <div className="p-4 border-2 border-dashed rounded-md text-center text-sm text-muted-foreground border-muted">
                                      No slots available
                                    </div>
                                  );
                                }

                                // Merge tasks, external events, and open slots into a sorted timeline
                                type TimelineItem = 
                                  | { type: 'task'; task: Task; sortKey: number } 
                                  | { type: 'external'; event: ExternalCalendarEvent; sortKey: number }
                                  | { type: 'slot'; slot: { hour: number; minute: number; label: string }; sortKey: number };
                                const timeline: TimelineItem[] = [];

                                windowTasks.forEach(task => {
                                  const sortKey = task.start_time 
                                    ? (() => { const { hour, minute } = getTimePartsInTimezone(task.start_time, userTimezone); return hour * 60 + minute; })()
                                    : 0;
                                  timeline.push({ type: 'task', task, sortKey });
                                });

                                // Add external calendar events to this window
                                const windowConfig = config.timeWindows[windowName as keyof typeof config.timeWindows];
                                const wStart = windowConfig?.start ?? 0;
                                const wEnd = windowConfig?.end ?? 24;
                                externalEvents.forEach(evt => {
                                  const { hour, minute } = getTimePartsInTimezone(evt.start_time, userTimezone);
                                  if (hour >= wStart && hour < wEnd) {
                                    timeline.push({ type: 'external', event: evt, sortKey: hour * 60 + minute });
                                  }
                                });

                                openSlots.forEach(slot => {
                                  timeline.push({ type: 'slot', slot, sortKey: slot.hour * 60 + slot.minute });
                                });

                                timeline.sort((a, b) => a.sortKey - b.sortKey);

                                return timeline.map((item, idx) => {
                                  if (item.type === 'task') {
                                    const task = item.task;
                                    return (
                                    <div 
                                        key={task.id}
                                        className={cn(
                                          "rounded-md p-3 shadow-sm border cursor-pointer hover:shadow-md transition-shadow",
                                          task.assignment_id
                                            ? "bg-card border-l-4 border-l-violet-500"
                                            : "bg-card"
                                        )}
                                        onClick={() => onTaskEdit(task)}
                                      >
                                        <div className="flex items-start gap-2">
                                          <Checkbox
                                            checked={task.status === 'DONE'}
                                            onCheckedChange={(checked) => {
                                              if (checked) handleCompleteTask(task.id);
                                              else onStatusChange(task.id, 'TODO');
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                            className="mt-0.5 flex-shrink-0"
                                          />
                                          <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between gap-2">
                                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                                <span className="text-xs text-muted-foreground flex-shrink-0">
                                                  {task.start_time && format(parseISO(task.start_time), 'h:mm a')}
                                                </span>
                                                <span className={cn("font-medium text-sm truncate", task.status === 'DONE' && 'line-through text-muted-foreground')}>
                                                  {task.title}
                                                </span>
                                              </div>
                                              <div className="flex items-center gap-1 flex-shrink-0">
                                                {task.status !== 'DOING' && task.status !== 'DONE' && (
                                                  <>
                                                    <Button
                                                      variant="ghost"
                                                      size="icon"
                                                      className="h-7 w-7 hover:bg-destructive/10"
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleRemoveFromSchedule(task);
                                                      }}
                                                      title="Remove from schedule"
                                                    >
                                                      <X className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                                                    </Button>
                                                    <Button
                                                      variant="ghost"
                                                      size="icon"
                                                      className="h-7 w-7 hover:bg-green-100 dark:hover:bg-green-900"
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleStartTask(task.id);
                                                      }}
                                                      title="Start working on this task"
                                                    >
                                                      <Play className="h-4 w-4 text-green-600" />
                                                    </Button>
                                                  </>
                                                )}
                                              </div>
                                            </div>
                                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                                              {task.assignment_id ? (
                                                <Badge variant="outline" className={cn("text-xs",
                                                  ((task.scheduling_context as any)?.source === 'MIT' || task.category === 'EDUCATION')
                                                    ? "bg-red-500/10 text-red-700 border-red-500/20 dark:text-red-400"
                                                    : "bg-indigo-500/10 text-indigo-700 border-indigo-500/20 dark:text-indigo-400"
                                                )}>
                                                  📚 {(task.scheduling_context as any)?.source || (task.category === 'EDUCATION' ? 'MIT' : 'EMBA')}
                                                </Badge>
                                              ) : (
                                                <Badge variant="outline" className={cn("text-xs", categoryColors[task.category])}>
                                                  {task.category.toLowerCase()}
                                                </Badge>
                                              )}
                                              {(() => {
                                                const { violation, actualWindow, allowedWindows } = isWindowViolation(task);
                                                if (violation) {
                                                  return (
                                                    <Badge variant="outline" className="text-xs bg-destructive/10 text-destructive border-destructive/20">
                                                      ⚠ wrong window ({actualWindow} → {allowedWindows.join('/')})
                                                    </Badge>
                                                  );
                                                }
                                                return null;
                                              })()}
                                              {task.estimate_minutes && (
                                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                                  <Clock className="h-3 w-3" />
                                                  {task.estimate_minutes}m
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  }

                                  if (item.type === 'external') {
                                    const evt = item.event as any;
                                    const provider = evt.calendar_connections?.provider || 'calendar';
                                    const providerEmail = evt.calendar_connections?.provider_account_email || '';
                                    const providerLabel = provider === 'google' ? 'Google' : provider === 'outlook' ? 'Outlook' : provider;
                                    const borderColor = provider === 'google' ? 'border-l-4 border-l-blue-500' : 'border-l-4 border-l-cyan-500';
                                    return (
                                      <div
                                        key={`ext-${evt.id}`}
                                        className={cn("bg-accent/50 rounded-md p-3 shadow-sm border border-accent", borderColor)}
                                      >
                                        <div className="flex items-center gap-2">
                                          <Calendar className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                          <span className="text-xs text-muted-foreground flex-shrink-0">
                                            {format(parseISO(evt.start_time), 'h:mm a')} – {format(parseISO(evt.end_time), 'h:mm a')}
                                          </span>
                                          <span className="font-medium text-sm truncate">{evt.title || 'Untitled Event'}</span>
                                          <Badge variant="outline" className={cn("text-xs ml-auto flex-shrink-0",
                                            provider === 'google' ? "bg-blue-500/10 text-blue-700 border-blue-500/20 dark:text-blue-400" : "bg-cyan-500/10 text-cyan-700 border-cyan-500/20 dark:text-cyan-400"
                                          )}>
                                            {providerLabel}
                                          </Badge>
                                        </div>
                                        {(evt.location || providerEmail) && (
                                          <p className="text-xs text-muted-foreground mt-1 truncate">
                                            {evt.location ? `📍 ${evt.location}` : ''}{evt.location && providerEmail ? ' · ' : ''}{providerEmail}
                                          </p>
                                        )}
                                      </div>
                                    );
                                  }

                                  // Open slot
                                  const slot = item.slot;
                                  return (
                                    <Droppable key={`slot-${slot.hour}-${slot.minute}`} droppableId={`timeslot-${slot.hour}-${slot.minute}`}>
                                      {(provided, snapshot) => (
                                        <div
                                          ref={provided.innerRef}
                                          {...provided.droppableProps}
                                          onClick={() => {
                                            setCreateModalHour(slot.hour);
                                            setCreateModalMinute(slot.minute);
                                            setIsCreateModalOpen(true);
                                          }}
                                          className={cn(
                                            "p-3 border rounded-md text-sm transition-colors flex items-center gap-2 cursor-pointer min-h-[44px]",
                                            snapshot.isDraggingOver
                                              ? "border-primary bg-primary/5"
                                              : "border-dashed border-muted-foreground/30 hover:border-primary/50 hover:bg-accent"
                                          )}
                                        >
                                          <Clock className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                                          <span className="text-muted-foreground">{slot.label}</span>
                                          <Plus className="ml-auto h-4 w-4 text-muted-foreground/60" />
                                          {provided.placeholder}
                                        </div>
                                      )}
                                    </Droppable>
                                  );
                                });
                              })()}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <ScrollBar orientation="horizontal" />
                  </ScrollArea>
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        </div>
        
        {/* Sidebar - 1/3 width */}
        <div className="space-y-6 order-2">
          {/* Currently Doing Section */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Play className="h-5 w-5 text-green-500" />
                <h2 className="text-lg font-semibold">Currently Doing</h2>
                <Badge variant="secondary">{doingTasks.length}</Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {doingTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No tasks in progress. Start something from Up Next!
                </p>
              ) : (
                <div className="space-y-3">
                  {doingTasks.map(task => (
                    <div 
                      key={task.id}
                      className="bg-muted/50 rounded-lg p-3 border border-green-200 dark:border-green-800 cursor-pointer hover:shadow-md transition-shadow"
                      onClick={() => onTaskEdit(task)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium text-sm truncate">{task.title}</h3>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <Badge variant="outline" className={cn("text-xs", categoryColors[task.category])}>
                              {task.category.toLowerCase()}
                            </Badge>
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              Started {formatDistanceToNow(parseISO(task.updated_at), { addSuffix: true })}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 hover:bg-yellow-100 dark:hover:bg-yellow-900"
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePauseTask(task.id);
                            }}
                            title="Pause task"
                          >
                            <Pause className="h-4 w-4 text-yellow-600" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 hover:bg-green-100 dark:hover:bg-green-900"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCompleteTask(task.id);
                            }}
                            title="Complete task"
                          >
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Up Next Queue */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ListOrdered className="h-5 w-5 text-blue-500" />
                  <h2 className="text-lg font-semibold">Up Next</h2>
                  <Badge variant="secondary">{upNextTasks.length}</Badge>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAutoSchedule}
                  disabled={isScheduling || upNextTasks.length === 0}
                  className="text-xs h-7"
                >
                  {isScheduling ? (
                    <>
                      <Clock className="h-3 w-3 mr-1 animate-spin" />
                      Scheduling...
                    </>
                  ) : (
                    <>
                      <CalendarPlus className="h-3 w-3 mr-1" />
                      Schedule
                    </>
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Drag to schedule or click Start
              </p>
            </CardHeader>
            <CardContent className="pt-0">
              <Droppable droppableId="up-next-queue">
                {(provided) => (
                  <div 
                    ref={provided.innerRef} 
                    {...provided.droppableProps} 
                    className="space-y-2"
                  >
                    {displayedUpNext.map((task, index) => (
                      <Draggable key={task.id} draggableId={task.id} index={index}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            className={cn(
                              "bg-card rounded-lg p-3 border shadow-sm transition-shadow",
                              snapshot.isDragging && "shadow-lg ring-2 ring-primary",
                              task.assignment_id && "border-l-4 border-l-violet-500"
                            )}
                          >
                            <div className="flex items-start gap-2">
                              <div 
                                {...provided.dragHandleProps}
                                className="mt-1 text-muted-foreground hover:text-foreground cursor-grab"
                              >
                                <GripVertical className="h-4 w-4" />
                              </div>
                              <span className="text-xs font-bold text-muted-foreground mt-1 w-4">
                                {index + 1}
                              </span>
                              <div 
                                className="flex-1 min-w-0 cursor-pointer"
                                onClick={() => onTaskEdit(task)}
                              >
                                <h3 className="font-medium text-sm truncate">{task.title}</h3>
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                  {task.assignment_id ? (
                                    <Badge variant="outline" className={cn("text-xs",
                                      ((task.scheduling_context as any)?.source === 'MIT' || task.category === 'EDUCATION')
                                        ? "bg-red-500/10 text-red-700 border-red-500/20 dark:text-red-400"
                                        : "bg-indigo-500/10 text-indigo-700 border-indigo-500/20 dark:text-indigo-400"
                                    )}>
                                      📚 {(task.scheduling_context as any)?.source || (task.category === 'EDUCATION' ? 'MIT' : 'EMBA')}
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className={cn("text-xs", categoryColors[task.category])}>
                                      {task.category.toLowerCase()}
                                    </Badge>
                                  )}
                                  <Badge variant="outline" className={cn("text-xs", priorityBadgeColors[task.priority])}>
                                    {task.priority.toLowerCase()}
                                  </Badge>
                                  {task.due_date && (
                                    <span className="text-xs text-muted-foreground">
                                      Due {format(parseISO(task.due_date), 'MMM d')}
                                    </span>
                                  )}
                                  {task.pushed_count && task.pushed_count > 0 && (
                                    <Badge variant="outline" className="text-xs bg-destructive/10 text-destructive border-destructive/20">
                                      <RotateCcw className="h-3 w-3 mr-0.5" />
                                      ×{task.pushed_count}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 hover:bg-green-100 dark:hover:bg-green-900"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleStartTask(task.id);
                                }}
                                title="Start working on this task"
                              >
                                <Play className="h-3 w-3 mr-1 text-green-600" />
                                <span className="text-xs text-green-600">Start</span>
                              </Button>
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
              
              {upNextTasks.length > 5 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full mt-3"
                  onClick={() => setShowAllUpNext(!showAllUpNext)}
                >
                  {showAllUpNext 
                    ? 'Show less' 
                    : `View ${upNextTasks.length - 5} more...`}
                </Button>
              )}
              
              {upNextTasks.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No tasks queued. Add tasks to your backlog!
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      {user?.id && defaultBoardId && (
        <TaskCreationModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          onTasksCreated={() => {
            onTaskUpdate();
            setIsCreateModalOpen(false);
          }}
          boardId={defaultBoardId}
          userId={user.id}
          initialDate={today}
          initialHour={createModalHour}
          initialMinute={createModalMinute}
        />
      )}
    </DragDropContext>
  );
};

export default FocusView;
