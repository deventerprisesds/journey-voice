import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { DragDropContext, DropResult } from '@hello-pangea/dnd';
import { Button } from '@/components/ui/button';
import { Sparkles, Loader2, X, ArrowRight, CircleDot, Layers, ChevronDown } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import CategoryTreeSection from '@/components/priorities/CategoryTreeSection';
import TopicGroupPanel from '@/components/priorities/TopicGroupPanel';
import PriorityLane from '@/components/priorities/PriorityLane';
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

// Fixed display categories — always rendered first in this order
const DISPLAY_CATEGORIES = ['LIFE', 'CAREER', 'VENTURES', 'EDUCATION', 'FAMILY'] as const;

// Maps raw DB category values to a display category.
// Any key NOT present here is treated as a dynamic category and appended after.
const CATEGORY_DISPLAY_MAP: Record<string, string> = {
  LIFE: 'LIFE',
  PERSONAL: 'LIFE',
  CAREER: 'CAREER',
  VENTURES: 'VENTURES',
  EDUCATION: 'EDUCATION',
  PROF_EDUCATION: 'EDUCATION',
  FAMILY: 'FAMILY',
};

const CATEGORY_COLORS: Record<string, string> = {
  LIFE: 'hsl(var(--category-life))',
  CAREER: 'hsl(var(--category-career))',
  VENTURES: 'hsl(var(--category-ventures))',
  EDUCATION: 'hsl(var(--category-education))',
  FAMILY: 'hsl(220 14% 55%)',
};

const CATEGORY_LABELS: Record<string, string> = {
  LIFE: 'Life & Personal',
  CAREER: 'Career',
  VENTURES: 'Ventures',
  EDUCATION: 'Education',
  FAMILY: 'Family',
};

// Color palette cycled for dynamically detected categories
const DYNAMIC_CATEGORY_PALETTE = [
  'hsl(280 60% 55%)',
  'hsl(340 60% 55%)',
  'hsl(20 65% 55%)',
  'hsl(160 55% 45%)',
  'hsl(200 65% 50%)',
];

const PRIORITY_SORT = (a: Task, b: Task) => {
  const order: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  return (order[a.priority] ?? 3) - (order[b.priority] ?? 3);
};

