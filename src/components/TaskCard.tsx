import React from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  MoreHorizontal
} from 'lucide-react';
import { format } from 'date-fns';
import { Task } from '@/types/task';

interface TaskCardProps {
  task: Task;
  onStatusChange?: (taskId: string, newStatus: Task['status']) => void;
  onEdit?: (task: Task) => void;
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

const formatTime = (minutes?: number): string => {
  if (!minutes) return '';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
};

const formatDate = (dateString?: string): string | null => {
  if (!dateString) return null;
  try {
    return format(new Date(dateString), 'MMM d, yyyy');
  } catch {
    return null;
  }
};

const TaskCard: React.FC<TaskCardProps> = ({ task, onStatusChange, onEdit }) => {
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

  return (
    <Card 
      className={`group relative transition-all duration-200 hover:shadow-elevated border-l-4 cursor-pointer ${priorityColors[task.priority]} ${isBlocked ? 'opacity-75' : ''}`}
      onDoubleClick={() => onEdit?.(task)}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Button
              variant="ghost"
              size="sm"
              className={`p-1 h-6 w-6 rounded-full ${statusColors[task.status]}`}
              onClick={handleStatusToggle}
            >
              <StatusIcon className="h-3 w-3" />
            </Button>
            <h3 className="font-medium text-sm leading-tight truncate flex-1">
              {task.title}
            </h3>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 p-1"
            onClick={() => onEdit?.(task)}
          >
            <MoreHorizontal className="h-3 w-3" />
          </Button>
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
              <span>{formatDate(task.due_date)}</span>
              {isOverdue && <span className="font-medium">(Overdue)</span>}
            </div>
          )}

          {task.estimate_minutes && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>{formatTime(task.estimate_minutes)}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default TaskCard;