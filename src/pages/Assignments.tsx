import React, { useState, useEffect, useMemo, useCallback } from 'react';
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

interface AssignmentRow {
  id: string;
  title: string;
  description?: string | null;
  due_date?: string | null;
  priority: string;
  status: string;
  course_id?: string | null;
  assignment_url?: string | null;
  program_id?: string | null;
  source: 'EMBA' | 'MIT';
  // Linked task data
  task?: Task | null;
}

const Assignments: React.FC = () => {
  const { user } = useAuth();
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [courses, setCourses] = useState<Map<string, string>>(new Map());
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
        const emba = data.find(p => p.name.toLowerCase().includes('emba') || p.name.toLowerCase().includes('executive'));
        setProgramFilter(emba?.id || data[0].id);
      }
    };
    fetchPrograms();
  }, []);

  // Fetch courses for display names
  useEffect(() => {
    const fetchCourses = async () => {
      if (!user) return;
      const { data } = await supabase.from('courses').select('id, name').eq('user_id', user.id);
      if (data) {
        const map = new Map<string, string>();
        data.forEach(c => map.set(c.id, c.name));
        setCourses(map);
      }
    };
    fetchCourses();
  }, [user]);

  const fetchAssignments = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Fetch from both assignment tables
      const [embaRes, mitRes, tasksRes] = await Promise.all([
        supabase.from('assignments').select('id, title, description, due_date, priority, status, course_id, assignment_url, program_id').eq('user_id', user.id),
        supabase.from('assignments_mit').select('id, title, description, due_date, priority, status, course_id, assignment_url').eq('user_id', user.id),
        supabase.from('tasks').select('*').eq('user_id', user.id).not('assignment_id', 'is', null),
      ]);

      // Build task lookup by assignment_id
      const taskByAssignmentId = new Map<string, Task>();
      (tasksRes.data || []).forEach((t: any) => {
        if (t.assignment_id) taskByAssignmentId.set(t.assignment_id, t as Task);
      });

      // Find MIT program
      const mitProgram = programs.find(p => p.name.toLowerCase().includes('mit') || p.name.toLowerCase().includes('cto'));

      const embaRows: AssignmentRow[] = (embaRes.data || []).map(a => ({
        ...a,
        source: 'EMBA' as const,
        task: taskByAssignmentId.get(a.id) || null,
      }));

      const mitRows: AssignmentRow[] = (mitRes.data || []).map(a => ({
        ...a,
        source: 'MIT' as const,
        program_id: mitProgram?.id || null,
        task: taskByAssignmentId.get(a.id) || null,
      }));

      const combined = [...embaRows, ...mitRows].sort((a, b) => {
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      });

      setAssignments(combined);
    } catch (err) {
      console.error('Error fetching assignments:', err);
      toast.error('Failed to load assignments');
    } finally {
      setLoading(false);
    }
  }, [user, programs]);

  useEffect(() => {
    if (user && programs.length > 0) {
      fetchAssignments();
    }
  }, [user, programs, fetchAssignments]);

  const getAssignmentStatus = (row: AssignmentRow): 'upcoming' | 'due_next' | 'overdue' | 'completed' | 'active' => {
    // Completed only if the linked task has completed_at
    if (row.task?.completed_at) return 'completed';
    if (row.status === 'completed' || row.status === 'graded') return 'completed';
    if (row.task?.status === 'DOING' || row.task?.status === 'UP_NEXT') return 'active';
    if (row.due_date && isPast(parseISO(row.due_date))) return 'overdue';
    if (row.due_date && differenceInDays(parseISO(row.due_date), new Date()) <= 7) return 'due_next';
    return 'upcoming';
  };

  // Filter by program
  const programFilteredAssignments = useMemo(() => {
    if (!programFilter || programFilter === 'all') return assignments;
    return assignments.filter(a => {
      if (a.program_id === programFilter) return true;
      // MIT fallback: check source
      const matchingProgram = programs.find(p => p.id === programFilter);
      if (matchingProgram) {
        const name = matchingProgram.name.toLowerCase();
        if ((name.includes('emba') || name.includes('executive')) && a.source === 'EMBA') return true;
        if ((name.includes('mit') || name.includes('cto')) && a.source === 'MIT') return true;
      }
      return false;
    });
  }, [assignments, programFilter, programs]);

  // Filter by status tab
  const filteredAssignments = useMemo(() => {
    return programFilteredAssignments.filter(a => {
      const status = getAssignmentStatus(a);
      switch (statusTab) {
        case 'due_next': return status === 'due_next';
        case 'upcoming': return status === 'upcoming';
        case 'overdue': return status === 'overdue';
        case 'active': return status === 'active';
        case 'submitted': return status === 'completed';
        default: return true;
      }
    });
  }, [programFilteredAssignments, statusTab]);

  // Tab counts
  const tabCounts = useMemo(() => {
    let dueNext = 0, upcoming = 0, overdue = 0, active = 0, submitted = 0;
    programFilteredAssignments.forEach(a => {
      const s = getAssignmentStatus(a);
      if (s === 'due_next') dueNext++;
      else if (s === 'upcoming') upcoming++;
      else if (s === 'overdue') overdue++;
      else if (s === 'active') active++;
      else submitted++;
    });
    return { all: programFilteredAssignments.length, dueNext, upcoming, overdue, active, submitted };
  }, [programFilteredAssignments]);

  // Helper: group assignments by course and sort
  const groupByCourse = useCallback((items: AssignmentRow[], descending: boolean) => {
    const map = new Map<string, AssignmentRow[]>();
    items.forEach(a => {
      const courseName = a.course_id ? (courses.get(a.course_id) || 'Unknown Course') : (a.source === 'MIT' ? 'MIT' : 'EMBA');
      if (!map.has(courseName)) map.set(courseName, []);
      map.get(courseName)!.push(a);
    });
    map.forEach((rows) => {
      rows.sort((a, b) => {
        const da = a.due_date ? new Date(a.due_date).getTime() : 0;
        const db = b.due_date ? new Date(b.due_date).getTime() : 0;
        return descending ? db - da : da - db;
      });
    });
    const sortedMap = new Map<string, AssignmentRow[]>();
    const entries = Array.from(map.entries());
    if (descending) {
      entries.sort((a, b) => {
        const latestA = Math.max(...a[1].map(r => r.due_date ? new Date(r.due_date).getTime() : 0));
        const latestB = Math.max(...b[1].map(r => r.due_date ? new Date(r.due_date).getTime() : 0));
        return latestB - latestA;
      });
    } else {
      entries.sort((a, b) => a[0].localeCompare(b[0]));
    }
    entries.forEach(([k, v]) => sortedMap.set(k, v));
    return sortedMap;
  }, [courses]);

  // Group by course (non-overdue tabs)
  const grouped = useMemo(() => {
    return groupByCourse(filteredAssignments, statusTab === 'overdue');
  }, [filteredAssignments, statusTab, groupByCourse]);

  // Overdue partitioned into recent (≤14 days) and older
  const overduePartitions = useMemo(() => {
    if (statusTab !== 'overdue') return null;
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const recent: AssignmentRow[] = [];
    const older: AssignmentRow[] = [];
    filteredAssignments.forEach(a => {
      if (a.due_date && new Date(a.due_date) >= fourteenDaysAgo) {
        recent.push(a);
      } else {
        older.push(a);
      }
    });
    return {
      recent: groupByCourse(recent, true),
      older: groupByCourse(older, true),
    };
  }, [filteredAssignments, statusTab, groupByCourse]);

  // Auto-open all courses on filter change
  useEffect(() => {
    if (overduePartitions) {
      setOpenCourses(new Set([...overduePartitions.recent.keys(), ...overduePartitions.older.keys()]));
    } else {
      setOpenCourses(new Set(grouped.keys()));
    }
  }, [grouped, overduePartitions]);

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
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => fetchAssignments()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowImportSettings(!showImportSettings)}
              className={cn(showImportSettings && "bg-muted")}
            >
              <Settings className="h-4 w-4 mr-1" />
              Import
            </Button>
          </div>
        </div>

        {/* Collapsible Import Settings */}
        <Collapsible open={showImportSettings} onOpenChange={setShowImportSettings}>
          <CollapsibleContent className="mt-2 mb-3 border border-border rounded-lg p-3 bg-muted/30">
            <AssignmentSyncSettings onSyncComplete={fetchAssignments} />
          </CollapsibleContent>
        </Collapsible>

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
        ) : statusTab === 'overdue' && overduePartitions ? (
          <>
            {overduePartitions.recent.size > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-1 pt-1">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <span className="text-xs font-bold text-destructive uppercase tracking-wide">Last 2 Weeks</span>
                  <Badge variant="outline" className="text-[10px] h-4 px-1 border-destructive/30 text-destructive">
                    {Array.from(overduePartitions.recent.values()).reduce((sum, arr) => sum + arr.length, 0)}
                  </Badge>
                </div>
                {renderCourseAccordions(overduePartitions.recent)}
              </div>
            )}
            {overduePartitions.older.size > 0 && (
              <div className="space-y-2 mt-4">
                <div className="flex items-center gap-2 px-1 pt-1">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Older</span>
                  <Badge variant="outline" className="text-[10px] h-4 px-1">
                    {Array.from(overduePartitions.older.values()).reduce((sum, arr) => sum + arr.length, 0)}
                  </Badge>
                </div>
                {renderCourseAccordions(overduePartitions.older)}
              </div>
            )}
            {overduePartitions.recent.size === 0 && overduePartitions.older.size === 0 && (
              <div className="text-center py-8 text-muted-foreground text-sm">No overdue assignments</div>
            )}
          </>
        ) : grouped.size === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">No assignments found</div>
        ) : (
          renderCourseAccordions(grouped)
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