const Priorities: React.FC = () => {
  const { user } = useAuth();
  const [topLevel, setTopLevel] = useState<'category' | 'group'>('category');
  const [categories, setCategories] = useState<CategoryData[]>([]);
  const [priorityLaneTasks, setPriorityLaneTasks] = useState<Task[]>([]);
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
    const { error } = await supabase.from('tasks').update({ category: targetCategory } as any).in('id', ids);
    if (error) {
      toast.error('Failed to move tasks');
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
      await supabase.from('task_topic_mappings').delete().in('task_id', ids);
      const { error } = await supabase.from('task_topic_mappings').insert(
        ids.map(task_id => ({ task_id, topic_id: targetTopicId }))
      );
      if (error) throw error;
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

  const classifySingleTask = useCallback(async (task: Task) => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/classify-task-topic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_PUBLISHABLE_KEY },
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

  const classifyUnmapped = useCallback(async (limit?: number) => {
    if (!user) return;
    setClassifying(true);
    try {
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
      const BATCH = 3;
      for (let i = 0; i < unmapped.length; i += BATCH) {
        const batch = unmapped.slice(i, i + BATCH);
        await Promise.all(batch.map(t => classifySingleTask(t)));
        if (i + BATCH < unmapped.length) await new Promise(r => setTimeout(r, 500));
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
      const [topicsRes, mappingsRes, tasksRes] = await Promise.all([
        supabase.from('task_topic_index').select('*').eq('user_id', user.id),
        supabase.from('task_topic_mappings').select('*'),
        supabase.from('tasks').select('*').eq('user_id', user.id).not('status', 'in', '("DONE","BLOCKED")'),
      ]);

      const allTopics = topicsRes.data || [];
      const topics = allTopics.filter((t: any) => !t.parent_topic_id);
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
      mappings.forEach((m: any) => {
        const task = taskMap.get(m.task_id);
        if (task) {
          const existing = topicTasksMap.get(m.topic_id) || [];
          existing.push(task);
          topicTasksMap.set(m.topic_id, existing);
        }
      });

      const assignedTaskIds = new Set<string>(mappings.map((m: any) => m.task_id));

      // Map each topic to a display category.
      // Unknown category values pass through as-is so dynamic sections can pick them up.
      const topicCategoryMap = new Map<string, string>();
      allTopics.forEach((topic: any) => {
        const topicTasks = topicTasksMap.get(topic.id) || [];
        if (topicTasks.length > 0) {
          const catCounts: Record<string, number> = {};
          topicTasks.forEach(t => {
            const cat = CATEGORY_DISPLAY_MAP[t.category] || t.category || 'LIFE';
            catCounts[cat] = (catCounts[cat] || 0) + 1;
          });
          const majorCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0][0];
          topicCategoryMap.set(topic.id, majorCat);
        } else if (topic.category_affinity) {
          // Pass through unknown affinities instead of dropping them
          topicCategoryMap.set(topic.id, CATEGORY_DISPLAY_MAP[topic.category_affinity] || topic.category_affinity);
        } else if (topic.window_affinity && topic.window_affinity.length > 0) {
          topicCategoryMap.set(topic.id, CATEGORY_DISPLAY_MAP[topic.window_affinity[0]] || topic.window_affinity[0]);
        }
      });

      // Child topics inherit parent category if unset
      allTopics.filter((t: any) => t.parent_topic_id).forEach((t: any) => {
        if (!topicCategoryMap.has(t.id) && topicCategoryMap.has(t.parent_topic_id)) {
          topicCategoryMap.set(t.id, topicCategoryMap.get(t.parent_topic_id)!);
        }
      });

      const positionMap = new Map<string, number>();
      allTopics.forEach((t: any) => positionMap.set(t.id, t.position ?? 0));

      // Helper to build topic group entries for a given display category key
      const buildTopicGroups = (key: string) => {
        const catTopics = topics
          .filter((t: any) => topicCategoryMap.get(t.id) === key)
          .map((t: any) => ({
            id: t.id,
            topic_name: t.topic_name,
            topic_summary: t.topic_summary,
            task_count: t.task_count,
            tasks: (topicTasksMap.get(t.id) || []).sort(PRIORITY_SORT),
            children: (childrenMap.get(t.id) || []).map((child: any) => ({
              id: child.id,
              topic_name: child.topic_name,
              topic_summary: child.topic_summary,
              task_count: child.task_count,
              tasks: (topicTasksMap.get(child.id) || []).sort(PRIORITY_SORT),
              children: [],
            })),
          }));
        catTopics.sort((a: any, b: any) => {
          const diff = (positionMap.get(a.id) ?? 0) - (positionMap.get(b.id) ?? 0);
          return diff !== 0 ? diff : a.topic_name.localeCompare(b.topic_name);
        });
        return catTopics;
      };

      // --- Static (known) categories ---
      const catData: CategoryData[] = DISPLAY_CATEGORIES.map(key => ({
        key,
        label: CATEGORY_LABELS[key],
        color: CATEGORY_COLORS[key],
        topicGroups: buildTopicGroups(key),
        uncategorizedTasks: tasks.filter(t => {
          const displayCat = CATEGORY_DISPLAY_MAP[t.category] || t.category || 'LIFE';
          return displayCat === key && !assignedTaskIds.has(t.id);
        }),
      }));

      // --- Dynamic categories: keys in the data not covered by CATEGORY_DISPLAY_MAP ---
      const knownDisplaySet = new Set<string>(DISPLAY_CATEGORIES);
      const dynamicKeys = new Set<string>();

      tasks.forEach(t => {
        if (t.category && !CATEGORY_DISPLAY_MAP[t.category]) dynamicKeys.add(t.category);
      });
      topicCategoryMap.forEach(cat => {
        if (!knownDisplaySet.has(cat)) dynamicKeys.add(cat);
      });

      let paletteIdx = 0;
      Array.from(dynamicKeys).sort().forEach(key => {
        const topicGroups = buildTopicGroups(key);
        const uncategorizedTasks = tasks.filter(t => t.category === key && !assignedTaskIds.has(t.id));
        if (topicGroups.length === 0 && uncategorizedTasks.length === 0) return;
        catData.push({
          key,
          label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          color: DYNAMIC_CATEGORY_PALETTE[paletteIdx++ % DYNAMIC_CATEGORY_PALETTE.length],
          topicGroups,
          uncategorizedTasks,
        });
      });

      const refs: TopicGroupRef[] = allTopics
        .filter((t: any) => topicCategoryMap.has(t.id))
        .map((t: any) => ({
          id: t.id,
          topic_name: t.topic_name,
          categoryKey: topicCategoryMap.get(t.id)!,
          parentTopicId: t.parent_topic_id || undefined,
        }));
      setAllTopicGroupRefs(refs);
      setCategories(catData);

      const priorityTasks = tasks
        .filter(t => t.is_priority)
        .sort((a, b) => (a.priority_rank ?? 999) - (b.priority_rank ?? 999));
      setPriorityLaneTasks(priorityTasks);

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

  useEffect(() => {
    if (!loading && unmappedCount > 0 && !autoClassifyRan.current && !classifying) {
      autoClassifyRan.current = true;
      console.log(`[Priorities] Auto-classifying up to 10 of ${unmappedCount} unmapped tasks`);
      classifyUnmapped(10);
    }
  }, [loading, unmappedCount, classifying, classifyUnmapped]);

  const persistPriorityRanks = useCallback(async (laneTasks: Task[]) => {
    await Promise.all(
      laneTasks.map((t, i) =>
        supabase.from('tasks').update({ is_priority: true, priority_rank: i } as any).eq('id', t.id)
      )
    );
  }, []);

  const removePriority = useCallback(async (taskId: string) => {
    setPriorityLaneTasks(prev => {
      const updated = prev.filter(t => t.id !== taskId);
      persistPriorityRanks(updated).catch(console.error);
      return updated;
    });
    await supabase.from('tasks').update({ is_priority: false, priority_rank: null } as any).eq('id', taskId);
  }, [persistPriorityRanks]);

  const addToPriorityLane = useCallback(async (task: Task) => {
    setPriorityLaneTasks(prev => {
      if (prev.some(t => t.id === task.id)) return prev;
      const updated = [...prev, { ...task, is_priority: true, priority_rank: prev.length }];
      persistPriorityRanks(updated).catch(console.error);
      return updated;
    });
  }, [persistPriorityRanks]);

  const handleDragEnd = useCallback(async (result: DropResult) => {
    if (!result.destination || !user) return;
    const { source, destination } = result;
    if (source.droppableId === 'priority-lane' && destination.droppableId === 'priority-lane') {
      setPriorityLaneTasks(prev => {
        const items = [...prev];
        const [moved] = items.splice(source.index, 1);
        items.splice(destination.index, 0, moved);
        persistPriorityRanks(items).catch(console.error);
        return items;
      });
    }
  }, [user, persistPriorityRanks]);

  const totalTasks = useMemo(() =>
    categories.reduce((sum, cat) =>
      sum + cat.topicGroups.reduce((s, tg) =>
        s + tg.tasks.length + (tg.children || []).reduce((cs, c) => cs + c.tasks.length, 0), 0
      ) + cat.uncategorizedTasks.length, 0
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Priorities</h1>
          <p className="text-sm text-muted-foreground">
            {totalTasks} active tasks across {categories.filter(c => c.topicGroups.length > 0 || c.uncategorizedTasks.length > 0).length} categories
          </p>
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 text-sm min-w-[110px] justify-between">
                <span className="text-xs text-muted-foreground">View by</span>
                <span className="font-medium">{topLevel === 'category' ? 'Category' : 'Group'}</span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setTopLevel('category')}>
                Category
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTopLevel('group')}>
                Group
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-primary-foreground/80 hover:text-primary-foreground"
            onClick={clearSelection}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      <DragDropContext onDragEnd={handleDragEnd}>
        {/* Priority Lane */}
        <PriorityLane
          tasks={priorityLaneTasks}
          onRemove={removePriority}
          onOpenTask={setSelectedTask}
        />

        {/* Tree view */}
        <div className="space-y-3 mt-4">
          {topLevel === 'category' ? (
            categories.map(cat => (
              <CategoryTreeSection
                key={cat.key}
                category={cat}
                onRefresh={loadData}
                allCategories={categoryRefs}
                allTopicGroupRefs={allTopicGroupRefs}
                selectedTaskIds={selectedTaskIds}
                onToggleTaskSelection={toggleTaskSelection}
                onOpenTask={setSelectedTask}
                onAddToPriority={addToPriorityLane}
              />
            ))
          ) : (
            // Group mode: groups are top-level, categories shown as colour-dot section labels
            categories.map(cat => {
              const hasContent = cat.topicGroups.length > 0 || cat.uncategorizedTasks.length > 0;
              if (!hasContent) return null;
              return (
                <div key={cat.key}>
                  <div className="flex items-center gap-2 mb-1.5 px-1">
                    <div className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {cat.label}
                    </span>
                  </div>
                  <div className="space-y-0.5 border rounded-lg p-2">
                    {cat.topicGroups.map(tg => (
                      <TopicGroupPanel
                        key={tg.id}
                        topicGroup={tg}
                        isDeletable
                        onRefresh={loadData}
                        allCategories={categoryRefs}
                        allTopicGroupRefs={allTopicGroupRefs}
                        selectedTaskIds={selectedTaskIds}
                        onToggleTaskSelection={toggleTaskSelection}
                        onOpenTask={setSelectedTask}
                        onAddToPriority={addToPriorityLane}
                        categoryKey={cat.key}
                      />
                    ))}
                    {cat.uncategorizedTasks.length > 0 && (
                      <TopicGroupPanel
                        topicGroup={{
                          id: `uncategorized-${cat.key}`,
                          topic_name: 'Uncategorized',
                          topic_summary: null,
                          task_count: cat.uncategorizedTasks.length,
                          tasks: cat.uncategorizedTasks,
                        }}
                        isDeletable={false}
                        onRefresh={loadData}
                        allCategories={categoryRefs}
                        allTopicGroupRefs={allTopicGroupRefs}
                        selectedTaskIds={selectedTaskIds}
                        onToggleTaskSelection={toggleTaskSelection}
                        onOpenTask={setSelectedTask}
                        onAddToPriority={addToPriorityLane}
                        categoryKey={cat.key}
                      />
                    )}
                  </div>
                </div>
              );
            })
          )}
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
