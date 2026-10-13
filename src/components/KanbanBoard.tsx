import React, { useState, useEffect, useRef } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  Plus, 
  MoreHorizontal, 
  Calendar, 
  Clock, 
  Filter, 
  Wand2, 
  ChevronLeft, 
  ChevronRight, 
  Eye, 
  EyeOff,
  CheckCircle2,
  Trash2,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import TaskCard from './TaskCard';

import TaskCreationModal from './TaskCreationModal';
import TaskFilters from './TaskFilters';
import ColumnManager from './ColumnManager';
import { AddColumnModal } from './AddColumnModal';
import { itineraryEngine } from '@/utils/ItineraryEngine';
import VoiceAssistantButton from './VoiceAssistantButton';
import { useIsMobile } from '@/hooks/use-mobile';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, addWeeks, isWithinInterval, parseISO } from 'date-fns';

import { Task, Board, Column } from '@/types/task';

interface KanbanBoardProps {
  tasks: Task[];
  onTaskUpdate?: () => void;
  onTaskEdit?: (task: Task) => void;
  categoryFilter?: string;
  useStandardColumns?: boolean;
}

const statusLabels = {
  BLOCKED: 'Blocked',
  LIFE: 'Life',
  CAREER: 'Career',
  PROF_EDUCATION: 'Prof. Education',
  VENTURES: 'Ventures',
  PLANNING: 'Planning',
  READY: 'Ready',
  UP_NEXT: 'Up Next',
  DOING: 'Doing',
  DONE: 'Done',
  // Legacy statuses for compatibility
  BACKLOG: 'Backlog',
  TODO: 'To Do',
};

const statusColors = {
  BLOCKED: 'border-red-500 bg-red-50',
  BACKLOG: 'border-gray-500 bg-gray-50',
  LIFE: 'border-pink-500 bg-pink-50',
  CAREER: 'border-blue-500 bg-blue-50',
  PROF_EDUCATION: 'border-purple-500 bg-purple-50',
  VENTURES: 'border-green-500 bg-green-50',
  PLANNING: 'border-yellow-500 bg-yellow-50',
  READY: 'border-orange-500 bg-orange-50',
  UP_NEXT: 'border-indigo-500 bg-indigo-50',
  DOING: 'border-primary bg-primary/10',
  DONE: 'border-emerald-500 bg-emerald-50',
  // Legacy statuses for compatibility  
  TODO: 'border-blue-500 bg-blue-50',
};

// Standard workflow columns for tabbed view
const STANDARD_COLUMNS: Column[] = [
  { id: 'std-backlog', name: 'Backlog', status: 'BACKLOG', position: 0, board_id: 'std' },
  { id: 'std-blocked', name: 'Blocked', status: 'BLOCKED', position: 1, board_id: 'std' },
  { id: 'std-ready', name: 'Ready', status: 'READY', position: 2, board_id: 'std' },
  { id: 'std-upnext', name: 'Up Next', status: 'UP_NEXT', position: 3, board_id: 'std' },
  { id: 'std-doing', name: 'Doing', status: 'DOING', position: 4, board_id: 'std' },
  { id: 'std-done', name: 'Done', status: 'DONE', position: 5, board_id: 'std' },
];


