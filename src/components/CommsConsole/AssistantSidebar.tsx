import React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import AssistantAvatar from './AssistantAvatar';
import type { Assistant } from './types';

interface AssistantSidebarProps {
  assistants: Assistant[];
  currentAssistant: Assistant | null;
  onSelectAssistant: (assistant: Assistant) => void;
  isExpanded: boolean;
  className?: string;
}

const AssistantSidebar: React.FC<AssistantSidebarProps> = ({
  assistants,
  currentAssistant,
  onSelectAssistant,
  isExpanded,
  className,
}) => {
  return (
    <div
      className={cn(
        'border-r bg-muted/30 transition-all duration-300 flex flex-col',
        isExpanded ? 'w-52' : 'w-14',
        className
      )}
    >
      {/* Header */}
      {isExpanded && (
        <div className="px-3 py-2 border-b">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Assistants
          </h3>
        </div>
      )}

      {/* Assistant list */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {assistants.map((assistant) => {
            const isActive = currentAssistant?.id === assistant.id;

            return (
              <button
                key={assistant.id}
                onClick={() => onSelectAssistant(assistant)}
                className={cn(
                  'w-full flex items-center gap-2 p-2 rounded-lg transition-colors',
                  'hover:bg-accent',
                  isActive && 'bg-accent'
                )}
              >
                <AssistantAvatar
                  name={assistant.name}
                  avatarUrl={assistant.avatar_url}
                  avatarInitial={assistant.avatar_initial}
                  orbColor={assistant.orb_color}
                  size="sm"
                />
                {isExpanded && (
                  <div className="flex-1 text-left overflow-hidden">
                    <p className="text-sm font-medium truncate">{assistant.name}</p>
                    {assistant.description && (
                      <p className="text-xs text-muted-foreground truncate">
                        {assistant.description}
                      </p>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </ScrollArea>

      {/* Add new assistant button */}
      <div className="p-2 border-t">
        <Button
          variant="ghost"
          size={isExpanded ? 'sm' : 'icon'}
          className={cn('w-full', !isExpanded && 'h-10 w-10')}
          onClick={() => {
            // TODO: Open assistant creation modal
            console.log('Create new assistant');
          }}
        >
          <Plus className="w-4 h-4" />
          {isExpanded && <span className="ml-2">New Assistant</span>}
        </Button>
      </div>
    </div>
  );
};

export default AssistantSidebar;
