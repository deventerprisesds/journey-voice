import React, { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, MoreHorizontal, Calendar, Clock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import TaskCard from './TaskCard';
import TaskDetailModal from './TaskDetailModal';
import { itineraryEngine } from '@/utils/ItineraryEngine';

interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'BLOCKED' | 'CAREER' | 'PROF_EDUCATION' | 'VENTURES' | 'PLANNING' | 'READY' | 'UP_NEXT' | 'DOING' | 'DONE' | 'BACKLOG' | 'TODO';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  category: 'LIFE' | 'CAREER' | 'VENTURES' | 'EDUCATION';
  due_date?: string;
  estimate_minutes?: number;
  blocked_by?: string[];
  board_id: string;
  user_id: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

interface Board {
  id: string;
  name: string;
  description?: string;
  color: string;
  user_id: string;
  position: number;
  is_default: boolean;
}

interface Column {
  id: string;
  name: string;
  board_id: string;
  position: number;
  status: 'BLOCKED' | 'CAREER' | 'PROF_EDUCATION' | 'VENTURES' | 'PLANNING' | 'READY' | 'UP_NEXT' | 'DOING' | 'DONE' | 'BACKLOG' | 'TODO';
}

interface KanbanBoardProps {
  refreshTrigger?: number;
}

const statusLabels = {
  BLOCKED: 'Blocked',
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
  CAREER: 'border-blue-500 bg-blue-50',
  PROF_EDUCATION: 'border-purple-500 bg-purple-50',
  VENTURES: 'border-green-500 bg-green-50',
  PLANNING: 'border-yellow-500 bg-yellow-50',
  READY: 'border-orange-500 bg-orange-50',
  UP_NEXT: 'border-indigo-500 bg-indigo-50',
  DOING: 'border-primary bg-primary/10',
  DONE: 'border-emerald-500 bg-emerald-50',
  // Legacy statuses for compatibility  
  BACKLOG: 'border-red-500 bg-red-50',
  TODO: 'border-blue-500 bg-blue-50',
};

const KanbanBoard: React.FC<KanbanBoardProps> = ({ refreshTrigger }) => {
  const { toast } = useToast();
  const { user, isDemoMode } = useAuth();
  const [loading, setLoading] = useState(true);
  const [board, setBoard] = useState<Board | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isGeneratingSchedule, setIsGeneratingSchedule] = useState(false);

  const fetchBoardData = async () => {
    if (!user) return;
    
    setLoading(true);
    console.log('Fetching board data for user:', user.id);
    
    // Handle demo mode - use localStorage
    if (isDemoMode) {
      try {
        const demoBoard = localStorage.getItem('kanban-demo-board');
        const demoColumns = localStorage.getItem('kanban-demo-columns');
        const demoTasks = localStorage.getItem('kanban-demo-tasks');

        if (demoBoard && demoColumns) {
          setBoard(JSON.parse(demoBoard));
          setColumns(JSON.parse(demoColumns) as Column[]);
          setTasks(JSON.parse(demoTasks || '[]') as Task[]);
        } else {
          // Create demo data
          const result = await createDefaultBoardAndColumns(user.id);
          setBoard(result.board);
          setColumns(result.columns as Column[]);
          setTasks([]);
        }
      } catch (error) {
        console.error('Error loading demo data:', error);
        // Create demo data as fallback
        const result = await createDefaultBoardAndColumns(user.id);
        setBoard(result.board);
        setColumns(result.columns as Column[]);
        setTasks([]);
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
        setTasks([]);
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
        setTasks([]);
        return;
      }

      setColumns(columnsData as Column[]);

      // Fetch tasks for this board
      const { data: tasksData, error: tasksError } = await supabase
        .from('tasks')
        .select('*')
        .eq('board_id', boardData.id)
        .eq('user_id', user.id)
        .order('created_at');

      if (tasksError) {
        console.error('Error fetching tasks:', tasksError);
        throw tasksError;
      }

      console.log('Tasks data:', tasksData);
      setTasks((tasksData || []) as Task[]);
      
    } catch (error) {
      console.error('Error in fetchBoardData:', error);
      // In case of any error, try to create default board
      try {
        const result = await createDefaultBoardAndColumns(user.id);
        setBoard(result.board);
        setColumns(result.columns as Column[]);
        setTasks([]);
      } catch (createError) {
        console.error('Error creating default board:', createError);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (taskId: string, newStatus: Task['status']) => {
    try {
      const { error } = await supabase
        .from('tasks')
        .update({ 
          status: newStatus,
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

      // Update local state
      setTasks(prevTasks => 
        prevTasks.map(task => 
          task.id === taskId 
            ? { ...task, status: newStatus, completed_at: newStatus === 'DONE' ? new Date().toISOString() : task.completed_at }
            : task
        )
      );

      toast({
        title: "Task updated",
        description: `Task moved to ${statusLabels[newStatus]}`,
      });
    } catch (error) {
      console.error('Error updating task:', error);
    }
  };

  const handleDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId } = result;

    // If dropped outside or in same position, do nothing
    if (!destination || 
        (destination.droppableId === source.droppableId && destination.index === source.index)) {
      return;
    }

    // Find the column that matches the destination
    const targetColumn = columns.find(col => col.id === destination.droppableId);
    if (!targetColumn) return;

    // Update task status based on column
    await handleStatusChange(draggableId, targetColumn.status);
  };

  const handleTaskEdit = (task: Task) => {
    setSelectedTask(task);
    setIsModalOpen(true);
  };

  const handleTaskSave = (updatedTask: Task) => {
    setTasks(prevTasks => 
      prevTasks.map(task => 
        task.id === updatedTask.id ? updatedTask : task
      )
    );
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
    return tasks.filter(task => task.status === status);
  };

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
        { id: 'demo-col-2', name: 'Career', status: 'CAREER' as const, position: 1, board_id: 'demo-board-1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'demo-col-3', name: 'Prof. Education', status: 'PROF_EDUCATION' as const, position: 2, board_id: 'demo-board-1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'demo-col-4', name: 'Ventures', status: 'VENTURES' as const, position: 3, board_id: 'demo-board-1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'demo-col-5', name: 'Planning', status: 'PLANNING' as const, position: 4, board_id: 'demo-board-1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'demo-col-6', name: 'Ready', status: 'READY' as const, position: 5, board_id: 'demo-board-1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'demo-col-7', name: 'Up Next', status: 'UP_NEXT' as const, position: 6, board_id: 'demo-board-1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'demo-col-8', name: 'Doing', status: 'DOING' as const, position: 7, board_id: 'demo-board-1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        { id: 'demo-col-9', name: 'Done', status: 'DONE' as const, position: 8, board_id: 'demo-board-1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
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

      // Create default columns with new 9-column structure
      const defaultColumns = [
        { name: 'Blocked', status: 'BLOCKED' as const, position: 0 },
        { name: 'Career', status: 'CAREER' as const, position: 1 },
        { name: 'Prof. Education', status: 'PROF_EDUCATION' as const, position: 2 },
        { name: 'Ventures', status: 'VENTURES' as const, position: 3 },
        { name: 'Planning', status: 'PLANNING' as const, position: 4 },
        { name: 'Ready', status: 'READY' as const, position: 5 },
        { name: 'Up Next', status: 'UP_NEXT' as const, position: 6 },
        { name: 'Doing', status: 'DOING' as const, position: 7 },
        { name: 'Done', status: 'DONE' as const, position: 8 }
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

      // Update local state
      setTasks(prev => [demoTask, ...prev]);

      // Save to localStorage
      const currentTasks = JSON.parse(localStorage.getItem('kanban-demo-tasks') || '[]');
      currentTasks.unshift(demoTask);
      localStorage.setItem('kanban-demo-tasks', JSON.stringify(currentTasks));

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

      setTasks(prev => [data, ...prev]);
      toast({
        title: "Sample task added",
        description: "Try using the voice assistant to create more tasks!",
      });
    } catch (error) {
      console.error('Error adding sample task:', error);
    }
  };

  useEffect(() => {
    fetchBoardData();
  }, [refreshTrigger]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground mb-4">No board found. Creating your default board...</p>
        <Button onClick={fetchBoardData}>Retry</Button>
      </div>
    );
  }

  const hasAnyTasks = tasks.length > 0;

  return (
    <div className="space-y-6">
      {/* Board Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{board.name}</h1>
          {board.description && (
            <p className="text-muted-foreground mt-1">{board.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button 
            onClick={generateDailySchedule}
            disabled={isGeneratingSchedule}
            size="sm"
            className="bg-productivity hover:bg-productivity/90 text-white"
          >
            <Calendar className="h-4 w-4 mr-2" />
            {isGeneratingSchedule ? 'Generating...' : 'Schedule Tasks'}
          </Button>
          <Button variant="outline" size="sm">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Empty State */}
      {!hasAnyTasks && (
        <Card className="p-8 text-center border-dashed">
          <div className="space-y-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Plus className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-lg mb-2">Ready to get productive?</h3>
              <p className="text-muted-foreground mb-4">
                Start by creating your first task. Try using the voice assistant below!
              </p>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p><strong>Voice prompts to try:</strong></p>
                <p>"Add a task to review quarterly goals"</p>
                <p>"Create a high priority task to finish the presentation"</p>
                <p>"Add a task for EMBA homework due next week"</p>
              </div>
            </div>
            <Button onClick={addSampleTask} variant="outline">
              Add Sample Task
            </Button>
          </div>
        </Card>
      )}

      {/* Kanban Columns with Drag & Drop */}
      {hasAnyTasks && (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="flex gap-4 overflow-x-auto pb-4">
            {columns.map((column) => {
              const columnTasks = getTasksByStatus(column.status);
              
              return (
                <Card key={column.id} className={`${statusColors[column.status]} border-t-4 min-w-[280px]`}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium flex items-center justify-between">
                      <span>{column.name}</span>
                      <span className="text-xs bg-background/50 px-2 py-1 rounded-full">
                        {columnTasks.length}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Droppable droppableId={column.id}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={`space-y-3 min-h-[200px] transition-colors ${
                            snapshot.isDraggingOver ? 'bg-muted/50 rounded-lg' : ''
                          }`}
                        >
                          {columnTasks.map((task, index) => (
                            <Draggable key={task.id} draggableId={task.id} index={index}>
                              {(provided, snapshot) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  {...provided.dragHandleProps}
                                  className={`transition-transform ${
                                    snapshot.isDragging ? 'rotate-2 scale-105' : ''
                                  }`}
                                >
                                  <TaskCard
                                    task={task}
                                    onStatusChange={handleStatusChange}
                                    onEdit={handleTaskEdit}
                                  />
                                </div>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                          {columnTasks.length === 0 && (
                            <div className="text-center py-8 text-muted-foreground text-xs">
                              Drop tasks here or no tasks in {column.name.toLowerCase()}
                            </div>
                          )}
                        </div>
                      )}
                    </Droppable>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </DragDropContext>
      )}
      {/* Task Detail Modal */}
      <TaskDetailModal
        task={selectedTask}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedTask(null);
        }}
        onSave={handleTaskSave}
        allTasks={tasks}
      />
    </div>
  );
};

export default KanbanBoard;