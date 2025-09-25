import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  LayoutGrid, 
  BarChart3, 
  Calendar,
  List
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type ViewType = 'kanban' | 'grid' | 'gantt' | 'timeline' | 'list';

interface ViewSwitcherProps {
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
  className?: string;
}

const viewOptions = [
  {
    value: 'kanban' as ViewType,
    label: 'Board',
    icon: LayoutGrid,
    description: 'Kanban-style task board'
  },
  {
    value: 'grid' as ViewType,
    label: 'Grid',
    icon: List,
    description: 'Structured table view'
  },
  {
    value: 'gantt' as ViewType,
    label: 'Gantt',
    icon: BarChart3,
    description: 'Project timeline view'
  },
  {
    value: 'timeline' as ViewType,
    label: 'Timeline',
    icon: Calendar,
    description: 'Calendar timeline view'
  },
  {
    value: 'list' as ViewType,
    label: 'List',
    icon: List,
    description: 'Simple list view'
  }
];

const ViewSwitcher: React.FC<ViewSwitcherProps> = ({ 
  currentView, 
  onViewChange, 
  className 
}) => {
  return (
    <div className={cn("flex items-center gap-1 p-1 bg-muted rounded-lg", className)}>
      {viewOptions.map((option) => {
        const Icon = option.icon;
        const isActive = currentView === option.value;
        
        return (
          <Button
            key={option.value}
            variant={isActive ? "default" : "ghost"}
            size="sm"
            onClick={() => onViewChange(option.value)}
            className={cn(
              "flex items-center gap-2 relative transition-all",
              isActive ? "bg-background text-foreground shadow-sm" : "hover:bg-background/50"
            )}
            title={option.description}
          >
            <Icon className="h-4 w-4" />
            <span className="hidden sm:inline">{option.label}</span>
            {isActive && (
              <Badge variant="secondary" className="ml-1 bg-primary/10 text-primary text-xs px-1">
                Active
              </Badge>
            )}
          </Button>
        );
      })}
    </div>
  );
};

export default ViewSwitcher;