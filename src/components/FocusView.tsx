import React, { useState } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { format, parseISO, isToday, formatDistanceToNow, setHours, setMinutes, addMinutes } from 'date-fns';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  ChevronUp
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Task } from '@/types/task';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { DEFAULT_SCHEDULING_CONFIG } from '@/config/schedulingRules';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

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
  const today = new Date();
  const config = DEFAULT_SCHEDULING_CONFIG;

  // Filter task groups
  const doingTasks = tasks.filter(t => t.status === 'DOING');
  
  const upNextTasks = tasks
    .filter(t => 
      t.status === 'UP_NEXT' || 
      (t.status === 'READY' && ['URGENT', 'HIGH'].includes(t.priority)) ||
      (t.status === 'TODO' && t.priority === 'URGENT')
    )
    .sort((a, b) => {
      // Sort by priority first
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
    t.start_time && isToday(parseISO(t.start_time))
  ).sort((a, b) => {
    if (!a.start_time || !b.start_time) return 0;
    return new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
  });

  // Group scheduled tasks by time window
  const getTimeWindowForTask = (task: Task): string | null => {
    if (!task.start_time) return null;
    const taskHour = parseISO(task.start_time).getHours();
    const dayOfWeek = today.getDay();
    
    const windows = config.timeWindows;
    if (windows.morning.days.includes(dayOfWeek) && taskHour >= windows.morning.start && taskHour < windows.morning.end) {
      return 'morning';
    }
    if (windows.business_hours.days.includes(dayOfWeek) && taskHour >= windows.business_hours.start && taskHour < windows.business_hours.end) {
      return 'business_hours';
    }
    if (windows.after_work.days.includes(dayOfWeek) && taskHour >= windows.after_work.start && taskHour < windows.after_work.end) {
      return 'after_work';
    }
    if (windows.evening.days.includes(dayOfWeek) && taskHour >= windows.evening.start && taskHour < windows.evening.end) {
      return 'evening';
    }
    return null;
  };

  const tasksByWindow: Record<string, Task[]> = {
    morning: [],
    business_hours: [],
    after_work: [],
    evening: [],
  };

  scheduledToday.forEach(task => {
    const window = getTimeWindowForTask(task);
    if (window && tasksByWindow[window]) {
      tasksByWindow[window].push(task);
    }
  });

  // Schedule task at specific time
  const scheduleTaskAtTime = async (taskId: string, hour: number, minute: number) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const startTime = setMinutes(setHours(today, hour), minute);
    const estimatedMinutes = task.estimate_minutes || 60;
    const endTime = addMinutes(startTime, estimatedMinutes);

    try {
      const { error } = await supabase
        .from('tasks')
        .update({
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          status: task.status === 'UP_NEXT' ? 'TODO' : task.status,
          updated_at: new Date().toISOString()
        })
        .eq('id', taskId);

      if (error) throw error;
      
      toast.success(`Scheduled "${task.title}" for ${format(startTime, 'h:mm a')}`);
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

  // Get drop time slots for a window
  const getDropSlotsForWindow = (windowName: string) => {
    const window = config.timeWindows[windowName as keyof typeof config.timeWindows];
    if (!window) return [];
    
    const slots: { hour: number; minute: number; label: string }[] = [];
    for (let hour = window.start; hour < window.end; hour++) {
      for (const minute of [0, 30]) {
        slots.push({
          hour,
          minute,
          label: format(setMinutes(setHours(today, hour), minute), 'h:mm a')
        });
      }
    }
    return slots;
  };

  const displayedUpNext = showAllUpNext ? upNextTasks : upNextTasks.slice(0, 5);

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Timeline - 2/3 width on desktop */}
        <div className="lg:col-span-2 order-2 lg:order-1">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-primary" />
                  <h2 className="text-lg font-semibold">Today's Schedule</h2>
                  <Badge variant="secondary">{scheduledToday.length} scheduled</Badge>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsTimelineExpanded(!isTimelineExpanded)}
                  className="lg:hidden"
                >
                  {isTimelineExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </div>
            </CardHeader>
            
            <Collapsible open={isTimelineExpanded} onOpenChange={setIsTimelineExpanded}>
              <CollapsibleContent>
                <CardContent className="pt-0">
                  <ScrollArea className="h-[400px] lg:h-[500px]">
                    <div className="space-y-4">
                      {Object.entries(timeWindowStyles).map(([windowName, style]) => {
                        const windowTasks = tasksByWindow[windowName] || [];
                        const dropSlots = getDropSlotsForWindow(windowName);
                        
                        return (
                          <div key={windowName} className={cn("rounded-lg overflow-hidden", style.bgClass)}>
                            {/* Window Header */}
                            <div className={cn("p-3 flex items-center gap-2", style.borderClass)}>
                              <span className={style.textClass}>{style.icon}</span>
                              <span className={cn("font-medium text-sm", style.textClass)}>{style.label}</span>
                              <span className="text-xs text-muted-foreground ml-auto">
                                {config.timeWindows[windowName as keyof typeof config.timeWindows]?.start}:00 - {config.timeWindows[windowName as keyof typeof config.timeWindows]?.end}:00
                              </span>
                            </div>
                            
                            {/* Tasks in Window */}
                            <div className="p-2 space-y-2">
                              {windowTasks.length > 0 ? (
                                windowTasks.map(task => (
                                  <div 
                                    key={task.id}
                                    className="bg-card rounded-md p-3 shadow-sm border cursor-pointer hover:shadow-md transition-shadow"
                                    onClick={() => onTaskEdit(task)}
                                  >
                                    <div className="flex items-center gap-2">
                                      <Checkbox
                                        checked={task.status === 'DONE'}
                                        onCheckedChange={(checked) => {
                                          if (checked) handleCompleteTask(task.id);
                                          else onStatusChange(task.id, 'TODO');
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                      />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                          <span className="text-xs text-muted-foreground">
                                            {task.start_time && format(parseISO(task.start_time), 'h:mm a')}
                                          </span>
                                          <span className={cn("font-medium text-sm truncate", task.status === 'DONE' && 'line-through text-muted-foreground')}>
                                            {task.title}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-2 mt-1">
                                          <Badge variant="outline" className={cn("text-xs", categoryColors[task.category])}>
                                            {task.category.toLowerCase()}
                                          </Badge>
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
                                ))
                              ) : (
                                <Droppable droppableId={`timeslot-${dropSlots[0]?.hour || config.timeWindows[windowName as keyof typeof config.timeWindows]?.start}-0`}>
                                  {(provided, snapshot) => (
                                    <div
                                      ref={provided.innerRef}
                                      {...provided.droppableProps}
                                      className={cn(
                                        "p-4 border-2 border-dashed rounded-md text-center text-sm text-muted-foreground transition-colors",
                                        snapshot.isDraggingOver ? "border-primary bg-primary/5" : "border-muted"
                                      )}
                                    >
                                      <span>Drop task here to schedule</span>
                                      {provided.placeholder}
                                    </div>
                                  )}
                                </Droppable>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        </div>
        
        {/* Sidebar - 1/3 width */}
        <div className="space-y-6 order-1 lg:order-2">
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
              <div className="flex items-center gap-2">
                <ListOrdered className="h-5 w-5 text-blue-500" />
                <h2 className="text-lg font-semibold">Up Next</h2>
                <Badge variant="secondary">{upNextTasks.length}</Badge>
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
                              snapshot.isDragging && "shadow-lg ring-2 ring-primary"
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
                                  <Badge variant="outline" className={cn("text-xs", categoryColors[task.category])}>
                                    {task.category.toLowerCase()}
                                  </Badge>
                                  <Badge variant="outline" className={cn("text-xs", priorityBadgeColors[task.priority])}>
                                    {task.priority.toLowerCase()}
                                  </Badge>
                                  {task.due_date && (
                                    <span className="text-xs text-muted-foreground">
                                      Due {format(parseISO(task.due_date), 'MMM d')}
                                    </span>
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
    </DragDropContext>
  );
};

export default FocusView;
