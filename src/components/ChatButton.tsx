import React from 'react';
import { Button } from '@/components/ui/button';
import { MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChatButtonProps {
  onClick: () => void;
  hasUnread?: boolean;
  className?: string;
}

const ChatButton: React.FC<ChatButtonProps> = ({ onClick, hasUnread = false, className }) => {
  return (
    <Button
      onClick={onClick}
      size="lg"
      className={cn(
        "relative h-14 w-14 rounded-full shadow-lg",
        "bg-card hover:bg-card/90 border-2 border-primary/20",
        "transition-all duration-300 hover:scale-105 hover:shadow-xl",
        className
      )}
    >
      <MessageSquare className="h-6 w-6 text-primary" />
      
      {/* Unread indicator */}
      {hasUnread && (
        <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive animate-pulse" />
      )}
    </Button>
  );
};

export default ChatButton;
