import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Task } from '@/types/task';
import KanbanBoard from './KanbanBoard';
import { format, isToday, parseISO } from 'date-fns';

interface TabbedKanbanBoardProps {
  tasks: Task[];
  onTaskUpdate?: () => void;
  onTaskEdit?: (task: Task) => void;
}

type CategoryTab = 'today' | 'career' | 'prof_education' | 'ventures' | 'life';

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

const TabbedKanbanBoard: React.FC<TabbedKanbanBoardProps> = ({
  tasks,
  onTaskUpdate,
  onTaskEdit,
}) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as CategoryTab | null;
  const [activeTab, setActiveTab] = useState<CategoryTab>(tabParam || 'today');

  // Normalize tasks on render
  const normalizedTasks = useMemo(() => normalizeTasks(tasks), [tasks]);

  // Update URL when tab changes
  const handleTabChange = (value: string) => {
    const tab = value as CategoryTab;
    setActiveTab(tab);
    const newParams = new URLSearchParams(searchParams);
    newParams.set('tab', tab);
    setSearchParams(newParams, { replace: true });
  };

  // Sync with URL on mount
  useEffect(() => {
    if (tabParam && ['today', 'career', 'prof_education', 'ventures', 'life'].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  // Filter tasks by category tab
  const getFilteredTasks = (tab: CategoryTab): Task[] => {
    if (tab === 'today') {
      // Today tab: tasks due today OR in active workflow (UP_NEXT, DOING)
      return normalizedTasks.filter(task => {
        const isDueToday = task.due_date && isToday(parseISO(task.due_date));
        const isActive = ['UP_NEXT', 'DOING'].includes(task.status);
        return isDueToday || isActive;
      });
    }

    // Category tabs: filter by category
    const categoryMap: Record<CategoryTab, Task['category'][]> = {
      today: [], // Handled above
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

  const tabConfig = [
    { value: 'today', label: 'Today', count: getFilteredTasks('today').length },
    { value: 'career', label: 'Career', count: getFilteredTasks('career').length },
    { value: 'prof_education', label: 'Prof. Education', count: getFilteredTasks('prof_education').length },
    { value: 'ventures', label: 'Ventures', count: getFilteredTasks('ventures').length },
    { value: 'life', label: 'Life', count: getFilteredTasks('life').length },
  ];

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
      <TabsList className="w-full justify-start gap-1 h-auto flex-wrap bg-transparent p-0 mb-4">
        {tabConfig.map(tab => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-full px-4 py-2 text-sm font-medium transition-all"
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

      {tabConfig.map(tab => (
        <TabsContent key={tab.value} value={tab.value} className="mt-0">
          <KanbanBoard
            tasks={getFilteredTasks(tab.value as CategoryTab)}
            onTaskUpdate={onTaskUpdate}
            onTaskEdit={onTaskEdit}
            categoryFilter={tab.value === 'today' ? undefined : tab.value.toUpperCase()}
            useStandardColumns={true}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
};

export default TabbedKanbanBoard;
