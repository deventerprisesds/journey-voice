import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { 
  CalendarIcon, 
  Wand2, 
  Plus, 
  X, 
  Loader2, 
  Mic, 
  Type,
  Sparkles,
  Check,
  AlertCircle,
  Clock,
  FileSpreadsheet
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Task } from '@/types/task';
import { fromHHMMToISO } from '@/lib/date';
import { extractSchedulingContext } from '@/services/schedulingService';
import { useAssignmentSelection } from '@/contexts/AssignmentSelectionContext';

interface ParsedTask {
  title: string;
  description?: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  category: 'LIFE' | 'CAREER' | 'VENTURES' | 'EDUCATION' | 'PROF_EDUCATION';
  due_date?: string;
  start_time?: string;
  end_time?: string;
  estimate_minutes?: number;
  status: 'BACKLOG' | 'TODO' | 'READY' | 'UP_NEXT' | 'DOING' | 'PROF_EDUCATION';
  assignment_id?: string; // Track if task came from an assignment
  assignment_url?: string; // Track assignment URL for linking
  course_id?: string; // Track course for assignment-sourced tasks
  sheet_row_number?: number; // Track sheet row for assignment-sourced tasks
  points?: number; // Track points for assignment-sourced tasks
  source?: 'emba' | 'mit'; // Track assignment source
  isPreview?: boolean; // Track if task has preview scheduling
  mit_assignment_id?: string; // For MIT-specific tasks
}

interface Assignment {
  id: string;
  title: string;
  description?: string;
  due_date?: string;
  priority: string;
  course_id?: string;
  type: string;
  source: 'emba' | 'mit';
  course_name?: string;
  assignment_url?: string;
}

interface TaskCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTasksCreated: (tasks: Task[]) => void;
  boardId: string;
  userId: string;
}

