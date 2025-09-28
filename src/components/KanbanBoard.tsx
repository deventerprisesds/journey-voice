import React, { useState, useEffect, useRef } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, MoreHorizontal, Calendar, Clock, Filter, Wand2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import TaskCard from './TaskCard';
import TaskDetailModal from './TaskDetailModal';
import TaskCreationModal from './TaskCreationModal';
import TaskFilters from './TaskFilters';
import ColumnManager from './ColumnManager';
import { AddColumnModal } from './AddColumnModal';
import { itineraryEngine } from '@/utils/ItineraryEngine';
import VoiceAssistantButton from './VoiceAssistantButton';

import { Task, Board, Column } from '@/types/task';

interface KanbanBoardProps {
  tasks: Task[];
  onTaskUpdate?: () => void;
  onTaskEdit?: (task: Task) => void;
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

const KanbanBoard: React.FC<KanbanBoardProps> = ({ tasks, onTaskUpdate, onTaskEdit }) => {
  console.log('KanbanBoard component rendering'); // Debug log
  const { toast } = useToast();
  const { user, isDemoMode } = useAuth();
  const [loading, setLoading] = useState(true);
  const [board, setBoard] = useState<Board | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isGeneratingSchedule, setIsGeneratingSchedule] = useState(false);
  const [isCreationModalOpen, setIsCreationModalOpen] = useState(false);
  const [filteredTasks, setFilteredTasks] = useState<Task[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [quickAddColumnId, setQuickAddColumnId] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

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
        const { error } = await supabase
          .from('tasks')
          .update({ 
            status: newStatus as any,
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
    if (onTaskEdit) {
      onTaskEdit(task);
    }
    setSelectedTask(task);
    setIsModalOpen(true);
  };

  const handleTaskSave = (updatedTask: Task) => {
    // Notify parent to reload tasks
    if (onTaskUpdate) {
      onTaskUpdate();
    }
    setIsModalOpen(false);
    setSelectedTask(null);
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
      await itineraryEngine.saveScheduleAsItinerary(
        [{
          date: tomorrow.toISOString().split('T')[0],
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

  const getTasksByStatus = (status: Task['status']) => {
    // Use filtered tasks if filters are active, otherwise use all tasks
    const tasksToFilter = filteredTasks.length > 0 ? filteredTasks : tasks;
    return tasksToFilter.filter(task => task.status === status);
  };

  const handleTasksCreated = (newTasks: Task[]) => {
    // Notify parent to reload tasks
    if (onTaskUpdate) {
      onTaskUpdate();
    }
  };

  const handleFilteredTasksChange = (filtered: Task[]) => {
    setFilteredTasks(filtered);
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

    const quickTask = {
      title: title.trim(),
      description: '',
      status: column.status,
      priority: 'MEDIUM' as const,
      category: 'LIFE' as const,
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

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer) {
      updateScrollButtons();
      scrollContainer.addEventListener('scroll', updateScrollButtons);
      window.addEventListener('resize', updateScrollButtons);
      
      return () => {
        scrollContainer.removeEventListener('scroll', updateScrollButtons);
        window.removeEventListener('resize', updateScrollButtons);
      };
    }
  }, [columns]);

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

      // Save to localStorage
      localStorage.setItem('kanban-demo-board', JSON.stringify(demoBoard));
      localStorage.setItem('kanban-demo-columns', JSON.stringify(demoColumns));
      localStorage.setItem('kanban-demo-tasks', JSON.stringify([]));

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
    fetchBoardColumns();
  }, [user, isDemoMode]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading board...</p>
        </div>
      </div>
    );
  }

  if (!board || columns.length === 0) {
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
    <div className="space-y-6">
      {/* Board Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            {board.name}
          </h2>
          <p className="text-muted-foreground">
            {board.description}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <VoiceAssistantButton />
          <AddColumnModal
            boardId={board.id} 
            onColumnCreated={fetchBoardColumns}
            isDemo={isDemoMode}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="h-4 w-4 mr-2" />
            Filters
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsCreationModalOpen(true)}
          >
            <Wand2 className="h-4 w-4 mr-2" />
            AI Create
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={generateDailySchedule}
            disabled={isGeneratingSchedule}
          >
            <Calendar className="h-4 w-4 mr-2" />
            {isGeneratingSchedule ? 'Generating...' : 'Schedule'}
          </Button>
          <Button
            size="sm"
            onClick={addSampleTask}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Sample
          </Button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <TaskFilters
          tasks={tasks}
          onFilteredTasksChange={handleFilteredTasksChange}
        />
      )}

      {/* Kanban Board */}
      <div className="relative">
        {/* Navigation Controls */}
        <div className="absolute left-0 top-1/2 -translate-y-1/2 z-10">
          <Button
            variant="outline"
            size="icon"
            onClick={scrollLeft}
            disabled={!canScrollLeft}
            className="h-10 w-10 bg-background/80 backdrop-blur-sm shadow-lg border-2"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
        
        <div className="absolute right-0 top-1/2 -translate-y-1/2 z-10">
          <Button
            variant="outline"
            size="icon"
            onClick={scrollRight}
            disabled={!canScrollRight}
            className="h-10 w-10 bg-background/80 backdrop-blur-sm shadow-lg border-2"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="board" direction="horizontal" type="column">
            {(provided) => (
              <div
                ref={scrollContainerRef}
                {...provided.droppableProps}
                className="flex gap-4 min-h-[600px] overflow-x-auto pb-4 px-12 scroll-smooth"
                style={{ scrollbarWidth: 'thin' }}
              >
                {columns.map((column, index) => {
                  const columnTasks = getTasksByStatus(column.status);
                  return (
                    <Draggable key={column.id} draggableId={column.id} index={index}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
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
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.droppableProps}
                                className={`
                                  flex-1 space-y-2 p-2 rounded-lg border-2 border-dashed transition-colors min-h-32 mt-2
                                  ${snapshot.isDraggingOver 
                                    ? 'border-primary bg-primary/5' 
                                    : 'border-muted-foreground/20 bg-muted/10'
                                  }
                                  ${statusColors[column.status as keyof typeof statusColors]}
                                `}
                              >
                                {columnTasks.map((task, index) => (
                                  <Draggable
                                    key={task.id}
                                    draggableId={task.id}
                                    index={index}
                                  >
                                    {(provided, snapshot) => (
                                      <div
                                        ref={provided.innerRef}
                                        {...provided.draggableProps}
                                        {...provided.dragHandleProps}
                                        className={snapshot.isDragging ? 'rotate-2 scale-105' : ''}
                                      >
                                         <TaskCard
                                           task={task}
                                           onEdit={handleTaskEdit}
                                           onStatusChange={handleStatusChange}
                                         />
                                      </div>
                                    )}
                                  </Draggable>
                                ))}
                                {provided.placeholder}
                                
                                {/* Empty State */}
                                {columnTasks.length === 0 && (
                                  <div className="text-center py-8 text-muted-foreground">
                                    <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                    <p className="text-sm">No tasks</p>
                                  </div>
                                )}
                              </div>
                            )}
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
      <TaskDetailModal
        task={selectedTask}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleTaskSave}
        allTasks={filteredTasks.length > 0 ? filteredTasks : tasks}
      />

      <TaskCreationModal
        isOpen={isCreationModalOpen}
        onClose={() => setIsCreationModalOpen(false)}
        onTasksCreated={handleTasksCreated}
        boardId={board.id}
        userId={user?.id || ''}
      />
    </div>
  );
};

export default KanbanBoard;