
## Tab Row Layout Fix + Time Period Dropdown

### Two Changes Required

**Issue 1: Category tabs wrapping on mobile**
The tab row is using `flex-wrap` which causes it to break into two rows. We need to switch to horizontal scrolling instead.

**Issue 2: Convert "Today" pill to a time period dropdown**
Replace the static "Today" tab with a dropdown selector offering: Today, This Week, Next Week, All. The other category tabs (Career, Prof. Education, Ventures, Life) remain unchanged.

---

### Implementation

#### File: `src/components/TabbedKanbanBoard.tsx`

**Change 1: Fix tab wrapping - use horizontal scroll instead**

Current (line 99):
```tsx
<TabsList className="w-full justify-start gap-1 h-auto flex-wrap bg-transparent p-0 mb-4">
```

Updated:
```tsx
<TabsList className="w-full justify-start gap-1 h-auto overflow-x-auto flex-nowrap bg-transparent p-0 mb-4 scrollbar-thin">
```

**Change 2: Replace "Today" tab with a time period dropdown**

Add new state for time period:
```tsx
type TimePeriod = 'today' | 'this_week' | 'next_week' | 'all';
const [timePeriod, setTimePeriod] = useState<TimePeriod>('today');
```

Add new imports:
```tsx
import { startOfWeek, endOfWeek, addWeeks, isWithinInterval, parseISO } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
```

Update the filter logic for the first tab to handle all time periods:
```tsx
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
```

**Change 3: Update the UI to show dropdown for first position**

Replace the "Today" TabsTrigger with a Select dropdown inline with the other tabs:

```tsx
<div className="flex items-center gap-1 overflow-x-auto flex-nowrap pb-1 scrollbar-thin mb-4">
  {/* Time Period Dropdown (replaces Today pill) */}
  <Select value={timePeriod} onValueChange={(v) => setTimePeriod(v as TimePeriod)}>
    <SelectTrigger 
      className={cn(
        "w-auto min-w-[100px] h-9 rounded-full px-4 border-none",
        activeTab === 'time_filtered' 
          ? "bg-primary text-primary-foreground" 
          : "bg-transparent hover:bg-muted"
      )}
    >
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="today">Today</SelectItem>
      <SelectItem value="this_week">This Week</SelectItem>
      <SelectItem value="next_week">Next Week</SelectItem>
      <SelectItem value="all">All</SelectItem>
    </SelectContent>
  </Select>
  
  {/* Category tabs remain as TabsTriggers */}
  <Tabs value={activeTab} onValueChange={handleTabChange}>
    <TabsList className="bg-transparent p-0 gap-1">
      {categoryTabs.map(tab => (
        <TabsTrigger key={tab.value} ...>
          {tab.label} {tab.count > 0 && <span>...</span>}
        </TabsTrigger>
      ))}
    </TabsList>
  </Tabs>
</div>
```

**Behavior Notes:**
- When the time period dropdown is selected/changed, it activates that view and shows filtered tasks
- Category tabs (Career, Prof. Education, etc.) are NOT affected by the time period filter
- Each category tab shows ALL tasks for that category regardless of time period selection
- URL params will be updated: `?tab=time_filtered&period=this_week` or `?tab=career`

---

### Summary

| Change | File | What |
|--------|------|------|
| Fix wrapping | TabbedKanbanBoard.tsx | `flex-wrap` → `overflow-x-auto flex-nowrap` |
| Add dropdown | TabbedKanbanBoard.tsx | Replace "Today" pill with Select dropdown |
| Add filtering | TabbedKanbanBoard.tsx | New `getTimeFilteredTasks()` function for week/all logic |

### Expected Result
- Tabs stay in a single horizontal row with scroll on mobile
- First position becomes a dropdown: Today / This Week / Next Week / All
- Category tabs remain as pills and are unaffected by the time filter
