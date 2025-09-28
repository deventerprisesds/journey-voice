import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import KanbanBoard from '@/components/KanbanBoard';
import GanttChart from '@/components/GanttChart';
import TaskGridView from '@/components/EnhancedTaskGridView';
import TaskDetailModal from '@/components/TaskDetailModal';
import ViewSwitcher, { ViewType } from '@/components/ViewSwitcher';
import { VoiceAssistantProvider } from '@/contexts/VoiceAssistantContext';
import VoiceStatusArea from '@/components/VoiceStatusArea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LogOut, Settings, Crown, User, Calendar } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

// Force rebuild - removed VoiceInterface references
const Dashboard = () => {
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [currentView, setCurrentView] = useState<ViewType>('kanban');
  const [tasks, setTasks] = useState<any[]>([]);
  const [selectedTask, setSelectedTask] = useState<any>(null);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const { user, signOut, isAdmin, isDemoMode } = useAuth();

  // Load tasks once at Dashboard level
  useEffect(() => {
    loadTasks();
  }, [user, isDemoMode]);

  const loadTasks = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      if (isDemoMode) {
        // Load from localStorage for demo mode
        const demoTasks = localStorage.getItem('kanban-demo-tasks');
        if (demoTasks) {
          const parsedTasks = JSON.parse(demoTasks);
          setTasks(parsedTasks);
        } else {
          setTasks([]);
        }
      } else {
        // Load from Supabase for real mode
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
    setRefreshTrigger(prev => prev + 1);
    loadTasks(); // Reload tasks when updated
  };

  const handleTaskEdit = (task: any) => {
    console.log('Dashboard - handleTaskEdit called with task:', task?.id);
    setSelectedTask(task);
    setIsTaskModalOpen(true);
  };

  const handleTaskModalClose = () => {
    console.log('Dashboard - closing task modal');
    setIsTaskModalOpen(false);
    setSelectedTask(null);
  };

  const handleTaskSave = (updatedTask: any) => {
    console.log('Dashboard - task saved:', updatedTask?.id);
    handleTaskUpdate();
    setIsTaskModalOpen(false);
    setSelectedTask(null);
  };

  const handleTasksLoaded = (loadedTasks: any[]) => {
    setTasks(loadedTasks);
  };

  // Redirect to auth if not logged in
  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold">Please Sign In</h1>
          <p className="text-muted-foreground">You need to be logged in to access the task manager.</p>
          <Link to="/auth">
            <Button>Go to Sign In</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <VoiceAssistantProvider onTaskUpdate={handleTaskUpdate}>
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
        {/* Header */}
        <header className="border-b bg-card/80 backdrop-blur-sm">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-productivity bg-clip-text text-transparent">
                  Task Manager
                </h1>
                <p className="text-sm text-muted-foreground">
                  Organize your life, career, ventures, and education
                </p>
              </div>
              <div className="flex items-center gap-4">
                <ViewSwitcher 
                  currentView={currentView}
                  onViewChange={setCurrentView}
                />
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {user?.email}
                  </span>
                  {isAdmin && (
                    <Badge variant="secondary" className="flex items-center gap-1">
                      <Crown className="h-3 w-3" />
                      Admin
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Link to="/calendar">
                    <Button variant="outline" size="sm">
                      <Calendar className="h-4 w-4 mr-2" />
                      Calendar
                    </Button>
                  </Link>
                  <Link to="/settings">
                    <Button variant="outline" size="sm">
                      <Settings className="h-4 w-4 mr-2" />
                      Settings
                    </Button>
                  </Link>
                  {isAdmin && (
                    <Link to="/admin">
                      <Button variant="outline" size="sm">
                        <Crown className="h-4 w-4 mr-2" />
                        Admin
                      </Button>
                    </Link>
                  )}
                  <Button variant="outline" size="sm" onClick={signOut}>
                    <LogOut className="h-4 w-4 mr-2" />
                    Sign Out
                  </Button>
                </div>
              </div>
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
                  onTaskUpdate={handleTaskUpdate}
                />
              )}
            </>
          )}
        </main>

        {/* Voice Status Area */}
        <VoiceStatusArea />

        {/* Task Detail Modal - Centralized at Dashboard level */}
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
    </VoiceAssistantProvider>
  );
};

export default Dashboard;