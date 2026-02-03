
# Plan: Fix Real-time UI Updates + SmartTaskInput Improvements

## Problem Analysis

### Issue 1: UI Not Updating Even After Manual Refresh
The real root cause is more subtle than just the subscription event type:

**Current subscriptions only listen for `INSERT`, missing `UPDATE`:**
- `Dashboard.tsx` (line 45): `event: 'INSERT'`
- `TasksPage.tsx` (line 62): `event: 'INSERT'`  
- `Calendar.tsx`: **No subscription at all**

**Why this matters:**
When a task is created via voice/chat, the flow is:
1. Task `INSERT` → UI should update (but might be missed)
2. Task `UPDATE` with `start_time` → UI does NOT update (only INSERT subscribed)

### Issue 2: Duplicate Reminders - Already Handled!
Good news: The database trigger `schedule_task_reminders` already prevents duplicates:

```sql
IF NEW.start_time IS NOT NULL OR NEW.due_date IS NOT NULL THEN
    DELETE FROM scheduled_notifications WHERE task_id = NEW.id;  -- Deletes ALL existing
    -- Then creates fresh ones
END IF;
```

Every time a task is updated (status, due_date, start_time, etc.), it:
1. Deletes ALL pending scheduled_notifications for that task
2. Creates fresh ones based on current task state

So no duplicates will be created - this is already working correctly.

---

## Changes to Implement

### Part 1: Fix Real-time Subscriptions

**File: `src/pages/Dashboard.tsx`**

Change lines 44-45 from:
```typescript
{
  event: 'INSERT',
```
To:
```typescript
{
  event: '*',
```

Add UPDATE detection in the callback (lines 51-56):
```typescript
(payload) => {
  console.log('Task change detected:', payload.eventType, payload.new?.title);
  
  if (payload.eventType === 'INSERT') {
    toast.success(`Task Created: "${payload.new.title}"`);
  } else if (payload.eventType === 'UPDATE' && payload.new?.start_time && !payload.old?.start_time) {
    toast.success(`Task Scheduled: "${payload.new.title}"`);
  }
  
  loadTasks();
}
```

---

**File: `src/pages/TasksPage.tsx`**

Change line 62 from:
```typescript
event: 'INSERT',
```
To:
```typescript
event: '*',
```

Update callback (lines 67-71):
```typescript
(payload) => {
  console.log('[TasksPage] Task change:', payload.eventType);
  
  if (payload.eventType === 'INSERT') {
    toast.success(`Task Created: "${payload.new.title}"`);
  } else if (payload.eventType === 'UPDATE' && payload.new?.start_time && !payload.old?.start_time) {
    toast.success(`Task Scheduled: "${payload.new.title}"`);
  }
  
  loadTasks();
}
```

---

**File: `src/pages/Calendar.tsx`**

Add new useEffect after line 108 to create a real-time subscription:
```typescript
// Set up real-time subscription for task changes
useEffect(() => {
  if (!user || isDemoMode) return;
  
  console.log('[Calendar] Setting up real-time subscription');
  
  const channel = supabase
    .channel('calendar-task-changes')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'tasks',
        filter: `user_id=eq.${user.id}`
      },
      (payload) => {
        console.log('[Calendar] Task change detected:', payload.eventType);
        loadTasks();
      }
    )
    .subscribe();
  
  return () => {
    supabase.removeChannel(channel);
  };
}, [user, isDemoMode]);
```

---

### Part 2: Condense SmartTaskInput to 2 Rows

**File: `src/components/SmartTaskInput.tsx`**

Replace lines 201-244 with condensed layout:
```typescript
return (
  <div className="space-y-3">
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Describe your task... (e.g., 'Review project tomorrow 2pm')"
        disabled={isProcessing}
        className="flex-1"
      />
      
      {/* Compact assignment toggle */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-muted/50 rounded-md shrink-0">
        <Switch 
          checked={includeAssignments} 
          onCheckedChange={setIncludeAssignments}
          id="include-assignments"
          className="scale-90"
        />
        <Label 
          htmlFor="include-assignments" 
          className="cursor-pointer text-xs text-muted-foreground whitespace-nowrap"
        >
          +Assign ({selectedAssignmentIds.size})
        </Label>
      </div>
      
      <Button type="submit" disabled={isProcessing || !input.trim()} size="icon">
        {isProcessing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
      </Button>
    </form>

    {lastSuggestion && lastSuggestion.taskSuggestion && (
      <EditableTaskSuggestion
        suggestion={lastSuggestion.taskSuggestion}
        onAccept={handleAcceptSuggestion}
        onDismiss={() => {
          setLastSuggestion(null);
          setBusySlots([]);
        }}
        busySlots={busySlots}
      />
    )}
  </div>
);
```

