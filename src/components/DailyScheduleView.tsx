import React, { useState, useEffect } from 'react';
import { format, startOfDay, endOfDay, parseISO, isSameDay, addDays, subDays } from 'date-fns';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, Clock, Calendar as CalendarIcon, Plus } from 'lucide-react';
import { Task } from '@/types/task';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import TaskCard from '@/components/TaskCard';
import TaskCreationModal from '@/components/TaskCreationModal';

interface DailyScheduleViewProps {
  tasks: Task[];
  selectedDate: Date;
  onDateChange: (date: Date) => void;
  onTaskUpdate: () => void;
}

const DailyScheduleView: React.FC<DailyScheduleViewProps> = ({
  tasks,
  selectedDate,
  onDateChange,
  onTaskUpdate
}) => {
  const { user } = useAuth();
  const [isCreating, setIsCreating] = useState(false);
  const [defaultBoardId, setDefaultBoardId] = useState<string | null>(null);

  // Get default board for task creation
  useEffect(() => {
    const fetchDefaultBoard = async () => {
      if (!user) return;
      
      const { data, error } = await supabase
        .from('boards')
        .select('id')
        .eq('user_id', user.id)
        .eq('is_default', true)
        .single();

      if (data) {
        setDefaultBoardId(data.id);
      } else if (error) {
        // If no default board, get the first board
        const { data: firstBoard } = await supabase
          .from('boards')
          .select('id')
          .eq('user_id', user.id)
          .limit(1)
          .single();
        
        if (firstBoard) {
          setDefaultBoardId(firstBoard.id);
        }
      }
    };

    fetchDefaultBoard();
  }, [user]);

  // Filter tasks for today
  const scheduledTasks = tasks.filter(task => {
    if (!task.start_time) return false;
    const taskDate = parseISO(task.start_time);
    return isSameDay(taskDate, selectedDate);
  }).sort((a, b) => {
    if (!a.start_time || !b.start_time) return 0;
    return parseISO(a.start_time).getTime() - parseISO(b.start_time).getTime();
  });

  // Unscheduled tasks (no start_time or end_time)
  const unscheduledTasks = tasks.filter(task => 
    !task.start_time && task.status !== 'DONE'
  ).sort((a, b) => {
    const priorityOrder = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return (priorityOrder[a.priority as keyof typeof priorityOrder] || 4) - 
           (priorityOrder[b.priority as keyof typeof priorityOrder] || 4);
  });

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return;

    const { source, destination, draggableId } = result;

    // Moving from unscheduled to scheduled
    if (source.droppableId === 'unscheduled' && destination.droppableId === 'scheduled') {
      const task = tasks.find(t => t.id === draggableId);
      if (!task) return;

      // Schedule task with default time (9 AM for 1 hour)
      const startTime = new Date(selectedDate);
      startTime.setHours(9, 0, 0, 0);
      const endTime = new Date(startTime);
      endTime.setHours(10, 0, 0, 0);

      try {
        const { error } = await supabase
          .from('tasks')
          .update({
            start_time: startTime.toISOString(),
            end_time: endTime.toISOString(),
            status: 'TODO'
          })
          .eq('id', draggableId);

        if (error) throw error;
        toast.success('Task scheduled');
        onTaskUpdate();
      } catch (error) {
        console.error('Error scheduling task:', error);
        toast.error('Failed to schedule task');
      }
    }

    // Moving from scheduled to unscheduled
    if (source.droppableId === 'scheduled' && destination.droppableId === 'unscheduled') {
      try {
        const { error } = await supabase
          .from('tasks')
          .update({
            start_time: null,
            end_time: null,
            status: 'BACKLOG'
          })
          .eq('id', draggableId);

        if (error) throw error;
        toast.success('Task unscheduled');
        onTaskUpdate();
      } catch (error) {
        console.error('Error unscheduling task:', error);
        toast.error('Failed to unschedule task');
      }
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'URGENT': return 'destructive';
      case 'HIGH': return 'default';
      case 'MEDIUM': return 'secondary';
      case 'LOW': return 'outline';
      default: return 'outline';
    }
  };

  const formatTime = (dateString: string) => {
    return format(parseISO(dateString), 'h:mm a');
  };

  return (
    <div className="space-y-6">
      {/* Date Navigation */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onDateChange(subDays(selectedDate, 1))}
          >
            <ChevronLeft className="w-4 h-4 mr-2" />
            Previous Day
          </Button>

          <div className="flex items-center gap-2">
            <CalendarIcon className="w-5 h-5 text-muted-foreground" />
            <span className="font-semibold">
              {format(selectedDate, 'EEEE, MMMM d')}
            </span>
            {isSameDay(selectedDate, new Date()) && (
              <Badge variant="default">Today</Badge>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => onDateChange(addDays(selectedDate, 1))}
          >
            Next Day
            <ChevronRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </Card>

      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Scheduled Tasks */}
          <div className="lg:col-span-2">
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <Clock className="w-5 h-5" />
                  Scheduled Tasks
                  <Badge variant="secondary">{scheduledTasks.length}</Badge>
                </h2>
                <Button 
                  size="sm"
                  onClick={() => setIsCreating(true)}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  New Task
                </Button>
              </div>

              <Droppable droppableId="scheduled">
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`space-y-3 min-h-[400px] p-4 rounded-lg border-2 border-dashed transition-colors ${
                      snapshot.isDraggingOver ? 'border-primary bg-accent/50' : 'border-border'
                    }`}
                  >
                    {scheduledTasks.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                        <Clock className="w-12 h-12 mb-2 opacity-50" />
                        <p>No scheduled tasks for this day</p>
                        <p className="text-sm">Drag tasks here to schedule them</p>
                      </div>
                    ) : (
                      scheduledTasks.map((task, index) => (
                        <Draggable key={task.id} draggableId={task.id} index={index}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className={snapshot.isDragging ? 'opacity-50' : ''}
                            >
                              <Card className="p-4 hover:shadow-md transition-shadow">
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-2">
                                      <Badge variant={getPriorityColor(task.priority)}>
                                        {task.priority}
                                      </Badge>
                                      {task.category && (
                                        <Badge variant="outline">{task.category}</Badge>
                                      )}
                                      <span className="text-sm text-muted-foreground">
                                        {task.start_time && task.end_time && 
                                          `${formatTime(task.start_time)} - ${formatTime(task.end_time)}`
                                        }
                                      </span>
                                    </div>
                                    <h3 className="font-semibold mb-1">{task.title}</h3>
                                    {task.description && (
                                      <p className="text-sm text-muted-foreground line-clamp-2">
                                        {task.description}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </Card>
                            </div>
                          )}
                        </Draggable>
                      ))
                    )}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </Card>
          </div>

          {/* Unscheduled Tasks */}
          <div>
            <Card className="p-6">
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                Unscheduled
                <Badge variant="secondary">{unscheduledTasks.length}</Badge>
              </h2>

              <Droppable droppableId="unscheduled">
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`space-y-3 min-h-[400px] p-4 rounded-lg border-2 border-dashed transition-colors ${
                      snapshot.isDraggingOver ? 'border-primary bg-accent/50' : 'border-border'
                    }`}
                  >
                    {unscheduledTasks.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                        <CalendarIcon className="w-12 h-12 mb-2 opacity-50" />
                        <p className="text-center">All tasks are scheduled!</p>
                      </div>
                    ) : (
                      unscheduledTasks.map((task, index) => (
                        <Draggable key={task.id} draggableId={task.id} index={index}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className={snapshot.isDragging ? 'opacity-50' : ''}
                            >
                              <Card className="p-4 hover:shadow-md transition-shadow cursor-move">
                                <div className="flex items-start justify-between">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-2">
                                      <Badge variant={getPriorityColor(task.priority)}>
                                        {task.priority}
                                      </Badge>
                                      {task.category && (
                                        <Badge variant="outline">{task.category}</Badge>
                                      )}
                                    </div>
                                    <h3 className="font-semibold mb-1">{task.title}</h3>
                                    {task.description && (
                                      <p className="text-sm text-muted-foreground line-clamp-2">
                                        {task.description}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </Card>
                            </div>
                          )}
                        </Draggable>
                      ))
                    )}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </Card>
          </div>
        </div>
      </DragDropContext>

      {/* Task Creation Modal */}
      {defaultBoardId && user && (
        <TaskCreationModal
          isOpen={isCreating}
          onClose={() => setIsCreating(false)}
          onTasksCreated={onTaskUpdate}
          boardId={defaultBoardId}
          userId={user.id}
          targetDate={selectedDate}
        />
      )}
    </div>
  );
};

export default DailyScheduleView;
