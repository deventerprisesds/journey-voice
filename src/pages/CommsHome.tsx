import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import CommsConsole from '@/components/CommsConsole/CommsConsole';
import { useCommsConsole } from '@/contexts/CommsConsoleContext';

interface CommsHomeProps {
  autoConnect?: boolean;
}

const CommsHome: React.FC<CommsHomeProps> = ({ autoConnect = false }) => {
  const { user } = useAuth();
  const { setMode, connectVoice } = useCommsConsole();

  useEffect(() => {
    setMode('voice');
    if (autoConnect) {
      connectVoice();
    }
    return () => setMode('chat');
  }, []);

  // Redirect to auth if not logged in
  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold">Please Sign In</h1>
          <p className="text-muted-foreground">You need to be logged in to access the assistant.</p>
          <Link to="/auth">
            <Button>Go to Sign In</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="min-h-[100dvh] w-full bg-background" 
      style={{ 
        overscrollBehavior: 'none',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <CommsConsole embedded />
    </div>
  );
};

export default CommsHome;
