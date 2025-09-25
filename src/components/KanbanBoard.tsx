import React, { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, MoreHorizontal, Calendar, Clock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import TaskCard from './TaskCard';
import TaskDetailModal from './TaskDetailModal';
import { itineraryEngine } from '@/utils/ItineraryEngine';

interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'BACKLOG' | 'TODO' | 'DOING' | 'DONE';
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
  status: 'BACKLOG' | 'TODO' | 'DOING' | 'DONE';
}

interface KanbanBoardProps {
  refreshTrigger?: number;
}

const statusLabels = {
  BACKLOG: 'Backlog',
  TODO: 'To Do',
  DOING: 'In Progress', 
  DONE: 'Done',
};

const statusColors = {
  BACKLOG: 'border-status-backlog bg-status-backlog/5',
  TODO: 'border-status-todo bg-status-todo/5',
  DOING: 'border-status-doing bg-status-doing/5',
  DONE: 'border-status-done bg-status-done/5',
};

const KanbanBoard: React.FC<KanbanBoardProps> = ({ refreshTrigger }) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [board, setBoard] = useState<Board | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isGeneratingSchedule, setIsGeneratingSchedule] = useState(false);

  const fetchBoardData = async () => {
    try {
      setLoading(true);

      // Check if user is authenticated
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log('User not authenticated, skipping board fetch');
        setLoading(false);
        return;
      }

      // Get default board - use maybeSingle() to handle case where no board exists
      const { data: boardData, error: boardError } = await supabase
        .from('boards')
        .select('*')
        .eq('is_default', true)
        .maybeSingle();

      if (boardError) {
        console.error('Error fetching board:', boardError);
        toast({
          title: "Error loading board",
          description: "Failed to load your task board",
          variant: "destructive",
        });
        return;
      }

      // If no default board exists, show a message but don't error
      if (!boardData) {
        console.log('No default board found for user');
        toast({
          title: "No board found",
          description: "Creating your default board...",
          variant: "default",
        });
        setLoading(false);
        return;
      }

      setBoard(boardData);

      // Get columns for this board
      const { data: columnsData, error: columnsError } = await supabase
        .from('columns')
        .select('*')
        .eq('board_id', boardData.id)
        .order('position');

      if (columnsError) {
        console.error('Error fetching columns:', columnsError);
        return;
      }

      setColumns(columnsData || []);

      // Get tasks for this board
      const { data: tasksData, error: tasksError } = await supabase
        .from('tasks')
        .select('*')
        .eq('board_id', boardData.id)
        .order('created_at', { ascending: false });

      if (tasksError) {
        console.error('Error fetching tasks:', tasksError);
        return;
      }

      setTasks(tasksData || []);
    } catch (error) {
      console.error('Error in fetchBoardData:', error);
      toast({
        title: "Error",
        description: "Failed to load board data",
        variant: "destructive",
      });
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

  const addSampleTask = async () => {
    if (!board) return;

    const sampleTask = {
      title: 'Sample Task',
      description: 'This is a sample task to get you started. Try asking the voice assistant to create more tasks!',
      status: 'TODO' as const,
      priority: 'MEDIUM' as const,
      category: 'LIFE' as const,
      board_id: board.id,
      user_id: board.user_id,
    };

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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {columns.map((column) => {
              const columnTasks = getTasksByStatus(column.status);
              
              return (
                <Card key={column.id} className={`${statusColors[column.status]} border-t-4`}>
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