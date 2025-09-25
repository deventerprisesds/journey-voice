import React, { useState } from 'react';
import KanbanBoard from '@/components/KanbanBoard';
import VoiceInterface from '@/components/VoiceInterface';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { LogOut, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';

const Dashboard = () => {
  const { user, signOut } = useAuth();
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleTaskUpdate = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  return (
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
                Welcome back, {user?.email?.split('@')[0]}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link to="/admin">
                <Button variant="ghost" size="sm">
                  <Settings className="h-4 w-4 mr-2" />
                  Admin
                </Button>
              </Link>
              <Button variant="ghost" size="sm" onClick={signOut}>
                <LogOut className="h-4 w-4 mr-2" />
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <KanbanBoard refreshTrigger={refreshTrigger} />
      </main>

      {/* Voice Interface */}
      <VoiceInterface onTaskUpdate={handleTaskUpdate} />

      {/* Background Elements */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-0 right-0 w-72 h-72 bg-gradient-to-br from-primary/10 to-productivity/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-gradient-to-tr from-success/10 to-focus/10 rounded-full blur-3xl"></div>
      </div>
    </div>
  );
};

export default Dashboard;