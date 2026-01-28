import React, { useState, useEffect } from 'react';
import { Mic, ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { getCurrentTimeInTimezone } from '@/lib/date';

interface LiveTranscriptPanelProps {
  liveTranscript: { role: 'user' | 'assistant'; content: string; isListening: boolean } | null;
  isConnected: boolean;
  userTimezone: string;
  className?: string;
}

const LiveTranscriptPanel: React.FC<LiveTranscriptPanelProps> = ({
  liveTranscript,
  isConnected,
  userTimezone,
  className,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [currentTime, setCurrentTime] = useState(() => getCurrentTimeInTimezone(userTimezone));

  // Update current time every second when expanded
  useEffect(() => {
    if (!isExpanded) return;
    
    const interval = setInterval(() => {
      setCurrentTime(getCurrentTimeInTimezone(userTimezone));
    }, 1000);

    return () => clearInterval(interval);
  }, [isExpanded, userTimezone]);

  return (
    <Collapsible 
      open={isExpanded} 
      onOpenChange={setIsExpanded}
      className={cn('border-t', className)}
    >
      <CollapsibleTrigger className="flex items-center justify-between w-full px-4 py-2 bg-muted/50 hover:bg-muted transition-colors">
        <div className="flex items-center gap-2">
          <Mic className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Live Transcription</span>
          {liveTranscript?.isListening && (
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
              <span className="text-xs text-muted-foreground">Listening...</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono">{currentTime}</span>
          <ChevronDown className={cn(
            "h-4 w-4 text-muted-foreground transition-transform duration-200",
            isExpanded && "rotate-180"
          )} />
        </div>
      </CollapsibleTrigger>
      
      <CollapsibleContent className="px-4 py-3 bg-muted/30 min-h-[80px]">
        {!isConnected ? (
          <p className="text-sm text-muted-foreground italic">
            Connect to see live transcription
          </p>
        ) : !liveTranscript ? (
          <p className="text-sm text-muted-foreground italic">
            Waiting for speech...
          </p>
        ) : (
          <div className="space-y-2">
            <div className={cn(
              "p-2 rounded-lg text-sm",
              liveTranscript.role === 'user' ? "bg-primary/10" : "bg-muted"
            )}>
              <span className="font-medium text-xs uppercase text-muted-foreground">
                {liveTranscript.role === 'user' ? 'You' : 'Assistant'}:
              </span>
              <p className="mt-1">
                {liveTranscript.content || (liveTranscript.isListening ? '...' : '')}
              </p>
            </div>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
};

export default LiveTranscriptPanel;
