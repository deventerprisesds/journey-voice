
# Fix: List View Status Dropdown Changes Not Persisting

## Problem Summary

When you change a task's status (or priority) via the dropdown in the List View, the selection visually changes momentarily but then reverts back - the change is never saved to the database.

---

## Root Cause

In `src/components/EnhancedTaskGridView.tsx`, the `renderEditableCell` function handles the Select dropdown for status and priority fields.

**Current Code (Lines 327-340):**
```typescript
if (type === 'select' && options) {
  return (
    <Select value={editValue} onValueChange={setEditValue}>
      <SelectTrigger className="h-8">
        <SelectValue />
      </SelectTrigger>
      ...
    </Select>
  );
}
```

**The Problem:**
- `onValueChange` only calls `setEditValue(newValue)` - it updates local React state
- Unlike the text Input (which has `onBlur={() => saveEdit(...)}`), the Select has **no mechanism to trigger `saveEdit()`**
- When the dropdown closes, the local state has the new value, but it's never persisted to the database
- On the next render, the task prop still has the old value, so the UI reverts

---

## Solution

Modify the Select's `onValueChange` to immediately save the change and close the editor:

**Updated Code:**
```typescript
if (type === 'select' && options) {
  return (
    <Select 
      value={editValue} 
      onValueChange={(newValue) => {
        setEditValue(newValue);
        // Immediately save the selection and close edit mode
        saveEditImmediate(task.id, field, newValue);
      }}
    >
      ...
    </Select>
  );
}
```

Since `saveEdit()` uses `editValue` from state (which won't be updated yet due to React's async state), we need a variation that accepts the value directly:

**New helper function:**
```typescript
const saveEditImmediate = async (taskId: string, field: string, value: string) => {
  try {
    const updateData: any = { [field]: value };
    console.log(`Updating task ${taskId} field ${field} to:`, value);
    
    // Optimistic update - immediately update the UI
    const updatedTasks = currentTasks.map((task: Task) => 
      task.id === taskId ? { ...task, ...updateData, updated_at: new Date().toISOString() } : task
    );
    setOptimisticTasks(updatedTasks);
    
    if (isDemoMode) {
      const demoTasks = localStorage.getItem('kanban-demo-tasks');
      if (demoTasks) {
        const tasks = JSON.parse(demoTasks);
        const updatedDemoTasks = tasks.map((task: Task) => 
          task.id === taskId ? { ...task, ...updateData } : task
        );
        localStorage.setItem('kanban-demo-tasks', JSON.stringify(updatedDemoTasks));
      }
    } else {
      const { error } = await supabase
        .from('tasks')
        .update(updateData)
        .eq('id', taskId);

      if (error) {
        console.error('Error updating task:', error);
        setOptimisticTasks([]);
        toast({
          title: "Error",
          description: "Failed to update task",
          variant: "destructive",
        });
        return;
      }
    }

    // Clear optimistic updates and refresh data
    setTimeout(() => {
      setOptimisticTasks([]);
      if (onTaskUpdate) {
        onTaskUpdate();
      }
    }, 100);

    toast({
      title: "Task updated",
      description: "Task has been updated successfully",
    });
  } catch (error) {
    console.error('Error saving edit:', error);
    setOptimisticTasks([]);
  } finally {
    setEditingCell(null);
    setEditValue('');
  }
};
```

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/EnhancedTaskGridView.tsx` | Add `saveEditImmediate` function and update Select's `onValueChange` handler |

---

## Technical Summary

| Issue | Location | Root Cause |
|-------|----------|------------|
| Status/Priority changes don't persist | `renderEditableCell()` | Select's `onValueChange` only updates local state, never calls `saveEdit()` |

---

## Expected Behavior After Fix

1. User clicks the status/priority badge in List View
2. Dropdown appears with options
3. User selects a new value (e.g., "UP_NEXT")
4. Change is **immediately** saved to Supabase
5. Dropdown closes automatically
6. Toast shows "Task updated"
7. The new status persists correctly
