import React from 'react';
import { MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCommsConsole } from '@/contexts/CommsConsoleContext';
import { cn } from '@/lib/utils';

interface CommsConsoleTriggerProps {
  className?: string;
}

const CommsConsoleTrigger: React.FC<CommsConsoleTriggerProps> = ({ className }) => {
  const { isPanelOpen, togglePanel, currentAssistant, voiceState } = useCommsConsole();

  if (isPanelOpen) {
    return null;
  }

  const orbColor = currentAssistant?.orb_color || '#3B82F6';
  const isActive = voiceState !== 'idle';

  return (
    <Button
      onClick={togglePanel}
      size="icon"
      className={cn(
        'fixed bottom-6 right-6 z-40 h-14 w-14 rounded-full shadow-lg transition-all',
        'hover:scale-105 active:scale-95',
        isActive && 'animate-pulse',
        className
      )}
      style={{
        backgroundColor: orbColor,
      }}
      aria-label="Open Comms Console"
    >
      <MessageSquare className="w-6 h-6 text-white" />
      
      {/* Activity indicator */}
      {isActive && (
        <span 
          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-green-500 border-2 border-background animate-pulse"
        />
      )}
    </Button>
  );
};

export default CommsConsoleTrigger;
