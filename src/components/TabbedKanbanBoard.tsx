import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Task } from '@/types/task';
import KanbanBoard from './KanbanBoard';
import { format, isToday, parseISO, startOfWeek, endOfWeek, addWeeks, isWithinInterval } from 'date-fns';
import { cn } from '@/lib/utils';

interface TabbedKanbanBoardProps {
  tasks: Task[];
  onTaskUpdate?: () => void;
  onTaskEdit?: (task: Task) => void;
}

type CategoryTab = 'time_filtered' | 'career' | 'prof_education' | 'ventures' | 'life';
type TimePeriod = 'today' | 'this_week' | 'next_week' | 'all';

// Map old category-as-status to proper status/category
const normalizeTasks = (tasks: Task[]): Task[] => {
  return tasks.map(task => {
    const categoryStatuses = ['LIFE', 'CAREER', 'PROF_EDUCATION', 'VENTURES'];
    
    // If status is actually a category, normalize it
    if (categoryStatuses.includes(task.status)) {
      return {
        ...task,
        category: task.status as Task['category'],
        status: 'BACKLOG' as Task['status'],
      };
    }
    
    return task;
  });
};

const timePeriodLabels: Record<TimePeriod, string> = {
  today: 'Today',
  this_week: 'This Week',
  next_week: 'Next Week',
  all: 'All',
};

