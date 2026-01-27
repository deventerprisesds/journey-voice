import React, { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { VoiceAssistantProvider } from '@/contexts/VoiceAssistantContext';
import VoiceStatusArea from '@/components/VoiceStatusArea';
import DailyScheduleView from '@/components/DailyScheduleView';
import MobilePageHeader from '@/components/MobilePageHeader';
import { Badge } from '@/components/ui/badge';
import { Calendar, LayoutGrid, Settings, Crown, User, LogOut } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';

const DailyPriorities = () => {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { user, signOut, isAdmin, isDemoMode } = useAuth();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const isMobile = useIsMobile();

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

  const navActions = [
    { label: 'Calendar', icon: <Calendar className="h-4 w-4" />, to: '/calendar' },
    { label: 'All Tasks', icon: <LayoutGrid className="h-4 w-4" />, to: '/' },
    { label: 'Settings', icon: <Settings className="h-4 w-4" />, to: '/settings' },
    ...(isAdmin ? [{ label: 'Admin', icon: <Crown className="h-4 w-4" />, to: '/admin' }] : []),
  ];

  return (
    <VoiceAssistantProvider onTaskUpdate={handleTaskUpdate}>
      <div className="min-h-screen bg-background">
        {/* Header with back button and mobile menu */}
        <MobilePageHeader
          title="Today's Priorities"
          subtitle={format(selectedDate, 'EEEE, MMMM d, yyyy')}
          backTo="/"
          navActions={navActions}
          actions={
            <div className="flex items-center gap-2">
              {!isMobile && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <User className="h-4 w-4" />
                  <span className="hidden lg:inline">{user.email}</span>
                  {isDemoMode && <Badge variant="outline">Demo</Badge>}
                </div>
              )}
              <Button 
                variant="ghost" 
                size="icon"
                onClick={signOut}
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          }
        />

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
