
# Plan: Add "Focus" View - Today's Command Center

## Summary

Create a new "Focus" view for the Tasks page that provides a real-time snapshot of what's in motion today. The view combines:
1. **Today's Timeline** - Scheduled tasks and events grouped by time window
2. **Currently Doing** - Active tasks being worked on now
3. **Up Next Queue** - Prioritized backlog ready to pull in or schedule

---

## Design Pattern References

| App | Pattern |
|-----|---------|
| Todoist Today | Scheduled tasks by time + overdue queue |
| Linear My Issues | Active work + queued backlog sidebar |
| Things 3 Today | Morning/Afternoon/Evening + Anytime queue |
| Toggl Focus | Currently working on + time tracking |

---

## Layout Design

```text
Desktop Layout (lg+)
┌────────────────────────────────────────────────────────────────────────────┐
│  Tasks                                       [Board] [Grid] [Focus*]       │
├────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────┐  ┌─────────────────────────────┐  │
│  │  Today's Schedule                   │  │  Currently Doing            │  │
│  │  ───────────────────────────────    │  │  ─────────────────────────  │  │
│  │                                     │  │  [▶] Review quarterly...    │  │
│  │  ☀️ Morning (6-9 AM)                │  │      🔵 CAREER • 2h left    │  │
│  │  └─ (empty - drop to schedule)      │  │                             │  │
│  │                                     │  │  [▶] MIT assignment...      │  │
│  │  ☕ Business Hours (9 AM-5 PM)      │  │      🟣 EDUCATION • 1h      │  │
│  │  ├─ 9:00  Team standup   30m        │  └─────────────────────────────┘  │
│  │  ├─ 10:00 Code review    1h         │                                   │
│  │  └─ 2:00  Client call    45m        │  ┌─────────────────────────────┐  │
│  │                                     │  │  Up Next Queue              │  │
│  │  🌅 After Work (5-10 PM)            │  │  ─────────────────────────  │  │
│  │  ├─ 6:00  Gym workout    1h         │  │  Drag to timeline →         │  │
│  │  └─ 8:00  Side project   2h         │  │                             │  │
│  │                                     │  │  [1] Finish pitch deck      │  │
│  │  ─────────────────────────────      │  │      🟠 VENTURES • URGENT   │  │
│  │  📅 Open slots available            │  │                             │  │
│  │                                     │  │  [2] Reply to investor      │  │
│  └─────────────────────────────────────┘  │      🟠 VENTURES • HIGH     │  │
│                                           │                             │  │
│                                           │  [3] Update docs            │  │
│                                           │      🔵 CAREER • MEDIUM     │  │
│                                           └─────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘

Mobile Layout (stacked)
┌────────────────────────────┐
│  Currently Doing (2)       │  ← Most important first
├────────────────────────────┤
│  Today's Schedule          │  ← Collapsed time windows
├────────────────────────────┤
│  Up Next Queue (5)         │  ← Collapsible
└────────────────────────────┘
```

---

## Key Features

### 1. Today's Timeline (Left Panel)
- Groups tasks by time windows from `schedulingConfig` (Morning, Business Hours, After Work, Evening)
- Reuses visual styling from `TimeSlotGrid` (icons, colors, borders)
- Shows scheduled tasks with start time, duration, category badge
- Drop zones for drag-scheduling from Up Next queue
- Empty slots show "+ Add task" on hover

### 2. Currently Doing Section (Right Top)
- Filters: `status === 'DOING'`
- Shows elapsed time since task was started (`updated_at`)
- Quick "Done" checkmark to complete
- "Pause" option to move back to UP_NEXT
- Click to open TaskDetailModal for details

### 3. Up Next Queue (Right Bottom)
- Filters:
  - `status === 'UP_NEXT'`
  - Plus: `status === 'READY'` with priority HIGH or URGENT
  - Plus: `status === 'TODO'` with priority URGENT
- Sorted by priority (URGENT > HIGH > MEDIUM > LOW), then by due_date
- Draggable to timeline for scheduling
- "Start" button to move to DOING immediately
- Shows top 5 with "View X more..." button

---

## Drag-and-Drop Flow

```text
┌────────────────────┐        Drag         ┌──────────────────────┐
│  Up Next Queue     │  ─────────────────► │  Timeline Time Slot  │
│  (Draggable)       │                     │  (Droppable)         │
└────────────────────┘                     └──────────────────────┘
         │                                          │
         │ onDragEnd                                │
         ▼                                          ▼
   Parse droppableId                         Set task.start_time
   "timeslot-14-30"                          to 2:30 PM today
         │                                          │
         └──────────► supabase.update() ◄───────────┘
                      start_time, end_time
                      status: 'TODO'
```

---

## Technical Implementation

### Files to Create

| File | Purpose |
|------|---------|
| `src/components/FocusView.tsx` | Main Focus view component (~350 lines) |

### Files to Modify

| File | Change |
|------|--------|
| `src/components/ViewSwitcher.tsx` | Add 'focus' to ViewType, add Focus button |
| `src/pages/TasksPage.tsx` | Handle 'focus' view rendering, update subtitle |

---

## ViewSwitcher.tsx Changes

