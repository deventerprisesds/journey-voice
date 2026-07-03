import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Task } from '@/types/task';
import { toast } from 'sonner';
import { getTodayInTimezone, getDefaultTimezone } from '@/lib/date';

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Query timed out after ${ms}ms`)), ms)
    ),
  ]);

/**
 * Unified task loader that merges:
 * - Live tasks from `tasks` table (always current source of truth)
 * - Historical schedule snapshots from `tasks_with_schedule` view (past dates only)
 *
 * This ensures all tabs (Focus, Agenda, Daily, Weekly, Grid, Kanban) see the same data.
 */
export function useUnifiedTasks() {
  const { user, isDemoMode } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  // showSpinner=false lets realtime updates refresh data without flashing the loading screen
  const loadTasks = useCallback(async (showSpinner = true) => {
    if (!user) {
      setLoading(false);
      return;
    }

    if (showSpinner) setLoading(true);
    const todayStr = getTodayInTimezone(getDefaultTimezone());
    try {
      // Run both queries in parallel; bail out after 10 seconds rather than hanging forever
      const [liveResult, historyResult] = await withTimeout(
        Promise.all([
          supabase
            .from('tasks')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false }),
          supabase
            .from('tasks_with_schedule' as any)
            .select('*')
            .eq('user_id', user.id)
            .eq('from_history', true)
            .lt('scheduled_date', todayStr),
        ]),
        10_000
      );

      const { data: liveTasks, error: liveError } = liveResult;
      const { data: historyRows } = historyResult;

      if (liveError) {
        console.error('[useUnifiedTasks] Live tasks error:', liveError);
        if (isDemoMode) {
          const cached = localStorage.getItem('kanban-demo-tasks');
          setTasks(cached ? JSON.parse(cached) : []);
        } else {
          setTasks([]);
        }
        return;
      }

      const live = (liveTasks || []) as Task[];

      // Merge: add history-only entries that don't duplicate live scheduled tasks
      const liveTaskIds = new Set(live.map(t => t.id));
      const liveScheduledKeys = new Set(
        live.filter(t => t.start_time).map(t => `${t.id}::${t.start_time}`)
      );

      const historyTasks: Task[] = [];
      if (historyRows && historyRows.length > 0) {
        for (const row of historyRows as any[]) {
          // Skip if the live task still has the same start_time (not rolled over)
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
            // History markers for UI
            _historyAction: row.history_action,
            _historyPushedCount: row.history_pushed_count,
            _fromHistory: true,
            _scheduledDate: row.scheduled_date,
          } as Task & Record<string, any>);
        }
      }

      const merged = [...live, ...historyTasks];
      console.log(`[useUnifiedTasks] ${live.length} live + ${historyTasks.length} history = ${merged.length} total`);
      setTasks(merged);

      // Cache for demo fallback
      if (isDemoMode && live.length > 0) {
        try { localStorage.setItem('kanban-demo-tasks', JSON.stringify(live)); } catch {}
      }
    } catch (error) {
      console.error('[useUnifiedTasks] Error:', error);
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [user, isDemoMode]);

  // Initial load
  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Real-time subscription
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

          loadTasks(false);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, loadTasks]);

  return { tasks, loading, reload: loadTasks };
}
