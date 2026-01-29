import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  MessageSquare,
  LayoutGrid,
  Calendar,
  CalendarDays,
  Settings,
  Crown,
  LogOut,
  ChevronDown,
  ChevronRight,
  Columns3,
  List,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface NavigationSectionProps {
  isExpanded: boolean;
  className?: string;
}

interface NavItem {
  icon: React.ElementType;
  label: string;
  path?: string;
  action?: () => void;
  adminOnly?: boolean;
  subItems?: { icon: React.ElementType; label: string; path: string }[];
}

const NavigationSection: React.FC<NavigationSectionProps> = ({
  isExpanded,
  className,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin, signOut } = useAuth();
  const [tasksExpanded, setTasksExpanded] = useState(true);

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const isTasksActive = () => {
    const searchParams = new URLSearchParams(location.search);
    return location.pathname === '/tasks' || searchParams.has('view');
  };

  const getTaskViewActive = (view: string) => {
    const searchParams = new URLSearchParams(location.search);
    return location.pathname === '/tasks' && searchParams.get('view') === view;
  };

  const navItems: NavItem[] = [
    {
      icon: MessageSquare,
      label: 'Comms',
      path: '/',
    },
    {
      icon: LayoutGrid,
      label: 'Tasks',
      subItems: [
        { icon: Columns3, label: 'Kanban Board', path: '/tasks?view=kanban' },
        { icon: List, label: 'List View', path: '/tasks?view=grid' },
      ],
    },
    {
      icon: Calendar,
      label: 'Calendar',
      path: '/calendar',
    },
    {
      icon: CalendarDays,
      label: 'Agenda',
      path: '/agenda',
    },
    {
      icon: Settings,
      label: 'Settings',
      path: '/settings',
    },
    {
      icon: Crown,
      label: 'Admin',
      path: '/admin',
      adminOnly: true,
    },
  ];

  const handleNavClick = (item: NavItem) => {
    if (item.action) {
      item.action();
    } else if (item.path) {
      navigate(item.path);
    }
  };

  const handleSubItemClick = (path: string) => {
    navigate(path);
  };

  const handleSignOut = () => {
    signOut();
  };

  const renderNavItem = (item: NavItem) => {
    if (item.adminOnly && !isAdmin) return null;

    const Icon = item.icon;
    const active = item.path ? isActive(item.path) : isTasksActive();

    // Item with sub-items (Tasks)
    if (item.subItems) {
      if (!isExpanded) {
        // Collapsed mode - just show icon, clicking expands sidebar or navigates
        return (
          <Tooltip key={item.label}>
            <TooltipTrigger asChild>
              <button
                onClick={() => navigate('/tasks?view=focus')}
                className={cn(
                  'w-full flex items-center justify-center p-2 rounded-lg transition-colors',
                  'hover:bg-accent',
                  active && 'bg-accent text-accent-foreground'
                )}
              >
                <Icon className="w-5 h-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>{item.label}</p>
            </TooltipContent>
          </Tooltip>
        );
      }

      // Expanded mode - show collapsible
      return (
        <Collapsible
          key={item.label}
          open={tasksExpanded}
          onOpenChange={setTasksExpanded}
        >
          <CollapsibleTrigger asChild>
            <button
              className={cn(
                'w-full flex items-center gap-2 p-2 rounded-lg transition-colors',
                'hover:bg-accent',
                active && 'bg-accent/50'
              )}
            >
              <Icon className="w-5 h-5" />
              <span className="flex-1 text-left text-sm font-medium">{item.label}</span>
              {tasksExpanded ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pl-4 space-y-1 mt-1">
            {item.subItems.map((subItem) => {
              const SubIcon = subItem.icon;
              const subActive = getTaskViewActive(subItem.path.includes('kanban') ? 'kanban' : 'grid');

              return (
                <button
                  key={subItem.path}
                  onClick={() => handleSubItemClick(subItem.path)}
                  className={cn(
                    'w-full flex items-center gap-2 p-2 rounded-lg transition-colors text-sm',
                    'hover:bg-accent',
                    subActive && 'bg-accent text-accent-foreground font-medium'
                  )}
                >
                  <SubIcon className="w-4 h-4" />
                  <span>{subItem.label}</span>
                </button>
              );
            })}
          </CollapsibleContent>
        </Collapsible>
      );
    }

    // Regular nav item
    if (!isExpanded) {
      return (
        <Tooltip key={item.label}>
          <TooltipTrigger asChild>
            <button
              onClick={() => handleNavClick(item)}
              className={cn(
                'w-full flex items-center justify-center p-2 rounded-lg transition-colors',
                'hover:bg-accent',
                active && 'bg-accent text-accent-foreground'
              )}
            >
              <Icon className="w-5 h-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>{item.label}</p>
          </TooltipContent>
        </Tooltip>
      );
    }

    return (
      <button
        key={item.label}
        onClick={() => handleNavClick(item)}
        className={cn(
          'w-full flex items-center gap-2 p-2 rounded-lg transition-colors',
          'hover:bg-accent',
          active && 'bg-accent text-accent-foreground font-medium'
        )}
      >
        <Icon className="w-5 h-5" />
        <span className="text-sm">{item.label}</span>
      </button>
    );
  };

  return (
    <div className={cn('space-y-1', className)}>
      {isExpanded && (
        <div className="px-3 py-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Navigation
          </h3>
        </div>
      )}

      <div className="px-2 space-y-1">
        {navItems.map(renderNavItem)}
      </div>

      {/* Sign Out */}
      <div className="px-2 pt-2 border-t border-border/50 mt-2">
        {!isExpanded ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleSignOut}
                className="w-full flex items-center justify-center p-2 rounded-lg transition-colors hover:bg-destructive/10 text-destructive"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Sign Out</p>
            </TooltipContent>
          </Tooltip>
        ) : (
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-2 p-2 rounded-lg transition-colors hover:bg-destructive/10 text-destructive"
          >
            <LogOut className="w-5 h-5" />
            <span className="text-sm">Sign Out</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default NavigationSection;
