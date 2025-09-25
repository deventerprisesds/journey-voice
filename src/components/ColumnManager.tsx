import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { 
  MoreHorizontal, 
  Edit2, 
  Archive, 
  Palette, 
  Settings2,
  Plus,
  GripVertical
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface Column {
  id: string;
  name: string;
  board_id: string;
  position: number;
  status: 'BLOCKED' | 'CAREER' | 'PROF_EDUCATION' | 'VENTURES' | 'PLANNING' | 'READY' | 'UP_NEXT' | 'DOING' | 'DONE' | 'BACKLOG' | 'TODO';
}

interface ColumnManagerProps {
  column: Column;
  taskCount: number;
  onColumnUpdate: (updatedColumn: Column) => void;
  onColumnArchive?: (columnId: string) => void;
}

const statusColors = {
  BLOCKED: '#ef4444',
  CAREER: '#3b82f6', 
  PROF_EDUCATION: '#8b5cf6',
  VENTURES: '#10b981',
  PLANNING: '#f59e0b',
  READY: '#f97316',
  UP_NEXT: '#6366f1',
  DOING: '#ec4899',
  DONE: '#10b981',
  BACKLOG: '#6b7280',
  TODO: '#64748b',
};

const ColumnManager: React.FC<ColumnManagerProps> = ({ 
  column, 
  taskCount, 
  onColumnUpdate,
  onColumnArchive 
}) => {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [newName, setNewName] = useState(column.name);
  const [selectedColor, setSelectedColor] = useState(statusColors[column.status as keyof typeof statusColors] || '#6b7280');

  const handleRename = async () => {
    if (!newName.trim()) {
      toast({
        title: "Invalid Name",
        description: "Column name cannot be empty",
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase
        .from('columns')
        .update({ name: newName.trim() })
        .eq('id', column.id);

      if (error) throw error;

      onColumnUpdate({ ...column, name: newName.trim() });
      setIsEditing(false);
      
      toast({
        title: "Column Renamed",
        description: `Column renamed to "${newName.trim()}"`,
      });
    } catch (error) {
      console.error('Error renaming column:', error);
      toast({
        title: "Error",
        description: "Failed to rename column",
        variant: "destructive",
      });
    }
  };

  const handleArchive = async () => {
    if (taskCount > 0) {
      toast({
        title: "Cannot Archive",
        description: "Move all tasks out of this column before archiving",
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase
        .from('columns')
        .delete()
        .eq('id', column.id);

      if (error) throw error;

      onColumnArchive?.(column.id);
      
      toast({
        title: "Column Archived",
        description: `"${column.name}" has been archived`,
      });
    } catch (error) {
      console.error('Error archiving column:', error);
      toast({
        title: "Error",
        description: "Failed to archive column",
        variant: "destructive",
      });
    }
  };

  const colorOptions = [
    { color: '#ef4444', name: 'Red' },
    { color: '#f97316', name: 'Orange' },
    { color: '#f59e0b', name: 'Yellow' },
    { color: '#10b981', name: 'Green' },
    { color: '#3b82f6', name: 'Blue' },
    { color: '#6366f1', name: 'Indigo' },
    { color: '#8b5cf6', name: 'Purple' },
    { color: '#ec4899', name: 'Pink' },
    { color: '#6b7280', name: 'Gray' },
  ];

  return (
    <div className="flex items-center gap-2">
      {/* Column Header with Task Count */}
      <div className="flex items-center gap-2 flex-1">
        <GripVertical className="h-4 w-4 text-muted-foreground cursor-move" />
        
        {isEditing ? (
          <div className="flex items-center gap-2 flex-1">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename();
                if (e.key === 'Escape') {
                  setIsEditing(false);
                  setNewName(column.name);
                }
              }}
              className="h-8 text-sm font-medium"
              autoFocus
            />
            <Button size="sm" onClick={handleRename}>
              Save
            </Button>
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={() => {
                setIsEditing(false);
                setNewName(column.name);
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <>
            <h3 
              className="font-medium text-sm cursor-pointer hover:text-primary transition-colors"
              onClick={() => setIsEditing(true)}
            >
              {column.name}
            </h3>
            <Badge 
              variant="secondary" 
              className="text-xs"
              style={{ 
                backgroundColor: selectedColor + '20', 
                color: selectedColor,
                borderColor: selectedColor + '40'
              }}
            >
              {taskCount}
            </Badge>
          </>
        )}
      </div>

      {/* Column Actions Menu */}
      {!isEditing && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => setIsEditing(true)}>
              <Edit2 className="h-4 w-4 mr-2" />
              Rename Column
            </DropdownMenuItem>
            
            <Dialog>
              <DialogTrigger asChild>
                <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                  <Palette className="h-4 w-4 mr-2" />
                  Change Color
                </DropdownMenuItem>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Change Column Color</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-2">
                    {colorOptions.map((option) => (
                      <Button
                        key={option.color}
                        variant={selectedColor === option.color ? "default" : "outline"}
                        className="h-12 p-2 flex flex-col items-center gap-1"
                        onClick={() => setSelectedColor(option.color)}
                        style={{
                          backgroundColor: selectedColor === option.color ? option.color : 'transparent',
                          borderColor: option.color,
                          color: selectedColor === option.color ? 'white' : option.color
                        }}
                      >
                        <div 
                          className="w-4 h-4 rounded-full" 
                          style={{ backgroundColor: option.color }}
                        />
                        <span className="text-xs">{option.name}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <DropdownMenuSeparator />
            
            <DropdownMenuItem 
              onClick={handleArchive}
              className="text-destructive focus:text-destructive"
              disabled={taskCount > 0}
            >
              <Archive className="h-4 w-4 mr-2" />
              Archive Column
              {taskCount > 0 && (
                <span className="ml-2 text-xs text-muted-foreground">
                  ({taskCount} tasks)
                </span>
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
};

export default ColumnManager;