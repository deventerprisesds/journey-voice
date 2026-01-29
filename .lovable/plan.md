

# Enhanced Agenda Page with Time Grid Bins

## Overview

Transform the current `DailyScheduleView` from a simple list-based layout into a visual time-block schedule with:
1. **Time Window Bins**: Scheduled tasks displayed in a vertical time grid
2. **15-Minute Snap Grid**: Task durations visually span their actual time slots
3. **Category Lanes/Tags**: Color-coded visual grouping by category (LIFE, CAREER, VENTURES, PROF_EDUCATION)

---

## Current vs Proposed Layout

```text
CURRENT                              PROPOSED
+-----------------+                  +--------------------------------------+
| Scheduled Tasks |                  |  09:00 | [CAREER] Review PRs    |  |
|   - Task 1      |                  |  09:15 |         (30 min)       |  |
|   - Task 2      |                  |  09:30 |------------------------|  |
+-----------------+                  |  09:45 |                        |  |
                                     |  10:00 | [LIFE] Gym workout     |  |
| Unscheduled     |                  |  10:15 |      (60 min)          |  |
|   - Task 3      |                  |  10:30 |                        |  |
|   - Task 4      |                  |  10:45 |                        |  |
+-----------------+                  +--------------------------------------+
                                     | UNSCHEDULED: 14 tasks               |
                                     +--------------------------------------+
```

---

## Technical Approach

### Option A: Reuse TimeSlotGrid Component (Recommended)

The existing `TimeSlotGrid.tsx` already provides:
- 15-minute interval grid (6 AM - 10 PM)
- Task positioning with duration spanning
- Side-by-side overlap handling
- Click-to-create functionality

**Changes needed:**
1. Import `TimeSlotGrid` into `DailyScheduleView`
2. Add category color badges to task rendering
3. Configure for single-day view optimized for agenda

### Option B: Build Custom AgendaTimeGrid Component

Create a simpler, agenda-focused grid that:
- Only shows hours with scheduled tasks (compact mode)
- Groups tasks by time window "bins" (morning/afternoon/evening)
- Has horizontal category lanes

---

## Implementation Plan

### Phase 1: Core Time Grid Integration

**File: `src/components/DailyScheduleView.tsx`**

Replace the simple Droppable list with an enhanced layout:

```typescript
// New imports
import TimeSlotGrid from './TimeSlotGrid';
import { ScrollArea } from '@/components/ui/scroll-area';

// Scheduled section becomes:
<ScrollArea className="h-[500px]">
  <TimeSlotGrid
    dates={[selectedDate]}
    tasks={scheduledTasks}
    onTimeSlotClick={(date, hour, minute) => {
      // Open task creation modal at this time
    }}
    onTaskClick={(task) => onTaskEdit(task)}
    onStatusChange={handleStatusChange}
    className="border rounded-lg"
  />
</ScrollArea>
```

### Phase 2: Add Category Visual Indicators

**File: `src/components/TimeSlotGrid.tsx`**

Enhance the task rendering to show prominent category badges:

```typescript
// Add category color mapping
const categoryColors = {
  LIFE: 'bg-category-life text-white',
  CAREER: 'bg-category-career text-white',
  VENTURES: 'bg-category-ventures text-white',
  EDUCATION: 'bg-category-education text-white',
  PROF_EDUCATION: 'bg-category-education text-white',
};

// In task rendering, add category badge:
<Badge className={cn("text-[10px] absolute top-0 right-0", categoryColors[t.category])}>
  {t.category}
</Badge>
```

### Phase 3: Smart Time Window Grouping (Optional Enhancement)

**File: `src/components/DailyScheduleView.tsx`**

Add collapsible time window groups:

```typescript
const timeWindows = [
  { label: 'Morning', range: [6, 12], icon: Sunrise },
  { label: 'Afternoon', range: [12, 17], icon: Sun },
  { label: 'Evening', range: [17, 22], icon: Sunset },
];

// Group tasks by time window for summary view
const getTasksForWindow = (start: number, end: number) => {
  return scheduledTasks.filter(task => {
    const hour = parseISO(task.start_time).getHours();
    return hour >= start && hour < end;
  });
};
```

### Phase 4: Mobile-Optimized Compact View

For mobile, show a more compact list with visible time blocks:

```typescript
{isMobile ? (
  <MobileAgendaList tasks={scheduledTasks} />
) : (
  <TimeSlotGrid ... />
)}
```

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/components/DailyScheduleView.tsx` | MODIFY | Integrate TimeSlotGrid, add category indicators |
| `src/components/TimeSlotGrid.tsx` | MODIFY | Add category badges to task blocks |
| `src/components/AgendaTaskBin.tsx` | CREATE (optional) | Reusable task bin component for compact view |

---

## Visual Design Details

### Task Block Styling
- **Height**: Calculated from duration (4px per minute, snapped to 15-min = 60px minimum)
- **Width**: 90% of column (leaves room for time labels)
- **Border**: Left border colored by category (4px solid)
- **Background**: Priority-based gradient (URGENT = red, HIGH = orange, etc.)
- **Badge**: Category tag positioned top-right

### Category Color Reference (from existing CSS)
| Category | Color Variable | Hex Equivalent |
|----------|---------------|----------------|
| LIFE | `--category-life` | Teal (~#28B67A) |
| CAREER | `--category-career` | Purple (~#6D4C9F) |
| VENTURES | `--category-ventures` | Orange (~#F97316) |
| EDUCATION | `--category-education` | Blue (~#3B82F6) |

### 15-Minute Grid Snapping
- Grid lines every 15 minutes
- Task blocks snap to nearest 15-minute boundary
- Minimum visible height = 1 slot (15 min = 60px)

---

## Integration with Existing Features

1. **Drag-Drop**: Preserve existing drag between scheduled/unscheduled
2. **Real-time Updates**: Keep Supabase subscription for live updates
3. **Task Creation**: "New Task" button pre-fills selected date
4. **Status Toggle**: Checkbox overlay on hover to mark complete

---

## Expected User Experience

1. User navigates to Agenda page
2. Sees vertical time grid with current day's tasks as blocks
3. Each block shows:
   - Task title
   - Time range (e.g., "9:00 AM - 10:30 AM")
   - Category badge (e.g., "CAREER")
   - Duration indicator (visual height)
4. Unscheduled tasks remain in sidebar/bottom panel
5. Clicking empty slot opens task creation at that time
6. Clicking task opens detail modal

