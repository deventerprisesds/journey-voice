import React, { useMemo } from 'react';
import { format, addDays, startOfWeek, parseISO, isToday, isSameDay } from 'date-fns';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sunrise,
  Coffee,
  Sunset,
  Moon,
  Clock,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Task } from '@/types/task';
import { DEFAULT_SCHEDULING_CONFIG } from '@/config/schedulingRules';
import { getTimePartsInTimezone, getDefaultTimezone } from '@/lib/date';

interface WeeklyAgendaViewProps {
  tasks: Task[];
  onTaskEdit: (task: Task) => void;
  onStatusChange: (taskId: string, newStatus: Task['status']) => void;
  onTaskUpdate: () => void;
}

const timeWindowStyles: Record<string, {
  icon: React.ReactNode;
  label: string;
  bgClass: string;
  borderClass: string;
  textClass: string;
}> = {
  morning: {
    icon: <Sunrise className="h-3.5 w-3.5" />,
    label: 'Morning',
    bgClass: 'bg-amber-50 dark:bg-amber-950/20',
    borderClass: 'border-l-2 border-l-amber-400',
    textClass: 'text-amber-700 dark:text-amber-300',
  },
  business_hours: {
    icon: <Coffee className="h-3.5 w-3.5" />,
    label: 'Business',
    bgClass: 'bg-blue-50 dark:bg-blue-950/20',
    borderClass: 'border-l-2 border-l-blue-400',
    textClass: 'text-blue-700 dark:text-blue-300',
  },
  after_work: {
    icon: <Sunset className="h-3.5 w-3.5" />,
    label: 'After Work',
    bgClass: 'bg-orange-50 dark:bg-orange-950/20',
    borderClass: 'border-l-2 border-l-orange-400',
    textClass: 'text-orange-700 dark:text-orange-300',
  },
  evening: {
    icon: <Moon className="h-3.5 w-3.5" />,
    label: 'Evening',
    bgClass: 'bg-purple-50 dark:bg-purple-950/20',
    borderClass: 'border-l-2 border-l-purple-400',
    textClass: 'text-purple-700 dark:text-purple-300',
  },
};

const priorityBadgeColors: Record<string, string> = {
  LOW: 'bg-priority-low/10 text-priority-low border-priority-low/20',
  MEDIUM: 'bg-priority-medium/10 text-priority-medium border-priority-medium/20',
  HIGH: 'bg-priority-high/10 text-priority-high border-priority-high/20',
  URGENT: 'bg-priority-urgent/10 text-priority-urgent border-priority-urgent/20',
};

const categoryColors: Record<string, string> = {
  LIFE: 'bg-category-life/10 text-category-life border-category-life/20',
  CAREER: 'bg-category-career/10 text-category-career border-category-career/20',
  VENTURES: 'bg-category-ventures/10 text-category-ventures border-category-ventures/20',
  EDUCATION: 'bg-category-education/10 text-category-education border-category-education/20',
  PROF_EDUCATION: 'bg-category-education/10 text-category-education border-category-education/20',
};

