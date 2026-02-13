import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { CalendarCheck, Sparkles, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { InteractiveContent } from '@/hooks/useChatAssistant';

interface ChatInteractiveMessageProps {
  interactive: InteractiveContent;
  onTopicSelect?: (topicName: string) => void;
  onScheduleTasks?: (taskIds: string[]) => void;
  disabled?: boolean;
}

const ChatInteractiveMessage: React.FC<ChatInteractiveMessageProps> = ({
  interactive,
  onTopicSelect,
  onScheduleTasks,
  disabled = false
}) => {
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());

  if (interactive.type === 'topic_selection' && interactive.topics) {
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        {interactive.topics.map((topic) => (
          <Button
            key={topic.topic_name}
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onTopicSelect?.(topic.topic_name)}
            className={cn(
              "text-xs rounded-full border-primary/30 hover:bg-primary/10 hover:border-primary/60 transition-colors",
              topic.priority_density > 0 && "border-destructive/40 hover:border-destructive/60"
            )}
          >
            <Sparkles className="h-3 w-3 mr-1 text-primary" />
            {topic.topic_name}
            <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0">
              {topic.task_count}
            </Badge>
            {topic.priority_density > 0 && (
              <Badge variant="destructive" className="ml-1 text-[10px] px-1.5 py-0">
                {topic.priority_density} urgent
              </Badge>
            )}
          </Button>
        ))}
      </div>
    );
  }

  if (interactive.type === 'task_selection' && interactive.tasks) {
    const toggleTask = (id: string) => {
      setSelectedTaskIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
    };

    return (
      <div className="mt-2 space-y-2">
        {interactive.tasks.map((task) => (
          <label
            key={task.id}
            className={cn(
              "flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-colors",
              selectedTaskIds.has(task.id)
                ? "bg-primary/5 border-primary/40"
                : "bg-card border-border hover:border-primary/30"
            )}
          >
            <Checkbox
              checked={selectedTaskIds.has(task.id)}
              onCheckedChange={() => toggleTask(task.id)}
              disabled={disabled}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{task.title}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                {task.category && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">{task.category}</Badge>
                )}
                <Badge
                  variant={task.priority === 'HIGH' || task.priority === 'URGENT' ? 'destructive' : 'secondary'}
                  className="text-[10px] px-1.5 py-0"
                >
                  {task.priority}
                </Badge>
              </div>
            </div>
          </label>
        ))}

        <Button
          size="sm"
          disabled={disabled || selectedTaskIds.size === 0}
          onClick={() => onScheduleTasks?.(Array.from(selectedTaskIds))}
          className="w-full mt-2"
        >
          <CalendarCheck className="h-4 w-4 mr-2" />
          Schedule {selectedTaskIds.size > 0 ? `${selectedTaskIds.size} ` : ''}Selected
        </Button>
      </div>
    );
  }

  if (interactive.type === 'confirmation') {
    return (
      <div className="mt-2 flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20">
        <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
        <p className="text-sm text-foreground">
          {interactive.scheduledCount} task{(interactive.scheduledCount || 0) > 1 ? 's' : ''} scheduled successfully!
        </p>
      </div>
    );
  }

  return null;
};

export default ChatInteractiveMessage;
