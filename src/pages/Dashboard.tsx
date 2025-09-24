import React, { useState } from 'react';
import KanbanBoard from '@/components/KanbanBoard';
import VoiceInterface from '@/components/VoiceInterface';

const Dashboard = () => {
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
                Organize your life, career, ventures, and education
              </p>
            </div>
            <div className="text-sm text-muted-foreground">
              Use voice commands to manage your tasks
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