import React, { useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { ChevronRight, ChevronDown, GripVertical } from 'lucide-react';
import type { Task } from '@/types/task';

interface TopicGroup {
  id: string;
  topic_name: string;
  topic_summary: string | null;
  task_count: number | null;
  tasks: Task[];
}

interface TopicGroupPanelProps {
  topicGroup: TopicGroup;
}

const PRIORITY_COLORS: Record<string, string> = {
  URGENT: 'text-destructive',
  HIGH: 'text-[hsl(var(--priority-high))]',
  MEDIUM: 'text-[hsl(var(--priority-medium))]',
  LOW: 'text-[hsl(var(--priority-low))]',
};

const TopicGroupPanel: React.FC<TopicGroupPanelProps> = ({ topicGroup }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center gap-1.5 p-2 rounded-md hover:bg-muted/50 transition-colors text-left group">
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          )}
          <span className="flex-1 text-sm font-medium text-foreground truncate">
            {topicGroup.topic_name}
          </span>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
            {topicGroup.tasks.length}
          </Badge>
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent className="pl-8 pr-2 pb-1 space-y-0.5">
        {topicGroup.tasks.map(task => (
          <div
            key={task.id}
            className="flex items-center gap-2 p-1.5 rounded text-sm hover:bg-muted/30 transition-colors cursor-default"
          >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${PRIORITY_COLORS[task.priority] ? 'bg-current ' + PRIORITY_COLORS[task.priority] : 'bg-muted-foreground'}`} />
            <span className="flex-1 truncate text-foreground/90">{task.title}</span>
            {task.due_date && (
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                {new Date(task.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            )}
          </div>
        ))}
        {topicGroup.tasks.length === 0 && (
          <p className="text-xs text-muted-foreground py-1">No tasks</p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
};

export default TopicGroupPanel;
