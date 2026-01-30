

## Auto-Schedule Button for Up Next Section

### Summary
Add an "Auto Schedule" button to the Up Next header that fills remaining time slots for today with queued tasks, reusing the existing `useBatchScheduling` hook as-is.

---

### Implementation

#### File: `src/components/FocusView.tsx`

**1. Add imports (around line 27)**

```tsx
import { useAuth } from '@/hooks/useAuth';
import { useBatchScheduling } from '@/hooks/useBatchScheduling';
```

**2. Add hooks inside component (after existing hooks ~line 111)**

```tsx
const { user } = useAuth();
const { scheduleBatch, updateTasksWithSchedule, isScheduling } = useBatchScheduling();
```

**3. Add handler function (after handleCompleteTask ~line 280)**

```tsx
const handleAutoSchedule = async () => {
  if (!user?.id || upNextTasks.length === 0) return;
  
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  
  const result = await scheduleBatch(
    upNextTasks.map(task => ({
      id: task.id,
      title: task.title,
      category: task.category,
      priority: task.priority,
      estimate_minutes: task.estimate_minutes || 60,
      due_date: task.due_date
    })),
    user.id,
    timezone,
    new Date() // Target today
  );
  
  if (result.scheduled.length > 0) {
    await updateTasksWithSchedule(
      result.scheduled,
      upNextTasks.map(t => t.id)
    );
    onTaskUpdate();
  }
};
```

**4. Update Up Next CardHeader (around lines 507-516)**

Add a Schedule button next to the badge:

```tsx
<CardHeader className="pb-3">
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-2">
      <ListOrdered className="h-5 w-5 text-blue-500" />
      <h2 className="text-lg font-semibold">Up Next</h2>
      <Badge variant="secondary">{upNextTasks.length}</Badge>
    </div>
    {upNextTasks.length > 0 && (
      <Button
        variant="outline"
        size="sm"
        onClick={handleAutoSchedule}
        disabled={isScheduling}
        className="text-xs h-7"
      >
        {isScheduling ? (
          <>
            <Clock className="h-3 w-3 mr-1 animate-spin" />
            Scheduling...
          </>
        ) : (
          <>
            <Calendar className="h-3 w-3 mr-1" />
            Schedule
          </>
        )}
      </Button>
    )}
  </div>
  <p className="text-xs text-muted-foreground">
    Drag to schedule or click Start
  </p>
</CardHeader>
```

---

### Files Changed

| File | Change |
|------|--------|
| `src/components/FocusView.tsx` | Add useAuth + useBatchScheduling hooks, handler, and Schedule button |

No modifications to edge function or hook - uses existing infrastructure as-is.

