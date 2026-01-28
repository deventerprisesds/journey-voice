import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { useCommsConsole } from '@/contexts/CommsConsoleContext';
import { useAuth } from '@/hooks/useAuth';
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import CommsConsole from '@/components/CommsConsole/CommsConsole';
import {
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
  Menu,
  PanelRightClose,
  PanelRightOpen,
  MessageSquare,
} from 'lucide-react';

interface MainLayoutProps {
  children: React.ReactNode;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin, signOut, user } = useAuth();
  const { isPanelOpen, togglePanel } = useCommsConsole();
  
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(() => {
    const stored = localStorage.getItem('main-sidebar-expanded');
    return stored ? JSON.parse(stored) : true;
  });
  const [isMobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [tasksExpanded, setTasksExpanded] = useState(true);
  const [kanbanExpanded, setKanbanExpanded] = useState(false);

  // Persist sidebar state
  React.useEffect(() => {
    localStorage.setItem('main-sidebar-expanded', JSON.stringify(isSidebarExpanded));
  }, [isSidebarExpanded]);

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const isTasksActive = () => {
    return location.pathname === '/tasks';
  };

  const getTaskViewActive = (view: string) => {
    const searchParams = new URLSearchParams(location.search);
    return location.pathname === '/tasks' && searchParams.get('view') === view;
  };

  const getKanbanTabActive = (tab: string) => {
    const searchParams = new URLSearchParams(location.search);
    return location.pathname === '/tasks' && 
           searchParams.get('view') === 'kanban' && 
           searchParams.get('tab') === tab;
  };

  interface KanbanTab {
    label: string;
    path: string;
  }

  interface SubItem {
    icon: React.ElementType;
    label: string;
    path: string;
    kanbanTabs?: KanbanTab[];
  }

  interface NavItem {
    icon: React.ElementType;
    label: string;
    path?: string;
    action?: () => void;
    adminOnly?: boolean;
    subItems?: SubItem[];
  }

  const kanbanTabs: KanbanTab[] = [
    { label: 'Today', path: '/tasks?view=kanban&tab=today' },
    { label: 'Career', path: '/tasks?view=kanban&tab=career' },
    { label: 'Prof. Education', path: '/tasks?view=kanban&tab=prof_education' },
    { label: 'Ventures', path: '/tasks?view=kanban&tab=ventures' },
    { label: 'Life', path: '/tasks?view=kanban&tab=life' },
  ];

  const navItems: NavItem[] = [
    {
      icon: LayoutGrid,
      label: 'Tasks',
      subItems: [
        { icon: Columns3, label: 'Kanban Board', path: '/tasks?view=kanban', kanbanTabs },
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
    if (isMobile) {
      setMobileSidebarOpen(false);
    }
  };

  const handleSubItemClick = (path: string) => {
    navigate(path);
    if (isMobile) {
      setMobileSidebarOpen(false);
    }
  };

  const renderNavItem = (item: NavItem) => {
    if (item.adminOnly && !isAdmin) return null;

    const Icon = item.icon;
    const active = item.path ? isActive(item.path) : isTasksActive();

    // Item with sub-items (Tasks)
    if (item.subItems) {
      if (!isSidebarExpanded && !isMobile) {
        return (
          <Tooltip key={item.label}>
            <TooltipTrigger asChild>
              <button
                onClick={() => navigate('/tasks?view=kanban')}
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
              const isKanban = subItem.path.includes('kanban');
              const subActive = getTaskViewActive(isKanban ? 'kanban' : 'grid');

              // Kanban Board with nested tabs
              if (subItem.kanbanTabs && subItem.kanbanTabs.length > 0) {
                return (
                  <Collapsible
                    key={subItem.path}
                    open={kanbanExpanded}
                    onOpenChange={setKanbanExpanded}
                  >
                    <CollapsibleTrigger asChild>
                      <button
                        className={cn(
                          'w-full flex items-center gap-2 p-2 rounded-lg transition-colors text-sm',
                          'hover:bg-accent',
                          subActive && 'bg-accent/50'
                        )}
                      >
                        <SubIcon className="w-4 h-4" />
                        <span className="flex-1 text-left">{subItem.label}</span>
                        {kanbanExpanded ? (
                          <ChevronDown className="w-3 h-3 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="w-3 h-3 text-muted-foreground" />
                        )}
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pl-6 space-y-0.5 mt-1">
                      {subItem.kanbanTabs.map((tab) => {
                        const tabParam = tab.path.split('tab=')[1];
                        const tabActive = getKanbanTabActive(tabParam);
                        
                        return (
                          <button
                            key={tab.path}
                            onClick={() => handleSubItemClick(tab.path)}
                            className={cn(
                              'w-full flex items-center gap-2 p-1.5 rounded-md transition-colors text-xs',
                              'hover:bg-accent',
                              tabActive && 'bg-accent text-accent-foreground font-medium'
                            )}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
                            <span>{tab.label}</span>
                          </button>
                        );
                      })}
                    </CollapsibleContent>
                  </Collapsible>
                );
              }

              // Regular sub-item (List View)
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
    if (!isSidebarExpanded && !isMobile) {
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

  // Sidebar content component for reuse
  const SidebarContent = (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h2 className={cn(
          "font-bold bg-gradient-to-r from-primary to-productivity bg-clip-text text-transparent transition-all",
          (!isSidebarExpanded && !isMobile) ? "text-lg" : "text-xl"
        )}>
          {(!isSidebarExpanded && !isMobile) ? "J" : "Journey"}
        </h2>
        {!isMobile && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsSidebarExpanded(prev => !prev)}
            className="h-8 w-8"
          >
            {isSidebarExpanded ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        )}
      </div>

      {/* Navigation */}
      <div className="flex-1 p-2 space-y-1 overflow-y-auto">
        {(isSidebarExpanded || isMobile) && (
          <div className="px-3 py-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Navigation
            </h3>
          </div>
        )}
        <div className="space-y-1">
          {navItems.map(renderNavItem)}
        </div>
      </div>

      {/* Sign Out */}
      <div className="p-2 border-t border-border">
        {(!isSidebarExpanded && !isMobile) ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={signOut}
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
            onClick={signOut}
            className="w-full flex items-center gap-2 p-2 rounded-lg transition-colors hover:bg-destructive/10 text-destructive"
          >
            <LogOut className="w-5 h-5" />
            <span className="text-sm">Sign Out</span>
          </button>
        )}
      </div>
    </div>
  );

  // If not logged in, just render children (Auth page, etc.)
  if (!user) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-[100dvh] flex w-full bg-background" style={{ overscrollBehavior: 'none' }}>
      {/* Desktop Left Sidebar */}
      {!isMobile && (
        <aside
          className={cn(
            'border-r border-border bg-card/50 flex-shrink-0 transition-all duration-200',
            isSidebarExpanded ? 'w-56' : 'w-14'
          )}
        >
          {SidebarContent}
        </aside>
      )}

      {/* Mobile Sidebar Sheet */}
      {isMobile && (
        <Sheet open={isMobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
          <SheetContent side="left" className="w-72 p-0">
            {SidebarContent}
          </SheetContent>
        </Sheet>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Mobile Header */}
        {isMobile && (
          <header className="h-14 border-b border-border bg-card/95 backdrop-blur flex items-center px-4 gap-3 flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="font-bold text-lg bg-gradient-to-r from-primary to-productivity bg-clip-text text-transparent">
              Journey
            </h1>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="icon"
              onClick={togglePanel}
            >
              <MessageSquare className="h-5 w-5" />
            </Button>
          </header>
        )}

        {/* Page Content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>

      {/* Right Comms Panel - Desktop only, collapsible */}
      {!isMobile && isPanelOpen && (
        <aside className="w-[400px] border-l border-border bg-card/50 flex-shrink-0 flex flex-col">
          <CommsConsole mode="panel" />
        </aside>
      )}

      {/* Desktop Comms Panel Toggle Button (when closed) */}
      {!isMobile && !isPanelOpen && (
        <Button
          variant="outline"
          size="icon"
          onClick={togglePanel}
          className="fixed right-4 bottom-4 z-50 h-12 w-12 rounded-full shadow-lg bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <MessageSquare className="h-5 w-5" />
        </Button>
      )}

      {/* Mobile Comms Panel Sheet */}
      {isMobile && (
        <Sheet open={isPanelOpen} onOpenChange={togglePanel}>
          <SheetContent side="right" className="w-full p-0 sm:max-w-md">
            <CommsConsole mode="panel" />
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
};

export default MainLayout;
