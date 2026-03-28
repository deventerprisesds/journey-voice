import React, { useMemo, useState, useEffect } from 'react';
import { format, addDays, startOfWeek, parseISO, isToday, isBefore, addWeeks } from 'date-fns';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
  CalendarDays,
  GraduationCap,
  Video,
  BookOpen,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { humanizeCalendarId } from '@/lib/calendarUtils';
import { Task, ExternalCalendarEvent } from '@/types/task';
import { DEFAULT_SCHEDULING_CONFIG } from '@/config/schedulingRules';
import { loadUserSchedulingConfig, type SchedulingConfig } from '@/services/schedulingService';
import { getTimePartsInTimezone, getDateInTimezone, getDefaultTimezone, formatTimeInTimezone } from '@/lib/date';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

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
  weekends: {
    icon: <CalendarDays className="h-3.5 w-3.5" />,
    label: 'Weekend',
    bgClass: 'bg-teal-50 dark:bg-teal-950/20',
    borderClass: 'border-l-2 border-l-teal-400',
    textClass: 'text-teal-700 dark:text-teal-300',
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

// ─── Sub-components ────────────────────────────────────────────

interface TaskCardProps {
  task: Task;
  onTaskEdit: (task: Task) => void;
  onComplete: (taskId: string) => void;
}

const TaskCard: React.FC<TaskCardProps> = ({ task, onTaskEdit, onComplete }) => (
  <div
    className="bg-card rounded px-2 py-1.5 shadow-sm border cursor-pointer hover:shadow-md transition-shadow"
    onClick={() => onTaskEdit(task)}
  >
    <div className="flex items-start gap-2">
      <Checkbox
        checked={task.status === 'DONE'}
        onCheckedChange={() => onComplete(task.id)}
        onClick={(e) => e.stopPropagation()}
        className="mt-0.5 h-3.5 w-3.5"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {task.start_time && (
            <span className="text-xs text-muted-foreground flex-shrink-0">
              {new Date(task.start_time).toLocaleTimeString('en-US', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, hour: 'numeric', minute: '2-digit', hour12: true })}
            </span>
          )}
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
);

// ─── Agenda Tab (existing logic) ───────────────────────────────

interface AgendaTabProps {
  tasks: Task[];
  weekDays: Date[];
  externalEvents: (ExternalCalendarEvent & { calendar_connections?: { provider: string; provider_account_email: string } })[];
  config: SchedulingConfig;
  userTimezone: string;
  onTaskEdit: (task: Task) => void;
  onComplete: (taskId: string) => void;
}

