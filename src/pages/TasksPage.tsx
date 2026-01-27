import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import KanbanBoard from '@/components/KanbanBoard';
import TaskGridView from '@/components/EnhancedTaskGridView';
import TaskDetailModal from '@/components/TaskDetailModal';
import ViewSwitcher, { ViewType } from '@/components/ViewSwitcher';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const TasksPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const viewParam = searchParams.get('view') as ViewType | null;
  const [currentView, setCurrentView] = useState<ViewType>(viewParam || 'kanban');
  const [tasks, setTasks] = useState<any[]>([]);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const { user, isDemoMode } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Sync view with URL param
  useEffect(() => {
    if (viewParam && ['kanban', 'grid'].includes(viewParam)) {
      setCurrentView(viewParam);
    }
  }, [viewParam]);

  // Update URL when view changes
  const handleViewChange = (view: ViewType) => {
    setCurrentView(view);
    navigate(`/tasks?view=${view}`, { replace: true });
  };

  // Load tasks
  useEffect(() => {
    loadTasks();
  }, [user, isDemoMode]);

  // Set up real-time subscription for task changes
  useEffect(() => {
    if (!user || isDemoMode) return;

    const channel = supabase
      .channel('task-changes-tasks-page')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'tasks',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          toast.success(`Task Created: "${payload.new.title}" has been added`);
          loadTasks();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, isDemoMode]);

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

        // Clear the task parameter but keep view
        const newParams = new URLSearchParams(location.search);
        newParams.delete('task');
        navigate(`${location.pathname}?${newParams.toString()}`, { replace: true });
      }
    }
  }, [loading, tasks, location.search, navigate]);

  const loadTasks = async () => {
    if (!user) return;

    setLoading(true);
    try {
      if (isDemoMode) {
        const demoTasks = localStorage.getItem('kanban-demo-tasks');
        setTasks(demoTasks ? JSON.parse(demoTasks) : []);
      } else {
        const { data, error } = await supabase
          .from('tasks')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at');

        if (error) {
          console.error('Error loading tasks:', error);
          setTasks([]);
        } else {
          setTasks(data || []);
        }
      }
    } catch (error) {
      console.error('Error in loadTasks:', error);
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

  // Redirect to auth if not logged in
  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold">Please Sign In</h1>
          <p className="text-muted-foreground">You need to be logged in to access tasks.</p>
          <Link to="/auth">
            <Button>Go to Sign In</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      {/* Header */}
      <header className="border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60 sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 md:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 md:gap-4">
              <Link to="/">
                <Button variant="ghost" size="icon">
                  <ArrowLeft className="h-5 w-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-lg md:text-2xl font-bold bg-gradient-to-r from-primary to-productivity bg-clip-text text-transparent">
                  Tasks
                </h1>
                <p className="text-xs md:text-sm text-muted-foreground hidden sm:block">
                  {currentView === 'kanban' ? 'Kanban Board' : 'List View'}
                </p>
              </div>
            </div>
            <ViewSwitcher currentView={currentView} onViewChange={handleViewChange} />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
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
              <KanbanBoard
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

      {/* Background Elements */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-0 right-0 w-72 h-72 bg-gradient-to-br from-primary/10 to-productivity/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-gradient-to-tr from-success/10 to-focus/10 rounded-full blur-3xl"></div>
      </div>
    </div>
  );
};

export default TasksPage;
