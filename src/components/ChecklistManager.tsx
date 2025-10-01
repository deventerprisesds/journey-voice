import { useState } from "react";
import { Check, Plus, Trash2, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { ChecklistItem } from "@/types/task";

interface ChecklistManagerProps {
  taskId: string;
  items: ChecklistItem[];
  onUpdate: () => void;
  compact?: boolean;
}

export function ChecklistManager({ taskId, items, onUpdate, compact = false }: ChecklistManagerProps) {
  const [newItemTitle, setNewItemTitle] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const { toast } = useToast();

  const handleAddItem = async () => {
    if (!newItemTitle.trim()) return;

    setIsAdding(true);
    try {
      const { error } = await supabase
        .from("task_checklist_items")
        .insert({
          task_id: taskId,
          title: newItemTitle.trim(),
          position: items.length,
        });

      if (error) throw error;

      setNewItemTitle("");
      onUpdate();
      toast({
        title: "Item added",
        description: "Checklist item added successfully",
      });
    } catch (error) {
      console.error("Error adding checklist item:", error);
      toast({
        title: "Error",
        description: "Failed to add checklist item",
        variant: "destructive",
      });
    } finally {
      setIsAdding(false);
    }
  };

  const handleToggleItem = async (itemId: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from("task_checklist_items")
        .update({ is_completed: !currentStatus })
        .eq("id", itemId);

      if (error) throw error;
      onUpdate();
    } catch (error) {
      console.error("Error toggling checklist item:", error);
      toast({
        title: "Error",
        description: "Failed to update checklist item",
        variant: "destructive",
      });
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    try {
      const { error } = await supabase
        .from("task_checklist_items")
        .delete()
        .eq("id", itemId);

      if (error) throw error;
      onUpdate();
      toast({
        title: "Item removed",
        description: "Checklist item removed successfully",
      });
    } catch (error) {
      console.error("Error deleting checklist item:", error);
      toast({
        title: "Error",
        description: "Failed to remove checklist item",
        variant: "destructive",
      });
    }
  };

  const completedCount = items.filter(item => item.is_completed).length;
  const totalCount = items.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <div className="space-y-3">
      {totalCount > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {completedCount} of {totalCount} completed
            </span>
            <span className="text-muted-foreground">{Math.round(progress)}%</span>
          </div>
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="space-y-2">
        {items
          .sort((a, b) => a.position - b.position)
          .map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 group py-1"
            >
              {!compact && (
                <GripVertical className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              )}
              <Checkbox
                checked={item.is_completed}
                onCheckedChange={() => handleToggleItem(item.id, item.is_completed)}
              />
              <span
                className={`flex-1 text-sm ${
                  item.is_completed ? "line-through text-muted-foreground" : ""
                }`}
              >
                {item.title}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => handleDeleteItem(item.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Add checklist item..."
          value={newItemTitle}
          onChange={(e) => setNewItemTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleAddItem();
            }
          }}
          className="flex-1"
        />
        <Button
          onClick={handleAddItem}
          disabled={isAdding || !newItemTitle.trim()}
          size="icon"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
