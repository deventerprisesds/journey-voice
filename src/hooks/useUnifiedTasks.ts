import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Task } from '@/types/task';
import { toast } from 'sonner';
import { getTodayInTimezone, getDefaultTimezone } from '@/lib/date';
import { useEffect } from 'react';

/**
 * Unified task loader that merges:
 * - Live tasks from `tasks` table (always current source of truth)
 * - Historical schedule snapshots from `tasks_with_schedule` view (past dates only)
 *
 * Uses React Query for caching so navigating away and back doesn't trigger
 * a full reload. The Realtime subscription invalidates the cache when changes arrive.
 */

const TASKS_QUERY_KEY = (userId: string) => ['tasks', userId] as const;

async function fetchUnifiedTasks(userId: string, isDemoMode: boolean): Promise<Task[]> {
  // 1. Always load live tasks
  const { data: liveTasks, error: liveError } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (liveError) {
    console.error('[useUnifiedTasks] Live tasks error:', liveError);
    if (isDemoMode) {
      const cached = localStorage.getItem('kanban-demo-tasks');
      return cached ? JSON.parse(cached) : [];
    }
    throw liveError;
  }

  const live = (liveTasks || []) as Task[];

  // 2. Load historical rows (past dates where start_time was cleared by rollover)
  const todayStr = getTodayInTimezone(getDefaultTimezone());
  const { data: historyRows } = await supabase
    .from('tasks_with_schedule' as any)
    .select('*')
    .eq('user_id', userId)
    .eq('from_history', true)
    .lt('scheduled_date', todayStr);

  // 3. Merge: add history-only entries that don't duplicate live scheduled tasks
  const liveScheduledKeys = new Set(
    live.filter(t => t.start_time).map(t => `${t.id}::${t.start_time}`)
  );

  const historyTasks: Task[] = [];
  if (historyRows && historyRows.length > 0) {
    for (const row of historyRows as any[]) {
      const key = `${row.id}::${row.start_time}`;
      if (liveScheduledKeys.has(key)) continue;

      historyTasks.push({
        id: row.id,
        title: row.title,
        description: row.description,
        status: row.status,
        priority: row.priority,
        category: row.category,
        estimate_minutes: row.estimate_minutes,
        board_id: row.board_id,
        user_id: row.user_id,
        due_date: row.due_date,
        is_scheduled: row.is_scheduled,
        external_event_id: row.external_event_id,
        pushed_count: row.pushed_count,
        assignment_id: row.assignment_id,
        scheduling_context: row.scheduling_context,
        start_time: row.start_time,
        end_time: row.end_time,
        created_at: row.created_at,
        updated_at: row.updated_at,
        completed_at: row.completed_at,
        _historyAction: row.history_action,
        _historyPushedCount: row.history_pushed_count,
        _fromHistory: true,
        _scheduledDate: row.scheduled_date,
      } as Task & Record<string, any>);
    }
  }

  const merged = [...live, ...historyTasks];
  console.log(`[useUnifiedTasks] ${live.length} live + ${historyTasks.length} history = ${merged.length} total`);

  // Cache for demo fallback
  if (isDemoMode && live.length > 0) {
    try { localStorage.setItem('kanban-demo-tasks', JSON.stringify(live)); } catch {}
  }

  return merged;
}

export function useUnifiedTasks() {
  const { user, isDemoMode } = useAuth();
  const queryClient = useQueryClient();

  const queryKey = user ? TASKS_QUERY_KEY(user.id) : null;

  const { data: tasks = [], isLoading: loading } = useQuery({
    queryKey: queryKey ?? ['tasks', '__no_user__'],
    queryFn: () => fetchUnifiedTasks(user!.id, isDemoMode),
    enabled: !!user,
    staleTime: 60 * 1000,  // 1 minute — short enough to catch changes, long enough to avoid noise
  });

  const reload = useCallback(() => {
    if (queryKey) queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  // Realtime subscription — invalidates the cache on any task change
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('unified-task-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tasks',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const newTask = payload.new as any;
          const oldTask = payload.old as any;
          console.log('[useUnifiedTasks] Change:', payload.eventType, newTask?.title);

          if (payload.eventType === 'INSERT') {
            toast.success(`Task Created: "${newTask?.title}"`);
          } else if (payload.eventType === 'UPDATE' && newTask?.start_time && !oldTask?.start_time) {
            toast.success(`Task Scheduled: "${newTask?.title}"`);
          }

          // Invalidate cache so the next read refetches from DB
          queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY(user.id) });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, queryClient]);

  return { tasks, loading, reload };
}