const WeeklyAgendaView: React.FC<WeeklyAgendaViewProps> = ({
  tasks,
  onTaskEdit,
  onStatusChange,
  onTaskUpdate,
}) => {
  const [weekOffset, setWeekOffset] = React.useState(0);
  const config = DEFAULT_SCHEDULING_CONFIG;
  const userTimezone = getDefaultTimezone();

  const weekStart = useMemo(() => {
    const base = startOfWeek(new Date(), { weekStartsOn: 1 }); // Monday
    return addDays(base, weekOffset * 7);
  }, [weekOffset]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  const getTimeWindowForTask = (task: Task, day: Date): string | null => {
    if (!task.start_time) return null;
    const { hour: taskHour } = getTimePartsInTimezone(task.start_time, userTimezone);
    const dayOfWeek = day.getDay();
    const windows = config.timeWindows;

    if (windows.morning.days.includes(dayOfWeek) && taskHour >= windows.morning.start && taskHour < windows.morning.end) return 'morning';
    if (windows.business_hours.days.includes(dayOfWeek) && taskHour >= windows.business_hours.start && taskHour < windows.business_hours.end) return 'business_hours';
    if (windows.after_work.days.includes(dayOfWeek) && taskHour >= windows.after_work.start && taskHour < windows.after_work.end) return 'after_work';
    if (windows.evening.days.includes(dayOfWeek) && taskHour >= windows.evening.start && taskHour < windows.evening.end) return 'evening';
    return null;
  };

  // Group tasks by day and time window
  const tasksByDay = useMemo(() => {
    const map: Record<string, Record<string, Task[]>> = {};
    weekDays.forEach(day => {
      const key = format(day, 'yyyy-MM-dd');
      map[key] = { morning: [], business_hours: [], after_work: [], evening: [], unscheduled: [] };
    });

    tasks.forEach(task => {
      if (!task.start_time || task.status === 'DONE') return;
      const taskDate = parseISO(task.start_time);
      const dayKey = format(taskDate, 'yyyy-MM-dd');
      if (!map[dayKey]) return;

      const window = getTimeWindowForTask(task, taskDate);
      if (window && map[dayKey][window]) {
        map[dayKey][window].push(task);
      } else {
        map[dayKey].unscheduled.push(task);
      }
    });

    return map;
  }, [tasks, weekDays, userTimezone]);

  const handleComplete = (taskId: string) => {
    onStatusChange(taskId, 'DONE');
  };

  return (
    <div className="space-y-4">
      {/* Week Navigation */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => setWeekOffset(w => w - 1)}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Prev
        </Button>
        <div className="text-center">
          <h2 className="text-sm font-semibold">
            {format(weekDays[0], 'MMM d')} – {format(weekDays[6], 'MMM d, yyyy')}
          </h2>
          {weekOffset !== 0 && (
            <Button variant="link" size="sm" className="text-xs p-0 h-auto" onClick={() => setWeekOffset(0)}>
              Back to this week
            </Button>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setWeekOffset(w => w + 1)}>
          Next <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>

      {/* Mobile: stacked days */}
      <ScrollArea className="h-[calc(100vh-220px)]">
        <div className="space-y-3">
          {weekDays.map(day => {
            const dayKey = format(day, 'yyyy-MM-dd');
            const dayTasks = tasksByDay[dayKey] || {};
            const totalForDay = Object.values(dayTasks).flat().length;
            const today = isToday(day);

            return (
              <Card key={dayKey} className={cn(today && 'ring-2 ring-primary/50')}>
                <CardHeader className="pb-2 pt-3 px-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-sm font-semibold",
                        today && "text-primary"
                      )}>
                        {format(day, 'EEE, MMM d')}
                      </span>
                      {today && <Badge variant="default" className="text-xs px-1.5 py-0">Today</Badge>}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {totalForDay} task{totalForDay !== 1 ? 's' : ''}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 px-3 pb-3">
                  {totalForDay === 0 ? (
                    <div className="py-4 text-center text-xs text-muted-foreground border-2 border-dashed border-muted rounded-md">
                      <Plus className="h-4 w-4 mx-auto mb-1 opacity-50" />
                      No tasks scheduled
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {Object.entries(timeWindowStyles).map(([windowName, style]) => {
                        const windowTasks = dayTasks[windowName] || [];
                        if (windowTasks.length === 0) return null;

                        return (
                          <div key={windowName} className={cn("rounded-md", style.bgClass, style.borderClass)}>
                            <div className="px-2 py-1 flex items-center gap-1.5">
                              <span className={style.textClass}>{style.icon}</span>
                              <span className={cn("text-xs font-medium", style.textClass)}>{style.label}</span>
                            </div>
                            <div className="px-2 pb-2 space-y-1">
                              {windowTasks.map(task => (
                                <div
                                  key={task.id}
                                  className="bg-card rounded px-2 py-1.5 shadow-sm border cursor-pointer hover:shadow-md transition-shadow"
                                  onClick={() => onTaskEdit(task)}
                                >
                                  <div className="flex items-start gap-2">
                                    <Checkbox
                                      checked={task.status === 'DONE'}
                                      onCheckedChange={() => handleComplete(task.id)}
                                      onClick={(e) => e.stopPropagation()}
                                      className="mt-0.5 h-3.5 w-3.5"
                                    />
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-xs text-muted-foreground flex-shrink-0">
                                          {task.start_time && format(parseISO(task.start_time), 'h:mm a')}
                                        </span>
                                        <span className="text-xs font-medium truncate">{task.title}</span>
                                      </div>
                                      <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                        <Badge variant="outline" className={cn("text-[10px] px-1 py-0", categoryColors[task.category])}>
                                          {task.category.toLowerCase()}
                                        </Badge>
                                        {task.pushed_count && task.pushed_count > 0 && (
                                          <Badge variant="outline" className="text-[10px] px-1 py-0 bg-destructive/10 text-destructive border-destructive/20">
                                            <RotateCcw className="h-2.5 w-2.5 mr-0.5" />
                                            ×{task.pushed_count}
                                          </Badge>
                                        )}
                                        {task.estimate_minutes && (
                                          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                            <Clock className="h-2.5 w-2.5" />
                                            {task.estimate_minutes}m
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
};

export default WeeklyAgendaView;
