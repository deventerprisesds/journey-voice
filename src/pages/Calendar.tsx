import React, { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Task } from '@/types/task';
import CalendarModule from '@/components/CalendarModule';
import TaskCreationModal from '@/components/TaskCreationModal';
import TaskDetailModal from '@/components/TaskDetailModal';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Home } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { useOAuthCallback } from '@/hooks/useOAuthCallback';
import { AssignmentSelectionProvider } from '@/contexts/AssignmentSelectionContext';

const Calendar: React.FC = () => {
  const { user, isDemoMode } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  useOAuthCallback(); // Handle OAuth callbacks
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const [selectedMinute, setSelectedMinute] = useState<number | null>(null);
  const [defaultBoardId, setDefaultBoardId] = useState<string>('');

  // Load default board ID
  const loadDefaultBoard = async () => {
    if (isDemoMode) {
      setDefaultBoardId('demo-board-default');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('boards')
        .select('id')
        .eq('is_default', true)
        .single();

      if (error) {
        // Create default board if none exists
        const { data: newBoard, error: createError } = await supabase
          .from('boards')
          .insert([{
            name: 'Personal Tasks',
            description: 'Your main task board',
            user_id: user?.id || '',
            is_default: true,
            position: 0
          }])
          .select('id')
          .single();

        if (createError) throw createError;
        setDefaultBoardId(newBoard.id);
      } else {
        setDefaultBoardId(data.id);
      }
    } catch (error) {
      console.error('Error loading default board:', error);
      toast.error('Failed to load board');
    }
  };

  // Load tasks
  const loadTasks = async () => {
    try {
      if (isDemoMode) {
        const demoTasks = localStorage.getItem('kanban-demo-tasks');
        if (demoTasks) {
          setTasks(JSON.parse(demoTasks));
        }
      } else {
        const { data, error } = await supabase
          .from('tasks')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) throw error;
        setTasks(data || []);
      }
    } catch (error) {
      console.error('Error loading tasks:', error);
      toast.error('Failed to load tasks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDefaultBoard();
    loadTasks();
  }, [isDemoMode]);

  // Listen for voice task creation events
  useEffect(() => {
    const handleVoiceTaskCreated = () => {
      console.log('Voice task created, refreshing calendar...');
      loadTasks();
    };
    window.addEventListener('voice-task-created', handleVoiceTaskCreated);
    return () => window.removeEventListener('voice-task-created', handleVoiceTaskCreated);
  }, []);

  // Handle deep linking to specific tasks (same as Dashboard)
  useEffect(() => {
    if (!loading && tasks.length > 0) {
      const urlParams = new URLSearchParams(location.search);
      const taskId = urlParams.get('task');
      
      if (taskId) {
        const foundTask = tasks.find(t => t.id === taskId);
        if (foundTask) {
          console.log('Opening task from deep link in Calendar:', taskId);
          setSelectedTask(foundTask);
        } else {
          console.warn('Task not found for deep link:', taskId);
          toast.error('Task not found');
        }
        
        // Clear the query parameter
        navigate(location.pathname, { replace: true });
      }
    }
  }, [loading, tasks, location.search, navigate]);

  const handleTaskEdit = (task: Task) => {
    setSelectedTask(task);
  };

  const handleCreateTask = (date: Date, hour?: number, minute?: number) => {
    setSelectedDate(date);
    setSelectedHour(hour ?? null);
    setSelectedMinute(minute ?? null);
    setIsCreateModalOpen(true);
  };

  const handleTaskUpdate = () => {
    loadTasks();
    setSelectedTask(null);
  };

  const handleTaskCreate = () => {
    loadTasks();
    setIsCreateModalOpen(false);
    setSelectedDate(null);
    setSelectedHour(null);
    setSelectedMinute(null);
  };

  const handleStatusChange = async (taskId: string, newStatus: Task['status']) => {
    try {
      const { error } = await supabase
        .from('tasks')
        .update({ 
          status: newStatus,
          completed_at: newStatus === 'DONE' ? new Date().toISOString() : null,
          updated_at: new Date().toISOString()
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const handleNavigation = () => {
    try {
      console.log('Navigating back to dashboard...');
      navigate('/');
      toast.success('Returning to dashboard');
    } catch (error) {
      console.error('Navigation error:', error);
      // Fallback navigation
      window.location.href = '/';
    }
  };

  return (
    <div className="min-h-screen bg-background">
        {/* Fixed Navigation Header */}
        <div className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container mx-auto p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleNavigation}
                  className="flex items-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Dashboard
                </Button>
                <div>
                  <h1 className="text-2xl font-bold">Calendar</h1>
                  <p className="text-sm text-muted-foreground">
                    View and manage your tasks in calendar format
                  </p>
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleNavigation}
                className="flex items-center gap-2"
              >
                <Home className="h-4 w-4" />
                Dashboard
              </Button>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="container mx-auto p-6 space-y-6">

            <CalendarModule
              tasks={tasks}
              onTaskEdit={handleTaskEdit}
              onCreateTask={handleCreateTask}
              onTaskScheduled={loadTasks}
              onStatusChange={handleStatusChange}
            />

        {/* Task Detail Modal */}
        <TaskDetailModal
          task={selectedTask}
          isOpen={!!selectedTask}
          onClose={() => setSelectedTask(null)}
          onSave={handleTaskUpdate}
          allTasks={tasks}
        />

        {/* Task Creation Modal */}
        <TaskCreationModal
          isOpen={isCreateModalOpen}
          onClose={() => {
            setIsCreateModalOpen(false);
            setSelectedDate(null);
            setSelectedHour(null);
            setSelectedMinute(null);
          }}
          onTasksCreated={() => handleTaskCreate()}
          boardId={defaultBoardId}
          userId={user?.id || ""}
          initialDate={selectedDate}
          initialHour={selectedHour}
          initialMinute={selectedMinute}
        />
        </div>
      </div>
  );
};

export default Calendar;