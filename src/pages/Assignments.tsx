import React, { useState, useEffect, useMemo } from 'react';
import { format, isPast, parseISO, differenceInDays } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Card, CardContent } from '@/components/ui/card';
import { GraduationCap, RefreshCw, CheckCircle2, AlertTriangle, Clock, BookOpen, ChevronRight, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import TaskDetailModal from '@/components/TaskDetailModal';
import { AssignmentSyncSettings } from '@/components/AssignmentSyncSettings';
import type { Task } from '@/types/task';

type StatusTab = 'all' | 'due_next' | 'upcoming' | 'overdue' | 'active' | 'submitted';

interface Program {
  id: string;
  name: string;
}

interface AssignmentMapping {
  id: string;
  program_id: string | null;
}

const Assignments: React.FC = () => {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [assignmentMap, setAssignmentMap] = useState<Map<string, string | null>>(new Map());
  const [loading, setLoading] = useState(true);
  const [programFilter, setProgramFilter] = useState<string>('');
  const [statusTab, setStatusTab] = useState<StatusTab>('all');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [openCourses, setOpenCourses] = useState<Set<string>>(new Set());
  const [showImportSettings, setShowImportSettings] = useState(false);

  // Fetch programs
  useEffect(() => {
    const fetchPrograms = async () => {
      const { data } = await supabase.from('programs').select('id, name').order('name');
      if (data && data.length > 0) {
        setPrograms(data);
        // Default to EMBA
        const emba = data.find(p => p.name.toLowerCase().includes('emba') || p.name.toLowerCase().includes('executive'));
        setProgramFilter(emba?.id || data[0].id);
      }
    };
    fetchPrograms();
  }, []);

  // Fetch assignments mapping (assignment_id → program_id)
  useEffect(() => {
    const fetchMapping = async () => {
      const { data } = await supabase.from('assignments').select('id, program_id');
      if (data) {
        const map = new Map<string, string | null>();
        data.forEach((a: AssignmentMapping) => map.set(a.id, a.program_id));
        setAssignmentMap(map);
      }
    };
    fetchMapping();
  }, []);

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

  const getTaskStatus = (task: Task): 'upcoming' | 'due_next' | 'overdue' | 'completed' | 'active' => {
    if (task.completed_at) return 'completed';
    if (task.status === 'DOING' || task.status === 'UP_NEXT') return 'active';
    if (task.due_date && isPast(parseISO(task.due_date))) return 'overdue';
    if (task.due_date && differenceInDays(parseISO(task.due_date), new Date()) <= 7) return 'due_next';
    return 'upcoming';
  };

  // Filter by program
  const programFilteredTasks = useMemo(() => {
    if (!programFilter || programFilter === 'all') return tasks;
    return tasks.filter(t => {
      if (!t.assignment_id) return false;
      const progId = assignmentMap.get(t.assignment_id);
      return progId === programFilter;
    });
  }, [tasks, programFilter, assignmentMap]);

  // Filter by status tab
  const filteredTasks = useMemo(() => {
    return programFilteredTasks.filter(t => {
      const status = getTaskStatus(t);
      switch (statusTab) {
        case 'due_next': return status === 'due_next';
        case 'upcoming': return status === 'upcoming';
        case 'overdue': return status === 'overdue';
        case 'active': return status === 'active';
        case 'submitted': return status === 'completed';
        default: return true;
      }
    });
  }, [programFilteredTasks, statusTab]);

  // Tab counts
  const tabCounts = useMemo(() => {
    let dueNext = 0, upcoming = 0, overdue = 0, active = 0, submitted = 0;
    programFilteredTasks.forEach(t => {
      const s = getTaskStatus(t);
      if (s === 'due_next') dueNext++;
      else if (s === 'upcoming') upcoming++;
      else if (s === 'overdue') overdue++;
      else if (s === 'active') active++;
      else submitted++;
    });
    return { all: programFilteredTasks.length, dueNext, upcoming, overdue, active, submitted };
  }, [programFilteredTasks]);

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

  // Auto-open all courses on filter change
  useEffect(() => {
    setOpenCourses(new Set(grouped.keys()));
  }, [grouped]);

  const toggleCourse = (course: string) => {
    setOpenCourses(prev => {
      const next = new Set(prev);
      if (next.has(course)) next.delete(course);
      else next.add(course);
      return next;
    });
  };

  const getProgramShortName = (p: Program) => {
    if (p.name.toLowerCase().includes('executive') || p.name.toLowerCase().includes('emba')) return 'EMBA';
    if (p.name.toLowerCase().includes('mit') || p.name.toLowerCase().includes('cto')) return 'MIT';
    return p.name.slice(0, 6);
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="p-4 pb-2 border-b border-border">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-bold text-foreground">Assignments</h1>
          </div>
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
            <RefreshCw className={cn("h-4 w-4 mr-1", syncing && "animate-spin")} />
            Sync
          </Button>
        </div>
        {lastSyncedAt && (
          <p className="text-xs text-muted-foreground mb-2">
            Last synced: {format(parseISO(lastSyncedAt), 'MMM d, h:mm a')}
          </p>
        )}

        {/* Program Toggle */}
        {programs.length > 0 && (
          <Tabs value={programFilter} onValueChange={setProgramFilter} className="mb-3">
            <TabsList className="w-full h-9">
              {programs.map(p => (
                <TabsTrigger key={p.id} value={p.id} className="flex-1 text-xs font-semibold">
                  {getProgramShortName(p)}
                </TabsTrigger>
              ))}
              <TabsTrigger value="all" className="flex-1 text-xs font-semibold">All</TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {/* Status Tab Bar */}
        <Tabs value={statusTab} onValueChange={(v) => setStatusTab(v as StatusTab)}>
          <TabsList className="w-full h-9 overflow-x-auto flex-nowrap">
            <TabsTrigger value="all" className="text-[11px] px-2 flex-shrink-0">
              All <Badge variant="secondary" className="ml-1 h-4 text-[9px] px-1">{tabCounts.all}</Badge>
            </TabsTrigger>
            <TabsTrigger value="due_next" className="text-[11px] px-2 flex-shrink-0">
              Due Next <Badge variant="secondary" className="ml-1 h-4 text-[9px] px-1">{tabCounts.dueNext}</Badge>
            </TabsTrigger>
            <TabsTrigger value="upcoming" className="text-[11px] px-2 flex-shrink-0">
              Upcoming <Badge variant="secondary" className="ml-1 h-4 text-[9px] px-1">{tabCounts.upcoming}</Badge>
            </TabsTrigger>
            <TabsTrigger value="overdue" className="text-[11px] px-2 flex-shrink-0">
              Overdue <Badge variant="secondary" className="ml-1 h-4 text-[9px] px-1">{tabCounts.overdue}</Badge>
            </TabsTrigger>
            <TabsTrigger value="active" className="text-[11px] px-2 flex-shrink-0">
              Active <Badge variant="secondary" className="ml-1 h-4 text-[9px] px-1">{tabCounts.active}</Badge>
            </TabsTrigger>
            <TabsTrigger value="submitted" className="text-[11px] px-2 flex-shrink-0">
              Submitted <Badge variant="secondary" className="ml-1 h-4 text-[9px] px-1">{tabCounts.submitted}</Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Assignment list with course accordions */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {loading ? (
          <div className="text-center py-8 text-muted-foreground text-sm">Loading...</div>
        ) : grouped.size === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">No assignments found</div>
        ) : (
          Array.from(grouped.entries()).map(([course, courseTasks]) => (
            <Collapsible
              key={course}
              open={openCourses.has(course)}
              onOpenChange={() => toggleCourse(course)}
            >
              <CollapsibleTrigger className="flex items-center justify-between w-full p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                <div className="flex items-center gap-2">
                  <ChevronRight className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform",
                    openCourses.has(course) && "rotate-90"
                  )} />
                  <BookOpen className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-semibold text-foreground">{course}</span>
                </div>
                <Badge variant="secondary" className="text-[10px] h-5">{courseTasks.length}</Badge>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-2 mt-2 pl-2">
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
                        status === 'overdue' && "border-l-4 border-l-destructive",
                        status === 'completed' && "opacity-60",
                        status === 'upcoming' && "border-l-4 border-l-primary",
                        status === 'active' && "border-l-4 border-l-accent-foreground"
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
                              <Badge variant="outline" className="text-[10px] h-4 px-1 bg-destructive/10 text-destructive border-destructive/20">
                                <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                                {daysOverdue}d overdue
                              </Badge>
                            )}
                            {status === 'upcoming' && (
                              <Badge variant="outline" className="text-[10px] h-4 px-1 bg-primary/10 text-primary border-primary/20">
                                <Clock className="h-2.5 w-2.5 mr-0.5" />
                                upcoming
                              </Badge>
                            )}
                            {status === 'active' && (
                              <Badge variant="outline" className="text-[10px] h-4 px-1 bg-accent text-accent-foreground border-accent">
                                active
                              </Badge>
                            )}
                            <Badge variant="outline" className={cn("text-[10px] h-4 px-1",
                              task.priority === 'URGENT' ? "bg-destructive/10 text-destructive border-destructive/20" :
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
              </CollapsibleContent>
            </Collapsible>
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
