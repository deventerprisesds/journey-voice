import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { DragDropContext, DropResult } from '@hello-pangea/dnd';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Button } from '@/components/ui/button';
import { Layers, List, Sparkles, Loader2, X, ArrowRight, CircleDot } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { DEFAULT_SCHEDULING_CONFIG, mergeSchedulingConfig } from '@/config/schedulingRules';
import CategoryColumn from '@/components/priorities/CategoryColumn';
import TaskDetailModal from '@/components/TaskDetailModal';
import type { Task } from '@/types/task';
import { toast } from 'sonner';

export interface TopicGroupData {
  id: string;
  topic_name: string;
  topic_summary: string | null;
  task_count: number | null;
  tasks: Task[];
  children?: TopicGroupData[];
}
export interface CategoryData {
  key: string;
  label: string;
  color: string;
  topicGroups: TopicGroupData[];
  uncategorizedTasks: Task[];
}

export interface TopicGroupRef {
  id: string;
  topic_name: string;
  categoryKey: string;
  parentTopicId?: string;
}

export interface CategoryRef {
  key: string;
  label: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  CAREER: 'hsl(var(--category-career))',
  PROF_EDUCATION: 'hsl(var(--category-education))',
  EDUCATION: 'hsl(var(--category-education))',
  VENTURES: 'hsl(var(--category-ventures))',
  LIFE: 'hsl(var(--category-life))',
  PERSONAL: 'hsl(var(--category-life))',
};

const CATEGORY_LABELS: Record<string, string> = {
  CAREER: 'Career',
  PROF_EDUCATION: 'Prof. Education',
  EDUCATION: 'Education',
  VENTURES: 'Ventures',
  LIFE: 'Life',
  PERSONAL: 'Personal',
};

