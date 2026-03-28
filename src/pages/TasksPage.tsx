import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useUnifiedTasks } from '@/hooks/useUnifiedTasks';
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
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Unified task loader — live + historical
  const { tasks, loading, reload: handleTaskUpdate } = useUnifiedTasks();

  // Sync view with URL param
  useEffect(() => {
    if (viewParam && ['kanban', 'grid', 'focus', 'week'].includes(viewParam)) {
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

        const newParams = new URLSearchParams(location.search);
        newParams.delete('task');
        navigate(`${location.pathname}?${newParams.toString()}`, { replace: true });
      }
    }
  }, [loading, tasks, location.search, navigate]);

  const handleTaskEdit = (task: any) => {
    setSelectedTask(task);
    setIsTaskModalOpen(true);
  };

  const handleTaskModalClose = () => {
    setIsTaskModalOpen(false);
    setSelectedTask(null);
  };

  const handleTaskSave = () => {
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

      handleTaskUpdate();
      toast.success(newStatus === 'DONE' ? 'Task completed!' : 'Task status updated');
    } catch (error) {
      console.error('Error updating task status:', error);
      toast.error('Failed to update task status');
    }
  };

  return (
    <div className="h-full flex flex-col">
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
                 currentView === 'week' ? 'Weekly Agenda' :
                 "Today's Command Center"}
              </p>
            </div>
            <ViewSwitcher currentView={currentView} onViewChange={handleViewChange} />
          </div>
        </div>
      </header>

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
              <TabbedKanbanBoard tasks={tasks} onTaskUpdate={handleTaskUpdate} onTaskEdit={handleTaskEdit} />
            )}
            {currentView === 'grid' && (
              <TaskGridView tasks={tasks} onTaskEdit={handleTaskEdit} onStatusChange={handleStatusChange} />
            )}
            {currentView === 'focus' && (
              <FocusView tasks={tasks} onTaskEdit={handleTaskEdit} onStatusChange={handleStatusChange} onTaskUpdate={handleTaskUpdate} />
            )}
            {currentView === 'week' && (
              <WeeklyAgendaView tasks={tasks} onTaskEdit={handleTaskEdit} onStatusChange={handleStatusChange} onTaskUpdate={handleTaskUpdate} />
            )}
          </>
        )}
      </main>

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
