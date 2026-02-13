import React, { useState } from 'react';
import { Droppable, Draggable } from '@hello-pangea/dnd';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import TopicGroupPanel from './TopicGroupPanel';
import AddTopicGroupDialog from './AddTopicGroupDialog';
import type { Task } from '@/types/task';
import type { CategoryData, CategoryRef, TopicGroupRef } from '@/pages/Priorities';

interface CategoryColumnProps {
  category: CategoryData;
  viewMode: 'group' | 'task';
  onRefresh: () => void;
  allCategories: CategoryRef[];
  allTopicGroupRefs: TopicGroupRef[];
}

const PRIORITY_ORDER = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;

const CategoryColumn: React.FC<CategoryColumnProps> = ({
  category, viewMode, onRefresh, allCategories, allTopicGroupRefs,
}) => {
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  const totalTasks = category.topicGroups.reduce((s, tg) => s + tg.tasks.length, 0) + category.uncategorizedTasks.length;

  const allTasks = React.useMemo(() => {
    if (viewMode !== 'task') return [];
    const tasks = [...category.topicGroups.flatMap(tg => tg.tasks), ...category.uncategorizedTasks];
    const seen = new Set<string>();
    return tasks.filter(t => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    }).sort((a, b) => {
      const pDiff = (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3);
      if (pDiff !== 0) return pDiff;
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return 0;
    });
  }, [category, viewMode]);

  return (
    <Card className="flex flex-col" style={{ borderTopWidth: '3px', borderTopColor: category.color }}>
      <CardHeader className="pb-3 pt-4 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">{category.label}</CardTitle>
          <Badge variant="secondary" className="text-xs font-normal">
            {totalTasks} {totalTasks === 1 ? 'task' : 'tasks'}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="px-3 pb-3 flex-1 space-y-1">
        {viewMode === 'group' ? (
          <Droppable droppableId={category.key}>
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-1.5 min-h-[40px]">
                {category.topicGroups.map((tg, index) => (
                  <Draggable key={tg.id} draggableId={tg.id} index={index}>
                    {(dragProvided) => (
                      <div
                        ref={dragProvided.innerRef}
                        {...dragProvided.draggableProps}
                        {...dragProvided.dragHandleProps}
                      >
                        <TopicGroupPanel
                          topicGroup={tg}
                          isDeletable
                          onRefresh={onRefresh}
                          allCategories={allCategories}
                          allTopicGroupRefs={allTopicGroupRefs}
                        />
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}

                {category.uncategorizedTasks.length > 0 && (
                  <TopicGroupPanel
                    topicGroup={{
                      id: `uncategorized-${category.key}`,
                      topic_name: 'Uncategorized',
                      topic_summary: null,
                      task_count: category.uncategorizedTasks.length,
                      tasks: category.uncategorizedTasks,
                    }}
                    isDeletable={false}
                    onRefresh={onRefresh}
                    allCategories={allCategories}
                    allTopicGroupRefs={allTopicGroupRefs}
                  />
                )}
              </div>
            )}
          </Droppable>
        ) : (
          <div className="space-y-1">
            {allTasks.map(task => (
              <TaskRow key={task.id} task={task} />
            ))}
            {allTasks.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">No tasks</p>
            )}
          </div>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="w-full mt-2 text-muted-foreground hover:text-foreground"
          onClick={() => setAddDialogOpen(true)}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Group
        </Button>
      </CardContent>

      <AddTopicGroupDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        categoryKey={category.key}
        onCreated={onRefresh}
      />
    </Card>
  );
};

const TaskRow: React.FC<{ task: Task }> = ({ task }) => {
  const priorityColors: Record<string, string> = {
    URGENT: 'bg-destructive/10 text-destructive',
    HIGH: 'bg-[hsl(var(--priority-high))]/10 text-[hsl(var(--priority-high))]',
    MEDIUM: 'bg-[hsl(var(--priority-medium))]/10 text-[hsl(var(--priority-medium))]',
    LOW: 'bg-[hsl(var(--priority-low))]/10 text-[hsl(var(--priority-low))]',
  };

  return (
    <div className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors text-sm">
      <span className="flex-1 truncate text-foreground">{task.title}</span>
      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${priorityColors[task.priority] || ''}`}>
        {task.priority}
      </Badge>
      {task.due_date && (
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
          {new Date(task.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </span>
      )}
    </div>
  );
};

export default CategoryColumn;
