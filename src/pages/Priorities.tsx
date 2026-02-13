import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { DragDropContext, DropResult } from '@hello-pangea/dnd';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Layers, List } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { DEFAULT_SCHEDULING_CONFIG, mergeSchedulingConfig } from '@/config/schedulingRules';
import CategoryColumn from '@/components/priorities/CategoryColumn';
import type { Task } from '@/types/task';
import { toast } from 'sonner';

export interface TopicGroupData {
  id: string;
  topic_name: string;
  topic_summary: string | null;
  task_count: number | null;
  tasks: Task[];
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
      const topics = topicsRes.data || [];
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
      topics.forEach((topic: any) => {
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

      const refs: TopicGroupRef[] = topics
        .filter((t: any) => topicCategoryMap.has(t.id))
        .map((t: any) => ({ id: t.id, topic_name: t.topic_name, categoryKey: topicCategoryMap.get(t.id)! }));

      setAllTopicGroupRefs(refs);
      setCategories(catData);
    } catch (err) {
      console.error('Failed to load priorities data:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleDragEnd = useCallback(async (result: DropResult) => {
    if (!result.destination || !user) return;
    const { source, destination, type, draggableId } = result;

    if (type === 'TASK') {
      // Task dragged between categories
      const srcCatKey = source.droppableId.replace('tasks-', '');
      const dstCatKey = destination.droppableId.replace('tasks-', '');
      if (srcCatKey === dstCatKey && source.index === destination.index) return;

      // Find the task
      const srcCat = categories.find(c => c.key === srcCatKey);
      if (!srcCat) return;
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
      if (!task) return;

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
      const { error } = await supabase.from('tasks').update({ category: dstCatKey } as any).eq('id', task.id);
      if (error) {
        toast.error('Failed to move task');
        loadData();
      }
      return;
    }

    // Group drag (type === 'GROUP')
    const srcCatKey = source.droppableId;
    const dstCatKey = destination.droppableId;

    if (srcCatKey === dstCatKey) {
      // Reorder within same column
      setCategories(prev => prev.map(cat => {
        if (cat.key !== srcCatKey) return cat;
        const groups = [...cat.topicGroups];
        const [moved] = groups.splice(source.index, 1);
        groups.splice(destination.index, 0, moved);
        localStorage.setItem(`priorities-order-${user.id}-${srcCatKey}`, JSON.stringify(groups.map(g => g.id)));
        return { ...cat, topicGroups: groups };
      }));
    } else {
      // Move group to different category
      let movedGroup: TopicGroupData | null = null;

      setCategories(prev => {
        const updated = prev.map(cat => {
          if (cat.key === srcCatKey) {
            const groups = [...cat.topicGroups];
            const [removed] = groups.splice(source.index, 1);
            movedGroup = removed;
            localStorage.setItem(`priorities-order-${user.id}-${srcCatKey}`, JSON.stringify(groups.map(g => g.id)));
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
            return { ...cat, topicGroups: groups };
          }
          return cat;
        });
      });

      // Persist category_affinity + update task categories
      const groupId = draggableId;
      const res1 = await supabase.from('task_topic_index').update({ category_affinity: dstCatKey } as any).eq('id', groupId);

      // Also update all tasks in this group to the new category
      const srcCat = categories.find(c => c.key === srcCatKey);
      const group = srcCat?.topicGroups.find(g => g.id === groupId);
      let res2: any = { error: null };
      if (group && group.tasks.length > 0) {
        const taskIds = group.tasks.map(t => t.id);
        res2 = await supabase.from('tasks').update({ category: dstCatKey } as any).in('id', taskIds);
      }

      if (res1.error || res2.error) {
        toast.error('Failed to move group');
        loadData();
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
            />
          ))}
        </div>
      </DragDropContext>
    </div>
  );
};

export default Priorities;
