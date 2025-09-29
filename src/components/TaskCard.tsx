import React, { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Clock, 
  MapPin, 
  AlertTriangle, 
  CheckCircle2, 
  Circle, 
  Play,
  User,
  BookOpen,
  Briefcase,
  Rocket,
  Calendar,
  MoreHorizontal,
  CalendarPlus,
  Trash2
} from 'lucide-react';
import { format } from 'date-fns';
import { Task } from '@/types/task';
import { formatDateOnly, formatDuration } from '@/lib/date';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface TaskCardProps {
  task: Task;
  onStatusChange?: (taskId: string, newStatus: Task['status']) => void;
  onEdit?: (task: Task) => void;
  onSchedule?: (task: Task) => void;
  onDelete?: (taskId: string) => void;
}

const statusIcons = {
  BLOCKED: AlertTriangle,
  LIFE: User,
  CAREER: Briefcase,
  PROF_EDUCATION: BookOpen,
  VENTURES: Rocket,
  PLANNING: Calendar,
  READY: Circle,
  UP_NEXT: Play,
  DOING: Play,
  DONE: CheckCircle2,
  BACKLOG: Circle,
  TODO: Circle,
};

const statusColors = {
  BLOCKED: 'bg-red-500 text-white',
  LIFE: 'bg-pink-500 text-white',
  CAREER: 'bg-blue-500 text-white', 
  PROF_EDUCATION: 'bg-green-500 text-white',
  VENTURES: 'bg-purple-500 text-white',
  PLANNING: 'bg-yellow-500 text-white',
  READY: 'bg-cyan-500 text-white',
  UP_NEXT: 'bg-orange-500 text-white',
  DOING: 'bg-indigo-500 text-white',
  DONE: 'bg-emerald-500 text-white',
  BACKLOG: 'bg-gray-500 text-white',
  TODO: 'bg-slate-500 text-white',
};

const priorityColors = {
  LOW: 'border-l-priority-low bg-priority-low/5',
  MEDIUM: 'border-l-priority-medium bg-priority-medium/5',
  HIGH: 'border-l-priority-high bg-priority-high/5',
  URGENT: 'border-l-priority-urgent bg-priority-urgent/5',
};

const priorityBadgeColors = {
  LOW: 'bg-priority-low/10 text-priority-low border-priority-low/20',
  MEDIUM: 'bg-priority-medium/10 text-priority-medium border-priority-medium/20',
  HIGH: 'bg-priority-high/10 text-priority-high border-priority-high/20',
  URGENT: 'bg-priority-urgent/10 text-priority-urgent border-priority-urgent/20',
};

const categoryIcons = {
  LIFE: User,
  CAREER: Briefcase,
  VENTURES: Rocket,
  EDUCATION: BookOpen,
};

const categoryColors = {
  LIFE: 'bg-category-life/10 text-category-life border-category-life/20',
  CAREER: 'bg-category-career/10 text-category-career border-category-career/20',
  VENTURES: 'bg-category-ventures/10 text-category-ventures border-category-ventures/20',
  EDUCATION: 'bg-category-education/10 text-category-education border-category-education/20',
};

// Using utility functions for consistent formatting