const TaskCreationModal: React.FC<TaskCreationModalProps> = ({
  isOpen,
  onClose,
  onTasksCreated,
  boardId,
  userId
}) => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'ai' | 'manual' | 'assignments'>('ai');
  const { selectedAssignmentIds, setSelectedAssignmentIds, clearSelection } = useAssignmentSelection();
  
  // Assignments Tab State
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [isLoadingAssignments, setIsLoadingAssignments] = useState(false);
  
  // Include Selected Assignments Toggle
  const [includeSelectedAssignments, setIncludeSelectedAssignments] = useState(true);
  
  // Assignment Preview Scheduling State
  const [isSchedulingAssignments, setIsSchedulingAssignments] = useState(false);
  const [schedulingDataCache, setSchedulingDataCache] = useState<{
    existingTasks: any[];
    userConfig: any;
  } | null>(null);
  
  // AI Mode State with sessionStorage persistence for mobile
  const [aiInput, setAiInput] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('ai-task-input') || '';
    }
    return '';
  });
  const [isParsingAI, setIsParsingAI] = useState(false);
  const [parsedTasks, setParsedTasks] = useState<ParsedTask[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('parsed-tasks');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          return [];
        }
      }
    }
    return [];
  });
  
  // Manual Mode State  
  const [manualTask, setManualTask] = useState<Partial<Task>>({
    title: '',
    description: '',
    priority: 'MEDIUM',
    category: 'LIFE',
    status: 'BACKLOG'
  });
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);
  const [startTime, setStartTime] = useState<string>('');
  const [endTime, setEndTime] = useState<string>('');
  const [estimateHours, setEstimateHours] = useState('');
  const [estimateMinutes, setEstimateMinutes] = useState('');
  
  // Common State
  const [isCreating, setIsCreating] = useState(false);

  // Load assignments when assignments tab becomes active
  useEffect(() => {
    if (activeTab === 'assignments' && isOpen) {
      loadAvailableAssignments();
    }
  }, [activeTab, isOpen]);

  const loadAvailableAssignments = async () => {
    setIsLoadingAssignments(true);
    try {
      // Get all tasks to check which assignments are already converted
      const { data: existingTasks } = await supabase
        .from('tasks')
        .select('scheduling_context')
        .eq('user_id', userId);

      const existingAssignmentIds = new Set<string>();
      const existingMitAssignmentIds = new Set<string>();

      existingTasks?.forEach(task => {
        const context = task.scheduling_context;
        if (Array.isArray(context)) {
          context.forEach((c) => {
            if (typeof c === 'string') {
              if (c.startsWith('assignment_id:')) {
                existingAssignmentIds.add(c.split(':')[1]);
              } else if (c.startsWith('mit_assignment_id:')) {
                existingMitAssignmentIds.add(c.split(':')[1]);
              }
            }
          });
        }
      });

      // Fetch EMBA assignments with weekend date filtering
      const DEMO_EMBA_USER_IDS = [
        '00000000-0000-0000-0000-000000000001',
        'a3378f93-d655-4913-b2fa-ca5b1d8020f1',
      ];
      const isDemo = DEMO_EMBA_USER_IDS.includes(userId);

      // Prepare today's date (YYYY-MM-DD) for date-only comparisons
      const todayStr = format(new Date(), 'yyyy-MM-dd');

      // Get last weekend end time
      const { data: lastWeekend } = await supabase
        .from('class_schedules')
        .select('end_time')
        .in('user_id', isDemo ? DEMO_EMBA_USER_IDS : [userId])
        .lt('date', todayStr)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Get next weekend's class dates
      const { data: nextWeekendDates } = await supabase
        .from('class_schedules')
        .select('date, end_time')
        .in('user_id', isDemo ? DEMO_EMBA_USER_IDS : [userId])
        .gte('date', todayStr)
        .order('date', { ascending: true })
        .limit(5);

      let embaAssignments = null;

      if (nextWeekendDates && nextWeekendDates.length > 0) {
        // Group dates within 3 days as same weekend, take the last date's end time
        const weekendGroups: Array<typeof nextWeekendDates> = [];
        let currentGroup: typeof nextWeekendDates = [];
        
        nextWeekendDates.forEach((curr, idx) => {
          if (idx === 0 || Math.abs(new Date(curr.date).getTime() - new Date(nextWeekendDates[idx-1].date).getTime()) <= 3 * 24 * 60 * 60 * 1000) {
            currentGroup.push(curr);
          } else {
            weekendGroups.push(currentGroup);
            currentGroup = [curr];
          }
        });
        if (currentGroup.length > 0) weekendGroups.push(currentGroup);
        
        const nextWeekendEnd = weekendGroups[0]
          .sort((a, b) => new Date(b.end_time).getTime() - new Date(a.end_time).getTime())[0];

        let embaQuery = supabase
          .from('assignments')
          .select('*, courses(name)')
          .gte('due_date', lastWeekend?.end_time || new Date().toISOString())
          .lte('due_date', nextWeekendEnd.end_time);

        embaQuery = isDemo
          ? embaQuery.in('user_id', DEMO_EMBA_USER_IDS)
          : embaQuery.eq('user_id', userId);

        const { data } = await embaQuery
          .order('due_date', { ascending: true });
        
        embaAssignments = data;
      } else {
        // No class schedules found - show error
        toast({
          variant: "destructive",
          title: "No class schedules found",
          description: "Please sync your EMBA class schedule first.",
        });
        setIsLoadingAssignments(false);
        return;
      }

      // Fetch MIT assignments (exclude office hours)
      const { data: mitAssignments } = await supabase
        .from('assignments_mit')
        .select('*, courses(name)')
        .eq('user_id', userId)
        .eq('status', 'active')
        .not('title', 'ilike', '%office hour%')
        .order('due_date', { ascending: true });

      // Filter out already converted assignments and format
      const availableEmba: Assignment[] = (embaAssignments || [])
        .filter(a => !existingAssignmentIds.has(a.id))
        .map(a => ({
          id: a.id,
          title: a.title,
          description: a.description,
          due_date: a.due_date,
          priority: a.priority,
          course_id: a.course_id,
          type: a.type,
          source: 'emba' as const,
          course_name: (a.courses as any)?.name,
          assignment_url: a.assignment_url
        }));

      const availableMit: Assignment[] = (mitAssignments || [])
        .filter(a => !existingMitAssignmentIds.has(a.id))
        .map(a => ({
          id: a.id,
          title: a.title,
          description: a.description,
          due_date: a.due_date,
          priority: a.priority,
          course_id: a.course_id,
          type: a.type,
          source: 'mit' as const,
          course_name: (a.courses as any)?.name,
          assignment_url: a.assignment_url
        }));

      // Combine and sort by due date in ascending order
      const combined = [...availableEmba, ...availableMit].sort((a, b) => {
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      });
      
      setAssignments(combined);
    } catch (error) {
      console.error('Error loading assignments:', error);
      toast({
        title: "Error Loading Assignments",
        description: "Failed to load available assignments",
        variant: "destructive"
      });
    } finally {
      setIsLoadingAssignments(false);
    }
  };

  const toggleAssignment = (id: string) => {
    setSelectedAssignmentIds(prev => {
      const next = new Set<string>(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedAssignmentIds.size === assignments.length) {
      setSelectedAssignmentIds(new Set<string>());
    } else {
      setSelectedAssignmentIds(new Set<string>(assignments.map(a => a.id)));
    }
  };

  const handleCreateFromAssignments = async () => {
    if (selectedAssignmentIds.size === 0) {
      toast({
        title: "No Assignments Selected",
        description: "Please select at least one assignment",
        variant: "destructive"
      });
      return;
    }

    setIsCreating(true);
    try {
      const selectedIds = Array.from(selectedAssignmentIds);
      
      // Separate EMBA and MIT assignments
      const embaIds = selectedIds.filter((id: string) => 
        assignments.find(a => a.id === id)?.source === 'emba'
      );
      const mitIds = selectedIds.filter((id: string) => 
        assignments.find(a => a.id === id)?.source === 'mit'
      );

      // Import helpers
      const { createTasksFromAssignments, createTasksFromMitAssignments } = await import('@/utils/assignmentSync');

      // Convert EMBA assignments
      if (embaIds.length > 0) {
        await createTasksFromAssignments(embaIds as string[], userId);
      }

      // Convert MIT assignments
      if (mitIds.length > 0) {
        await createTasksFromMitAssignments(mitIds as string[], userId);
      }

      // Fetch newly created tasks to pass to parent
      const { data: newTasks } = await supabase
        .from('tasks')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(selectedIds.length);

      if (newTasks && newTasks.length > 0) {
        console.log('Newly created tasks (post-assignments):', newTasks.map(t => ({ id: t.id, title: t.title, status: t.status, board_id: t.board_id })));
        toast({
          title: "Tasks Created",
          description: `Successfully created ${newTasks.length} task${newTasks.length > 1 ? 's' : ''} from assignments`
        });
        onTasksCreated(newTasks);
      } else {
        toast({
          title: "Warning",
          description: "Tasks may have been created but couldn't be fetched. Please refresh the page.",
          variant: "default"
        });
      }

      // Reload assignments and clear selection
      clearSelection();
      await loadAvailableAssignments();

      handleClose();
    } catch (error: any) {
      console.error('Error creating tasks from assignments:', error);
      toast({
        title: "Creation Error",
        description: error?.message || "Failed to create tasks from assignments. Please check priorities are set correctly.",
        variant: "destructive"
      });
    } finally {
      setIsCreating(false);
    }
  };

  // Persist AI input to sessionStorage for mobile
  useEffect(() => {
    if (aiInput) {
      sessionStorage.setItem('ai-task-input', aiInput);
    }
  }, [aiInput]);

  // Persist parsed tasks to sessionStorage for mobile
  useEffect(() => {
    if (parsedTasks.length > 0) {
      sessionStorage.setItem('parsed-tasks', JSON.stringify(parsedTasks));
    } else {
      sessionStorage.removeItem('parsed-tasks');
    }
  }, [parsedTasks]);

  // Smart date/time logic: When time is set first, auto-populate date to today
  useEffect(() => {
    if (startTime && !dueDate) {
      setDueDate(new Date());
    }
  }, [startTime, dueDate]);

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

  const handleAIParseTask = async () => {
    if (!aiInput.trim()) {
      toast({
        title: "Input Required",
        description: "Please enter a task description",
        variant: "destructive",
      });
      return;
    }

    setIsParsingAI(true);
    try {
      console.log('Parsing AI input:', aiInput);
      
      // Load user's timezone config
      const { loadUserSchedulingConfig } = await import('@/services/schedulingService');
      const userConfig = await loadUserSchedulingConfig(userId);
      
      // Load existing tasks for preview scheduling context
      const { data: existingTasks } = await supabase
        .from('tasks')
        .select('*')
        .eq('user_id', userId)
        .eq('board_id', boardId);
      
      const { data, error } = await supabase.functions.invoke('ai-task-parser', {
        body: { 
          text: aiInput, 
          mode: 'multiple',
          timezone: userConfig.timezone,
          userId,
          boardId,
          existingTasks: existingTasks || []
        }
      });

      if (error) {
        throw new Error(error.message);
      }

      console.log('✅ Received AI parser response:', data);

      if (!data?.tasks || data.tasks.length === 0) {
        console.error('❌ No tasks in response:', data);
        throw new Error('No tasks could be parsed from the input');
      }

      // Preview-schedule newly parsed AI tasks (non-assignment) and preserve existing assignment tasks
      const newAITasks: ParsedTask[] = (data.tasks || []).map((t: ParsedTask) => ({ ...t }));
      const previewedTasks: ParsedTask[] = [];
      const reservedSlots: any[] = [];

      for (const t of newAITasks) {
        try {
          const allExisting = [ ...(existingTasks || []), ...reservedSlots ];
          const { data: schedData, error: schedErr } = await supabase.functions.invoke('smart-calendar-scheduler', {
            body: {
              taskText: t.title,
              userId,
              existingTasks: allExisting,
              scheduling_context: [],
              taskCategory: t.category,
              taskPriority: t.priority,
              estimateMinutes: t.estimate_minutes,
              dueDate: t.due_date,
              timezone: userConfig?.timezone || 'America/New_York',
            }
          });

          if (schedErr) {
            previewedTasks.push(t);
            continue;
          }

          const startISO = schedData?.scheduledSlot?.startTime || schedData?.scheduledTask?.start_time;
          const endISO = schedData?.scheduledSlot?.endTime || schedData?.scheduledTask?.end_time;

          if (startISO && endISO) {
            previewedTasks.push({ ...t, start_time: startISO, end_time: endISO });
            reservedSlots.push({ start_time: startISO, end_time: endISO, title: t.title, is_scheduled: true });
          } else {
            previewedTasks.push(t);
          }
        } catch {
          previewedTasks.push(t);
        }
      }

      setParsedTasks(prev => {
        const preservedAssignments = prev.filter(pt => pt.assignment_id);
        return [...preservedAssignments, ...previewedTasks];
      });
      toast({
        title: "Tasks Parsed Successfully",
        description: `Found ${data.tasks.length} task${data.tasks.length > 1 ? 's' : ''}`,
      });
    } catch (error) {
      console.error('❌ Error parsing tasks:', error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to parse tasks';
      toast({
        title: "Parsing Error",
        description: `${errorMsg}. Please try again or check your OpenAI API key.`,
        variant: "destructive",
      });
    } finally {
      setIsParsingAI(false);
    }
  };

  const handleCreateTasks = async (tasksToCreate: ParsedTask[]) => {
    setIsCreating(true);
    try {
      // Check if this is demo mode (board ID starts with 'demo-')
      const isDemoMode = boardId.startsWith('demo-');
      
      const tasksWithMeta = tasksToCreate.map(task => {
        // Build scheduling_context for assignment-sourced tasks
        const schedulingContext = task.assignment_id ? [
          `source:selected_${task.source}_assignment`,
          `assignment_id:${task.assignment_id}`,
          ...(task.assignment_url ? [`assignment_url:${task.assignment_url}`] : []),
          ...(task.course_id ? [`course_id:${task.course_id}`] : []),
          ...(task.sheet_row_number ? [`sheet_row:${task.sheet_row_number}`] : []),
          ...(task.points ? [`points:${task.points}`] : [])
        ] : undefined;

        return {
          title: task.title,
          description: task.description || null,
          board_id: boardId,
          user_id: userId,
          priority: task.priority,
          category: (task.category === 'PROF_EDUCATION' ? 'EDUCATION' : task.category) as any,
          status: (task.assignment_id ? 'PROF_EDUCATION' : task.status) as Task['status'], // Force PROF_EDUCATION for assignments
          due_date: task.due_date || null,
          // Force AI-parsed tasks to have null times so scheduler assigns them
          start_time: null,
          end_time: null,
          estimate_minutes: task.estimate_minutes || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...(schedulingContext && { scheduling_context: schedulingContext }),
          ...(isDemoMode ? { id: `demo-task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` } : {})
        };
      });

      let createdTasks;
      
      if (isDemoMode) {
        // For demo mode, store in localStorage
        const demoTasks = JSON.parse(localStorage.getItem('kanban-demo-tasks') || '[]');
        createdTasks = tasksWithMeta;
        demoTasks.push(...createdTasks);
        localStorage.setItem('kanban-demo-tasks', JSON.stringify(demoTasks));
      } else {
        // For real mode, use Supabase
        const { data, error } = await supabase
          .from('tasks')
          .insert(tasksWithMeta)
          .select();

        if (error) {
          throw new Error(error.message);
        }
        createdTasks = data;
      }

      // Auto-schedule ALL tasks that don't have explicit times set by user
      const tasksToSchedule = createdTasks.filter(task => 
        !task.start_time && !task.end_time // Schedule if no times set
      );

      // Accumulator for batch-scheduled tasks
      const alreadyScheduled: Task[] = [];

      for (const task of tasksToSchedule) {
        if (!isDemoMode) {
          try {
            const { scheduleNewTask } = await import('@/utils/taskScheduling');
            
            // Extract keyword hints ONLY as fallback context
            const { context, estimatedDuration } = extractSchedulingContext(
              `${task.title} ${task.description || ''}`,
              task.category,
              task.priority
            );
            
            // Merge AI-provided context with keyword hints (NO timeWindow override)
            const fullContext = [
              ...(task.scheduling_context || []),
              ...context
              // REMOVED: `timeWindow:${timeWindow}` - Let user settings decide
            ];
            
            // Pass already scheduled tasks in this batch so scheduler knows about them
            const scheduleResult = await scheduleNewTask({
              ...task,
              estimate_minutes: task.estimate_minutes || estimatedDuration,
              scheduling_context: fullContext
            }, alreadyScheduled);
            
            if (scheduleResult.success && scheduleResult.scheduledTask) {
              // Add to accumulator for next task
              alreadyScheduled.push(scheduleResult.scheduledTask);
              
              // Update the task in createdTasks with scheduled times
              const taskIndex = createdTasks.findIndex(t => t.id === task.id);
              if (taskIndex !== -1) {
                createdTasks[taskIndex] = scheduleResult.scheduledTask;
              }
            }
          } catch (error) {
            console.warn('Failed to auto-schedule task:', task.id, error);
          }
        }
      }

      // Clear sessionStorage after successful creation
      sessionStorage.removeItem('ai-task-input');
      sessionStorage.removeItem('parsed-tasks');
      
      onTasksCreated(createdTasks);
      
      // Send ONE batched notification for all tasks (prevent API lock)
      if (createdTasks.length > 0) {
        try {
          const taskList = createdTasks.map(t => `• ${t.title}`).join('\n');
          await supabase.functions.invoke('send-push-notification', {
            body: {
              userId: createdTasks[0].user_id,
              title: `${createdTasks.length} New Task${createdTasks.length > 1 ? 's' : ''} Created`,
              body: `Created:\n\n${taskList}`,
              data: {
                type: 'tasks_created_batch',
                taskIds: createdTasks.map(t => t.id),
                count: createdTasks.length
              }
            }
          });
        } catch (error) {
          console.error('Error sending batch notification:', error);
        }
      }
      
      toast({
        title: "Tasks Created",
        description: `Successfully created ${createdTasks.length} task${createdTasks.length > 1 ? 's' : ''} with automatic reminders`,
      });
      
      // Clear assignment selection BEFORE closing (prevent flash)
      setSelectedAssignmentIds(new Set());
      setIncludeSelectedAssignments(false);
      
      handleClose();
    } catch (error) {
      console.error('Error creating tasks:', error);
      toast({
        title: "Creation Error",
        description: error instanceof Error ? error.message : 'Failed to create tasks',
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreateManualTask = async () => {
    if (!manualTask.title?.trim()) {
      toast({
        title: "Title Required",
        description: "Please enter a task title",
        variant: "destructive",
      });
      return;
    }

    const hours = parseInt(estimateHours) || 0;
    const minutes = parseInt(estimateMinutes) || 0;
    const totalMinutes = hours * 60 + minutes;

    const taskToCreate: ParsedTask = {
      title: manualTask.title!,
      description: manualTask.description || undefined,
      priority: manualTask.priority as ParsedTask['priority'],
      category: manualTask.category as ParsedTask['category'],
      status: manualTask.status as ParsedTask['status'],
      due_date: dueDate ? dueDate.toISOString() : undefined,
      start_time: startTime ? fromHHMMToISO(dueDate || new Date(), startTime) : undefined,
      end_time: endTime ? fromHHMMToISO(dueDate || new Date(), endTime) : undefined,
      estimate_minutes: totalMinutes > 0 ? totalMinutes : undefined,
    };

    await handleCreateTasks([taskToCreate]);
  };

  const handleClose = () => {
    // Don't clear AI input/parsed tasks - keep them for mobile persistence
    // Only clear manual mode state
    setManualTask({
      title: '',
      description: '',
      priority: 'MEDIUM',
      category: 'LIFE',
      status: 'BACKLOG'
    });
    setDueDate(undefined);
    setEstimateHours('');
    setEstimateMinutes('');
    onClose();
  };

  const handleClearAIResults = () => {
    setAiInput('');
    setParsedTasks([]);
    sessionStorage.removeItem('ai-task-input');
    sessionStorage.removeItem('parsed-tasks');
  };

  const removeParsedTask = (index: number) => {
    const task = parsedTasks[index];
    // Don't allow removing assignment-sourced tasks when toggle is ON
    if (task.assignment_id && includeSelectedAssignments) {
      toast({
        title: "Cannot Remove",
        description: "Uncheck the assignment in the 'From Assignments' tab to remove it.",
        variant: "destructive"
      });
      return;
    }
    setParsedTasks(prev => prev.filter((_, i) => i !== index));
  };

  const editParsedTask = (index: number, field: keyof ParsedTask, value: any) => {
    setParsedTasks(prev => prev.map((task, i) => 
      i === index ? { ...task, [field]: value } : task
    ));
  };

  // Helper: Convert Assignment to ParsedTask
  const convertAssignmentToParsedTask = (assignment: Assignment): ParsedTask => {
    const mapPriority = (p: string): ParsedTask['priority'] => {
      const normalized = p?.toUpperCase();
      if (['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(normalized)) {
        return normalized as ParsedTask['priority'];
      }
      return 'MEDIUM';
    };

    return {
      title: assignment.title,
      description: assignment.description || `${assignment.course_name || 'Assignment'} - Due: ${assignment.due_date ? format(new Date(assignment.due_date), 'PPP') : 'No due date'}`,
      priority: mapPriority(assignment.priority),
      category: 'PROF_EDUCATION',
      status: 'PROF_EDUCATION',
      due_date: assignment.due_date,
      estimate_minutes: 60, // Default 1 hour
      assignment_id: assignment.id,
      assignment_url: assignment.assignment_url,
      course_id: assignment.course_id,
      source: assignment.source,
      isPreview: false
    };
  };

  // Sync selected assignments with parsed tasks when toggle is ON
  useEffect(() => {
    if (!includeSelectedAssignments) {
      // Remove all assignment-sourced tasks when toggle is OFF
      setParsedTasks(prev => prev.filter(task => !task.assignment_id));
      return;
    }

    // Fetch full assignment details for selected IDs and add preview scheduling
    const syncAssignmentTasks = async () => {
      if (selectedAssignmentIds.size === 0) {
        setParsedTasks(prev => prev.filter(task => !task.assignment_id));
        return;
      }

      setIsSchedulingAssignments(true);

      try {
        const selectedIds = Array.from(selectedAssignmentIds);
        
        // Fetch EMBA assignments
        const { data: embaAssignments } = await supabase
          .from('assignments')
          .select('*')
          .in('id', selectedIds)
          .eq('user_id', userId);

        // Fetch MIT assignments
        const { data: mitAssignments } = await supabase
          .from('assignments_mit')
          .select('*')
          .in('id', selectedIds)
          .eq('user_id', userId);

        const allAssignments: Assignment[] = [
          ...(embaAssignments || []).map(a => ({ ...a, source: 'emba' as const })),
          ...(mitAssignments || []).map(a => ({ ...a, source: 'mit' as const }))
        ];

        // Fetch/cache scheduling data once
        let existingTasksCache = schedulingDataCache?.existingTasks;
        let userConfigCache = schedulingDataCache?.userConfig;

        if (!schedulingDataCache) {
          // Fetch existing tasks for scheduling context
          const { data: existingTasks } = await supabase
            .from('tasks')
            .select('*')
            .eq('user_id', userId)
            .eq('board_id', boardId)
            .order('created_at', { ascending: false });

          existingTasksCache = existingTasks || [];
          userConfigCache = { timezone: 'America/New_York' }; // Default config

          setSchedulingDataCache({
            existingTasks: existingTasksCache,
            userConfig: userConfigCache
          });
        }

        // Sequential preview scheduling for each assignment
        const assignmentTasksWithPreview: ParsedTask[] = [];
        const reservedSlots: any[] = [];

        for (const assignment of allAssignments) {
          // Check if we already have this assignment with scheduled times
          const existingParsedTask = parsedTasks.find(t => t.assignment_id === assignment.id);
          if (existingParsedTask?.start_time && existingParsedTask?.end_time) {
            assignmentTasksWithPreview.push(existingParsedTask); // Keep existing schedule
            continue;
          }

          const assignmentTask = convertAssignmentToParsedTask(assignment);

          try {
            // Calculate target schedule date: 1 week before due date
            let targetScheduleDate = new Date();
            let schedulingContextArray: string[] = [];

            if (assignmentTask.due_date) {
              const dueDate = new Date(assignmentTask.due_date);
              const oneWeekBefore = new Date(dueDate.getTime() - 7 * 24 * 60 * 60 * 1000);
              targetScheduleDate = oneWeekBefore < new Date() ? new Date() : oneWeekBefore;
              
              schedulingContextArray = [
                `target_schedule_date:${targetScheduleDate.toISOString()}`,
                `buffer_days:7`,
                `is_assignment:true`,
                `assignment_due:${assignmentTask.due_date}`
              ];
            }

            // Build busy slots: existing tasks + previously scheduled previews
            const allExistingTasks = [...existingTasksCache, ...reservedSlots];

            const { data: schedulerData, error: schedulerError } = await supabase.functions.invoke('smart-calendar-scheduler', {
              body: {
                taskText: assignmentTask.title,
                userId,
                existingTasks: allExistingTasks,
                scheduling_context: schedulingContextArray,
                taskCategory: assignmentTask.category,
                taskPriority: assignmentTask.priority,
                estimateMinutes: assignmentTask.estimate_minutes,
                dueDate: assignmentTask.due_date,
                targetDate: targetScheduleDate.toISOString(),
                timezone: userConfigCache?.timezone || 'America/New_York',
              }
            });

            if (schedulerError) {
              console.error('Preview scheduling failed for assignment:', assignmentTask.title, schedulerError);
              assignmentTasksWithPreview.push(assignmentTask); // Add without preview
              continue;
            }

            const startISO = schedulerData?.scheduledSlot?.startTime || schedulerData?.scheduledTask?.start_time;
            const endISO = schedulerData?.scheduledSlot?.endTime || schedulerData?.scheduledTask?.end_time;

            if (startISO && endISO) {
              // Add preview times
              assignmentTasksWithPreview.push({
                ...assignmentTask,
                start_time: startISO,
                end_time: endISO,
              });

              // Reserve this slot for next iteration
              reservedSlots.push({
                start_time: startISO,
                end_time: endISO,
                title: assignmentTask.title,
                is_scheduled: true
              });
            } else {
              // No preview time available
              assignmentTasksWithPreview.push(assignmentTask);
            }
          } catch (error) {
            console.error('Preview scheduling failed for assignment:', assignmentTask.title, error);
            assignmentTasksWithPreview.push(assignmentTask); // Add without preview
          }
        }

        // Update parsed tasks with preview-scheduled assignments
        setParsedTasks(prev => {
          const nonAssignmentTasks = prev.filter(task => !task.assignment_id);
          return [...nonAssignmentTasks, ...assignmentTasksWithPreview];
        });
      } catch (error) {
        console.error('Failed to sync assignment tasks:', error);
        toast({
          title: 'Error',
          description: 'Failed to load assignments. Please try again.',
          variant: 'destructive',
        });
      } finally {
        setIsSchedulingAssignments(false);
      }
    };

    syncAssignmentTasks();
  }, [includeSelectedAssignments, selectedAssignmentIds, userId, boardId]);

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Create New Tasks
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'ai' | 'manual' | 'assignments')}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="ai" className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              AI Assistant
            </TabsTrigger>
            <TabsTrigger value="manual" className="flex items-center gap-2">
              <Type className="h-4 w-4" />
              Manual Entry
            </TabsTrigger>
            <TabsTrigger value="assignments" className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              From Assignments
            </TabsTrigger>
          </TabsList>

          {/* AI Mode */}
          <TabsContent value="ai" className="space-y-6 mt-4">
            <div className="space-y-4">
              <div>
                <Label htmlFor="ai-input">Describe your tasks</Label>
                <p className="text-sm text-muted-foreground mb-2">
                  Tell the AI what you need to do. You can include multiple tasks, priorities, due dates, and time estimates.
                </p>
                <Textarea
                  id="ai-input"
                  placeholder="e.g., Schedule dentist appointment for next Tuesday, finish project proposal by Friday (urgent, 3 hours), learn React and Vue.js..."
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  rows={4}
                  className="resize-none"
                />
              </div>

              {/* Include Selected Assignments Toggle */}
              <div className="flex flex-col gap-3 p-4 border rounded-lg bg-muted/50">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <Label htmlFor="include-assignments" className="text-sm font-medium cursor-pointer">
                      Include Selected Assignments
                    </Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      {selectedAssignmentIds.size > 0 
                        ? `${selectedAssignmentIds.size} assignment${selectedAssignmentIds.size > 1 ? 's' : ''} selected from 'From Assignments' tab`
                        : 'No assignments selected. Go to "From Assignments" tab to select.'}
                    </p>
                  </div>
                  <Switch
                    id="include-assignments"
                    checked={includeSelectedAssignments}
                    onCheckedChange={setIncludeSelectedAssignments}
                    disabled={isSchedulingAssignments}
                  />
                </div>
                <div className="min-h-[20px]">
                  {isSchedulingAssignments && (
                    <p className="text-xs text-primary flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Scheduling preview times...
                    </p>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <Button 
                  onClick={handleAIParseTask}
                  disabled={isParsingAI || !aiInput.trim()}
                  className="flex-1"
                >
                  {isParsingAI ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Parsing Tasks...
                    </>
                  ) : (
                    <>
                      <Wand2 className="h-4 w-4 mr-2" />
                      Parse Tasks with AI
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Parsed Tasks Preview */}
            {parsedTasks.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-medium">Parsed Tasks ({parsedTasks.length})</h3>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setParsedTasks([]);
                        setAiInput('');
                        sessionStorage.removeItem('parsed-tasks');
                        sessionStorage.removeItem('ai-task-input');
                        setSelectedAssignmentIds(new Set());
                        toast({ title: "Cleared all tasks" });
                      }}
                    >
                      <X className="h-4 w-4 mr-1" />
                      Clear All
                    </Button>
                    <Button
                      onClick={handleClearAIResults}
                      variant="outline"
                      size="sm"
                    >
                      <X className="h-4 w-4 mr-2" />
                      Clear
                    </Button>
                    <Button
                      onClick={() => handleCreateTasks(parsedTasks)}
                      disabled={isCreating}
                      className="bg-primary hover:bg-primary/90"
                    >
                      {isCreating ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        <>
                          <Check className="h-4 w-4 mr-2" />
                          Create All Tasks
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {parsedTasks.map((task, index) => (
                    <div key={index} className={cn(
                      "border rounded-lg p-4 space-y-2",
                      task.assignment_id && "border-primary/50 bg-primary/5"
                    )}>
                      <div className="flex items-start justify-between">
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <Input
                              value={task.title}
                              onChange={(e) => editParsedTask(index, 'title', e.target.value)}
                              className="font-medium"
                            />
                            {task.assignment_id && (
                              <Badge variant="secondary" className="shrink-0 text-xs">
                                <FileSpreadsheet className="h-3 w-3 mr-1" />
                                Assignment
                              </Badge>
                            )}
                          </div>
                          {task.assignment_url && (
                            <a 
                              href={task.assignment_url} 
                              target="_blank" 
                              rel="noreferrer"
                              className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Open assignment →
                            </a>
                          )}
                          {task.description && (
                            <Textarea
                              value={task.description}
                              onChange={(e) => editParsedTask(index, 'description', e.target.value)}
                              rows={2}
                              className="text-sm"
                            />
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeParsedTask(index)}
                          className="ml-2"
                          disabled={task.assignment_id && includeSelectedAssignments}
                          title={task.assignment_id && includeSelectedAssignments ? "Uncheck assignment to remove" : "Remove task"}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>

                      {/* Editable Task Properties */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
                        {/* Priority */}
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">Priority</Label>
                          <Select
                            value={task.priority}
                            onValueChange={(value) => editParsedTask(index, 'priority', value)}
                          >
                            <SelectTrigger className="h-8 text-xs">
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

                        {/* Category */}
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">Category</Label>
                          <Select
                            value={task.category}
                            onValueChange={(value) => editParsedTask(index, 'category', value)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="LIFE">Life</SelectItem>
                              <SelectItem value="CAREER">Career</SelectItem>
                              <SelectItem value="VENTURES">Ventures</SelectItem>
                              <SelectItem value="EDUCATION">Education</SelectItem>
                              <SelectItem value="PROF_EDUCATION">Prof. Education</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Status */}
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">Status</Label>
                          <Select
                            value={task.status}
                            onValueChange={(value) => editParsedTask(index, 'status', value)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="BACKLOG">Backlog</SelectItem>
                              <SelectItem value="TODO">To Do</SelectItem>
                              <SelectItem value="READY">Ready</SelectItem>
                              <SelectItem value="UP_NEXT">Up Next</SelectItem>
                              <SelectItem value="DOING">Doing</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Start Date */}
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">Start Date</Label>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                className={cn(
                                  "h-8 justify-start text-left font-normal text-xs",
                                  !task.start_time && "text-muted-foreground"
                                )}
                              >
                                <CalendarIcon className="mr-1 h-3 w-3" />
                                {task.start_time ? format(new Date(task.start_time), "MMM d") : "Set date"}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                              <Calendar
                                mode="single"
                                selected={task.start_time ? new Date(task.start_time) : undefined}
                                onSelect={(date) => {
                                  if (!date) {
                                    editParsedTask(index, 'start_time', undefined);
                                    return;
                                  }
                                  // Preserve existing time if present, otherwise use current time
                                  const existingTime = task.start_time ? new Date(task.start_time) : new Date();
                                  date.setHours(existingTime.getHours(), existingTime.getMinutes(), 0, 0);
                                  editParsedTask(index, 'start_time', date.toISOString());
                                  
                                  // Also update end_time if it exists
                                  if (task.end_time) {
                                    const endTime = new Date(task.end_time);
                                    date.setHours(endTime.getHours(), endTime.getMinutes(), 0, 0);
                                    editParsedTask(index, 'end_time', date.toISOString());
                                  }
                                }}
                                initialFocus
                                className={cn("p-3 pointer-events-auto")}
                              />
                            </PopoverContent>
                          </Popover>
                        </div>

                        {/* Time Estimate */}
                        <div className="space-y-2 col-span-2">
                          <Label className="text-xs font-medium">Time Estimate</Label>
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                placeholder="0"
                                value={task.estimate_minutes ? Math.floor(task.estimate_minutes / 60) : ''}
                                onChange={(e) => {
                                  const hours = parseInt(e.target.value) || 0;
                                  const minutes = task.estimate_minutes ? task.estimate_minutes % 60 : 0;
                                  editParsedTask(index, 'estimate_minutes', hours * 60 + minutes);
                                }}
                                className="w-16 h-8 text-xs"
                                min="0"
                              />
                              <span className="text-xs text-muted-foreground">h</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                placeholder="0"
                                value={task.estimate_minutes ? task.estimate_minutes % 60 : ''}
                                onChange={(e) => {
                                  const minutes = parseInt(e.target.value) || 0;
                                  const hours = task.estimate_minutes ? Math.floor(task.estimate_minutes / 60) : 0;
                                  editParsedTask(index, 'estimate_minutes', hours * 60 + minutes);
                                }}
                                className="w-16 h-8 text-xs"
                                min="0"
                                max="59"
                              />
                              <span className="text-xs text-muted-foreground">m</span>
                            </div>
                          </div>
                        </div>

                        {/* Start Time */}
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">Start Time</Label>
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            <Input
                              type="time"
                              value={task.start_time ? new Date(task.start_time).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }) : ''}
                              onChange={(e) => {
                                if (!e.target.value) {
                                  editParsedTask(index, 'start_time', undefined);
                                  return;
                                }
                                const baseDate = task.start_time ? new Date(task.start_time) : new Date();
                                const [hours, minutes] = e.target.value.split(':');
                                baseDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
                                editParsedTask(index, 'start_time', baseDate.toISOString());
                              }}
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>

                        {/* End Time */}
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">End Time</Label>
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            <Input
                              type="time"
                              value={task.end_time ? new Date(task.end_time).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }) : ''}
                              onChange={(e) => {
                                if (!e.target.value) {
                                  editParsedTask(index, 'end_time', undefined);
                                  return;
                                }
                                const baseDate = task.start_time ? new Date(task.start_time) : new Date();
                                const [hours, minutes] = e.target.value.split(':');
                                baseDate.setHours(parseInt(hours), parseInt(minutes), 0, 0);
                                editParsedTask(index, 'end_time', baseDate.toISOString());
                              }}
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>
                      </div>
                      {task.start_time && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Scheduled preview: {format(new Date(task.start_time), 'PPP p')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Manual Mode */}
          <TabsContent value="manual" className="space-y-4 mt-4">
            <div>
              <Label htmlFor="manual-title">Task Name *</Label>
              <Input
                id="manual-title"
                value={manualTask.title || ''}
                onChange={(e) => setManualTask({ ...manualTask, title: e.target.value })}
                placeholder="Enter task name"
                className="text-base"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="manual-due-date">Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      id="manual-due-date"
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
                    />
                  </PopoverContent>
                </Popover>
                {!dueDate && startTime && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Auto-set to today
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="manual-start-time">Start Time</Label>
                <Input
                  id="manual-start-time"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
                {dueDate && !startTime && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Leave blank for AI scheduling
                  </p>
                )}
              </div>
            </div>

            <div>
              <Label htmlFor="manual-description">Description</Label>
              <Textarea
                id="manual-description"
                value={manualTask.description || ''}
                onChange={(e) => setManualTask({ ...manualTask, description: e.target.value })}
                placeholder="Add details about the task"
                rows={3}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="manual-priority">Priority</Label>
                <Select
                  value={manualTask.priority}
                  onValueChange={(value) => setManualTask({ ...manualTask, priority: value as Task['priority'] })}
                >
                  <SelectTrigger id="manual-priority">
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

              <div>
                <Label htmlFor="manual-category">Category</Label>
                <Select
                  value={manualTask.category}
                  onValueChange={(value) => setManualTask({ ...manualTask, category: value as Task['category'] })}
                >
                  <SelectTrigger id="manual-category">
                    <SelectValue />
                  </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="LIFE">Life</SelectItem>
                          <SelectItem value="CAREER">Career</SelectItem>
                          <SelectItem value="VENTURES">Ventures</SelectItem>
                          <SelectItem value="EDUCATION">Education</SelectItem>
                          <SelectItem value="PROF_EDUCATION">Prof. Education</SelectItem>
                        </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="manual-status">Status</Label>
                <Select
                  value={manualTask.status}
                  onValueChange={(value) => setManualTask({ ...manualTask, status: value as Task['status'] })}
                >
                  <SelectTrigger id="manual-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BACKLOG">Backlog</SelectItem>
                    <SelectItem value="TODO">To Do</SelectItem>
                    <SelectItem value="DOING">Doing</SelectItem>
                    <SelectItem value="DONE">Done</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="manual-end-time">End Time (Optional)</Label>
              <Input
                id="manual-end-time"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>

            {/* Calculated Duration */}
            {startTime && endTime && (
              <div>
                <Label>Calculated Duration</Label>
                <div className="px-3 py-2 bg-muted rounded-md text-sm">
                  <Clock className="inline h-4 w-4 mr-1" />
                  {calculateDuration(startTime, endTime)}
                </div>
              </div>
            )}

            <div>
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

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleCreateManualTask} disabled={isCreating || !manualTask.title?.trim()}>
                {isCreating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Task
                  </>
                )}
              </Button>
            </div>
          </TabsContent>

          {/* From Assignments Mode */}
          <TabsContent value="assignments" className="space-y-4 mt-4">
            {isLoadingAssignments ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-muted-foreground">Loading assignments...</span>
              </div>
            ) : assignments.length === 0 ? (
              <div className="text-center py-8">
                <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground mb-2">No assignments available</p>
                <p className="text-sm text-muted-foreground">
                  Sync your EMBA or MIT assignments from Settings → Assignments
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Select assignments to convert into tasks
                  </p>
                  <Badge variant="secondary">
                    {selectedAssignmentIds.size} selected
                  </Badge>
                </div>

                {/* Select All Checkbox */}
                <div 
                  className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-muted/50"
                  onClick={toggleSelectAll}
                >
                  <div className={cn(
                    "h-5 w-5 rounded border-2 flex items-center justify-center shrink-0",
                    selectedAssignmentIds.size === assignments.length
                      ? "border-primary bg-primary"
                      : selectedAssignmentIds.size > 0
                      ? "border-primary bg-primary/20"
                      : "border-muted-foreground"
                  )}>
                    {selectedAssignmentIds.size === assignments.length && (
                      <Check className="h-3 w-3 text-primary-foreground" />
                    )}
                    {selectedAssignmentIds.size > 0 && selectedAssignmentIds.size < assignments.length && (
                      <div className="h-2 w-2 bg-primary rounded-sm" />
                    )}
                  </div>
                  <span className="font-medium">Select All</span>
                </div>

                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {assignments.map((assignment) => (
                    <div
                      key={assignment.id}
                      className={cn(
                        "border rounded-lg p-4 cursor-pointer transition-colors",
                        selectedAssignmentIds.has(assignment.id)
                          ? "border-primary bg-primary/5"
                          : "hover:bg-muted/50"
                      )}
                      onClick={() => toggleAssignment(assignment.id)}
                    >
                      <div className="flex items-start gap-3">
                        <div className={cn(
                          "mt-1 h-5 w-5 rounded border-2 flex items-center justify-center shrink-0",
                          selectedAssignmentIds.has(assignment.id)
                            ? "border-primary bg-primary"
                            : "border-muted-foreground"
                        )}>
                          {selectedAssignmentIds.has(assignment.id) && (
                            <Check className="h-3 w-3 text-primary-foreground" />
                          )}
                        </div>

                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <h4 className="font-medium">{assignment.title}</h4>
                            <Badge variant={assignment.source === 'mit' ? 'secondary' : 'default'} className="text-xs">
                              {assignment.source.toUpperCase()}
                            </Badge>
                          </div>

                          {assignment.description && (
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {assignment.description}
                            </p>
                          )}

                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            {assignment.course_name && (
                              <span>📚 {assignment.course_name}</span>
                            )}
                            {assignment.due_date && (
                              <span>📅 Due {format(new Date(assignment.due_date), 'MMM d, yyyy')}</span>
                            )}
                            <Badge variant="outline" className="text-xs">
                              {assignment.priority}
                            </Badge>
                          </div>

                          {assignment.assignment_url && (
                            <a
                              href={assignment.assignment_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary hover:underline flex items-center gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              🔗 View Assignment
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t">
                  <Button variant="outline" onClick={handleClose}>
                    Cancel
                  </Button>
                  <Button 
                    onClick={handleCreateFromAssignments} 
                    disabled={isCreating || selectedAssignmentIds.size === 0}
                  >
                    {isCreating ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <Check className="h-4 w-4 mr-2" />
                        Create {selectedAssignmentIds.size} Task{selectedAssignmentIds.size !== 1 ? 's' : ''}
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default TaskCreationModal;