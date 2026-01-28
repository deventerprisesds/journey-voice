import React from 'react';
import { PanelLeft, ChevronDown, PanelRightClose } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import AssistantAvatar from './AssistantAvatar';
import type { Assistant } from './types';

interface AssistantHeaderProps {
  currentAssistant: Assistant | null;
  assistants: Assistant[];
  onSelectAssistant: (assistant: Assistant) => void;
  onToggleSidebar: () => void;
  onClose: () => void;
  isSidebarExpanded: boolean;
  showCloseButton?: boolean;
  showSidebarToggle?: boolean;
  className?: string;
}

const AssistantHeader: React.FC<AssistantHeaderProps> = ({
  currentAssistant,
  assistants,
  onSelectAssistant,
  onToggleSidebar,
  onClose,
  isSidebarExpanded,
  showCloseButton = true,
  showSidebarToggle = true,
  className,
}) => {
  const displayName = currentAssistant?.name || 'Select Assistant';
  const orbColor = currentAssistant?.orb_color || '#3B82F6';

  return (
    <div
      className={cn(
        'flex items-center justify-between px-3 py-2 border-b bg-background/95 backdrop-blur-sm',
        className
      )}
    >
      {/* Left group: Sidebar toggle + Avatar + Dropdown */}
      <div className="flex items-center gap-2">
        {/* Sidebar expand button (conditionally shown) */}
        {showSidebarToggle && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleSidebar}
            className="h-8 w-8 flex-shrink-0"
            aria-label={isSidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            <PanelLeft className={cn('w-4 h-4 transition-transform', isSidebarExpanded && 'rotate-180')} />
          </Button>
        )}

        {/* Avatar */}
        {currentAssistant && (
          <AssistantAvatar
            name={currentAssistant.name}
            avatarUrl={currentAssistant.avatar_url}
            avatarInitial={currentAssistant.avatar_initial}
            orbColor={orbColor}
            size="md"
          />
        )}

        {/* Assistant name dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-1 px-2 h-8">
              <span className="font-medium">{displayName}</span>
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56 bg-popover z-50">
            {assistants.length === 0 ? (
              <DropdownMenuItem disabled>
                No assistants available
              </DropdownMenuItem>
            ) : (
              assistants.map((assistant) => (
                <DropdownMenuItem
                  key={assistant.id}
                  onClick={() => onSelectAssistant(assistant)}
                  className={cn(
                    'flex items-center gap-2 cursor-pointer',
                    currentAssistant?.id === assistant.id && 'bg-accent'
                  )}
                >
                  <AssistantAvatar
                    name={assistant.name}
                    avatarUrl={assistant.avatar_url}
                    avatarInitial={assistant.avatar_initial}
                    orbColor={assistant.orb_color}
                    size="sm"
                  />
                  <div className="flex flex-col">
                    <span className="font-medium">{assistant.name}</span>
                    {assistant.description && (
                      <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                        {assistant.description}
                      </span>
                    )}
                  </div>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Right: Close button (mobile) */}
      {showCloseButton && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-8 w-8"
          aria-label="Collapse panel"
        >
          <PanelRightClose className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
};

export default AssistantHeader;
