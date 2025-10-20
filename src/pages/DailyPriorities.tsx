import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { VoiceAssistantProvider } from '@/contexts/VoiceAssistantContext';
import VoiceStatusArea from '@/components/VoiceStatusArea';
import DailyScheduleView from '@/components/DailyScheduleView';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LogOut, Settings, Crown, User, Calendar, LayoutGrid } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';

const DailyPriorities = () => {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { user, signOut, isAdmin, isDemoMode } = useAuth();
  const [selectedDate, setSelectedDate] = useState(new Date());

  useEffect(() => {
    loadTasks();
  }, [user, isDemoMode, selectedDate]);

  // Set up real-time subscription for task changes
  useEffect(() => {
    if (!user || isDemoMode) return;
    
    console.log('📡 Setting up real-time subscription for tasks');
    
    const channel = supabase
      .channel('daily-task-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tasks',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          console.log('✨ Task change detected:', payload);
          loadTasks();
        }
      )
      .subscribe();
    
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, isDemoMode, selectedDate]);

  const loadTasks = async () => {
    if (!user) return;
    
    setLoading(true);
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
          .eq('user_id', user.id)
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

  const handleTaskUpdate = () => {
    loadTasks();
  };

  if (!user) {
    return null;
  }

  return (
    <VoiceAssistantProvider onTaskUpdate={handleTaskUpdate}>
      <div className="min-h-screen bg-background">
        {/* Header */}
        <header className="border-b border-border bg-card sticky top-0 z-40">
          <div className="container mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-6">
              <h1 className="text-2xl font-bold text-primary">
                Today's Priorities
              </h1>
              <p className="text-muted-foreground">
                {format(selectedDate, 'EEEE, MMMM d, yyyy')}
              </p>
            </div>

            <div className="flex items-center gap-4">
              <Link to="/calendar">
                <Button variant="outline" size="sm">
                  <Calendar className="w-4 h-4 mr-2" />
                  Calendar
                </Button>
              </Link>
              
              <Link to="/">
                <Button variant="outline" size="sm">
                  <LayoutGrid className="w-4 h-4 mr-2" />
                  All Tasks
                </Button>
              </Link>

              <Link to="/settings">
                <Button variant="outline" size="sm">
                  <Settings className="w-4 h-4 mr-2" />
                  Settings
                </Button>
              </Link>

              {isAdmin && (
                <Link to="/admin">
                  <Button variant="outline" size="sm">
                    <Crown className="w-4 h-4 mr-2" />
                    Admin
                  </Button>
                </Link>
              )}

              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{user.email}</span>
                {isDemoMode && <Badge variant="outline">Demo</Badge>}
              </div>

              <Button 
                variant="ghost" 
                size="sm"
                onClick={signOut}
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="container mx-auto px-4 py-6">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <p className="text-muted-foreground">Loading tasks...</p>
            </div>
          ) : (
            <DailyScheduleView 
              tasks={tasks}
              selectedDate={selectedDate}
              onDateChange={setSelectedDate}
              onTaskUpdate={handleTaskUpdate}
            />
          )}
        </main>

        {/* Voice Assistant */}
        <VoiceStatusArea />
      </div>
    </VoiceAssistantProvider>
  );
};

export default DailyPriorities;
