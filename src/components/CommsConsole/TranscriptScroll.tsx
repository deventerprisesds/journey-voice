import React, { useRef, useEffect } from 'react';
import { Mic, Phone, MessageSquare, RefreshCw } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ConversationMessage } from './types';

interface TranscriptScrollProps {
  messages: ConversationMessage[];
  isLoading?: boolean;
  className?: string;
  onRetry?: () => void;
}

const sourceIcons: Record<string, React.ElementType> = {
  voice: Mic,
  phone: Phone,
  chat: MessageSquare,
};

const TranscriptScroll: React.FC<TranscriptScrollProps> = ({
  messages,
  isLoading = false,
  className,
  onRetry,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0 && !isLoading) {
    return (
      <div className={cn('flex-1 flex items-center justify-center p-4', className)}>
        <p className="text-muted-foreground text-sm text-center">
          Start a conversation using voice, phone, or text.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className={cn('flex-1', className)} ref={scrollRef}>
      <div className="flex flex-col gap-3 p-4">
        {messages.map((message, index) => {
          const SourceIcon = sourceIcons[message.source] || MessageSquare;
          const isUser = message.role === 'user';
          const isSystem = message.role === 'system';

          return (
            <div
              key={message.id || index}
              className={cn(
                'flex gap-2 animate-fade-in',
                isUser && 'flex-row-reverse',
                isSystem && 'justify-center'
              )}
            >
              {!isSystem && (
                <div
                  className={cn(
                    'flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center',
                    isUser ? 'bg-primary/10' : 'bg-muted'
                  )}
                >
                  <SourceIcon className="w-3 h-3 text-muted-foreground" />
                </div>
              )}

              <div
                className={cn(
                  'max-w-[80%] rounded-lg px-3 py-2',
                  isUser && 'bg-primary text-primary-foreground',
                  !isUser && !isSystem && 'bg-muted',
                  isSystem && 'bg-muted/50 text-muted-foreground text-sm italic'
                )}
              >
                {message.role === 'assistant' && !message.content ? (
                  <div className="flex gap-1 py-1">
                    <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                ) : (
                  <>
                    <p className="text-sm whitespace-pre-wrap break-words">
                      {message.content}
                    </p>
                    {/* Retry button for connection errors */}
                    {isSystem && message.content?.includes('Connection interrupted') && onRetry && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={onRetry}
                        className="mt-2 gap-1.5"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Retry
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}

        {isLoading && !messages.some(m => m.role === 'assistant' && !m.content) && (
          <div className="flex gap-2 animate-fade-in">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-muted flex items-center justify-center">
              <MessageSquare className="w-3 h-3 text-muted-foreground" />
            </div>
            <div className="bg-muted rounded-lg px-3 py-2">
              <div className="flex gap-1">
                <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
};

export default TranscriptScroll;