const Priorities: React.FC = () => {
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState<'group' | 'task'>('group');
  const [categories, setCategories] = useState<CategoryData[]>([]);
  const [allTopicGroupRefs, setAllTopicGroupRefs] = useState<TopicGroupRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [classifying, setClassifying] = useState(false);
  const [unmappedCount, setUnmappedCount] = useState(0);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const autoClassifyRan = useRef(false);
  const loadDataRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const toggleTaskSelection = useCallback((taskId: string) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedTaskIds(new Set()), []);

  const batchMoveToCategory = useCallback(async (targetCategory: string) => {
    if (!user || selectedTaskIds.size === 0) return;
    const ids = Array.from(selectedTaskIds);
    
    // Optimistic update
    setCategories(prev => prev.map(cat => ({
      ...cat,
      topicGroups: cat.topicGroups.map(tg => ({
        ...tg,
        tasks: tg.tasks.filter(t => !selectedTaskIds.has(t.id) || cat.key === targetCategory),
      })),
      uncategorizedTasks: cat.uncategorizedTasks.filter(t => !selectedTaskIds.has(t.id) || cat.key === targetCategory),
    })));

    // Persist
    const { error } = await supabase.from('tasks').update({ category: targetCategory } as any).in('id', ids);
    if (error) {
      toast.error('Failed to move tasks');
      loadDataRef.current();
    } else {
      toast.success(`Moved ${ids.length} tasks to ${CATEGORY_LABELS[targetCategory] || targetCategory}`);
      clearSelection();
      loadDataRef.current();
    }
  }, [user, selectedTaskIds, clearSelection]);

  const batchChangeStatus = useCallback(async (targetStatus: string) => {
    if (!user || selectedTaskIds.size === 0) return;
    const ids = Array.from(selectedTaskIds);
    const { error } = await supabase.from('tasks').update({ status: targetStatus } as any).in('id', ids);
    if (error) {
      toast.error('Failed to update status');
    } else {
      toast.success(`Updated ${ids.length} tasks to ${targetStatus.replace('_', ' ')}`);
      clearSelection();
      loadDataRef.current();
    }
  }, [user, selectedTaskIds, clearSelection]);

  const batchMoveToGroup = useCallback(async (targetTopicId: string, targetCategoryKey: string) => {
    if (!user || selectedTaskIds.size === 0) return;
    const ids = Array.from(selectedTaskIds);

    try {
      // Delete existing mappings
      await supabase.from('task_topic_mappings').delete().in('task_id', ids);
      // Insert new mappings
      const mappings = ids.map(task_id => ({ task_id, topic_id: targetTopicId }));
      const { error: insertError } = await supabase.from('task_topic_mappings').insert(mappings);
      if (insertError) throw insertError;

      // Update task categories to match the group's category
      await supabase.from('tasks').update({ category: targetCategoryKey } as any).in('id', ids);

      toast.success(`Moved ${ids.length} tasks to group`);
      clearSelection();
      loadDataRef.current();
    } catch (err: any) {
      toast.error('Failed to move tasks to group');
      console.error('[batchMoveToGroup]', err);
      loadDataRef.current();
    }
  }, [user, selectedTaskIds, clearSelection]);
  // Classify a single task via edge function
  const classifySingleTask = useCallback(async (task: Task) => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/classify-task-topic`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        task_id: task.id,
        task_title: task.title,
        task_category: task.category || 'LIFE',
        user_id: task.user_id,
        operation: 'INSERT',
      }),
    });
    return res.json();
  }, []);

  // Bulk classify unmapped tasks
  const classifyUnmapped = useCallback(async (limit?: number) => {
    if (!user) return;
    setClassifying(true);

    try {
      // Get all tasks and existing mappings
      const [tasksRes, mappingsRes] = await Promise.all([
        supabase.from('tasks').select('id, title, category, user_id').eq('user_id', user.id).not('status', 'in', '("DONE","BLOCKED")'),
        supabase.from('task_topic_mappings').select('task_id'),
      ]);

      const tasks = (tasksRes.data || []) as unknown as Task[];
      const mappedIds = new Set((mappingsRes.data || []).map(m => m.task_id));
      let unmapped = tasks.filter(t => !mappedIds.has(t.id) && !t.title.toLowerCase().includes('test'));

      if (limit) unmapped = unmapped.slice(0, limit);

      if (unmapped.length === 0) {
        if (!limit) toast.info('All tasks are already classified');
        setClassifying(false);
        return;
      }

      if (!limit) toast.info(`Classifying ${unmapped.length} tasks...`);

      // Process in batches of 3 with 500ms delay
      const BATCH = 3;
      for (let i = 0; i < unmapped.length; i += BATCH) {
        const batch = unmapped.slice(i, i + BATCH);
        await Promise.all(batch.map(t => classifySingleTask(t)));
        if (i + BATCH < unmapped.length) {
          await new Promise(r => setTimeout(r, 500));
        }
      }

      if (!limit) toast.success(`Classified ${unmapped.length} tasks`);
      await loadDataRef.current();
    } catch (err) {
      console.error('[ClassifyUnmapped] Error:', err);
      toast.error('Classification failed');
    } finally {
      setClassifying(false);
    }
  }, [user, classifySingleTask]);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    try {
      const [prefsRes, topicsRes, mappingsRes, tasksRes] = await Promise.all([
        supabase.from('user_scheduling_prefs').select('config').eq('user_id', user.id).maybeSingle(),
        supabase.from('task_topic_index').select('*').eq('user_id', user.id),
        supabase.from('task_topic_mappings').select('*'),
        supabase.from('tasks').select('*').eq('user_id', user.id).not('status', 'in', '("DONE","BLOCKED")'),
      ]);

      const userConfig = prefsRes.data?.config as any;
      const config = userConfig ? mergeSchedulingConfig(userConfig) : DEFAULT_SCHEDULING_CONFIG;

      const categoryKeys = Object.keys(config.categoryMappings);
      const allTopics = topicsRes.data || [];
      // Filter to top-level topics; children will be nested
      const topics = allTopics.filter((t: any) => !t.parent_topic_id);
      // Build children map for sub-groups
      const childrenMap = new Map<string, any[]>();
      allTopics.filter((t: any) => t.parent_topic_id).forEach((t: any) => {
        const list = childrenMap.get(t.parent_topic_id) || [];
        list.push(t);
        childrenMap.set(t.parent_topic_id, list);
      });
      const mappings = mappingsRes.data || [];
      const tasks = (tasksRes.data || []) as unknown as Task[];

      const taskMap = new Map<string, Task>();
      tasks.forEach(t => taskMap.set(t.id, t));

      const topicTasksMap = new Map<string, Task[]>();
      mappings.forEach(m => {
        const task = taskMap.get(m.task_id);
        if (task) {
          const existing = topicTasksMap.get(m.topic_id) || [];
          existing.push(task);
          topicTasksMap.set(m.topic_id, existing);
        }
      });

      const assignedTaskIds = new Set<string>();
      mappings.forEach(m => assignedTaskIds.add(m.task_id));

      // Determine majority category for each topic (with category_affinity / window_affinity fallback)
      const topicCategoryMap = new Map<string, string>();
      allTopics.forEach((topic: any) => {
        const topicTasks = topicTasksMap.get(topic.id) || [];
        if (topicTasks.length > 0) {
          const catCounts: Record<string, number> = {};
          topicTasks.forEach(t => {
            const cat = t.category || 'LIFE';
            catCounts[cat] = (catCounts[cat] || 0) + 1;
          });
          const majorCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0][0];
          topicCategoryMap.set(topic.id, majorCat);
        } else if (topic.category_affinity && categoryKeys.includes(topic.category_affinity)) {
          topicCategoryMap.set(topic.id, topic.category_affinity);
        } else if (topic.window_affinity && topic.window_affinity.length > 0 && categoryKeys.includes(topic.window_affinity[0])) {
          topicCategoryMap.set(topic.id, topic.window_affinity[0]);
        }
      });

      const getOrder = (catKey: string): string[] => {
        try {
          const stored = localStorage.getItem(`priorities-order-${user.id}-${catKey}`);
          return stored ? JSON.parse(stored) : [];
        } catch { return []; }
      };

      const catData: CategoryData[] = categoryKeys.map(key => {
        const savedOrder = getOrder(key);
        const catTopics = topics
          .filter((t: any) => topicCategoryMap.get(t.id) === key)
          .map((t: any) => ({
            id: t.id,
            topic_name: t.topic_name,
            topic_summary: t.topic_summary,
            task_count: t.task_count,
            tasks: (topicTasksMap.get(t.id) || []).sort((a, b) => {
              const pOrder: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
              return (pOrder[a.priority] ?? 3) - (pOrder[b.priority] ?? 3);
            }),
            children: (childrenMap.get(t.id) || []).map((child: any) => ({
              id: child.id,
              topic_name: child.topic_name,
              topic_summary: child.topic_summary,
              task_count: child.task_count,
              tasks: (topicTasksMap.get(child.id) || []).sort((a: Task, b: Task) => {
                const pOrder: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
                return (pOrder[a.priority] ?? 3) - (pOrder[b.priority] ?? 3);
              }),
              children: [],
            })),
          }));
        catTopics.sort((a: any, b: any) => {
          const aIdx = savedOrder.indexOf(a.id);
          const bIdx = savedOrder.indexOf(b.id);
          if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
          if (aIdx !== -1) return -1;
          if (bIdx !== -1) return 1;
          return a.topic_name.localeCompare(b.topic_name);
        });

        const uncategorized = tasks.filter(
          t => (t.category === key || (!t.category && key === 'LIFE')) && !assignedTaskIds.has(t.id)
        );

        return {
          key,
          label: CATEGORY_LABELS[key] || key,
          color: CATEGORY_COLORS[key] || 'hsl(var(--muted-foreground))',
          topicGroups: catTopics,
          uncategorizedTasks: uncategorized,
        };
      });

      // Ensure children inherit parent's category if they don't have their own
      allTopics.filter((t: any) => t.parent_topic_id).forEach((t: any) => {
        if (!topicCategoryMap.has(t.id) && topicCategoryMap.has(t.parent_topic_id)) {
          topicCategoryMap.set(t.id, topicCategoryMap.get(t.parent_topic_id)!);
        }
      });

      const refs: TopicGroupRef[] = allTopics
        .filter((t: any) => topicCategoryMap.has(t.id))
        .map((t: any) => ({ id: t.id, topic_name: t.topic_name, categoryKey: topicCategoryMap.get(t.id)!, parentTopicId: t.parent_topic_id || undefined }));
      setAllTopicGroupRefs(refs);
      setCategories(catData);

      // Track unmapped count for UI
      const unmapped = tasks.filter(t => !assignedTaskIds.has(t.id) && !t.title.toLowerCase().includes('test'));
      setUnmappedCount(unmapped.length);
    } catch (err) {
      console.error('Failed to load priorities data:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  loadDataRef.current = loadData;
  useEffect(() => { loadData(); }, [loadData]);

  // Auto-classify up to 10 unmapped tasks on first load
  useEffect(() => {
    if (!loading && unmappedCount > 0 && !autoClassifyRan.current && !classifying) {
      autoClassifyRan.current = true;
      console.log(`[Priorities] Auto-classifying up to 10 of ${unmappedCount} unmapped tasks`);
      classifyUnmapped(10);
    }
  }, [loading, unmappedCount, classifying, classifyUnmapped]);

  const handleDragEnd = useCallback(async (result: DropResult) => {
    console.log('[DragEnd] Raw result:', JSON.stringify(result));
    if (!result.destination || !user) {
      console.log('[DragEnd] Abort: no destination or no user');
      return;
    }
    const { source, destination, type, draggableId } = result;
    console.log('[DragEnd] Type:', type, 'From:', source.droppableId, '->', destination.droppableId);

    if (type === 'TASK') {
      // Task dragged between categories
      const srcCatKey = source.droppableId.replace('tasks-', '');
      const dstCatKey = destination.droppableId.replace('tasks-', '');
      console.log('[DragEnd:TASK] srcCat:', srcCatKey, 'dstCat:', dstCatKey, 'srcIdx:', source.index, 'dstIdx:', destination.index);
      if (srcCatKey === dstCatKey && source.index === destination.index) {
        console.log('[DragEnd:TASK] Same position, ignoring');
        return;
      }

      // Find the task
      const srcCat = categories.find(c => c.key === srcCatKey);
      if (!srcCat) {
        console.error('[DragEnd:TASK] Source category not found:', srcCatKey);
        return;
      }
      const allSrcTasks = [
        ...srcCat.topicGroups.flatMap(tg => tg.tasks),
        ...srcCat.uncategorizedTasks,
      ];
      const seen = new Set<string>();
      const dedupedSrcTasks = allSrcTasks.filter(t => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });
      const task = dedupedSrcTasks[source.index];
      if (!task) {
        console.error('[DragEnd:TASK] Task not found at index:', source.index, 'total tasks:', dedupedSrcTasks.length);
        return;
      }
      console.log('[DragEnd:TASK] Moving task:', task.id, task.title, 'from', srcCatKey, 'to', dstCatKey);

      // Optimistic update
      setCategories(prev => prev.map(cat => {
        if (cat.key === srcCatKey) {
          return {
            ...cat,
            topicGroups: cat.topicGroups.map(tg => ({
              ...tg,
              tasks: tg.tasks.filter(t => t.id !== task.id),
            })),
            uncategorizedTasks: cat.uncategorizedTasks.filter(t => t.id !== task.id),
          };
        }
        if (cat.key === dstCatKey) {
          const updatedTask = { ...task, category: dstCatKey as Task['category'] };
          return {
            ...cat,
            uncategorizedTasks: [...cat.uncategorizedTasks, updatedTask],
          };
        }
        return cat;
      }));

      // Persist
      const { error, status, statusText } = await supabase.from('tasks').update({ category: dstCatKey } as any).eq('id', task.id);
      console.log('[DragEnd:TASK] DB update result:', { error, status, statusText });
      if (error) {
        console.error('[DragEnd:TASK] DB error, reloading:', error);
        toast.error('Failed to move task');
        loadData();
      } else {
        console.log('[DragEnd:TASK] Success');
      }
      return;
    }

    // Group drag (type === 'GROUP')
    const srcCatKey = source.droppableId;
    const dstCatKey = destination.droppableId;
    console.log('[DragEnd:GROUP] draggableId:', draggableId, 'srcCat:', srcCatKey, 'dstCat:', dstCatKey);

    // Helper to persist positions to database
    const persistPositions = async (groups: TopicGroupData[]) => {
      const updates = groups.map((g, i) =>
        supabase.from('task_topic_index').update({ position: i } as any).eq('id', g.id)
      );
      await Promise.all(updates);
    };

    if (srcCatKey === dstCatKey) {
      console.log('[DragEnd:GROUP] Reorder within same column');
      // Reorder within same column
      let reorderedGroups: TopicGroupData[] = [];
      setCategories(prev => prev.map(cat => {
        if (cat.key !== srcCatKey) return cat;
        const groups = [...cat.topicGroups];
        const [moved] = groups.splice(source.index, 1);
        groups.splice(destination.index, 0, moved);
        localStorage.setItem(`priorities-order-${user.id}-${srcCatKey}`, JSON.stringify(groups.map(g => g.id)));
        reorderedGroups = groups;
        return { ...cat, topicGroups: groups };
      }));
      // Persist positions to DB
      if (reorderedGroups.length > 0) {
        persistPositions(reorderedGroups).catch(err => console.error('[DragEnd:GROUP] Position persist error:', err));
      }
    } else {
      // Move group to different category
      console.log('[DragEnd:GROUP] Cross-column move from', srcCatKey, 'to', dstCatKey);

      // Capture group data BEFORE optimistic update (categories is stale after setCategories)
      const srcCat = categories.find(c => c.key === srcCatKey);
      const groupBeforeMove = srcCat?.topicGroups.find(g => g.id === draggableId);
      const taskIdsToMove = groupBeforeMove?.tasks.map(t => t.id) || [];

      let movedGroup: TopicGroupData | null = null;
      let srcGroups: TopicGroupData[] = [];
      let dstGroups: TopicGroupData[] = [];

      setCategories(prev => {
        const updated = prev.map(cat => {
          if (cat.key === srcCatKey) {
            const groups = [...cat.topicGroups];
            const [removed] = groups.splice(source.index, 1);
            movedGroup = removed;
            localStorage.setItem(`priorities-order-${user.id}-${srcCatKey}`, JSON.stringify(groups.map(g => g.id)));
            srcGroups = groups;
            return { ...cat, topicGroups: groups };
          }
          return cat;
        });

        if (!movedGroup) return updated;

        return updated.map(cat => {
          if (cat.key === dstCatKey) {
            const groups = [...cat.topicGroups];
            groups.splice(destination.index, 0, movedGroup!);
            localStorage.setItem(`priorities-order-${user.id}-${dstCatKey}`, JSON.stringify(groups.map(g => g.id)));
            dstGroups = groups;
            return { ...cat, topicGroups: groups };
          }
          return cat;
        });
      });

      // Persist category_affinity + positions + update task categories
      const groupId = draggableId;
      const res1 = await supabase.from('task_topic_index').update({ category_affinity: dstCatKey } as any).eq('id', groupId);

      // Persist positions for both source and destination columns
      const positionPromises: Promise<any>[] = [];
      if (srcGroups.length > 0) positionPromises.push(persistPositions(srcGroups));
      if (dstGroups.length > 0) positionPromises.push(persistPositions(dstGroups));
      Promise.all(positionPromises).catch(err => console.error('[DragEnd:GROUP] Position persist error:', err));

      let res2: any = { error: null };
      if (taskIdsToMove.length > 0) {
        res2 = await supabase.from('tasks').update({ category: dstCatKey } as any).in('id', taskIdsToMove);
      }

      if (res1.error || res2.error) {
        toast.error('Failed to move group');
        loadData();
      } else {
        toast.success(`Moved group to ${CATEGORY_LABELS[dstCatKey] || dstCatKey}`);
      }
    }
  }, [user, categories, loadData]);

  const totalTasks = useMemo(() =>
    categories.reduce((sum, cat) =>
      sum + cat.topicGroups.reduce((s, tg) => s + tg.tasks.length, 0) + cat.uncategorizedTasks.length, 0
    ), [categories]);

  const categoryRefs: CategoryRef[] = useMemo(() =>
    categories.map(c => ({ key: c.key, label: c.label })), [categories]);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[50vh]">
        <div className="animate-pulse text-muted-foreground">Loading priorities...</div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Priorities</h1>
          <p className="text-sm text-muted-foreground">{totalTasks} active tasks across {categories.length} categories</p>
        </div>
        <div className="flex items-center gap-2">
          {unmappedCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => classifyUnmapped()}
              disabled={classifying}
              className="gap-1.5"
            >
              {classifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              <span className="hidden sm:inline">Classify</span>
              <span className="text-xs text-muted-foreground">({unmappedCount})</span>
            </Button>
          )}
        <ToggleGroup type="single" value={viewMode} onValueChange={(v) => v && setViewMode(v as 'group' | 'task')}>
          <ToggleGroupItem value="group" aria-label="Group view" className="gap-1.5">
            <Layers className="h-4 w-4" />
            <span className="hidden sm:inline text-sm">Group</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="task" aria-label="Task view" className="gap-1.5">
            <List className="h-4 w-4" />
            <span className="hidden sm:inline text-sm">Task</span>
          </ToggleGroupItem>
        </ToggleGroup>
        </div>
      </div>

      {/* Batch action bar */}
      {selectedTaskIds.size > 0 && (
        <div className="sticky top-0 z-20 flex items-center gap-3 p-3 rounded-lg bg-primary text-primary-foreground shadow-lg">
          <span className="text-sm font-medium">{selectedTaskIds.size} selected</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="secondary" className="gap-1.5">
                <ArrowRight className="h-3.5 w-3.5" />
                Move to…
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {categoryRefs.map(cat => (
                <DropdownMenuItem key={cat.key} onClick={() => batchMoveToCategory(cat.key)}>
                  {cat.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="secondary" className="gap-1.5">
                <Layers className="h-3.5 w-3.5" />
                Group…
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-64 overflow-y-auto">
              {categoryRefs.map(cat => {
                const groupsInCat = allTopicGroupRefs.filter(g => g.categoryKey === cat.key);
                if (groupsInCat.length === 0) return null;
                const parents = groupsInCat.filter(g => !g.parentTopicId);
                const childrenOf = (pid: string) => groupsInCat.filter(g => g.parentTopicId === pid);
                return (
                  <React.Fragment key={cat.key}>
                    <DropdownMenuItem disabled className="text-xs font-semibold text-muted-foreground uppercase">
                      {cat.label}
                    </DropdownMenuItem>
                    {parents.map(g => (
                      <React.Fragment key={g.id}>
                        <DropdownMenuItem onClick={() => batchMoveToGroup(g.id, g.categoryKey)} className="pl-6">
                          {g.topic_name}
                        </DropdownMenuItem>
                        {childrenOf(g.id).map(child => (
                          <DropdownMenuItem key={child.id} onClick={() => batchMoveToGroup(child.id, child.categoryKey)} className="pl-10 text-sm">
                            {child.topic_name}
                          </DropdownMenuItem>
                        ))}
                      </React.Fragment>
                    ))}
                  </React.Fragment>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="secondary" className="gap-1.5">
                <CircleDot className="h-3.5 w-3.5" />
                Status…
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {[
                { value: 'TODO', label: 'To Do' },
                { value: 'READY', label: 'Ready' },
                { value: 'UP_NEXT', label: 'Up Next' },
                { value: 'DOING', label: 'Doing' },
                { value: 'DONE', label: 'Done' },
                { value: 'BLOCKED', label: 'Blocked' },
                { value: 'BACKLOG', label: 'Backlog' },
              ].map(s => (
                <DropdownMenuItem key={s.value} onClick={() => batchChangeStatus(s.value)}>
                  {s.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="ghost" className="ml-auto text-primary-foreground/80 hover:text-primary-foreground" onClick={clearSelection}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {categories.map(cat => (
            <CategoryColumn
              key={cat.key}
              category={cat}
              viewMode={viewMode}
              onRefresh={loadData}
              allCategories={categoryRefs}
              allTopicGroupRefs={allTopicGroupRefs}
              selectedTaskIds={selectedTaskIds}
              onToggleTaskSelection={toggleTaskSelection}
              onOpenTask={setSelectedTask}
            />
          ))}
        </div>
      </DragDropContext>

      <TaskDetailModal
        task={selectedTask}
        isOpen={!!selectedTask}
        onClose={() => setSelectedTask(null)}
        onSave={() => { setSelectedTask(null); loadData(); }}
      />
    </div>
  );
};

export default Priorities;
