import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import TopicGroupPanel from './TopicGroupPanel';
import AddTopicGroupDialog from './AddTopicGroupDialog';
import type { Task } from '@/types/task';
import type { CategoryData, CategoryRef, TopicGroupRef } from '@/pages/Priorities';

interface CategoryTreeSectionProps {
  category: CategoryData;
  onRefresh: () => void;
  allCategories: CategoryRef[];
  allTopicGroupRefs: TopicGroupRef[];
  selectedTaskIds: Set<string>;
  onToggleTaskSelection: (taskId: string) => void;
  onOpenTask: (task: Task) => void;
  onAddToPriority?: (task: Task) => void;
}

const CategoryTreeSection: React.FC<CategoryTreeSectionProps> = ({
  category, onRefresh, allCategories, allTopicGroupRefs,
  selectedTaskIds, onToggleTaskSelection, onOpenTask, onAddToPriority,
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  const totalTasks = category.topicGroups.reduce((s, tg) =>
    s + tg.tasks.length + (tg.children || []).reduce((cs, c) => cs + c.tasks.length, 0), 0
  ) + category.uncategorizedTasks.length;

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-2.5 bg-muted/20 hover:bg-muted/40 transition-colors text-left"
        style={{ borderLeft: `4px solid ${category.color}` }}
        onClick={() => setIsOpen(v => !v)}
      >
        {isOpen
          ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        }
        <span className="font-semibold text-foreground flex-1 text-sm">{category.label}</span>
        <Badge variant="secondary" className="text-xs font-normal">
          {totalTasks} {totalTasks === 1 ? 'task' : 'tasks'}
        </Badge>
      </button>

      {isOpen && (
        <div className="px-2 py-1.5 space-y-0.5">
          {category.topicGroups.map(tg => (
            <TopicGroupPanel
              key={tg.id}
              topicGroup={tg}
              isDeletable
              onRefresh={onRefresh}
              allCategories={allCategories}
              allTopicGroupRefs={allTopicGroupRefs}
              selectedTaskIds={selectedTaskIds}
              onToggleTaskSelection={onToggleTaskSelection}
              onOpenTask={onOpenTask}
              onAddToPriority={onAddToPriority}
              categoryKey={category.key}
            />
          ))}

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
              selectedTaskIds={selectedTaskIds}
              onToggleTaskSelection={onToggleTaskSelection}
              onOpenTask={onOpenTask}
              onAddToPriority={onAddToPriority}
              categoryKey={category.key}
            />
          )}

          {category.topicGroups.length === 0 && category.uncategorizedTasks.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-3">No tasks</p>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-1 text-muted-foreground hover:text-foreground text-xs"
            onClick={(e) => { e.stopPropagation(); setAddDialogOpen(true); }}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add Group
          </Button>
        </div>
      )}

      <AddTopicGroupDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        categoryKey={category.key}
        onCreated={onRefresh}
      />
    </div>
  );
};

export default CategoryTreeSection;
