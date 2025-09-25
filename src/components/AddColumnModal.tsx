import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { Task } from "@/types/task";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface AddColumnModalProps {
  boardId: string;
  onColumnCreated: () => void;
  isDemo?: boolean;
}

const availableStatuses: Task['status'][] = [
  'BACKLOG', 'TODO', 'DOING', 'DONE', 'BLOCKED', 'LIFE', 'CAREER', 
  'PROF_EDUCATION', 'VENTURES', 'PLANNING', 'READY', 'UP_NEXT'
];

const statusDisplayNames: Record<Task['status'], string> = {
  'BACKLOG': 'Backlog',
  'TODO': 'To Do',
  'DOING': 'Doing',
  'DONE': 'Done',
  'BLOCKED': 'Blocked',
  'LIFE': 'Life',
  'CAREER': 'Career',
  'PROF_EDUCATION': 'Prof. Education',
  'VENTURES': 'Ventures',
  'PLANNING': 'Planning',
  'READY': 'Ready',
  'UP_NEXT': 'Up Next'
};

export const AddColumnModal: React.FC<AddColumnModalProps> = ({ boardId, onColumnCreated, isDemo = false }) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [status, setStatus] = useState<Task['status']>('TODO');
  const [position, setPosition] = useState<number>(0);
  const [isCreating, setIsCreating] = useState(false);
  const { toast } = useToast();

  const handleCreate = async () => {
    if (!name.trim()) {
      toast({
        title: "Error",
        description: "Column name is required",
        variant: "destructive",
      });
      return;
    }

    setIsCreating(true);

    try {
      if (isDemo) {
        // Handle demo mode with localStorage
        const existingColumns = JSON.parse(localStorage.getItem('demoColumns') || '[]');
        const newColumn = {
          id: `col-${Date.now()}`,
          name: name.trim(),
          board_id: boardId,
          status,
          position: position,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        
        // Update positions of existing columns if needed
        const updatedColumns = existingColumns.map((col: any) => 
          col.position >= position ? { ...col, position: col.position + 1 } : col
        );
        
        updatedColumns.push(newColumn);
        localStorage.setItem('demoColumns', JSON.stringify(updatedColumns));
      } else {
        // First, get columns that need position updates
        const { data: columnsToUpdate } = await supabase
          .from('columns')
          .select('id, position')
          .eq('board_id', boardId)
          .gte('position', position);

        // Update positions one by one
        if (columnsToUpdate) {
          for (const column of columnsToUpdate) {
            await supabase
              .from('columns')
              .update({ position: column.position + 1 })
              .eq('id', column.id);
          }
        }

        

        // Create new column
        const { error: insertError } = await supabase
          .from('columns')
          .insert({
            name: name.trim(),
            board_id: boardId,
            status,
            position
          });

        if (insertError) throw insertError;
      }

      toast({
        title: "Success",
        description: "Column created successfully",
      });

      setOpen(false);
      setName('');
      setStatus('TODO');
      setPosition(0);
      onColumnCreated();
    } catch (error) {
      console.error('Error creating column:', error);
      toast({
        title: "Error",
        description: "Failed to create column",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 px-3">
          <Plus className="h-4 w-4 mr-1" />
          Add Column
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add New Column</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="column-name">Column Name</Label>
            <Input
              id="column-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter column name"
              className="mt-1"
            />
          </div>
          
          <div>
            <Label htmlFor="column-status">Status</Label>
            <Select value={status} onValueChange={(value: Task['status']) => setStatus(value)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableStatuses.map((statusOption) => (
                  <SelectItem key={statusOption} value={statusOption}>
                    {statusDisplayNames[statusOption]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="column-position">Position</Label>
            <Input
              id="column-position"
              type="number"
              min="0"
              value={position}
              onChange={(e) => setPosition(Math.max(0, parseInt(e.target.value) || 0))}
              placeholder="0"
              className="mt-1"
            />
            <p className="text-sm text-muted-foreground mt-1">
              Position where to insert the column (0 = first)
            </p>
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={isCreating}>
              {isCreating ? 'Creating...' : 'Create Column'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};