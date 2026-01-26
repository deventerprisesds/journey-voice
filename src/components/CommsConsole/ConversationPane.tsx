import React from 'react';
import { cn } from '@/lib/utils';
import VoiceOrb from './VoiceOrb';
import TranscriptScroll from './TranscriptScroll';
import type { VoiceState, CommunicationMode, ConversationMessage } from './types';

interface ConversationPaneProps {
  mode: CommunicationMode;
  voiceState: VoiceState;
  messages: ConversationMessage[];
  orbColor?: string;
  isLoading?: boolean;
  className?: string;
}

const ConversationPane: React.FC<ConversationPaneProps> = ({
  mode,
  voiceState,
  messages,
  orbColor = '#3B82F6',
  isLoading = false,
  className,
}) => {
  const showOrb = mode === 'voice' || mode === 'phone';

  return (
    <div className={cn('flex flex-col flex-1 min-h-0', className)}>
      {/* Voice/Phone orb area */}
      {showOrb && (
        <div className="flex items-center justify-center py-8 flex-shrink-0">
          <VoiceOrb
            state={voiceState}
            color={orbColor}
            size="lg"
          />
        </div>
      )}

      {/* Transcript area */}
      <TranscriptScroll
        messages={messages}
        isLoading={isLoading}
        className="flex-1 min-h-0"
      />
    </div>
  );
};

export default ConversationPane;