```typescript
// Update ViewType
export type ViewType = 'kanban' | 'grid' | 'focus';

// Add to viewOptions array
{
  value: 'focus' as ViewType,
  label: 'Focus',
  icon: Target,  // from lucide-react
  description: 'Today\'s command center'
}

// Update URL sync in TasksPage to include 'focus'
```

---

## FocusView.tsx Component Structure

```typescript
interface FocusViewProps {
  tasks: Task[];
  onTaskEdit: (task: Task) => void;
  onStatusChange: (taskId: string, newStatus: Task['status']) => void;
  onTaskUpdate: () => void;
}

const FocusView: React.FC<FocusViewProps> = ({...}) => {
  const today = new Date();
  const { schedulingConfig } = useSchedulingConfig(); // or use default
  
  // Filter task groups
  const doingTasks = tasks.filter(t => t.status === 'DOING');
  
  const upNextTasks = tasks.filter(t => 
    t.status === 'UP_NEXT' || 
    (t.status === 'READY' && ['URGENT', 'HIGH'].includes(t.priority)) ||
    (t.status === 'TODO' && t.priority === 'URGENT')
  ).sort(prioritySort);
  
  const scheduledToday = tasks.filter(t => 
    t.start_time && isToday(parseISO(t.start_time))
  );

  // Drag-drop handler
  const handleDragEnd = async (result: DropResult) => {
    if (result.destination?.droppableId.startsWith('timeslot-')) {
      const [_, hour, minute] = result.destination.droppableId.split('-');
      await scheduleTaskAtTime(result.draggableId, hour, minute);
    }
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Timeline - 2/3 width on desktop */}
        <div className="lg:col-span-2 order-2 lg:order-1">
          <TodayTimeline tasks={scheduledToday} config={schedulingConfig} />
        </div>
        
        {/* Sidebar - 1/3 width */}
        <div className="space-y-6 order-1 lg:order-2">
          <DoingSection tasks={doingTasks} />
          <UpNextQueue tasks={upNextTasks} />
        </div>
      </div>
    </DragDropContext>
  );
};
```

---

## Sub-Components Within FocusView

### TodayTimeline
- Iterates over time windows from `DEFAULT_SCHEDULING_CONFIG.timeWindows`
- For each window, renders header with icon (Morning, Business Hours, etc.)
- Lists tasks scheduled within that window
- Empty windows show drop zone with placeholder text
- Reuses `timeWindowStyles` pattern from `TimeSlotGrid`

### DoingSection
- Card with header "Currently Doing" + count badge
- Empty state: "No tasks in progress. Start something from Up Next!"
- Task cards with:
  - Checkbox to mark complete
  - Category badge
  - Time since started (humanized)
  - Click to edit

### UpNextQueue
- Card with header "Up Next" + count badge
- Instruction text: "Drag to schedule or click Start"
- Droppable container for drag-drop
- QueueCard items showing:
  - Position number (1, 2, 3...)
  - Task title
  - Category + Priority badges
  - "Start" button (moves to DOING)
- "View X more..." button when > 5 tasks

---

## TasksPage.tsx Changes

```typescript
// Import
import FocusView from '@/components/FocusView';

// Update URL validation
if (viewParam && ['kanban', 'grid', 'focus'].includes(viewParam)) {
  setCurrentView(viewParam);
}

// Update subtitle
<p className="text-xs md:text-sm text-muted-foreground hidden sm:block">
  {currentView === 'kanban' ? 'Kanban Board' : 
   currentView === 'grid' ? 'List View' : 
   'Today\'s Command Center'}
</p>

// Add Focus view rendering
{currentView === 'focus' && (
  <FocusView
    tasks={tasks}
    onTaskEdit={handleTaskEdit}
    onStatusChange={handleStatusChange}
    onTaskUpdate={handleTaskUpdate}
  />
)}
```

---

## Existing Code Reuse

| Pattern | Source | Usage in FocusView |
|---------|--------|-------------------|
| Time window styling | `TimeSlotGrid.tsx` lines 33-70 | Header icons, colors, labels |
| Category colors | `TaskCard.tsx` lines 105-111 | Badge styling |
| Priority colors | `TaskCard.tsx` lines 83-95 | Priority badges |
| Drag-drop | `KanbanBoard.tsx` | `@hello-pangea/dnd` patterns |
| Task filtering | `KanbanBoard.tsx` lines 129-133 | Time period logic |

---

## Summary of Changes

| Component | Estimated Lines | Complexity |
|-----------|-----------------|------------|
| ViewSwitcher.tsx | ~15 | Low |
| TasksPage.tsx | ~25 | Low |
| FocusView.tsx (new) | ~350 | Medium |

**Total estimated effort: Medium**

---

## Expected Outcome

After implementation:
1. New "Focus" button appears in Tasks toolbar next to Board and Grid
2. Clicking Focus shows today's timeline with time windows
3. "Currently Doing" section shows active tasks at top
4. "Up Next" queue shows prioritized backlog ready to pull
5. Drag tasks from Up Next to timeline slots to schedule
6. Click "Start" to begin working on a task immediately
7. Mobile-responsive stacked layout prioritizes active work
