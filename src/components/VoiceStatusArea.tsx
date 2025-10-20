import React from 'react';
import { Button } from '@/components/ui/button';
import { Mic, Volume2 } from 'lucide-react';
import { useVoiceAssistant } from '@/contexts/VoiceAssistantContext';
import ConnectionStatus from '@/components/ConnectionStatus';
import VoiceAssistantButton from '@/components/VoiceAssistantButton';

const VoiceStatusArea: React.FC = () => {
  const {
    isConnected,
    isListening,
    isSpeaking,
    isProcessing,
    processingStatus,
    connectionError,
    connectToAssistant,
    disconnectAssistant,
    testConnection,
  } = useVoiceAssistant();

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50">
      <div className="flex flex-col items-center gap-4">
        
        {/* Connection Status - only show on error */}
        {connectionError && (
          <div className="w-full max-w-md">
            <ConnectionStatus
              status="error"
              error={connectionError}
              onRetry={connectToAssistant}
            />
          </div>
        )}

        {/* Status indicators */}
        <div className="text-center">
          {isProcessing && (
            <div className="flex items-center gap-2 px-4 py-2 bg-focus/10 rounded-full shadow-lg border animate-fade-up">
              <div className="w-4 h-4 border-2 border-focus border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-focus font-medium">{processingStatus}</span>
            </div>
          )}
          
          {isSpeaking && !isProcessing && (
            <div className="flex items-center gap-2 px-4 py-2 bg-card rounded-full shadow-lg border animate-fade-up">
              <Volume2 className="w-4 h-4 text-primary" />
              <span className="text-sm text-muted-foreground">Assistant is speaking...</span>
              <div className="flex gap-1">
                {[...Array(3)].map((_, i) => (
                  <div
                    key={i}
                    className="w-1 h-4 bg-primary rounded-full animate-wave"
                    style={{ animationDelay: `${i * 0.2}s` }}
                  />
                ))}
              </div>
            </div>
          )}
          
          {isListening && !isSpeaking && !isProcessing && (
            <div className="flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full shadow-lg border animate-fade-up">
              <Mic className="w-4 h-4 text-primary animate-pulse" />
              <span className="text-sm text-primary font-medium">Listening...</span>
            </div>
          )}
        </div>

        {/* Voice Assistant Button */}
        <VoiceAssistantButton />

        {/* Connected state controls */}
        {isConnected && (
          <>
            <div className="flex items-center gap-3">
              <Button
                onClick={disconnectAssistant}
                variant="outline"
                size="sm"
                className="border-border/50"
              >
                Disconnect
              </Button>
            </div>
            
            {/* Connection status */}
            <div className="text-xs text-muted-foreground text-center animate-fade-up">
              Voice assistant ready • Tap microphone to talk
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default VoiceStatusArea;