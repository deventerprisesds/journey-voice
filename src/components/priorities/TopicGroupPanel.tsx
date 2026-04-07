import React, { useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ChevronRight, ChevronDown, GripVertical, Trash2, MoreHorizontal, ArrowRight, FolderMinus, Plus, Star } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { Task } from '@/types/task';
import type { CategoryRef, TopicGroupRef, TopicGroupData } from '@/pages/Priorities';
import AddTopicGroupDialog from './AddTopicGroupDialog';

interface TopicGroupPanelProps {
  topicGroup: TopicGroupData;
  isDeletable: boolean;
  onRefresh: () => void;
  allCategories: CategoryRef[];
  allTopicGroupRefs: TopicGroupRef[];
  selectedTaskIds: Set<string>;
  onToggleTaskSelection: (taskId: string) => void;
  onOpenTask: (task: Task) => void;
  onAddToPriority?: (task: Task) => void;
  depth?: number;
  categoryKey?: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  URGENT: 'text-destructive',
  HIGH: 'text-[hsl(var(--priority-high))]',
  MEDIUM: 'text-[hsl(var(--priority-medium))]',
  LOW: 'text-[hsl(var(--priority-low))]',
};

const TopicGroupPanel: React.FC<TopicGroupPanelProps> = ({
  topicGroup, isDeletable, onRefresh, allCategories, allTopicGroupRefs, selectedTaskIds, onToggleTaskSelection, onOpenTask,
  depth = 0, categoryKey,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [addSubGroupOpen, setAddSubGroupOpen] = useState(false);

  const handleDeleteGroup = async () => {
    try {
      const { error } = await supabase.from('task_topic_index').delete().eq('id', topicGroup.id);
      if (error) throw error;
      toast.success(`Deleted "${topicGroup.topic_name}"`);
      onRefresh();
    } catch (err: any) {
      toast.error('Failed to delete group');
      console.error(err);
    }
  };

  const handleChangeCategory = async (task: Task, newCategory: string) => {
    try {
      // Update category
      const { error } = await supabase.from('tasks').update({ category: newCategory as any }).eq('id', task.id);
      if (error) throw error;
      // Remove from current topic group so it moves to Uncategorized in target column
      await supabase.from('task_topic_mappings').delete().eq('task_id', task.id);
      toast.success(`Moved "${task.title}" to ${newCategory}`);
      onRefresh();
    } catch (err: any) {
      toast.error('Failed to change category');
      console.error('[ChangeCategory] error:', err?.code, err?.message, err?.details, { taskId: task.id, newCategory });
    }
  };

  const handleMoveToGroup = async (task: Task, targetTopicId: string) => {
    try {
      await supabase.from('task_topic_mappings').delete().eq('task_id', task.id);
      const { error } = await supabase.from('task_topic_mappings').insert({
        task_id: task.id,
        topic_id: targetTopicId,
      });
      if (error) throw error;
      toast.success('Moved to new group');
      onRefresh();
    } catch (err: any) {
      toast.error('Failed to move task');
      console.error('[MoveToGroup] error:', err?.code, err?.message, err?.details, { taskId: task.id, targetTopicId });
    }
  };

  const handleRemoveFromGroup = async (task: Task) => {
    try {
      const { error } = await supabase.from('task_topic_mappings').delete().eq('task_id', task.id);
      if (error) throw error;
      toast.success('Removed from group');
      onRefresh();
    } catch (err: any) {
      toast.error('Failed to remove from group');
      console.error('[RemoveFromGroup] error:', err?.code, err?.message, err?.details, { taskId: task.id });
    }
  };

  const isUncategorized = topicGroup.id.startsWith('uncategorized-');
  const children = topicGroup.children || [];
  const totalTaskCount = topicGroup.tasks.length + children.reduce((sum, c) => sum + c.tasks.length, 0);

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="flex items-center group" style={{ paddingLeft: depth > 0 ? `${depth * 16}px` : undefined }}>
          <CollapsibleTrigger asChild>
            <button className="flex-1 flex items-center gap-1.5 p-2 rounded-md hover:bg-muted/50 transition-colors text-left">
              {!isUncategorized && depth === 0 && (
                <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
              )}
              {isOpen ? (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              )}
              <span className={`flex-1 text-sm font-medium text-foreground truncate ${depth > 0 ? 'text-muted-foreground' : ''}`}>
                {topicGroup.topic_name}
              </span>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
                {totalTaskCount}
              </Badge>
            </button>
          </CollapsibleTrigger>

          {!isUncategorized && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={() => setAddSubGroupOpen(true)}>
                  <Plus className="h-3.5 w-3.5 mr-2" />
                  Add Sub-Group
                </DropdownMenuItem>
                {isDeletable && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setDeleteDialogOpen(true)} className="text-destructive">
                      <Trash2 className="h-3.5 w-3.5 mr-2" />
                      Delete Group
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {isDeletable && isUncategorized && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        <CollapsibleContent className={`pr-2 pb-1 space-y-0.5 ${depth > 0 ? '' : 'pl-8'}`} style={{ paddingLeft: depth > 0 ? `${(depth + 1) * 16 + 32}px` : undefined }}>
          {/* Render child sub-groups first */}
          {children.map(child => (
            <TopicGroupPanel
              key={child.id}
              topicGroup={child}
              isDeletable={true}
              onRefresh={onRefresh}
              allCategories={allCategories}
              allTopicGroupRefs={allTopicGroupRefs}
              selectedTaskIds={selectedTaskIds}
              onToggleTaskSelection={onToggleTaskSelection}
              onOpenTask={onOpenTask}
              depth={depth + 1}
              categoryKey={categoryKey}
            />
          ))}

          {/* Render tasks */}
          {topicGroup.tasks.map(task => (
            <div
              key={task.id}
              onDoubleClick={() => onOpenTask(task)}
              className={`flex items-center gap-2 p-1.5 rounded text-sm hover:bg-muted/30 transition-colors group/task ${selectedTaskIds.has(task.id) ? 'bg-primary/10 ring-1 ring-primary/30' : ''}`}
            >
              <input
                type="checkbox"
                checked={selectedTaskIds.has(task.id)}
                onChange={() => onToggleTaskSelection(task.id)}
                onClick={e => e.stopPropagation()}
                className="h-3.5 w-3.5 rounded border-border accent-primary flex-shrink-0"
              />
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${PRIORITY_COLORS[task.priority] ? 'bg-current ' + PRIORITY_COLORS[task.priority] : 'bg-muted-foreground'}`} />
              <span className="flex-1 truncate text-foreground/90">{task.title}</span>
              {task.due_date && (
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {new Date(task.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover/task:opacity-100 transition-opacity flex-shrink-0"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <ArrowRight className="h-3.5 w-3.5 mr-2" />
                      Change Category
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {allCategories.map(cat => (
                        <DropdownMenuItem
                          key={cat.key}
                          onClick={() => handleChangeCategory(task, cat.key)}
                        >
                          {cat.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>

                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <ArrowRight className="h-3.5 w-3.5 mr-2" />
                      Move to Group
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {allTopicGroupRefs
                        .filter(ref => ref.id !== topicGroup.id)
                        .map(ref => (
                          <DropdownMenuItem
                            key={ref.id}
                            onClick={() => handleMoveToGroup(task, ref.id)}
                          >
                            {ref.topic_name}
                          </DropdownMenuItem>
                        ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>

                  {!isUncategorized && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => handleRemoveFromGroup(task)}>
                        <FolderMinus className="h-3.5 w-3.5 mr-2" />
                        Remove from Group
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
          {topicGroup.tasks.length === 0 && children.length === 0 && (
            <p className="text-xs text-muted-foreground py-1">No tasks</p>
          )}
        </CollapsibleContent>
      </Collapsible>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{topicGroup.topic_name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the group. Tasks in this group will become uncategorized.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteGroup} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AddTopicGroupDialog
        open={addSubGroupOpen}
        onOpenChange={setAddSubGroupOpen}
        categoryKey={categoryKey || ''}
        onCreated={onRefresh}
        parentTopicId={topicGroup.id}
      />
    </>
  );
};

export default TopicGroupPanel;