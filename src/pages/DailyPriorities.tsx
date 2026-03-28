import React, { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useUnifiedTasks } from '@/hooks/useUnifiedTasks';
import { VoiceAssistantProvider } from '@/contexts/VoiceAssistantContext';
import VoiceStatusArea from '@/components/VoiceStatusArea';
import DailyScheduleView from '@/components/DailyScheduleView';
import MobilePageHeader from '@/components/MobilePageHeader';
import { Badge } from '@/components/ui/badge';
import { Calendar, LayoutGrid, Settings, Crown, User, LogOut } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';

const DailyPriorities = () => {
  const { user, signOut, isAdmin, isDemoMode } = useAuth();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const isMobile = useIsMobile();

  // Unified task loader — live + historical
  const { tasks, loading, reload: handleTaskUpdate } = useUnifiedTasks();

  if (!user) return null;

  const navActions = [
    { label: 'Calendar', icon: <Calendar className="h-4 w-4" />, to: '/calendar' },
    { label: 'All Tasks', icon: <LayoutGrid className="h-4 w-4" />, to: '/' },
    { label: 'Settings', icon: <Settings className="h-4 w-4" />, to: '/settings' },
    ...(isAdmin ? [{ label: 'Admin', icon: <Crown className="h-4 w-4" />, to: '/admin' }] : []),
  ];

  return (
    <VoiceAssistantProvider onTaskUpdate={handleTaskUpdate}>
      <div className="min-h-screen bg-background">
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
              <Button variant="ghost" size="icon" onClick={signOut}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          }
        />

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

        <VoiceStatusArea />
      </div>
    </VoiceAssistantProvider>
  );
};

export default DailyPriorities;
