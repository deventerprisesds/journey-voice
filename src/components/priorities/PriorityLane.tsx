import React from 'react';
import { Droppable, Draggable } from '@hello-pangea/dnd';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Star, X, GripVertical } from 'lucide-react';
import type { Task } from '@/types/task';

interface PriorityLaneProps {
  tasks: Task[];
  onRemove: (taskId: string) => void;
  onOpenTask: (task: Task) => void;
}

const PRIORITY_COLORS: Record<string, string> = {
  URGENT: 'bg-destructive/10 text-destructive border-destructive/20',
  HIGH: 'bg-[hsl(var(--priority-high))]/10 text-[hsl(var(--priority-high))] border-[hsl(var(--priority-high))]/20',
  MEDIUM: 'bg-[hsl(var(--priority-medium))]/10 text-[hsl(var(--priority-medium))] border-[hsl(var(--priority-medium))]/20',
  LOW: 'bg-[hsl(var(--priority-low))]/10 text-[hsl(var(--priority-low))] border-[hsl(var(--priority-low))]/20',
};

const PriorityLane: React.FC<PriorityLaneProps> = ({ tasks, onRemove, onOpenTask }) => {
  return (
    <div className="rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-3">
      <div className="flex items-center gap-2 mb-2">
        <Star className="h-4 w-4 text-primary fill-primary" />
        <span className="text-sm font-semibold text-foreground">My Priorities</span>
        <Badge variant="secondary" className="text-xs">
          {tasks.length}
        </Badge>
      </div>

      <Droppable droppableId="priority-lane" type="TASK" direction="vertical">
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`min-h-[48px] rounded-md transition-colors space-y-1 ${
              snapshot.isDraggingOver ? 'bg-primary/10' : ''
            }`}
          >
            {tasks.length === 0 && !snapshot.isDraggingOver && (
              <p className="text-xs text-muted-foreground text-center py-3">
                Drag tasks here or swipe right to prioritize
              </p>
            )}
            {tasks.map((task, index) => (
              <Draggable key={task.id} draggableId={task.id} index={index}>
                {(dragProvided, dragSnapshot) => (
                  <div
                    ref={dragProvided.innerRef}
                    {...dragProvided.draggableProps}
                    className={`flex items-center gap-2 p-2 rounded-md bg-card border border-border text-sm transition-shadow ${
                      dragSnapshot.isDragging ? 'shadow-lg' : ''
                    }`}
                  >
                    <span
                      {...dragProvided.dragHandleProps}
                      className="text-muted-foreground cursor-grab flex-shrink-0"
                    >
                      <GripVertical className="h-3.5 w-3.5" />
                    </span>
                    <Star className="h-3.5 w-3.5 text-primary fill-primary flex-shrink-0" />
                    <span className="text-xs font-medium text-muted-foreground w-5 flex-shrink-0">
                      #{index + 1}
                    </span>
                    <span
                      className="flex-1 truncate text-foreground cursor-pointer hover:underline"
                      onClick={() => onOpenTask(task)}
                    >
                      {task.title}
                    </span>
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${PRIORITY_COLORS[task.priority] || ''}`}>
                      {task.priority}
                    </Badge>
                    {task.due_date && (
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap hidden sm:inline">
                        {new Date(task.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive flex-shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemove(task.id);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
};

export default PriorityLane;
