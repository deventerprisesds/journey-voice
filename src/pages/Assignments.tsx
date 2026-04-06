import React, { useState, useEffect, useMemo } from 'react';
import { format, isPast, parseISO, differenceInDays } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { GraduationCap, RefreshCw, CheckCircle2, AlertTriangle, Clock, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import TaskDetailModal from '@/components/TaskDetailModal';
import type { Task } from '@/types/task';

type StatusFilter = 'all' | 'upcoming' | 'overdue' | 'completed';

const Assignments: React.FC = () => {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [courseFilter, setCourseFilter] = useState<string>('all');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const fetchAssignments = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('user_id', user.id)
        .not('assignment_id', 'is', null)
        .order('due_date', { ascending: true });

      if (error) throw error;
      setTasks((data || []) as Task[]);
    } catch (err) {
      console.error('Error fetching assignments:', err);
      toast.error('Failed to load assignments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssignments();
  }, [user]);

  const handleSync = async () => {
    if (!user) return;
    setSyncing(true);
    try {
      const { error } = await supabase.functions.invoke('nightly-assignment-sync', {
        body: { userId: user.id }
      });
      if (error) throw error;
      setLastSyncedAt(new Date().toISOString());
      toast.success('Assignments synced');
      await fetchAssignments();
    } catch (err) {
      console.error('Sync error:', err);
      toast.error('Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const courses = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach(t => {
      const src = (t.scheduling_context as any)?.source;
      if (src) set.add(src);
      else if (t.category) set.add(t.category);
    });
    return Array.from(set).sort();
  }, [tasks]);

  const getTaskStatus = (task: Task): 'upcoming' | 'overdue' | 'completed' => {
    if (task.status === 'DONE' || task.completed_at) return 'completed';
    if (task.due_date && isPast(parseISO(task.due_date))) return 'overdue';
    return 'upcoming';
  };

  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
      const status = getTaskStatus(t);
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (courseFilter !== 'all') {
        const src = (t.scheduling_context as any)?.source || t.category;
        if (src !== courseFilter) return false;
      }
      return true;
    });
  }, [tasks, statusFilter, courseFilter]);

  const stats = useMemo(() => {
    let upcoming = 0, overdue = 0, completed = 0;
    tasks.forEach(t => {
      const s = getTaskStatus(t);
      if (s === 'upcoming') upcoming++;
      else if (s === 'overdue') overdue++;
      else completed++;
    });
    return { total: tasks.length, upcoming, overdue, completed };
  }, [tasks]);

  // Group by course
  const grouped = useMemo(() => {
    const map = new Map<string, Task[]>();
    filteredTasks.forEach(t => {
      const key = (t.scheduling_context as any)?.source || t.category || 'Other';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    });
    return map;
  }, [filteredTasks]);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-bold text-foreground">Assignments</h1>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={syncing}
          >
            <RefreshCw className={cn("h-4 w-4 mr-1", syncing && "animate-spin")} />
            Sync
          </Button>
        </div>
        {lastSyncedAt && (
          <p className="text-xs text-muted-foreground">
            Last synced: {format(parseISO(lastSyncedAt), 'MMM d, h:mm a')}
          </p>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 p-4">
        <div className="text-center p-2 rounded-lg bg-muted/50">
          <div className="text-lg font-bold text-foreground">{stats.total}</div>
          <div className="text-[10px] text-muted-foreground">Total</div>
        </div>
        <div className="text-center p-2 rounded-lg bg-muted/50">
          <div className="text-lg font-bold text-blue-600 dark:text-blue-400">{stats.upcoming}</div>
          <div className="text-[10px] text-muted-foreground">Upcoming</div>
        </div>
        <div className="text-center p-2 rounded-lg bg-muted/50">
          <div className="text-lg font-bold text-red-600 dark:text-red-400">{stats.overdue}</div>
          <div className="text-[10px] text-muted-foreground">Overdue</div>
        </div>
        <div className="text-center p-2 rounded-lg bg-muted/50">
          <div className="text-lg font-bold text-green-600 dark:text-green-400">{stats.completed}</div>
          <div className="text-[10px] text-muted-foreground">Done</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 px-4 pb-3">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="h-8 text-xs flex-1">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="upcoming">Upcoming</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={courseFilter} onValueChange={setCourseFilter}>
          <SelectTrigger className="h-8 text-xs flex-1">
            <SelectValue placeholder="Course" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Courses</SelectItem>
            {courses.map(c => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Assignment list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
        {loading ? (
          <div className="text-center py-8 text-muted-foreground text-sm">Loading...</div>
        ) : grouped.size === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">No assignments found</div>
        ) : (
          Array.from(grouped.entries()).map(([course, courseTasks]) => (
            <div key={course}>
              <div className="flex items-center gap-2 mb-2">
                <BookOpen className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">{course}</h2>
                <Badge variant="secondary" className="text-[10px] h-4">{courseTasks.length}</Badge>
              </div>
              <div className="space-y-2">
                {courseTasks.map(task => {
                  const status = getTaskStatus(task);
                  const daysOverdue = task.due_date && isPast(parseISO(task.due_date))
                    ? differenceInDays(new Date(), parseISO(task.due_date))
                    : 0;

                  return (
                    <Card
                      key={task.id}
                      className={cn(
                        "cursor-pointer hover:shadow-md transition-shadow",
                        status === 'overdue' && "border-l-4 border-l-red-500",
                        status === 'completed' && "opacity-60",
                        status === 'upcoming' && "border-l-4 border-l-blue-500"
                      )}
                      onClick={() => setSelectedTask(task)}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <span className={cn(
                              "text-sm font-medium block truncate",
                              status === 'completed' && "line-through text-muted-foreground"
                            )}>
                              {status === 'completed' && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 inline mr-1" />}
                              {task.title}
                            </span>
                            {task.due_date && (
                              <span className="text-xs text-muted-foreground mt-0.5 block">
                                Due: {format(parseISO(task.due_date), 'MMM d, yyyy')}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1 flex-shrink-0">
                            {status === 'overdue' && (
                              <Badge variant="outline" className="text-[10px] h-4 px-1 bg-red-500/10 text-red-700 border-red-500/20 dark:text-red-400">
                                <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                                {daysOverdue}d overdue
                              </Badge>
                            )}
                            {status === 'upcoming' && (
                              <Badge variant="outline" className="text-[10px] h-4 px-1 bg-blue-500/10 text-blue-700 border-blue-500/20 dark:text-blue-400">
                                <Clock className="h-2.5 w-2.5 mr-0.5" />
                                upcoming
                              </Badge>
                            )}
                            <Badge variant="outline" className={cn("text-[10px] h-4 px-1",
                              task.priority === 'URGENT' ? "bg-red-500/10 text-red-700 border-red-500/20" :
                              task.priority === 'HIGH' ? "bg-orange-500/10 text-orange-700 border-orange-500/20" :
                              "bg-muted text-muted-foreground"
                            )}>
                              {task.priority.toLowerCase()}
                            </Badge>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Task Detail Modal */}
      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          isOpen={!!selectedTask}
          onClose={() => setSelectedTask(null)}
          onSave={async (updates) => {
            const { error } = await supabase
              .from('tasks')
              .update(updates)
              .eq('id', selectedTask.id);
            if (!error) {
              toast.success('Updated');
              fetchAssignments();
            }
          }}
        />
      )}
    </div>
  );
};

export default Assignments;