**Visual change:**
```
Before (3 rows):
┌──────────────────────────────────────────┐
│ [Toggle] Include Selected Assignments (0) │  ← Row 1
├──────────────────────────────────────────┤
│ [Input field........................] [▶] │  ← Row 2
├──────────────────────────────────────────┤
│ [Editable suggestion card]                │  ← Row 3
└──────────────────────────────────────────┘

After (2 rows):
┌──────────────────────────────────────────┐
│ [Input field..........] [+Assign (0)] [▶] │  ← Row 1
├──────────────────────────────────────────┤
│ [Editable suggestion card]                │  ← Row 2
└──────────────────────────────────────────┘
```

---

### Part 3: Add SmartTaskInput to Other Views

**File: `src/components/FocusView.tsx`**

Add import at top:
```typescript
import SmartTaskInput from './SmartTaskInput';
```

Add component after the "Today's Schedule" CardHeader (find the appropriate CardContent location):
```typescript
<div className="px-4 pb-3">
  <SmartTaskInput 
    tasks={tasks}
    targetDate={today}
    onTaskScheduled={onTaskUpdate}
  />
</div>
```

---

**File: `src/components/KanbanBoard.tsx`**

Add import at top:
```typescript
import SmartTaskInput from './SmartTaskInput';
```

Add component after the filter section, before the DragDropContext:
```typescript
<Card className="mb-4">
  <CardContent className="pt-4">
    <SmartTaskInput 
      tasks={tasks}
      targetDate={new Date()}
      onTaskScheduled={onTaskUpdate}
    />
  </CardContent>
</Card>
```

---

**File: `src/components/EnhancedTaskGridView.tsx`**

Add import at top:
```typescript
import SmartTaskInput from './SmartTaskInput';
```

Add component before the table:
```typescript
<Card className="mb-4">
  <CardContent className="pt-4">
    <SmartTaskInput 
      tasks={tasks}
      targetDate={new Date()}
      onTaskScheduled={onTaskUpdate}
    />
  </CardContent>
</Card>
```

---

## Summary

| File | Change |
|------|--------|
| `src/pages/Dashboard.tsx` | Change realtime from `INSERT` to `*` |
| `src/pages/TasksPage.tsx` | Change realtime from `INSERT` to `*` |
| `src/pages/Calendar.tsx` | Add new realtime subscription |
| `src/components/SmartTaskInput.tsx` | Condense to 2-row layout |
| `src/components/FocusView.tsx` | Add SmartTaskInput import and component |
| `src/components/KanbanBoard.tsx` | Add SmartTaskInput import and component |
| `src/components/EnhancedTaskGridView.tsx` | Add SmartTaskInput import and component |

## Technical Notes

### Why Slack Arrives Before UI Updates
```
Task Creation via Voice/Chat:
1. Edge function INSERTs task → DB trigger creates scheduled_notifications
2. notification-delivery cron (runs every minute) → sends Slack immediately
3. Meanwhile, browser realtime subscription...
   - Was only listening for INSERT
   - If task INSERT happened, then UPDATE for scheduling...
   - UPDATE was NOT caught → UI never refreshed
```

### Duplicate Prevention (Already Working)
The `schedule_task_reminders` trigger has this logic:
```sql
IF NEW.start_time IS NOT NULL OR NEW.due_date IS NOT NULL THEN
    DELETE FROM scheduled_notifications WHERE task_id = NEW.id;
    -- Then insert fresh notifications
END IF;
```

This means every UPDATE to a task's timing fields wipes all pending notifications and creates new ones. No duplicates possible.
