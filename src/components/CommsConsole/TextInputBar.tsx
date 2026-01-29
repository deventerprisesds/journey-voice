import React, { useState, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { CommunicationMode } from './types';

interface TextInputBarProps {
  onSend: (message: string) => void;
  mode: CommunicationMode;
  disabled?: boolean;
  isLoading?: boolean;
  className?: string;
}

const placeholders: Record<CommunicationMode, string> = {
  voice: 'Type a message or use voice...',
  phone: 'Type a message during call...',
  chat: 'Type a message...',
};

const TextInputBar: React.FC<TextInputBarProps> = ({
  onSend,
  mode,
  disabled = false,
  isLoading = false,
  className,
}) => {
  const [message, setMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !disabled && !isLoading) {
      onSend(message.trim());
      setMessage('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [message]);

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        'flex items-end gap-2 p-3 border-t bg-background',
        className
      )}
    >
      <Textarea
        ref={textareaRef}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholders[mode]}
        disabled={disabled}
        className="min-h-[40px] max-h-[120px] resize-none flex-1"
        rows={1}
      />
      <Button
        type="submit"
        size="icon"
        disabled={!message.trim() || disabled || isLoading}
        className="h-10 w-10 flex-shrink-0"
      >
        {isLoading ? (
          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : (
          <Send className="w-4 h-4" />
        )}
      </Button>
    </form>
  );
};

export default TextInputBar;