const CATEGORY_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  LIFE: { bg: 'bg-pink-50', border: 'border-pink-300', text: 'text-pink-700' },
  CAREER: { bg: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-700' },
  PROF_EDUCATION: { bg: 'bg-purple-50', border: 'border-purple-300', text: 'text-purple-700' },
  VENTURES: { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-700' },
  EDUCATION: { bg: 'bg-orange-50', border: 'border-orange-300', text: 'text-orange-700' },
};

const KanbanBoard: React.FC<KanbanBoardProps> = ({ tasks, onTaskUpdate, onTaskEdit, categoryFilter, useStandardColumns = false }) => {
  console.log('KanbanBoard component rendering', { categoryFilter, useStandardColumns }); // Debug log
  const { toast } = useToast();
  const { user, isDemoMode } = useAuth();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [board, setBoard] = useState<Board | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const [isGeneratingSchedule, setIsGeneratingSchedule] = useState(false);
  const [isCreationModalOpen, setIsCreationModalOpen] = useState(false);
  const [filteredTasks, setFilteredTasks] = useState<Task[]>([]);
  const [isFiltering, setIsFiltering] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [quickAddColumnId, setQuickAddColumnId] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [showCompletedTasks, setShowCompletedTasks] = useState(() => {
    const stored = localStorage.getItem('kanban-show-completed');
    return stored ? JSON.parse(stored) : false;
  });
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  
  
  // Category bins - track which are collapsed
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, Set<string>>>({});
  
  // Touch drag delay - for mobile
  const [touchStartTime, setTouchStartTime] = useState<number | null>(null);
  const TOUCH_DELAY_MS = 200; // Hold for 200ms before drag initiates
  
  // Drag-to-pan state
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeftStart, setScrollLeftStart] = useState(0);

  const fetchBoardColumns = async () => {
    if (!user) return;
    
    setLoading(true);
    console.log('Fetching board columns for user:', user.id);
    
    // Handle demo mode - use localStorage
    if (isDemoMode) {
      try {
        const demoBoard = localStorage.getItem('kanban-demo-board');
        const demoColumns = localStorage.getItem('kanban-demo-columns');

        if (demoBoard && demoColumns) {
          const parsedBoard = JSON.parse(demoBoard);
          const parsedColumns = JSON.parse(demoColumns) as Column[];
          
          setBoard(parsedBoard);
          setColumns(parsedColumns);
        } else {
          // Create demo data
          const result = await createDefaultBoardAndColumns(user.id);
          setBoard(result.board);
          setColumns(result.columns as Column[]);
        }
      } catch (error) {
        console.error('Error loading demo data:', error);
        // Create demo data as fallback
        const result = await createDefaultBoardAndColumns(user.id);
        setBoard(result.board);
        setColumns(result.columns as Column[]);
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      // Fetch user's default board with explicit user_id filter
      const { data: boardData, error: boardError } = await supabase
        .from('boards')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_default', true)
        .maybeSingle();

      if (boardError) {
        console.error('Error fetching board:', boardError);
        throw boardError;
      }

      console.log('Board data:', boardData);

      if (!boardData) {
        console.log('No default board found, creating one...');
        const result = await createDefaultBoardAndColumns(user.id);
        setBoard(result.board);
        setColumns(result.columns as Column[]);
        return;
      }

      setBoard(boardData);

      // Fetch columns for this board
      const { data: columnsData, error: columnsError } = await supabase
        .from('columns')
        .select('*')
        .eq('board_id', boardData.id)
        .order('position');

      if (columnsError) {
        console.error('Error fetching columns:', columnsError);
        throw columnsError;
      }

      console.log('Columns data:', columnsData);

      if (!columnsData || columnsData.length === 0) {
        console.log('No columns found, creating default columns...');
        const result = await createDefaultBoardAndColumns(user.id);
        setBoard(result.board);
        setColumns(result.columns as Column[]);
        return;
      }

      setColumns(columnsData as Column[]);
      
    } catch (error) {
      console.error('Error in fetchBoardColumns:', error);
      // In case of any error, try to create default board
      try {
        const result = await createDefaultBoardAndColumns(user.id);
        setBoard(result.board);
        setColumns(result.columns as Column[]);
      } catch (createError) {
        console.error('Error creating default board:', createError);
      }
    } finally {
      setLoading(false);
    }
  };

  // Map board lane status to canonical category for display consistency
  const statusToCategory = (status: Task['status']): Task['category'] | null => {
    switch (status) {
      case 'CAREER': return 'CAREER';
      case 'PROF_EDUCATION': return 'PROF_EDUCATION';
      case 'VENTURES': return 'VENTURES';
      case 'LIFE': return 'LIFE';
      default: return null; // Non-lane statuses (e.g., TODO/DONE) don't force category
    }
  };

  const handleStatusChange = async (taskId: string, newStatus: Task['status']) => {
    try {
      if (isDemoMode) {
        // Update localStorage for demo mode
        const demoTasks = localStorage.getItem('kanban-demo-tasks');
        if (demoTasks) {
          const tasks = JSON.parse(demoTasks);
          const updatedTasks = tasks.map((task: Task) => 
            task.id === taskId 
              ? { ...task, status: newStatus, completed_at: newStatus === 'DONE' ? new Date().toISOString() : task.completed_at }
              : task
          );
          localStorage.setItem('kanban-demo-tasks', JSON.stringify(updatedTasks));
        }
      } else {
        const mappedCategory = statusToCategory(newStatus);
        const { error } = await supabase
          .from('tasks')
          .update({ 
            status: newStatus as any,
            ...(mappedCategory ? { category: mappedCategory as any } : {}),
            completed_at: newStatus === 'DONE' ? new Date().toISOString() : null
          })
          .eq('id', taskId);

        if (error) {
          console.error('Error updating task status:', error);
          toast({
            title: "Error",
            description: "Failed to update task status",
            variant: "destructive",
          });
          return;
        }
      }

      // Notify parent to reload tasks
      if (onTaskUpdate) {
        onTaskUpdate();
      }

      toast({
        title: "Task updated",
        description: `Task moved to ${statusLabels[newStatus]}`,
      });
    } catch (error) {
      console.error('Error updating task:', error);
    }
  };

  const handleDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId, type } = result;

    // If dropped outside or in same position, do nothing
    if (!destination || 
        (destination.droppableId === source.droppableId && destination.index === source.index)) {
      return;
    }

    // Handle column reordering
    if (type === 'column') {
      const newColumns = Array.from(columns);
      const [reorderedColumn] = newColumns.splice(source.index, 1);
      newColumns.splice(destination.index, 0, reorderedColumn);
      
      // Update positions
      const updatedColumns = newColumns.map((col, index) => ({
        ...col,
        position: index
      }));
      
      setColumns(updatedColumns);
      
      // Save to database/localStorage
      if (isDemoMode) {
        localStorage.setItem('kanban-demo-columns', JSON.stringify(updatedColumns));
      } else {
        // Update positions in database
        for (const col of updatedColumns) {
          await supabase
            .from('columns')
            .update({ position: col.position })
            .eq('id', col.id);
        }
      }
      
      toast({
        title: "Column reordered",
        description: "Column order has been updated",
      });
      return;
    }

    // Handle task reordering (existing logic)
    const targetColumn = columns.find(col => col.id === destination.droppableId);
    if (!targetColumn) return;

    await handleStatusChange(draggableId, targetColumn.status);
  };

  const handleTaskEdit = (task: Task) => {
    console.log('KanbanBoard - handleTaskEdit called with task:', task?.id);
    if (onTaskEdit) {
      onTaskEdit(task);
    }
  };

  const handleTaskSchedule = async (task: Task) => {
    // Skip scheduling in demo mode
    if (isDemoMode) {
      toast({
        title: "Demo Mode",
        description: "Task scheduling is not available in demo mode. Please sign in to use this feature.",
        variant: "destructive",
      });
      return;
    }

    try {
      const { scheduleNewTask } = await import('@/utils/taskScheduling');
      
      setIsGeneratingSchedule(true);
      const result = await scheduleNewTask({
        ...task,
        board_id: board?.id || '',
        user_id: user?.id || ''
      });

      if (result.success && result.scheduledTask) {
        toast({
          title: "Task scheduled!",
          description: `"${task.title}" has been scheduled`,
        });
        
        // Reload tasks to show the updated schedule
        if (onTaskUpdate) {
          onTaskUpdate();
        }
      } else {
        toast({
          title: "Scheduling failed",
          description: result.error || "Could not find a suitable time slot",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error scheduling task:', error);
      toast({
        title: "Error",
        description: "Failed to schedule task",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingSchedule(false);
    }
  };

  const handleTaskDelete = async (taskId: string) => {
    try {
      if (isDemoMode) {
        // Handle demo mode deletion
        const demoTasks = localStorage.getItem('kanban-demo-tasks');
        if (demoTasks) {
          const tasks = JSON.parse(demoTasks);
          const updatedTasks = tasks.filter((task: Task) => task.id !== taskId);
          localStorage.setItem('kanban-demo-tasks', JSON.stringify(updatedTasks));
        }
      } else {
        // Handle production deletion
        const { error } = await supabase
          .from('tasks')
          .delete()
          .eq('id', taskId)
          .eq('user_id', user?.id);

        if (error) {
          throw error;
        }
      }

      // Reload tasks
      if (onTaskUpdate) {
        onTaskUpdate();
      }

      toast({
        title: "Task deleted",
        description: "Task has been successfully deleted",
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

      if (onTaskUpdate) {
        onTaskUpdate();
      }

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

  const generateDailySchedule = async () => {
    if (tasks.length === 0) {
      toast({
        title: "No tasks to schedule",
        description: "Add some tasks first to generate a schedule",
        variant: "destructive",
      });
      return;
    }

    setIsGeneratingSchedule(true);
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const scheduledTasks = await itineraryEngine.generateDailySchedule(tasks, tomorrow);
      
      if (scheduledTasks.length === 0) {
        toast({
          title: "No tasks scheduled",
          description: "All your tasks might be blocked by dependencies or already completed",
        });
        return;
      }

      // Create an itinerary with the scheduled tasks
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
      await itineraryEngine.saveScheduleAsItinerary(
        [{
          date: tomorrow.toLocaleDateString('en-CA', { timeZone: tz }),
          tasks: scheduledTasks,
          totalMinutes: scheduledTasks.reduce((sum, st) => sum + (st.task.estimate_minutes || 60), 0),
          availableMinutes: 420
        }],
        `Daily Schedule - ${tomorrow.toLocaleDateString()}`
      );

      toast({
        title: "Schedule generated!",
        description: `Created schedule with ${scheduledTasks.length} tasks for tomorrow`,
      });
    } catch (error) {
      console.error('Error generating schedule:', error);
      toast({
        title: "Error",
        description: "Failed to generate schedule",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingSchedule(false);
    }
  };

  // Map a task to a visible column status, even if the task's status doesn't have a matching column
  const mapTaskStatusForColumns = (task: Task): Task['status'] => {
    const columnsToCheck = useStandardColumns ? STANDARD_COLUMNS : columns;
    const hasColumnFor = (s: Task['status']) => columnsToCheck.some(col => col.status === s);
    if (hasColumnFor(task.status)) return task.status as any;
    if ((task.category as any) === 'EDUCATION' && hasColumnFor('PROF_EDUCATION' as any)) return 'PROF_EDUCATION' as any;
    if (hasColumnFor('BACKLOG' as any)) return 'BACKLOG' as any;
    return (columnsToCheck[0]?.status as any) || 'BACKLOG';
  };

  const getTasksByStatus = (status: Task['status']) => {
    // Use filtered tasks if filtering is active, otherwise use all tasks
    const tasksToFilter = isFiltering ? filteredTasks : tasks;
    let filtered = tasksToFilter.filter(task => mapTaskStatusForColumns(task) === status);
    
    // Hide completed tasks if toggle is off
    if (!showCompletedTasks) {
      filtered = filtered.filter(task => task.status !== 'DONE');
    }
    
    return filtered;
  };

  // Group tasks by category for bin display
  const getTasksByStatusGroupedByCategory = (status: Task['status']) => {
    const columnTasks = getTasksByStatus(status);
    const grouped: Record<string, Task[]> = {};
    const uncategorized: Task[] = [];
    
    columnTasks.forEach(task => {
      const cat = task.category || 'UNCATEGORIZED';
      if (cat === 'UNCATEGORIZED' || !CATEGORY_COLORS[cat]) {
        uncategorized.push(task);
      } else {
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(task);
      }
    });
    
    // Add uncategorized at the end
    if (uncategorized.length > 0) {
      grouped['UNCATEGORIZED'] = uncategorized;
    }
    
    return grouped;
  };

  // Toggle category collapse for a column
  const toggleCategoryCollapse = (columnId: string, category: string) => {
    setCollapsedCategories(prev => {
      const columnCollapsed = prev[columnId] || new Set();
      const newSet = new Set(columnCollapsed);
      if (newSet.has(category)) {
        newSet.delete(category);
      } else {
        newSet.add(category);
      }
      return { ...prev, [columnId]: newSet };
    });
  };

  const isCategoryCollapsed = (columnId: string, category: string) => {
    return collapsedCategories[columnId]?.has(category) || false;
  };

  const toggleShowCompletedTasks = () => {
    const newValue = !showCompletedTasks;
    setShowCompletedTasks(newValue);
    localStorage.setItem('kanban-show-completed', JSON.stringify(newValue));
  };

  const handleTasksCreated = (newTasks: Task[]) => {
    // Notify parent to reload tasks
    if (onTaskUpdate) {
      onTaskUpdate();
    }
  };

  const handleFilteredTasksChange = (filtered: Task[], isActive: boolean) => {
    setFilteredTasks(filtered);
    setIsFiltering(isActive);
  };

  const handleColumnUpdate = (updatedColumn: Column) => {
    setColumns(prev => prev.map(col => 
      col.id === updatedColumn.id ? updatedColumn : col
    ));
  };

  const handleColumnArchive = (columnId: string) => {
    setColumns(prev => prev.filter(col => col.id !== columnId));
  };

  const handleQuickAddTask = async (columnId: string, title: string) => {
    if (!board || !title.trim()) return;

    const column = columns.find(col => col.id === columnId);
    if (!column) return;

    const mappedCategory = statusToCategory(column.status) || 'LIFE';
    const quickTask = {
      title: title.trim(),
      description: '',
      status: column.status,
      priority: 'MEDIUM' as const,
      category: mappedCategory as any,
      board_id: board.id,
      user_id: board.user_id,
    };

    if (isDemoMode) {
      const demoTask = {
        ...quickTask,
        id: `demo-task-${Date.now()}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const currentTasks = JSON.parse(localStorage.getItem('kanban-demo-tasks') || '[]');
      currentTasks.unshift(demoTask);
      localStorage.setItem('kanban-demo-tasks', JSON.stringify(currentTasks));
    } else {
      try {
        const { error } = await supabase
          .from('tasks')
          .insert(quickTask as any);

        if (error) {
          console.error('Error creating quick task:', error);
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
              userId: board.user_id,
              taskId: '', // Will be set by the function
              title: 'New Task Created',
              body: `Task "${title}" has been created`,
              type: 'task_created'
            }
          });
        } catch (notificationError) {
          console.warn('Failed to send notifications:', notificationError);
        }
        */
      } catch (error) {
        console.error('Error creating quick task:', error);
        return;
      }
    }

    // Notify parent to reload tasks
    if (onTaskUpdate) {
      onTaskUpdate();
    }

    toast({
      title: "Task created",
      description: `"${title}" added to ${column.name}`,
    });
  };

  const scrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -280, behavior: 'smooth' });
    }
  };

  const scrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 280, behavior: 'smooth' });
    }
  };

  const updateScrollButtons = () => {
    if (scrollContainerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
      setCanScrollLeft(scrollLeft > 0);
      setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 1);
    }
  };

  // Drag-to-pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!scrollContainerRef.current) return;
    setIsDragging(true);
    setStartX(e.pageX);
    setScrollLeftStart(scrollContainerRef.current.scrollLeft);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !scrollContainerRef.current) return;
    e.preventDefault();
    const x = e.pageX;
    const walk = (startX - x) * 2; // Multiply for faster scrolling
    scrollContainerRef.current.scrollLeft = scrollLeftStart + walk;
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer) {
      // Use timeout to ensure DOM is fully rendered
      const timer = setTimeout(() => {
        updateScrollButtons();
      }, 100);
      
      updateScrollButtons();
      scrollContainer.addEventListener('scroll', updateScrollButtons);
      window.addEventListener('resize', updateScrollButtons);
      
      return () => {
        clearTimeout(timer);
        scrollContainer.removeEventListener('scroll', updateScrollButtons);
        window.removeEventListener('resize', updateScrollButtons);
      };
    }
  }, [columns, tasks]); // Added tasks dependency to update arrows when tasks change

  const createDefaultBoardAndColumns = async (userId: string) => {
    console.log('Creating default board and columns for user:', userId);
    
    // Handle demo mode - use localStorage instead of Supabase
    if (isDemoMode) {
      const demoBoard = {
        id: 'demo-board-1',
        name: 'Personal Tasks',
        description: 'Your main task board',
        user_id: userId,
        is_default: true,
        position: 0,
        color: '#3B82F6',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const demoColumns = [
        { id: 'demo-col-1', name: 'Blocked', status: 'BLOCKED' as const, position: 0, board_id: 'demo-board-1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'demo-col-2', name: 'Backlog', status: 'BACKLOG' as const, position: 1, board_id: 'demo-board-1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'demo-col-3', name: 'Life', status: 'LIFE' as const, position: 2, board_id: 'demo-board-1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'demo-col-4', name: 'Career', status: 'CAREER' as const, position: 3, board_id: 'demo-board-1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'demo-col-5', name: 'Prof. Education', status: 'PROF_EDUCATION' as const, position: 4, board_id: 'demo-board-1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'demo-col-6', name: 'Ventures', status: 'VENTURES' as const, position: 5, board_id: 'demo-board-1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'demo-col-7', name: 'Planning', status: 'PLANNING' as const, position: 6, board_id: 'demo-board-1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'demo-col-8', name: 'Ready', status: 'READY' as const, position: 7, board_id: 'demo-board-1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'demo-col-9', name: 'Up Next', status: 'UP_NEXT' as const, position: 8, board_id: 'demo-board-1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'demo-col-10', name: 'Doing', status: 'DOING' as const, position: 9, board_id: 'demo-board-1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'demo-col-11', name: 'Done', status: 'DONE' as const, position: 10, board_id: 'demo-board-1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      ];

      // Save board/columns to localStorage (do NOT overwrite tasks - they come from Supabase)
      localStorage.setItem('kanban-demo-board', JSON.stringify(demoBoard));
      localStorage.setItem('kanban-demo-columns', JSON.stringify(demoColumns));
      // Only initialize tasks if not already present (don't wipe existing demo tasks)
      if (!localStorage.getItem('kanban-demo-tasks')) {
        localStorage.setItem('kanban-demo-tasks', JSON.stringify([]));
      }

      return { board: demoBoard, columns: demoColumns };
    }
    
    try {
      // Create default board
      const { data: boardData, error: boardError } = await supabase
        .from('boards')
        .insert({
          name: 'Personal Tasks',
          description: 'Your main task board',
          user_id: userId,
          is_default: true,
          position: 0
        })
        .select()
        .single();

      if (boardError) {
        console.error('Error creating board:', boardError);
        throw boardError;
      }

      console.log('Board created successfully:', boardData);

      // Create default columns with BACKLOG and LIFE columns in correct order
      const defaultColumns = [
        { name: 'Blocked', status: 'BLOCKED' as const, position: 0 },
        { name: 'Backlog', status: 'BACKLOG' as const, position: 1 },
        { name: 'Life', status: 'LIFE' as const, position: 2 },
        { name: 'Career', status: 'CAREER' as const, position: 3 },
        { name: 'Prof. Education', status: 'PROF_EDUCATION' as const, position: 4 },
        { name: 'Ventures', status: 'VENTURES' as const, position: 5 },
        { name: 'Planning', status: 'PLANNING' as const, position: 6 },
        { name: 'Ready', status: 'READY' as const, position: 7 },
        { name: 'Up Next', status: 'UP_NEXT' as const, position: 8 },
        { name: 'Doing', status: 'DOING' as const, position: 9 },
        { name: 'Done', status: 'DONE' as const, position: 10 }
      ];

      const { data: columnsData, error: columnsError } = await supabase
        .from('columns')
        .insert(
          defaultColumns.map(col => ({
            name: col.name,
            board_id: boardData.id,
            status: col.status as any,
            position: col.position
          }))
        )
        .select();

      if (columnsError) {
        console.error('Error creating columns:', columnsError);
        throw columnsError;
      }

      console.log('Columns created successfully:', columnsData);

      return { board: boardData, columns: columnsData };
    } catch (error) {
      console.error('Error in createDefaultBoardAndColumns:', error);
      throw error;
    }
  };

  const addSampleTask = async () => {
    if (!board) return;

    const sampleTask = {
      title: 'Sample Task',
      description: 'This is a sample task to get you started. Try asking the voice assistant to create more tasks!',
      status: 'BLOCKED' as const,
      priority: 'MEDIUM' as const,
      category: 'LIFE' as const,
      board_id: board.id,
      user_id: board.user_id,
    };

    if (isDemoMode) {
      // Demo mode: save to localStorage
      const demoTask = {
        ...sampleTask,
        id: `demo-task-${Date.now()}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // Save to localStorage
      const currentTasks = JSON.parse(localStorage.getItem('kanban-demo-tasks') || '[]');
      currentTasks.unshift(demoTask);
      localStorage.setItem('kanban-demo-tasks', JSON.stringify(currentTasks));

      // Notify parent to reload tasks
      if (onTaskUpdate) {
        onTaskUpdate();
      }

      toast({
        title: "Sample task added",
        description: "Try using the voice assistant to create more tasks!",
      });
      return;
    }

    try {
      const { data, error } = await supabase
        .from('tasks')
        .insert(sampleTask)
        .select()
        .single();

      if (error) {
        console.error('Error creating sample task:', error);
        return;
      }

      // Notify parent to reload tasks
      if (onTaskUpdate) {
        onTaskUpdate();
      }
      
      toast({
        title: "Sample task added",
        description: "Try using the voice assistant to create more tasks!",
      });
    } catch (error) {
      console.error('Error adding sample task:', error);
    }
  };

  useEffect(() => {
    // Skip fetching board if using standard columns
    if (useStandardColumns) {
      setLoading(false);
      return;
    }
    fetchBoardColumns();
  }, [user, isDemoMode, useStandardColumns]);

  // Derive effective columns - use STANDARD_COLUMNS when in tabbed mode
  const effectiveColumns = useStandardColumns ? STANDARD_COLUMNS : columns;

  if (loading && !useStandardColumns) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading board...</p>
        </div>
      </div>
    );
  }

  if (!useStandardColumns && (!board || columns.length === 0)) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center space-y-4">
          <h3 className="text-lg font-medium">No Board Found</h3>
          <p className="text-muted-foreground">
            Unable to load your task board. Please try refreshing the page.
          </p>
          <Button onClick={() => window.location.reload()}>
            Refresh Page
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Board Header - hide in standard columns mode (tabbed view) */}
      {!useStandardColumns && board && (
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            {board.name}
          </h2>
          <p className="text-muted-foreground">
            {board.description}
          </p>
        </div>
      )}

      {/* Toolbar - always visible, horizontal scroll on mobile */}
      <div className="flex items-center justify-start">
        <div className="flex items-center gap-2 overflow-x-auto flex-nowrap pb-1 scrollbar-thin">
          <VoiceAssistantButton />
          <Button
            variant={isSelectMode ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setIsSelectMode(!isSelectMode);
              if (isSelectMode) setSelectedTasks(new Set());
            }}
            title="Select multiple tasks for bulk actions"
            className="flex-shrink-0"
          >
            <CheckCircle2 className="h-4 w-4" />
            <span className="hidden sm:inline ml-2">{isSelectMode ? 'Cancel' : 'Select'}</span>
          </Button>
          <Button
            variant={showCompletedTasks ? "default" : "outline"}
            size="sm"
            onClick={toggleShowCompletedTasks}
            title={showCompletedTasks ? "Hide completed tasks" : "Show completed tasks"}
            className="flex-shrink-0"
          >
            {showCompletedTasks ? (
              <Eye className="h-4 w-4" />
            ) : (
              <EyeOff className="h-4 w-4" />
            )}
            <span className="hidden sm:inline ml-2">{showCompletedTasks ? 'Hide' : 'Show'}</span>
          </Button>
          {!useStandardColumns && board && (
            <AddColumnModal
              boardId={board.id} 
              onColumnCreated={fetchBoardColumns}
              isDemo={isDemoMode}
            />
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="flex-shrink-0"
          >
            <Filter className="h-4 w-4" />
            <span className="hidden sm:inline ml-2">Filters</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsCreationModalOpen(true)}
            className="flex-shrink-0"
          >
            <Wand2 className="h-4 w-4" />
            <span className="hidden sm:inline ml-2">AI Create</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={generateDailySchedule}
            disabled={isGeneratingSchedule}
            className="flex-shrink-0"
          >
            <Calendar className="h-4 w-4" />
            <span className="hidden sm:inline ml-2">{isGeneratingSchedule ? 'Generating...' : 'Schedule'}</span>
          </Button>
          {!useStandardColumns && (
            <Button
              size="sm"
              onClick={addSampleTask}
              className="flex-shrink-0"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline ml-2">Add Sample</span>
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <TaskFilters
          tasks={tasks}
          onFilteredTasksChange={handleFilteredTasksChange}
        />
      )}

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

      {/* Kanban Board */}
      <div className="relative">
        {/* Navigation Controls */}
        {canScrollLeft && (
          <div className="fixed left-4 top-1/2 -translate-y-1/2 z-50 pointer-events-auto">
            <Button
              variant="outline"
              size="icon"
              onClick={scrollLeft}
              className="h-12 w-12 bg-background shadow-xl border-2 hover:bg-background/90 transition-all hover:scale-110"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          </div>
        )}
        
        {canScrollRight && (
          <div className="fixed right-4 top-1/2 -translate-y-1/2 z-50 pointer-events-auto">
            <Button
              variant="outline"
              size="icon"
              onClick={scrollRight}
              className="h-12 w-12 bg-background shadow-xl border-2 hover:bg-background/90 transition-all hover:scale-110"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
        )}

        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="board" direction="horizontal" type="column">
            {(provided) => (
              <div
                ref={(el) => {
                  scrollContainerRef.current = el as HTMLDivElement | null;
                  provided.innerRef(el);
                }}
                {...provided.droppableProps}
                className="flex gap-4 min-h-[600px] overflow-x-auto pb-4 px-12 scroll-smooth kanban-scroll-container"
                style={{ 
                  scrollbarWidth: 'thin',
                  cursor: isMobile ? 'auto' : (isDragging ? 'grabbing' : 'grab'),
                  userSelect: isDragging ? 'none' : 'auto'
                }}
                onMouseDown={!isMobile ? handleMouseDown : undefined}
                onMouseMove={!isMobile ? handleMouseMove : undefined}
                onMouseUp={!isMobile ? handleMouseUp : undefined}
                onMouseLeave={!isMobile ? handleMouseLeave : undefined}
              >
                {effectiveColumns.map((column, index) => {
                  const columnTasks = getTasksByStatus(column.status);
                  return (
                     <Draggable key={column.id} draggableId={column.id} index={index}>
                       {(provided, snapshot) => (
                         <div
                           {...provided.draggableProps}
                           ref={provided.innerRef}
                           className={`bg-card rounded-lg border p-4 shadow-sm min-w-[280px] flex-shrink-0 ${
                             snapshot.isDragging ? 'rotate-1 scale-105 shadow-xl' : ''
                           }`}
                         >
                          {/* Column Header */}
                          <ColumnManager
                            column={column}
                            taskCount={columnTasks.length}
                            onColumnUpdate={handleColumnUpdate}
                            onColumnArchive={handleColumnArchive}
                            onQuickAddTask={handleQuickAddTask}
                            dragHandleProps={provided.dragHandleProps}
                          />

                          {/* Tasks Container */}
                          <Droppable droppableId={column.id} type="task">
                             {(provided, snapshot) => {
                               const groupedTasks = getTasksByStatusGroupedByCategory(column.status);
                               const categories = Object.keys(groupedTasks);
                               let globalIndex = 0;
                               
                               return (
                                <div
                                  {...provided.droppableProps}
                                  ref={provided.innerRef}
                                  className={`
                                   flex-1 space-y-2 p-2 rounded-lg border-2 border-dashed transition-colors min-h-32 mt-2
                                   ${snapshot.isDraggingOver 
                                     ? 'border-primary bg-primary/5' 
                                     : 'border-muted-foreground/20 bg-muted/10'
                                   }
                                   ${statusColors[column.status as keyof typeof statusColors]}
                                 `}
                               >
                                 {categories.length === 0 && (
                                   <div className="text-center py-8 text-muted-foreground">
                                     <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                     <p className="text-sm">No tasks</p>
                                   </div>
                                 )}
                                 
                                 {categories.map((category) => {
                                   const categoryTasks = groupedTasks[category];
                                   const categoryStyle = CATEGORY_COLORS[category] || { bg: 'bg-gray-50', border: 'border-gray-300', text: 'text-gray-700' };
                                   const isCollapsed = isCategoryCollapsed(column.id, category);
                                   const startIndex = globalIndex;
                                   globalIndex += categoryTasks.length;
                                   
                                   return (
                                     <div key={category} className={`rounded-md ${categoryStyle.border} border ${categoryStyle.bg} overflow-hidden`}>
                                       {/* Category Header - collapsible */}
                                       <button
                                         onClick={() => toggleCategoryCollapse(column.id, category)}
                                         className={`w-full flex items-center justify-between p-2 ${categoryStyle.text} hover:bg-black/5 transition-colors`}
                                       >
                                         <div className="flex items-center gap-2">
                                           {isCollapsed ? (
                                             <ChevronRight className="h-4 w-4" />
                                           ) : (
                                             <ChevronDown className="h-4 w-4" />
                                           )}
                                           <span className="font-medium text-sm">
                                             {category === 'UNCATEGORIZED' ? 'Uncategorized' : category.replace('_', ' ')}
                                           </span>
                                         </div>
                                         <Badge variant="secondary" className="text-xs">
                                           {categoryTasks.length}
                                         </Badge>
                                       </button>
                                       
                                       {/* Category Tasks */}
                                       {!isCollapsed && (
                                         <div className="p-2 space-y-2 bg-background/50">
                                           {categoryTasks.map((task, idx) => (
                                             <Draggable
                                               key={task.id}
                                               draggableId={task.id}
                                               index={startIndex + idx}
                                             >
                                               {(provided, snapshot) => (
                                                 <div
                                                   {...provided.draggableProps}
                                                   {...provided.dragHandleProps}
                                                   ref={provided.innerRef}
                                                   className={`kanban-draggable ${snapshot.isDragging ? 'rotate-2 scale-105' : ''}`}
                                                   data-is-dragging={snapshot.isDragging}
                                                 >
                                                   <TaskCard
                                                     task={task}
                                                     onEdit={handleTaskEdit}
                                                     onStatusChange={handleStatusChange}
                                                     onSchedule={handleTaskSchedule}
                                                     onDelete={handleTaskDelete}
                                                     isSelectMode={isSelectMode}
                                                     isSelected={selectedTasks.has(task.id)}
                                                     onSelect={handleSelectTask}
                                                   />
                                                 </div>
                                               )}
                                             </Draggable>
                                           ))}
                                         </div>
                                       )}
                                     </div>
                                   );
                                 })}
                                 {provided.placeholder}
                               </div>
                             );
                            }}
                          </Droppable>
                        </div>
                      )}
                    </Draggable>
                  );
                })}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      </div>

      {/* Modals */}

      <TaskCreationModal
        isOpen={isCreationModalOpen}
        onClose={() => setIsCreationModalOpen(false)}
        onTasksCreated={handleTasksCreated}
        boardId={board?.id || ''}
        userId={user?.id || ''}
      />
    </div>
  );
};

export default KanbanBoard;