const AgendaTab: React.FC<AgendaTabProps> = ({ tasks, weekDays, externalEvents, config, userTimezone, onTaskEdit, onComplete }) => {

  const getTimeWindowForTask = (startTime: string, day: Date): string | null => {
    const { hour: taskHour } = getTimePartsInTimezone(startTime, userTimezone);
    const dayOfWeek = day.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) return 'weekends';
    const windows = config.timeWindows;
    for (const [name, win] of Object.entries(windows)) {
      if (name === 'flexible' || name === 'weekends') continue;
      if (win.days?.includes(dayOfWeek) && taskHour >= win.start && taskHour < win.end) return name;
    }
    return null;
  };

  const tasksByDay = useMemo(() => {
    const map: Record<string, Record<string, (Task | (ExternalCalendarEvent & { _isExternal: true; calendar_connections?: any }))[]>> = {};
    weekDays.forEach(day => {
      const key = format(day, 'yyyy-MM-dd');
      map[key] = { morning: [], business_hours: [], after_work: [], evening: [], weekends: [], unscheduled: [] };
    });
    // Bucket tasks using timezone-aware date comparison
    tasks.forEach(task => {
      if (!task.start_time || task.status === 'DONE') return;
      const dayKey = getDateInTimezone(task.start_time, userTimezone);
      if (!map[dayKey]) return;
      const window = getTimeWindowForTask(task.start_time, parseISO(dayKey));
      if (window && map[dayKey][window]) {
        map[dayKey][window].push(task);
      } else {
        map[dayKey].unscheduled.push(task);
      }
    });
    // Bucket external events into the same day/window structure
    externalEvents.forEach(evt => {
      const dayKey = getDateInTimezone(evt.start_time, userTimezone);
      if (!map[dayKey]) return;
      const window = getTimeWindowForTask(evt.start_time, parseISO(dayKey));
      const extItem = { ...evt, _isExternal: true as const };
      if (window && map[dayKey][window]) {
        map[dayKey][window].push(extItem as any);
      } else {
        map[dayKey].unscheduled.push(extItem as any);
      }
    });
    return map;
  }, [tasks, weekDays, externalEvents, userTimezone, config]);

  return (
    <div className="space-y-3">
      {weekDays.map(day => {
        const dayKey = format(day, 'yyyy-MM-dd');
        const dayTasks = tasksByDay[dayKey] || {};
        const totalForDay = Object.values(dayTasks).flat().length;
        const today = isToday(day);
        const dayOfWeek = day.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const relevantWindows = isWeekend
          ? ['weekends']
          : ['morning', 'business_hours', 'after_work', 'evening'];

        return (
          <Card key={dayKey} className={cn(today && 'ring-2 ring-primary/50')}>
            <CardHeader className="pb-2 pt-3 px-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={cn("text-sm font-semibold", today && "text-primary")}>
                    {format(day, 'EEE, MMM d')}
                  </span>
                  {today && <Badge variant="default" className="text-xs px-1.5 py-0">Today</Badge>}
                </div>
                <span className="text-xs text-muted-foreground">
                  {totalForDay} item{totalForDay !== 1 ? 's' : ''}
                </span>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-3 pb-3">
              {totalForDay === 0 ? (
                <div className="py-4 text-center text-xs text-muted-foreground border-2 border-dashed border-muted rounded-md">
                  <Plus className="h-4 w-4 mx-auto mb-1 opacity-50" />
                  No items scheduled
                </div>
              ) : (
                <div className="space-y-2">
                  {relevantWindows.map(windowName => {
                    const style = timeWindowStyles[windowName];
                    const windowItems = dayTasks[windowName] || [];
                    if (!style || windowItems.length === 0) return null;
                    return (
                      <div key={windowName} className={cn("rounded-md", style.bgClass, style.borderClass)}>
                        <div className="px-2 py-1 flex items-center gap-1.5">
                          <span className={style.textClass}>{style.icon}</span>
                          <span className={cn("text-xs font-medium", style.textClass)}>{style.label}</span>
                        </div>
                        <div className="px-2 pb-2 space-y-1">
                          {windowItems.map((item: any) => {
                            if (item._isExternal) {
                              // External event card
                              const conn = item.calendar_connections;
                              const provider = conn?.provider || 'calendar';
                              const isOutlook = provider === 'outlook' || provider === 'office365';
                              return (
                                <div
                                  key={`ext-${item.id}`}
                                  className={cn(
                                    "bg-card rounded px-2 py-1.5 shadow-sm border-l-2",
                                    provider === 'google' ? "border-l-blue-400 bg-blue-50/50 dark:bg-blue-950/20" : "border-l-cyan-400 bg-cyan-50/50 dark:bg-cyan-950/20"
                                  )}
                                >
                                  <div className="flex items-center gap-1.5">
                                    <Video className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                    <span className="text-xs text-muted-foreground flex-shrink-0">
                                      {formatTimeInTimezone(item.start_time, userTimezone)} – {formatTimeInTimezone(item.end_time, userTimezone)}
                                    </span>
                                    <span className="text-xs font-medium truncate">{item.title || 'Untitled Event'}</span>
                                  </div>
                                  <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                    <Badge variant="outline" className={cn("text-[10px] px-1 py-0",
                                      provider === 'google' ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                                        : "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300"
                                    )}>
                                      {conn?.provider_account_email || (isOutlook ? 'Outlook' : 'Google')}
                                    </Badge>
                                    {item.calendar_id && (
                                      <span className="text-[10px] text-muted-foreground truncate max-w-[100px]">
                                        {humanizeCalendarId(item.calendar_id)}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            }
                            return (
                              <TaskCard key={item.id} task={item} onTaskEdit={onTaskEdit} onComplete={onComplete} />
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  {(dayTasks.unscheduled || []).length > 0 && (
                    <div className="rounded-md bg-muted/30 border-l-2 border-l-muted-foreground/30">
                      <div className="px-2 py-1 flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs font-medium text-muted-foreground">Unscheduled</span>
                      </div>
                      <div className="px-2 pb-2 space-y-1">
                        {dayTasks.unscheduled.map((item: any) => {
                          if (item._isExternal) return null; // External without window — unlikely but skip
                          return (
                            <TaskCard key={item.id} task={item} onTaskEdit={onTaskEdit} onComplete={onComplete} />
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

// ─── Meetings Tab ──────────────────────────────────────────────

interface MeetingsTabProps {
  weekDays: Date[];
  externalEvents: (ExternalCalendarEvent & { calendar_connections?: { provider: string; provider_account_email: string } })[];
  userTimezone: string;
}

const MeetingsTab: React.FC<MeetingsTabProps> = ({ weekDays, externalEvents, userTimezone }) => {
  const eventsByDay = useMemo(() => {
    const map: Record<string, typeof externalEvents> = {};
    weekDays.forEach(day => {
      map[format(day, 'yyyy-MM-dd')] = [];
    });
    externalEvents.forEach(evt => {
      const dayKey = getDateInTimezone(evt.start_time, userTimezone);
      if (map[dayKey]) map[dayKey].push(evt);
    });
    return map;
  }, [weekDays, externalEvents]);

  const getProviderStyle = (provider?: string) => {
    const isOutlook = provider === 'outlook' || provider === 'office365';
    if (provider === 'google') return { bg: 'bg-blue-50 dark:bg-blue-950/30', border: 'border-l-blue-400', badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' };
    return { bg: 'bg-cyan-50 dark:bg-cyan-950/30', border: 'border-l-cyan-400', badge: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300' };
  };

  return (
    <div className="space-y-3">
      {weekDays.map(day => {
        const dayKey = format(day, 'yyyy-MM-dd');
        const events = eventsByDay[dayKey] || [];
        const today = isToday(day);

        return (
          <Card key={dayKey} className={cn(today && 'ring-2 ring-primary/50')}>
            <CardHeader className="pb-2 pt-3 px-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={cn("text-sm font-semibold", today && "text-primary")}>
                    {format(day, 'EEE, MMM d')}
                  </span>
                  {today && <Badge variant="default" className="text-xs px-1.5 py-0">Today</Badge>}
                </div>
                <span className="text-xs text-muted-foreground">
                  {events.length} meeting{events.length !== 1 ? 's' : ''}
                </span>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-3 pb-3">
              {events.length === 0 ? (
                <div className="py-4 text-center text-xs text-muted-foreground border-2 border-dashed border-muted rounded-md">
                  <Video className="h-4 w-4 mx-auto mb-1 opacity-50" />
                  No meetings
                </div>
              ) : (
                <div className="space-y-1.5">
                  {events
                    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
                    .map(evt => {
                      const conn = evt.calendar_connections;
                      const styles = getProviderStyle(conn?.provider);
                      return (
                        <div
                          key={evt.id}
                          className={cn("rounded-md px-2.5 py-2 border-l-2", styles.bg, styles.border)}
                        >
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-xs text-muted-foreground flex-shrink-0">
                              {formatTimeInTimezone(evt.start_time, userTimezone)} – {formatTimeInTimezone(evt.end_time, userTimezone)}
                            </span>
                          </div>
                          <p className="text-xs font-medium truncate">{evt.title || 'Untitled Event'}</p>
                          <div className="flex items-center gap-1 mt-1 flex-wrap">
                            <Badge variant="outline" className={cn("text-[10px] px-1 py-0", styles.badge)}>
                              {conn?.provider_account_email || (conn?.provider === 'google' ? 'Google' : 'Outlook')}
                            </Badge>
                            {evt.calendar_id && (
                              <span className="text-[10px] text-muted-foreground truncate max-w-[140px]">
                                {humanizeCalendarId(evt.calendar_id)}
                              </span>
                            )}
                            {evt.location && (
                              <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                                📍 {evt.location}
                              </span>
                            )}
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
  );
};

// ─── Assignments Tab ───────────────────────────────────────────

interface AssignmentsTabProps {
  tasks: Task[];
  onTaskEdit: (task: Task) => void;
  onComplete: (taskId: string) => void;
}

const getAssignmentSource = (task: Task): string => {
  const ctx = task.scheduling_context;
  if (ctx?.source) return ctx.source;
  if (task.category === 'PROF_EDUCATION') return 'EMBA';
  if (task.category === 'EDUCATION') return 'MIT';
  return 'Other';
};

const AssignmentsTab: React.FC<AssignmentsTabProps> = ({ tasks, onComplete, onTaskEdit }) => {
  const assignmentTasks = useMemo(
    () => tasks.filter(t => t.assignment_id || t.scheduling_context?.source),
    [tasks]
  );

  const twoWeeksOut = addWeeks(new Date(), 2);

  const upNext = useMemo(
    () => assignmentTasks
      .filter(t => t.status !== 'DONE' && t.due_date && isBefore(parseISO(t.due_date), twoWeeksOut))
      .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime()),
    [assignmentTasks]
  );

  const byClass = useMemo(() => {
    const upNextIds = new Set(upNext.map(t => t.id));
    const remaining = assignmentTasks.filter(t => !upNextIds.has(t.id) && t.status !== 'DONE');
    const groups: Record<string, Task[]> = {};
    remaining.forEach(t => {
      const source = getAssignmentSource(t);
      if (!groups[source]) groups[source] = [];
      groups[source].push(t);
    });
    return groups;
  }, [assignmentTasks, upNext]);

  const sourceStyles: Record<string, { icon: React.ReactNode; badge: string }> = {
    EMBA: { icon: <GraduationCap className="h-3.5 w-3.5" />, badge: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' },
    MIT: { icon: <BookOpen className="h-3.5 w-3.5" />, badge: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
    Other: { icon: <GraduationCap className="h-3.5 w-3.5" />, badge: 'bg-muted text-muted-foreground' },
  };

  if (assignmentTasks.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        <GraduationCap className="h-8 w-8 mx-auto mb-2 opacity-40" />
        No assignment tasks found. Tap Sync in the Focus View to pull assignments.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Up Next */}
      {upNext.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-3 px-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Up Next — Due within 2 weeks</span>
              <Badge variant="secondary" className="text-xs">{upNext.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0 px-3 pb-3 space-y-1.5">
            {upNext.map(task => {
              const source = getAssignmentSource(task);
              const style = sourceStyles[source] || sourceStyles.Other;
              return (
                <div
                  key={task.id}
                  className="bg-card rounded px-2.5 py-2 shadow-sm border cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => onTaskEdit(task)}
                >
                  <div className="flex items-start gap-2">
                    <Checkbox
                      checked={task.status === 'DONE'}
                      onCheckedChange={() => onComplete(task.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-0.5 h-3.5 w-3.5"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{task.title}</p>
                      <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                        <Badge variant="outline" className={cn("text-[10px] px-1 py-0", style.badge)}>
                          {source}
                        </Badge>
                        {task.due_date && (
                          <span className="text-[10px] text-muted-foreground">
                            Due {format(parseISO(task.due_date), 'MMM d')}
                          </span>
                        )}
                        <Badge variant="outline" className={cn("text-[10px] px-1 py-0", priorityBadgeColors[task.priority])}>
                          {task.priority.toLowerCase()}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* By Class */}
      {Object.entries(byClass).map(([source, classTasks]) => {
        const style = sourceStyles[source] || sourceStyles.Other;
        return (
          <Card key={source}>
            <CardHeader className="pb-2 pt-3 px-3">
              <div className="flex items-center gap-2">
                {style.icon}
                <span className="text-sm font-semibold">{source}</span>
                <Badge variant="secondary" className="text-xs">{classTasks.length}</Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0 px-3 pb-3 space-y-1.5">
              {classTasks
                .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''))
                .map(task => (
                  <div
                    key={task.id}
                    className="bg-card rounded px-2.5 py-2 shadow-sm border cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => onTaskEdit(task)}
                  >
                    <div className="flex items-start gap-2">
                      <Checkbox
                        checked={task.status === 'DONE'}
                        onCheckedChange={() => onComplete(task.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-0.5 h-3.5 w-3.5"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{task.title}</p>
                        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                          {task.due_date && (
                            <span className="text-[10px] text-muted-foreground">
                              Due {format(parseISO(task.due_date), 'MMM d')}
                            </span>
                          )}
                          <Badge variant="outline" className={cn("text-[10px] px-1 py-0", priorityBadgeColors[task.priority])}>
                            {task.priority.toLowerCase()}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

// ─── Main Component ────────────────────────────────────────────

const WeeklyAgendaView: React.FC<WeeklyAgendaViewProps> = ({
  tasks,
  onTaskEdit,
  onStatusChange,
  onTaskUpdate,
}) => {
  const [weekOffset, setWeekOffset] = useState(0);
  const { user } = useAuth();
  const [externalEvents, setExternalEvents] = useState<(ExternalCalendarEvent & { calendar_connections?: { provider: string; provider_account_email: string } })[]>([]);
  const [schedulingConfig, setSchedulingConfig] = useState<SchedulingConfig>(DEFAULT_SCHEDULING_CONFIG);

  // Load user's authoritative scheduling config
  useEffect(() => {
    if (user?.id) {
      loadUserSchedulingConfig(user.id).then(setSchedulingConfig);
    }
  }, [user?.id]);

  const userTimezone = schedulingConfig?.timezone || getDefaultTimezone();

  const weekStart = useMemo(() => {
    const base = startOfWeek(new Date(), { weekStartsOn: 1 });
    return addDays(base, weekOffset * 7);
  }, [weekOffset]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  // Fetch external events for the visible week
  useEffect(() => {
    if (!user?.id) return;
    const load = async () => {
      const rangeStart = weekDays[0];
      const rangeEnd = addDays(weekDays[6], 1);
      const { data } = await supabase
        .from('external_calendar_events')
        .select('*, calendar_connections!connection_id(provider, provider_account_email)')
        .eq('user_id', user.id)
        .gte('start_time', rangeStart.toISOString())
        .lt('start_time', rangeEnd.toISOString());
      if (data) setExternalEvents(data as any);
    };
    load();
  }, [user?.id, weekStart]);

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

      {/* Tabs */}
      <Tabs defaultValue="agenda" className="w-full">
        <TabsList className="w-full">
          <TabsTrigger value="agenda" className="flex-1 text-xs">Agenda</TabsTrigger>
          <TabsTrigger value="meetings" className="flex-1 text-xs">
            Meetings
            {externalEvents.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1 py-0">{externalEvents.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="assignments" className="flex-1 text-xs">Assignments</TabsTrigger>
        </TabsList>

        <TabsContent value="agenda">
          <ScrollArea className="h-[calc(100vh-280px)]">
            <AgendaTab tasks={tasks} weekDays={weekDays} externalEvents={externalEvents} config={schedulingConfig} userTimezone={userTimezone} onTaskEdit={onTaskEdit} onComplete={handleComplete} />
          </ScrollArea>
        </TabsContent>

        <TabsContent value="meetings">
          <ScrollArea className="h-[calc(100vh-280px)]">
            <MeetingsTab weekDays={weekDays} externalEvents={externalEvents} userTimezone={userTimezone} />
          </ScrollArea>
        </TabsContent>

        <TabsContent value="assignments">
          <ScrollArea className="h-[calc(100vh-280px)]">
            <AssignmentsTab tasks={tasks} onTaskEdit={onTaskEdit} onComplete={handleComplete} />
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default WeeklyAgendaView;
