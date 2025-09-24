import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, MoreHorizontal } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import TaskCard from './TaskCard';

interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'BACKLOG' | 'TODO' | 'DOING' | 'DONE';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  category: 'LIFE' | 'CAREER' | 'VENTURES' | 'EDUCATION';
  due_date?: string;
  estimate_minutes?: number;
  blocked_by?: string[];
  board_id: string;
  user_id: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

interface Board {
  id: string;
  name: string;
  description?: string;
  color: string;
  user_id: string;
  position: number;
  is_default: boolean;
}

interface Column {
  id: string;
  name: string;
  board_id: string;
  position: number;
  status: 'BACKLOG' | 'TODO' | 'DOING' | 'DONE';
}

interface KanbanBoardProps {
  refreshTrigger?: number;
}

const statusLabels = {
  BACKLOG: 'Backlog',
  TODO: 'To Do',
  DOING: 'In Progress', 
  DONE: 'Done',
};

const statusColors = {
  BACKLOG: 'border-status-backlog bg-status-backlog/5',
  TODO: 'border-status-todo bg-status-todo/5',
  DOING: 'border-status-doing bg-status-doing/5',
  DONE: 'border-status-done bg-status-done/5',
};

const KanbanBoard: React.FC<KanbanBoardProps> = ({ refreshTrigger }) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [board, setBoard] = useState<Board | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);

  const fetchBoardData = async () => {
    try {
      setLoading(true);

      // Get default board
      const { data: boardData, error: boardError } = await supabase
        .from('boards')
        .select('*')
        .eq('is_default', true)
        .single();

      if (boardError) {
        console.error('Error fetching board:', boardError);
        toast({
          title: "Error loading board",
          description: "Failed to load your task board",
          variant: "destructive",
        });
        return;
      }

      setBoard(boardData);

      // Get columns for this board
      const { data: columnsData, error: columnsError } = await supabase
        .from('columns')
        .select('*')
        .eq('board_id', boardData.id)
        .order('position');

      if (columnsError) {
        console.error('Error fetching columns:', columnsError);
        return;
      }

      setColumns(columnsData || []);

      // Get tasks for this board
      const { data: tasksData, error: tasksError } = await supabase
        .from('tasks')
        .select('*')
        .eq('board_id', boardData.id)
        .order('created_at', { ascending: false });

      if (tasksError) {
        console.error('Error fetching tasks:', tasksError);
        return;
      }

      setTasks(tasksData || []);
    } catch (error) {
      console.error('Error in fetchBoardData:', error);
      toast({
        title: "Error",
        description: "Failed to load board data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (taskId: string, newStatus: Task['status']) => {
    try {
      const { error } = await supabase
        .from('tasks')
        .update({ 
          status: newStatus,
          completed_at: newStatus === 'DONE' ? new Date().toISOString() : null
        })
        .eq('id', taskId);

      if (error) {
        console.error('Error updating task status:', error);
        toast({
          title: "Error",
          description: "Failed to update task status",
          variant: "destructive",
        });
        return;
      }

      // Update local state
      setTasks(prevTasks => 
        prevTasks.map(task => 
          task.id === taskId 
            ? { ...task, status: newStatus, completed_at: newStatus === 'DONE' ? new Date().toISOString() : task.completed_at }
            : task
        )
      );

      toast({
        title: "Task updated",
        description: `Task moved to ${statusLabels[newStatus]}`,
      });
    } catch (error) {
      console.error('Error updating task:', error);
    }
  };

  const getTasksByStatus = (status: Task['status']) => {
    return tasks.filter(task => task.status === status);
  };

  const addSampleTask = async () => {
    if (!board) return;

    const sampleTask = {
      title: 'Sample Task',
      description: 'This is a sample task to get you started. Try asking the voice assistant to create more tasks!',
      status: 'TODO' as const,
      priority: 'MEDIUM' as const,
      category: 'LIFE' as const,
      board_id: board.id,
      user_id: board.user_id,
    };

    try {
      const { data, error } = await supabase
        .from('tasks')
        .insert(sampleTask)
        .select()
        .single();

      if (error) {
        console.error('Error creating sample task:', error);
        return;
      }

      setTasks(prev => [data, ...prev]);
      toast({
        title: "Sample task added",
        description: "Try using the voice assistant to create more tasks!",
      });
    } catch (error) {
      console.error('Error adding sample task:', error);
    }
  };

  useEffect(() => {
    fetchBoardData();
  }, [refreshTrigger]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground mb-4">No board found. Creating your default board...</p>
        <Button onClick={fetchBoardData}>Retry</Button>
      </div>
    );
  }

  const hasAnyTasks = tasks.length > 0;

  return (
    <div className="space-y-6">
      {/* Board Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{board.name}</h1>
          {board.description && (
            <p className="text-muted-foreground mt-1">{board.description}</p>
          )}
        </div>
        <Button variant="outline" size="sm">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </div>

      {/* Empty State */}
      {!hasAnyTasks && (
        <Card className="p-8 text-center border-dashed">
          <div className="space-y-4">
            <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Plus className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-lg mb-2">Ready to get productive?</h3>
              <p className="text-muted-foreground mb-4">
                Start by creating your first task. Try using the voice assistant below!
              </p>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p><strong>Voice prompts to try:</strong></p>
                <p>"Add a task to review quarterly goals"</p>
                <p>"Create a high priority task to finish the presentation"</p>
                <p>"Add a task for EMBA homework due next week"</p>
              </div>
            </div>
            <Button onClick={addSampleTask} variant="outline">
              Add Sample Task
            </Button>
          </div>
        </Card>
      )}

      {/* Kanban Columns */}
      {hasAnyTasks && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {columns.map((column) => {
            const columnTasks = getTasksByStatus(column.status);
            
            return (
              <Card key={column.id} className={`${statusColors[column.status]} border-t-4`}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center justify-between">
                    <span>{column.name}</span>
                    <span className="text-xs bg-background/50 px-2 py-1 rounded-full">
                      {columnTasks.length}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {columnTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onStatusChange={handleStatusChange}
                    />
                  ))}
                  {columnTasks.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground text-xs">
                      No tasks in {column.name.toLowerCase()}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default KanbanBoard;