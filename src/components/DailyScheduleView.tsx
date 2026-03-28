import React, { useState, useEffect } from 'react';
import { format, startOfDay, endOfDay, parseISO, isSameDay, addDays, subDays } from 'date-fns';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChevronLeft, ChevronRight, Clock, Calendar as CalendarIcon, Plus, List, LayoutGrid } from 'lucide-react';
import { Task, ExternalCalendarEvent } from '@/types/task';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import TaskCard from '@/components/TaskCard';
import TaskCreationModal from '@/components/TaskCreationModal';
import TimeSlotGrid from '@/components/TimeSlotGrid';
import { useIsMobile } from '@/hooks/use-mobile';
import { loadUserSchedulingConfig, type SchedulingConfig } from '@/services/schedulingService';
import { DEFAULT_SCHEDULING_CONFIG } from '@/config/schedulingRules';

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
  const [isBoardLoading, setIsBoardLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [createAtTime, setCreateAtTime] = useState<{ hour: number; minute: number } | null>(null);
  const [schedulingConfig, setSchedulingConfig] = useState<SchedulingConfig>(DEFAULT_SCHEDULING_CONFIG);
  const isMobile = useIsMobile();

  // Load user's scheduling config for time windows
  useEffect(() => {
    const loadConfig = async () => {
      if (!user?.id) return;
      try {
        const config = await loadUserSchedulingConfig(user.id);
        setSchedulingConfig(config);
      } catch (error) {
        console.error('Failed to load scheduling config:', error);
      }
    };
    loadConfig();
  }, [user?.id]);

  // Get default board for task creation
  useEffect(() => {
    const fetchDefaultBoard = async () => {
      if (!user) {
        setIsBoardLoading(false);
        return;
      }
      
      setIsBoardLoading(true);
      
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
        } else {
          toast.error('No task boards found. Please create one first.');
        }
      }
      
      setIsBoardLoading(false);
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
    // Use timezone-aware formatting if available
    const tz = schedulingConfig?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
      return new Date(dateString).toLocaleTimeString('en-US', {
        timeZone: tz,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    } catch {
      return format(parseISO(dateString), 'h:mm a');
    }
  };

  const handleTimeSlotClick = (date: Date, hour: number, minute: number) => {
    setCreateAtTime({ hour, minute });
    setIsCreating(true);
  };

  // Handle task rescheduling from drag-and-drop
  const handleTaskReschedule = async (taskId: string, newStartTime: string, newEndTime: string) => {
    try {
      const { error } = await supabase
        .from('tasks')
        .update({ 
          start_time: newStartTime,
          end_time: newEndTime,
          is_scheduled: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', taskId);

      if (error) throw error;
      toast.success('Task rescheduled');
      onTaskUpdate();
    } catch (error) {
      console.error('Error rescheduling task:', error);
      toast.error('Failed to reschedule task');
    }
  };

  const handleTaskStatusChange = async (taskId: string, newStatus: Task['status']) => {
    try {
      const { error } = await supabase
        .from('tasks')
        .update({ 
          status: newStatus,
          completed_at: newStatus === 'DONE' ? new Date().toISOString() : null
        })
        .eq('id', taskId);

      if (error) throw error;
      toast.success(newStatus === 'DONE' ? 'Task completed!' : 'Task updated');
      onTaskUpdate();
    } catch (error) {
      console.error('Error updating task status:', error);
      toast.error('Failed to update task');
    }
  };

  // Category colors for badges in list view
  const categoryColors: Record<string, string> = {
    LIFE: 'bg-[hsl(var(--category-life))] text-white',
    CAREER: 'bg-[hsl(var(--category-career))] text-white',
    VENTURES: 'bg-[hsl(var(--category-ventures))] text-white',
    EDUCATION: 'bg-[hsl(var(--category-education))] text-white',
    PROF_EDUCATION: 'bg-[hsl(var(--category-education))] text-white',
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
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Scheduled Tasks - Time Grid */}
          <div className="lg:col-span-3">
            <Card className="p-4 md:p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg md:text-xl font-semibold flex items-center gap-2">
                  <Clock className="w-5 h-5" />
                  Scheduled Tasks
                  <Badge variant="secondary">{scheduledTasks.length}</Badge>
                </h2>
                <div className="flex items-center gap-2">
                  {/* View Toggle */}
                  <div className="flex items-center border rounded-md">
                    <Button
                      variant={viewMode === 'grid' ? 'default' : 'ghost'}
                      size="sm"
                      className="h-8 px-2"
                      onClick={() => setViewMode('grid')}
                    >
                      <LayoutGrid className="w-4 h-4" />
                    </Button>
                    <Button
                      variant={viewMode === 'list' ? 'default' : 'ghost'}
                      size="sm"
                      className="h-8 px-2"
                      onClick={() => setViewMode('list')}
                    >
                      <List className="w-4 h-4" />
                    </Button>
                  </div>
                  <Button 
                    size="sm"
                    disabled={isBoardLoading || !defaultBoardId}
                    onClick={() => {
                      setCreateAtTime(null);
                      setIsCreating(true);
                    }}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    {isBoardLoading ? 'Loading...' : 'New Task'}
                  </Button>
                </div>
              </div>

              {viewMode === 'grid' ? (
                /* Time Grid View */
                <ScrollArea className="h-[500px] md:h-[600px] rounded-lg border">
                  <TimeSlotGrid
                    dates={[selectedDate]}
                    tasks={scheduledTasks}
                    onTimeSlotClick={handleTimeSlotClick}
                    onTaskClick={(task) => console.log('Task clicked:', task)}
                    onStatusChange={handleTaskStatusChange}
                    onTaskReschedule={handleTaskReschedule}
                    schedulingConfig={schedulingConfig}
                    userTimezone={schedulingConfig?.timezone}
                    className="min-w-[300px]"
                  />
                </ScrollArea>
              ) : (
                /* List View (original Droppable) */
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
                                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                                        <Badge variant={getPriorityColor(task.priority)}>
                                          {task.priority}
                                        </Badge>
                                        {task.category && (
                                          <Badge className={categoryColors[task.category] || 'bg-secondary'}>
                                            {task.category}
                                          </Badge>
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
              )}
            </Card>
          </div>

          {/* Unscheduled Tasks */}
          <div className="lg:col-span-1">
            <Card className="p-4 md:p-6">
              <h2 className="text-lg md:text-xl font-semibold mb-4 flex items-center gap-2">
                Unscheduled
                <Badge variant="secondary">{unscheduledTasks.length}</Badge>
              </h2>

              <Droppable droppableId="unscheduled">
                {(provided, snapshot) => (
                  <ScrollArea className="h-[400px] md:h-[500px]">
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`space-y-3 min-h-[400px] p-2 rounded-lg border-2 border-dashed transition-colors ${
                        snapshot.isDraggingOver ? 'border-primary bg-accent/50' : 'border-border'
                      }`}
                    >
                      {unscheduledTasks.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                          <CalendarIcon className="w-12 h-12 mb-2 opacity-50" />
                          <p className="text-center text-sm">All tasks are scheduled!</p>
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
                                <Card className="p-3 hover:shadow-md transition-shadow cursor-move">
                                  <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-1 mb-1 flex-wrap">
                                        <Badge variant={getPriorityColor(task.priority)} className="text-[10px] px-1">
                                          {task.priority}
                                        </Badge>
                                        {task.category && (
                                          <Badge className={`text-[10px] px-1 ${categoryColors[task.category] || 'bg-secondary'}`}>
                                            {task.category}
                                          </Badge>
                                        )}
                                      </div>
                                      <h3 className="font-semibold text-sm mb-1">{task.title}</h3>
                                      {task.description && (
                                        <p className="text-xs text-muted-foreground line-clamp-2">
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
                  </ScrollArea>
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
