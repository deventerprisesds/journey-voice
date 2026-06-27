import React from 'react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import VoiceOrb from './VoiceOrb';
import PhoneDialer from './PhoneDialer';
import TranscriptScroll from './TranscriptScroll';
import type { VoiceState, CommunicationMode, ConversationMessage, PhoneCallState } from './types';

interface ConversationPaneProps {
  mode: CommunicationMode;
  voiceState: VoiceState;
  messages: ConversationMessage[];
  orbColor?: string;
  isLoading?: boolean;
  className?: string;
  isConnected?: boolean;
  onVoiceToggle?: () => void;
  phoneCallState?: PhoneCallState;
  onPhoneCallStateChange?: (state: PhoneCallState) => void;
  onRetry?: () => void;
}

const ConversationPane: React.FC<ConversationPaneProps> = ({
  mode,
  voiceState,
  messages,
  orbColor = '#3B82F6',
  isLoading = false,
  className,
  isConnected = false,
  onVoiceToggle,
  phoneCallState = 'idle',
  onPhoneCallStateChange,
  onRetry,
}) => {
  return (
    <div className={cn('flex flex-col flex-1 min-h-0', className)}>
      {/* Voice orb area - clickable to connect/disconnect */}
      {mode === 'voice' && (
        <div className="flex flex-col items-center justify-center py-8 flex-shrink-0 gap-2">
          <VoiceOrb
            state={voiceState}
            color={orbColor}
            size="lg"
            isConnected={isConnected}
            onClick={onVoiceToggle}
          />
          <span className="text-xs text-muted-foreground">
            {isConnected ? 'Tap to disconnect' : 'Tap to connect'}
          </span>
        </div>
      )}

      {/* Phone dialer area - wrapped in ScrollArea for proper scrolling */}
      {mode === 'phone' && onPhoneCallStateChange && (
        <ScrollArea className="flex-1 min-h-0">
          <div className="flex flex-col items-center py-4">
            <PhoneDialer
              callState={phoneCallState}
              onCallStateChange={onPhoneCallStateChange}
            />
          </div>
        </ScrollArea>
      )}

      {/* Transcript area - chat mode only, or voice when actively connected */}
      {(mode === 'chat' || (mode === 'voice' && isConnected)) && (
        <TranscriptScroll
          messages={messages}
          isLoading={isLoading}
          className="flex-1 min-h-0"
          onRetry={onRetry}
        />
      )}
    </div>
  );
};

export default ConversationPane;