const TaskCard: React.FC<TaskCardProps> = ({ task, onStatusChange, onEdit, onSchedule, onDelete }) => {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  
  const StatusIcon = statusIcons[task.status];
  const CategoryIcon = categoryIcons[task.category];
  const isBlocked = task.blocked_by && task.blocked_by.length > 0;
  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'DONE';
  
  // Check if blocked tasks are actually preventing progress
  const hasUnresolvedDependencies = isBlocked && task.blocked_by?.some(depId => {
    // In a real implementation, you'd check if the dependency is completed
    // For now, we'll assume blocked tasks have unresolved dependencies
    return true;
  });

  const handleStatusToggle = () => {
    if (!onStatusChange) return;
    
    const statusFlow = {
      BLOCKED: 'PLANNING',
      LIFE: 'PLANNING',
      CAREER: 'PLANNING', 
      PROF_EDUCATION: 'PLANNING',
      VENTURES: 'PLANNING',
      PLANNING: 'READY',
      READY: 'UP_NEXT',
      UP_NEXT: 'DOING',
      DOING: 'DONE',
      DONE: 'BLOCKED',
      BACKLOG: 'READY',
      TODO: 'DOING',
    } as const;
    
    onStatusChange(task.id, statusFlow[task.status] as Task['status']);
  };

  const handleCheckboxChange = (checked: boolean) => {
    if (!onStatusChange) return;
    
    if (checked) {
      // Mark as done
      onStatusChange(task.id, 'DONE');
    } else {
      // Unmark - go back to previous logical status
      onStatusChange(task.id, 'DOING');
    }
  };

  const handleCheckboxToggle = () => {
    if (!onStatusChange) return;
    
    // Toggle between current status and DONE
    if (task.status === 'DONE') {
      // When unchecking, return to previous status or default to TODO
      onStatusChange(task.id, 'TODO');
    } else {
      onStatusChange(task.id, 'DONE');
    }
  };

  const handleScheduleTask = async () => {
    if (!onSchedule || isScheduling) return;
    
    setIsScheduling(true);
    try {
      await onSchedule(task);
    } finally {
      setIsScheduling(false);
    }
  };

  // Check if task should show scheduling indicator
  const showSchedulingIndicator = task.is_scheduled || (task.start_time && task.end_time);
  const isAutoScheduled = task.is_scheduled && task.start_time && task.end_time;

  const handleDeleteTask = async () => {
    if (!onDelete || isDeleting) return;
    
    setIsDeleting(true);
    try {
      await onDelete(task.id);
      setShowDeleteDialog(false);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Card 
      className={`group relative transition-all duration-200 hover:shadow-elevated border-l-4 cursor-pointer ${priorityColors[task.priority]} ${isBlocked ? 'opacity-75' : ''}`}
      onDoubleClick={() => onEdit?.(task)}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Checkbox
              checked={task.status === 'DONE'}
              onCheckedChange={handleCheckboxChange}
              className="mt-0.5"
            />
            <Button
              variant="ghost"
              size="sm"
              className={`p-1 h-6 w-6 rounded-full ${statusColors[task.status]}`}
              onClick={handleStatusToggle}
              title="Advanced status management"
            >
              <StatusIcon className="h-3 w-3" />
            </Button>
            <h3 className={`font-medium text-sm leading-tight truncate flex-1 ${task.status === 'DONE' ? 'line-through text-muted-foreground' : ''}`}>
              {task.title}
            </h3>
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {onSchedule && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-1 hover:bg-primary/10"
                onClick={(e) => {
                  e.stopPropagation();
                  handleScheduleTask();
                }}
                disabled={isScheduling}
                title="Schedule this task"
              >
                <CalendarPlus className={`h-3 w-3 ${isScheduling ? 'animate-spin' : ''}`} />
              </Button>
            )}
            {onDelete && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-1 hover:bg-destructive/10 hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowDeleteDialog(true);
                }}
                disabled={isDeleting}
                title="Delete this task"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-1"
              onClick={() => onEdit?.(task)}
              title="Edit task details"
            >
              <MoreHorizontal className="h-3 w-3" />
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className={`text-xs ${priorityBadgeColors[task.priority]}`}>
            {task.priority.toLowerCase()}
          </Badge>
          
          <Badge variant="outline" className={`text-xs ${categoryColors[task.category]}`}>
            <CategoryIcon className="h-3 w-3 mr-1" />
            {task.category.toLowerCase()}
          </Badge>

          {hasUnresolvedDependencies && (
            <Badge variant="destructive" className="text-xs">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Blocked ({task.blocked_by?.length})
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {task.description && (
          <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
            {task.description}
          </p>
        )}

        <div className="space-y-2">
          {task.due_date && (
            <div className={`flex items-center gap-1 text-xs ${isOverdue ? 'text-destructive' : 'text-muted-foreground'}`}>
              <Calendar className="h-3 w-3" />
              <span>{formatDateOnly(task.due_date)}</span>
              {isOverdue && <span className="font-medium">(Overdue)</span>}
            </div>
          )}

          {task.estimate_minutes && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>{formatDuration(task.estimate_minutes)}</span>
            </div>
          )}

          {isAutoScheduled && (
            <div className="flex items-center gap-1 text-xs text-primary">
              <CalendarPlus className="h-3 w-3" />
              <span>Scheduled: {task.start_time ? format(new Date(task.start_time), 'MMM d, h:mm a') : 'Auto-scheduled'}</span>
            </div>
          )}
        </div>
      </CardContent>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Task</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{task.title}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteTask}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

export default TaskCard;