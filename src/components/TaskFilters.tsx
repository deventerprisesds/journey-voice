import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { 
  Filter, 
  X, 
  Search, 
  CalendarIcon, 
  RotateCcw,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { format, startOfDay, endOfDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { Task } from '@/types/task';

interface FilterState {
  search: string;
  statuses: string[];
  priorities: string[];
  categories: string[];
  dueDateRange: {
    from?: Date;
    to?: Date;
  };
  overdue: boolean;
  noDueDate: boolean;
}

interface TaskFiltersProps {
  tasks: Task[];
  onFilteredTasksChange: (filteredTasks: Task[]) => void;
  className?: string;
}

const statusOptions = [
  { value: 'BLOCKED', label: 'Blocked', color: 'bg-red-100 text-red-800' },
  { value: 'LIFE', label: 'Life', color: 'bg-pink-100 text-pink-800' },
  { value: 'CAREER', label: 'Career', color: 'bg-blue-100 text-blue-800' },
  { value: 'PROF_EDUCATION', label: 'Prof. Education', color: 'bg-purple-100 text-purple-800' },
  { value: 'VENTURES', label: 'Ventures', color: 'bg-green-100 text-green-800' },
  { value: 'PLANNING', label: 'Planning', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'READY', label: 'Ready', color: 'bg-orange-100 text-orange-800' },
  { value: 'UP_NEXT', label: 'Up Next', color: 'bg-indigo-100 text-indigo-800' },
  { value: 'DOING', label: 'Doing', color: 'bg-primary/10 text-primary' },
  { value: 'DONE', label: 'Done', color: 'bg-emerald-100 text-emerald-800' },
  { value: 'BACKLOG', label: 'Backlog', color: 'bg-gray-100 text-gray-800' },
  { value: 'TODO', label: 'To Do', color: 'bg-slate-100 text-slate-800' },
];

const priorityOptions = [
  { value: 'LOW', label: 'Low', color: 'bg-slate-100 text-slate-600' },
  { value: 'MEDIUM', label: 'Medium', color: 'bg-blue-100 text-blue-700' },
  { value: 'HIGH', label: 'High', color: 'bg-orange-100 text-orange-700' },
  { value: 'URGENT', label: 'Urgent', color: 'bg-red-100 text-red-700' },
];

const categoryOptions = [
  { value: 'LIFE', label: 'Life', color: 'bg-green-100 text-green-700' },
  { value: 'CAREER', label: 'Career', color: 'bg-blue-100 text-blue-700' },
  { value: 'VENTURES', label: 'Ventures', color: 'bg-purple-100 text-purple-700' },
  { value: 'EDUCATION', label: 'Education', color: 'bg-orange-100 text-orange-700' },
  { value: 'PROF_EDUCATION', label: 'Prof. Education', color: 'bg-purple-100 text-purple-700' },
];

const TaskFilters: React.FC<TaskFiltersProps> = ({ 
  tasks, 
  onFilteredTasksChange, 
  className 
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    search: '',
    statuses: [],
    priorities: [],
    categories: [],
    dueDateRange: {},
    overdue: false,
    noDueDate: false,
  });

  // Apply filters whenever filters or tasks change
  useEffect(() => {
    const filteredTasks = applyFilters(tasks, filters);
    onFilteredTasksChange(filteredTasks);
  }, [tasks, filters, onFilteredTasksChange]);

  const applyFilters = (tasks: Task[], filters: FilterState): Task[] => {
    return tasks.filter(task => {
      // Search filter
      if (filters.search) {
        const searchTerm = filters.search.toLowerCase();
        const matchesSearch = 
          task.title.toLowerCase().includes(searchTerm) ||
          task.description?.toLowerCase().includes(searchTerm);
        if (!matchesSearch) return false;
      }

      // Status filter
      if (filters.statuses.length > 0 && !filters.statuses.includes(task.status)) {
        return false;
      }

      // Priority filter
      if (filters.priorities.length > 0 && !filters.priorities.includes(task.priority)) {
        return false;
      }

      // Category filter
      if (filters.categories.length > 0 && !filters.categories.includes(task.category)) {
        return false;
      }

      // Due date filters
      if (task.due_date) {
        const taskDueDate = new Date(task.due_date);
        const now = new Date();

        // Overdue filter
        if (filters.overdue && taskDueDate >= now) {
          return false;
        }

        // Date range filter
        if (filters.dueDateRange.from || filters.dueDateRange.to) {
          const fromDate = filters.dueDateRange.from ? startOfDay(filters.dueDateRange.from) : null;
          const toDate = filters.dueDateRange.to ? endOfDay(filters.dueDateRange.to) : null;
          
          if (fromDate && taskDueDate < fromDate) return false;
          if (toDate && taskDueDate > toDate) return false;
        }
      } else {
        // No due date filter
        if (filters.noDueDate === false) return true;
        if (filters.overdue) return false; // Overdue only applies to tasks with due dates
      }

      return true;
    });
  };

  const clearFilters = () => {
    setFilters({
      search: '',
      statuses: [],
      priorities: [],
      categories: [],
      dueDateRange: {},
      overdue: false,
      noDueDate: false,
    });
  };

  const updateFilter = (key: keyof FilterState, value: any) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const toggleArrayFilter = (key: 'statuses' | 'priorities' | 'categories', value: string) => {
    setFilters(prev => ({
      ...prev,
      [key]: prev[key].includes(value) 
        ? prev[key].filter(item => item !== value)
        : [...prev[key], value]
    }));
  };

  const getActiveFiltersCount = () => {
    let count = 0;
    if (filters.search) count++;
    count += filters.statuses.length;
    count += filters.priorities.length;
    count += filters.categories.length;
    if (filters.dueDateRange.from || filters.dueDateRange.to) count++;
    if (filters.overdue) count++;
    if (filters.noDueDate) count++;
    return count;
  };

  const activeFiltersCount = getActiveFiltersCount();

  return (
    <div className={cn("bg-card border rounded-lg", className)}>
      {/* Filter Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">Filters</span>
          {activeFiltersCount > 0 && (
            <Badge variant="secondary" className="ml-2">
              {activeFiltersCount}
            </Badge>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {activeFiltersCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              Clear
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-muted-foreground hover:text-foreground"
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Quick Search (Always Visible) */}
      <div className="p-4 border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tasks..."
            value={filters.search}
            onChange={(e) => updateFilter('search', e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Expanded Filters */}
      {isExpanded && (
        <div className="p-4 space-y-6">
          {/* Status Filter */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Status</Label>
            <div className="flex flex-wrap gap-2">
              {statusOptions.map(option => (
                <Badge
                  key={option.value}
                  variant={filters.statuses.includes(option.value) ? "default" : "outline"}
                  className={cn(
                    "cursor-pointer hover:bg-muted transition-colors",
                    filters.statuses.includes(option.value) && "bg-primary text-primary-foreground"
                  )}
                  onClick={() => toggleArrayFilter('statuses', option.value)}
                >
                  {option.label}
                </Badge>
              ))}
            </div>
          </div>

          <Separator />

          {/* Priority Filter */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Priority</Label>
            <div className="flex flex-wrap gap-2">
              {priorityOptions.map(option => (
                <Badge
                  key={option.value}
                  variant={filters.priorities.includes(option.value) ? "default" : "outline"}
                  className={cn(
                    "cursor-pointer hover:bg-muted transition-colors",
                    filters.priorities.includes(option.value) && "bg-primary text-primary-foreground"
                  )}
                  onClick={() => toggleArrayFilter('priorities', option.value)}
                >
                  {option.label}
                </Badge>
              ))}
            </div>
          </div>

          <Separator />

          {/* Category Filter */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Category</Label>
            <div className="flex flex-wrap gap-2">
              {categoryOptions.map(option => (
                <Badge
                  key={option.value}
                  variant={filters.categories.includes(option.value) ? "default" : "outline"}
                  className={cn(
                    "cursor-pointer hover:bg-muted transition-colors",
                    filters.categories.includes(option.value) && "bg-primary text-primary-foreground"
                  )}
                  onClick={() => toggleArrayFilter('categories', option.value)}
                >
                  {option.label}
                </Badge>
              ))}
            </div>
          </div>

          <Separator />

          {/* Due Date Filter */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Due Date</Label>
            
            {/* Quick Options */}
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="overdue"
                  checked={filters.overdue}
                  onCheckedChange={(checked) => updateFilter('overdue', checked)}
                />
                <Label htmlFor="overdue" className="text-sm">Overdue</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="noDueDate"
                  checked={filters.noDueDate}
                  onCheckedChange={(checked) => updateFilter('noDueDate', checked)}
                />
                <Label htmlFor="noDueDate" className="text-sm">No due date</Label>
              </div>
            </div>

            {/* Date Range Picker */}
            <div className="grid grid-cols-2 gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "justify-start text-left font-normal",
                      !filters.dueDateRange.from && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {filters.dueDateRange.from ? format(filters.dueDateRange.from, "PP") : "From"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={filters.dueDateRange.from}
                    onSelect={(date) => updateFilter('dueDateRange', { ...filters.dueDateRange, from: date })}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>

              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "justify-start text-left font-normal",
                      !filters.dueDateRange.to && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {filters.dueDateRange.to ? format(filters.dueDateRange.to, "PP") : "To"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={filters.dueDateRange.to}
                    onSelect={(date) => updateFilter('dueDateRange', { ...filters.dueDateRange, to: date })}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Clear date range */}
            {(filters.dueDateRange.from || filters.dueDateRange.to) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => updateFilter('dueDateRange', {})}
                className="text-muted-foreground"
              >
                <X className="h-4 w-4 mr-1" />
                Clear dates
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Active Filters Summary */}
      {activeFiltersCount > 0 && !isExpanded && (
        <div className="px-4 pb-4">
          <div className="text-xs text-muted-foreground">
            {activeFiltersCount} filter{activeFiltersCount > 1 ? 's' : ''} applied
          </div>
        </div>
      )}
    </div>
  );
};

export default TaskFilters;