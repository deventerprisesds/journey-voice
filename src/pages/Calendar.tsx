import React, { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Task } from '@/types/task';
import CalendarModule from '@/components/CalendarModule';
import TaskCreationModal from '@/components/TaskCreationModal';
import TaskDetailModal from '@/components/TaskDetailModal';
import { toast } from 'sonner';

const Calendar: React.FC = () => {
  const { user, isDemoMode } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

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
    loadTasks();
  }, [isDemoMode]);

  const handleTaskEdit = (task: Task) => {
    setSelectedTask(task);
  };

  const handleCreateTask = (date: Date) => {
    setSelectedDate(date);
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
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Calendar</h1>
          <p className="text-muted-foreground">
            View and manage your tasks in calendar format
          </p>
        </div>
      </div>

      <CalendarModule
        tasks={tasks}
        onTaskEdit={handleTaskEdit}
        onCreateTask={handleCreateTask}
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
        }}
        onTasksCreated={() => handleTaskCreate()}
        boardId="default"
        userId={user?.id || ""}
      />
    </div>
  );
};

export default Calendar;