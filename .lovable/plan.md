

## Add "GO" Quick Action Button to Kanban Cards

### Overview
Add a "GO" button to TaskCard that quickly moves tasks to "UP_NEXT" status, complementing the existing checkbox that marks tasks as "DONE".

---

### Technical Changes

**File: `src/components/TaskCard.tsx`**

#### Change 1: Add a new handler function for "GO" action (after line 228)

Add a handler function that sets the task status to UP_NEXT:

```tsx
const handleGoAction = () => {
  if (!onStatusChange) return;
  onStatusChange(task.id, 'UP_NEXT');
};
```

#### Change 2: Add the "GO" button next to the checkbox (after line 276)

Insert a new button between the checkbox and the status icon button:

| Location | Current | New |
|----------|---------|-----|
| After checkbox (line 276-277) | `)}` then `<Button variant="ghost"...` | Add GO button before status icon button |

```tsx
{task.status !== 'UP_NEXT' && task.status !== 'DOING' && task.status !== 'DONE' && (
  <Button
    variant="ghost"
    size="sm"
    className="p-1 h-6 w-6 rounded-full bg-orange-500 hover:bg-orange-600 text-white"
    onClick={(e) => {
      e.stopPropagation();
      handleGoAction();
    }}
    title="Move to Up Next"
  >
    <Play className="h-3 w-3" />
  </Button>
)}
```

The button:
- Uses the `Play` icon (already imported) with orange styling to match "UP_NEXT" status color
- Only shows when the task is NOT already in UP_NEXT, DOING, or DONE status (no point showing GO for tasks already in progress)
- Calls `handleGoAction` which sets status to "UP_NEXT"

---

### Visual Layout

After implementation, the card header will show:

```text
[Checkbox] [GO Button*] [Status Icon] Task Title...
```
*GO button only visible when task is in BACKLOG, READY, BLOCKED, etc.

---

### Files Changed

| File | Action |
|------|--------|
| `src/components/TaskCard.tsx` | Add handleGoAction function and GO button |

