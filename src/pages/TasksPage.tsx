import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import TabbedKanbanBoard from '@/components/TabbedKanbanBoard';
import TaskGridView from '@/components/EnhancedTaskGridView';
import FocusView from '@/components/FocusView';
import WeeklyAgendaView from '@/components/WeeklyAgendaView';
import TaskDetailModal from '@/components/TaskDetailModal';
import ViewSwitcher, { ViewType } from '@/components/ViewSwitcher';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const TasksPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const viewParam = searchParams.get('view') as ViewType | null;
  const [currentView, setCurrentView] = useState<ViewType>(viewParam || 'focus');
  const [tasks, setTasks] = useState<any[]>([]);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const { user, isDemoMode } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Sync view with URL param
  useEffect(() => {
    if (viewParam && ['kanban', 'grid', 'focus'].includes(viewParam)) {
      setCurrentView(viewParam);
    }
  }, [viewParam]);

  // Set default view to focus if no view param exists
  useEffect(() => {
    if (!viewParam) {
      const newParams = new URLSearchParams(searchParams);
      newParams.set('view', 'focus');
      navigate(`/tasks?${newParams.toString()}`, { replace: true });
    }
  }, [viewParam, searchParams, navigate]);

  // Update URL when view changes
  const handleViewChange = (view: ViewType) => {
    setCurrentView(view);
    const newParams = new URLSearchParams(searchParams);
    newParams.set('view', view);
    navigate(`/tasks?${newParams.toString()}`, { replace: true });
  };

  // Load tasks
  useEffect(() => {
    loadTasks();
  }, [user, isDemoMode]);

  // Set up real-time subscription for task changes (both authenticated and demo modes)
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('task-changes-tasks-page')
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
          console.log('[TasksPage] Task change detected:', payload.eventType, newTask?.title);
          
          if (payload.eventType === 'INSERT') {
            toast.success(`Task Created: "${newTask?.title}"`);
          } else if (payload.eventType === 'UPDATE' && newTask?.start_time && !oldTask?.start_time) {
            toast.success(`Task Scheduled: "${newTask?.title}"`);
          }
          
          loadTasks();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Handle deep linking to specific tasks
  useEffect(() => {
    if (!loading && tasks.length > 0) {
      const urlParams = new URLSearchParams(location.search);
      const taskId = urlParams.get('task');

      if (taskId) {
        const foundTask = tasks.find((t) => t.id === taskId);
        if (foundTask) {
          setSelectedTask(foundTask);
          setIsTaskModalOpen(true);
        } else {
          toast.error('Task not found');
        }

        // Clear the task parameter but keep view and tab
        const newParams = new URLSearchParams(location.search);
        newParams.delete('task');
        navigate(`${location.pathname}?${newParams.toString()}`, { replace: true });
      }
    }
  }, [loading, tasks, location.search, navigate]);

  const loadTasks = async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // Both demo mode and authenticated mode now load from Supabase
      // Demo mode has RLS policies that allow access to demo user data
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at');

      if (error) {
        console.error('[TasksPage] Error loading tasks from Supabase:', error);
        
        // Fallback to localStorage only if Supabase fails in demo mode
        if (isDemoMode) {
          console.log('[TasksPage] Falling back to localStorage for demo mode');
          const demoTasks = localStorage.getItem('kanban-demo-tasks');
          setTasks(demoTasks ? JSON.parse(demoTasks) : []);
        } else {
          setTasks([]);
        }
      } else {
        console.log(`[TasksPage] Loaded ${data?.length || 0} tasks from Supabase`);
        setTasks(data || []);
        
        // Cache to localStorage in demo mode for fallback
        if (isDemoMode && data && data.length > 0) {
          try {
            localStorage.setItem('kanban-demo-tasks', JSON.stringify(data));
          } catch (e) {
            console.warn('[TasksPage] Could not cache demo tasks:', e);
          }
        }
      }
    } catch (error) {
      console.error('[TasksPage] Error in loadTasks:', error);
      setTasks([]);
    } finally {
      setLoading(false);
    }
  };

  const handleTaskUpdate = () => {
    loadTasks();
  };

  const handleTaskEdit = (task: any) => {
    setSelectedTask(task);
    setIsTaskModalOpen(true);
  };

  const handleTaskModalClose = () => {
    setIsTaskModalOpen(false);
    setSelectedTask(null);
  };

  const handleTaskSave = (updatedTask: any) => {
    handleTaskUpdate();
    setIsTaskModalOpen(false);
    setSelectedTask(null);
  };

  const handleStatusChange = async (taskId: string, newStatus: any) => {
    try {
      const { error } = await supabase
        .from('tasks')
        .update({
          status: newStatus,
          completed_at: newStatus === 'DONE' ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', taskId);

      if (error) throw error;

      loadTasks();
      toast.success(newStatus === 'DONE' ? 'Task completed!' : 'Task status updated');
    } catch (error) {
      console.error('Error updating task status:', error);
      toast.error('Failed to update task status');
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60 sticky top-0 z-10 flex-shrink-0">
        <div className="px-4 py-3 md:py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg md:text-2xl font-bold bg-gradient-to-r from-primary to-productivity bg-clip-text text-transparent">
                Tasks
              </h1>
              <p className="text-xs md:text-sm text-muted-foreground hidden sm:block">
                {currentView === 'kanban' ? 'Kanban Board' : 
                 currentView === 'grid' ? 'List View' : 
                 "Today's Command Center"}
              </p>
            </div>
            <ViewSwitcher currentView={currentView} onViewChange={handleViewChange} />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-auto px-4 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
              <p className="text-muted-foreground">Loading tasks...</p>
            </div>
          </div>
        ) : (
          <>
            {currentView === 'kanban' && (
              <TabbedKanbanBoard
                tasks={tasks}
                onTaskUpdate={handleTaskUpdate}
                onTaskEdit={handleTaskEdit}
              />
            )}
            {currentView === 'grid' && (
              <TaskGridView
                tasks={tasks}
                onTaskEdit={handleTaskEdit}
                onStatusChange={handleStatusChange}
              />
            )}
            {currentView === 'focus' && (
              <FocusView
                tasks={tasks}
                onTaskEdit={handleTaskEdit}
                onStatusChange={handleStatusChange}
                onTaskUpdate={handleTaskUpdate}
              />
            )}
          </>
        )}
      </main>

      {/* Task Detail Modal */}
      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          isOpen={isTaskModalOpen}
          onClose={handleTaskModalClose}
          onSave={handleTaskSave}
          allTasks={tasks}
        />
      )}
    </div>
  );
};

export default TasksPage;