const TabbedKanbanBoard: React.FC<TabbedKanbanBoardProps> = ({
  tasks,
  onTaskUpdate,
  onTaskEdit,
}) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as CategoryTab | null;
  const periodParam = searchParams.get('period') as TimePeriod | null;
  
  const [activeTab, setActiveTab] = useState<CategoryTab>(
    tabParam && ['time_filtered', 'career', 'prof_education', 'ventures', 'life'].includes(tabParam) 
      ? tabParam 
      : 'time_filtered'
  );
  const [timePeriod, setTimePeriod] = useState<TimePeriod>(
    periodParam && ['today', 'this_week', 'next_week', 'all'].includes(periodParam)
      ? periodParam
      : 'today'
  );

  // Normalize tasks on render
  const normalizedTasks = useMemo(() => normalizeTasks(tasks), [tasks]);

  // Update URL when tab changes
  const handleTabChange = (value: string) => {
    const tab = value as CategoryTab;
    setActiveTab(tab);
    const newParams = new URLSearchParams(searchParams);
    newParams.set('tab', tab);
    if (tab !== 'time_filtered') {
      newParams.delete('period');
    } else {
      newParams.set('period', timePeriod);
    }
    setSearchParams(newParams, { replace: true });
  };

  // Update URL when time period changes
  const handleTimePeriodChange = (value: TimePeriod) => {
    setTimePeriod(value);
    setActiveTab('time_filtered');
    const newParams = new URLSearchParams(searchParams);
    newParams.set('tab', 'time_filtered');
    newParams.set('period', value);
    setSearchParams(newParams, { replace: true });
  };

  // Sync with URL on mount
  useEffect(() => {
    if (tabParam && ['time_filtered', 'career', 'prof_education', 'ventures', 'life'].includes(tabParam)) {
      setActiveTab(tabParam);
    }
    if (periodParam && ['today', 'this_week', 'next_week', 'all'].includes(periodParam)) {
      setTimePeriod(periodParam);
    }
  }, [tabParam, periodParam]);

  // Get time-filtered tasks based on selected period
  const getTimeFilteredTasks = (): Task[] => {
    const now = new Date();
    
    switch (timePeriod) {
      case 'today': {
        return normalizedTasks.filter(task => {
          const isDueToday = task.due_date && isToday(parseISO(task.due_date));
          const isScheduledToday = task.start_time && isToday(parseISO(task.start_time));
          const isActive = ['UP_NEXT', 'DOING'].includes(task.status);
          return isDueToday || isScheduledToday || isActive;
        });
      }
      case 'this_week': {
        const weekStart = startOfWeek(now, { weekStartsOn: 1 });
        const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
        return normalizedTasks.filter(task => {
          const taskDate = task.due_date ? parseISO(task.due_date) : 
                          task.start_time ? parseISO(task.start_time) : null;
          const isActive = ['UP_NEXT', 'DOING'].includes(task.status);
          return isActive || (taskDate && isWithinInterval(taskDate, { start: weekStart, end: weekEnd }));
        });
      }
      case 'next_week': {
        const nextWeekStart = startOfWeek(addWeeks(now, 1), { weekStartsOn: 1 });
        const nextWeekEnd = endOfWeek(addWeeks(now, 1), { weekStartsOn: 1 });
        return normalizedTasks.filter(task => {
          const taskDate = task.due_date ? parseISO(task.due_date) : 
                          task.start_time ? parseISO(task.start_time) : null;
          return taskDate && isWithinInterval(taskDate, { start: nextWeekStart, end: nextWeekEnd });
        });
      }
      case 'all': {
        return normalizedTasks;
      }
      default:
        return normalizedTasks;
    }
  };

  // Filter tasks by category tab
  const getFilteredTasks = (tab: CategoryTab): Task[] => {
    if (tab === 'time_filtered') {
      return getTimeFilteredTasks();
    }

    // Category tabs: filter by category
    const categoryMap: Record<CategoryTab, Task['category'][]> = {
      time_filtered: [], // Handled above
      career: ['CAREER'],
      prof_education: ['PROF_EDUCATION', 'EDUCATION'],
      ventures: ['VENTURES'],
      life: ['LIFE'],
    };

    const categories = categoryMap[tab];
    return normalizedTasks.filter(task => 
      categories.includes(task.category)
    );
  };

  const categoryTabs = [
    { value: 'career', label: 'Career', count: getFilteredTasks('career').length },
    { value: 'prof_education', label: 'Prof. Education', count: getFilteredTasks('prof_education').length },
    { value: 'ventures', label: 'Ventures', count: getFilteredTasks('ventures').length },
    { value: 'life', label: 'Life', count: getFilteredTasks('life').length },
  ];

  const timeFilteredCount = getTimeFilteredTasks().length;

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
      <div className="flex items-center gap-1 overflow-x-auto flex-nowrap pb-1 mb-4 scrollbar-thin">
        {/* Time Period Dropdown (replaces Today pill) */}
        <Select value={timePeriod} onValueChange={handleTimePeriodChange}>
          <SelectTrigger 
            className={cn(
              "w-auto min-w-[100px] h-9 rounded-full px-4 border-none shrink-0",
              activeTab === 'time_filtered' 
                ? "bg-primary text-primary-foreground" 
                : "bg-transparent hover:bg-muted"
            )}
          >
            <SelectValue>
              {timePeriodLabels[timePeriod]}
              {timeFilteredCount > 0 && (
                <span className="ml-2 bg-muted-foreground/20 text-xs px-1.5 py-0.5 rounded-full">
                  {timeFilteredCount}
                </span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="bg-popover">
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="this_week">This Week</SelectItem>
            <SelectItem value="next_week">Next Week</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>

        {/* Category tabs */}
        <TabsList className="bg-transparent p-0 gap-1 h-auto flex-nowrap shrink-0">
          {categoryTabs.map(tab => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-full px-4 py-2 text-sm font-medium transition-all whitespace-nowrap shrink-0"
            >
              {tab.label}
              {tab.count > 0 && (
                <span className="ml-2 bg-muted-foreground/20 text-xs px-1.5 py-0.5 rounded-full">
                  {tab.count}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {/* Time filtered content */}
      <TabsContent value="time_filtered" className="mt-0">
        <KanbanBoard
          tasks={getTimeFilteredTasks()}
          onTaskUpdate={onTaskUpdate}
          onTaskEdit={onTaskEdit}
          categoryFilter={undefined}
          useStandardColumns={true}
        />
      </TabsContent>

      {/* Category tab contents */}
      {categoryTabs.map(tab => (
        <TabsContent key={tab.value} value={tab.value} className="mt-0">
          <KanbanBoard
            tasks={getFilteredTasks(tab.value as CategoryTab)}
            onTaskUpdate={onTaskUpdate}
            onTaskEdit={onTaskEdit}
            categoryFilter={tab.value.toUpperCase()}
            useStandardColumns={true}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
};

export default TabbedKanbanBoard;
