import React, { useState, useRef, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Send, Bot, User, Loader2, Plus, X, Search, Cloud, Newspaper } from 'lucide-react';
import { useChatAssistant, ChatMessage } from '@/hooks/useChatAssistant';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface ChatInterfaceProps {
  isOpen: boolean;
  onClose: () => void;
  onTaskUpdate?: () => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ isOpen, onClose, onTaskUpdate }) => {
  const { messages, isLoading, sendMessage, createNewThread } = useChatAssistant();
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when messages change or chat opens
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return;
    
    const message = inputValue;
    setInputValue('');
    await sendMessage(message);
    
    // Trigger task update callback if message might have created/modified tasks
    if (onTaskUpdate && (
      message.toLowerCase().includes('task') ||
      message.toLowerCase().includes('create') ||
      message.toLowerCase().includes('schedule')
    )) {
      onTaskUpdate();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewConversation = async () => {
    await createNewThread();
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent 
        side="right" 
        className="w-full sm:w-[420px] p-0 flex flex-col bg-background"
      >
        {/* Header */}
        <SheetHeader className="px-4 py-3 border-b bg-card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Bot className="h-5 w-5 text-primary" />
              </div>
              <div>
                <SheetTitle className="text-base font-semibold">Iris</SheetTitle>
                <p className="text-xs text-muted-foreground">AI Assistant</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleNewConversation}
                title="New conversation"
              >
                <Plus className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </SheetHeader>

        {/* Messages */}
        <ScrollArea className="flex-1 px-4">
          <div className="py-4 space-y-4">
            {messages.length === 0 ? (
              <div className="text-center py-12">
                <Bot className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <h3 className="font-medium text-foreground mb-1">Start a conversation</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Ask me to send emails, Slack messages, create calendar events, or help with tasks.
                </p>
                {/* Quick action buttons for testing */}
                <div className="flex flex-wrap gap-2 justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setInputValue("What's the weather in Baltimore?");
                      setTimeout(() => handleSend(), 100);
                    }}
                    className="text-xs"
                  >
                    <Cloud className="h-3 w-3 mr-1" />
                    Weather
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setInputValue("What are today's top news headlines?");
                      setTimeout(() => handleSend(), 100);
                    }}
                    className="text-xs"
                  >
                    <Newspaper className="h-3 w-3 mr-1" />
                    News
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setInputValue("Search for recent AI developments");
                      setTimeout(() => handleSend(), 100);
                    }}
                    className="text-xs"
                  >
                    <Search className="h-3 w-3 mr-1" />
                    Web Search
                  </Button>
                </div>
              </div>
            ) : (
              messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))
            )}
            {/* Scroll anchor */}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Input */}
        <div className="border-t bg-card p-4">
          <div className="flex items-center gap-2">
            <Input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              disabled={isLoading}
              className="flex-1"
            />
            <Button
              onClick={handleSend}
              disabled={!inputValue.trim() || isLoading}
              size="icon"
              className="shrink-0"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

interface MessageBubbleProps {
  message: ChatMessage;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isUser = message.role === 'user';

  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      {/* Avatar */}
      <div className={cn(
        "h-8 w-8 rounded-full flex items-center justify-center shrink-0",
        isUser ? "bg-primary" : "bg-muted"
      )}>
        {isUser ? (
          <User className="h-4 w-4 text-primary-foreground" />
        ) : (
          <Bot className="h-4 w-4 text-muted-foreground" />
        )}
      </div>

      {/* Content */}
      <div className={cn(
        "flex flex-col max-w-[80%]",
        isUser && "items-end"
      )}>
        <div className={cn(
          "rounded-2xl px-4 py-2.5",
          isUser 
            ? "bg-primary text-primary-foreground rounded-br-md" 
            : "bg-muted text-foreground rounded-bl-md"
        )}>
          {message.isLoading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Thinking...</span>
            </div>
          ) : (
            <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          )}
        </div>
        <span className="text-xs text-muted-foreground mt-1 px-1">
          {format(message.timestamp, 'h:mm a')}
        </span>
      </div>
    </div>
  );
};

export default ChatInterface;
