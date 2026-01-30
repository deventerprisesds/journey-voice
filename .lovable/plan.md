

## Add Quick "Up Next" Button to List View

### Overview

Add an orange Play button next to the Done checkbox in the list view table, matching the Kanban card's pattern. Also update the visibility condition to allow tasks in `DOING` status to be moved back to `UP_NEXT`.

### Design Approach

**Reuse existing infrastructure** - The component already has `onStatusChange` prop that handles status updates. We'll use this same callback rather than creating a duplicate handler.

---

### Technical Implementation

**File: `src/components/EnhancedTaskGridView.tsx`**

#### 1. Add Play icon to imports (line 33)

Add `Play` to the existing lucide-react imports.

#### 2. Update the Done column cell (lines 926-933)

Wrap the checkbox in a flex container and add the Play button that:
- Only shows when `task.status !== 'UP_NEXT' && task.status !== 'DONE'` (allows `DOING` to be pushed back)
- Calls `onStatusChange?.(task.id, 'UP_NEXT')` directly - same pattern as checkbox handler
- Uses orange styling matching the Kanban card

**Current code:**
```tsx
<TableCell>
  {onStatusChange && (
    <Checkbox
      checked={task.status === 'DONE'}
      onCheckedChange={(checked) => handleCheckboxChange(task.id, !!checked)}
    />
  )}
</TableCell>
```

**New code:**
```tsx
<TableCell>
  <div className="flex items-center gap-1">
    {onStatusChange && (
      <Checkbox
        checked={task.status === 'DONE'}
        onCheckedChange={(checked) => handleCheckboxChange(task.id, !!checked)}
      />
    )}
    {onStatusChange && task.status !== 'UP_NEXT' && task.status !== 'DONE' && (
      <Button
        variant="ghost"
        size="sm"
        className="p-1 h-6 w-6 rounded-full bg-orange-500 hover:bg-orange-600 text-white"
        onClick={(e) => {
          e.stopPropagation();
          onStatusChange(task.id, 'UP_NEXT');
        }}
        title="Move to Up Next"
      >
        <Play className="h-3 w-3" />
      </Button>
    )}
  </div>
</TableCell>
```

---

### Key Decisions

| Decision | Rationale |
|----------|-----------|
| Reuse `onStatusChange` | Avoids duplicating update logic; status changes are handled in parent |
| Allow `DOING` → `UP_NEXT` | User explicitly requested this - tasks can be deprioritized |
| Same styling as TaskCard | Consistent UX with orange rounded button |

---

### Consistency Update for TaskCard

To keep both views consistent, the **TaskCard.tsx** button condition (line 283) should also allow `DOING` tasks to be moved back:

**Current (line 283):**
```tsx
{task.status !== 'UP_NEXT' && task.status !== 'DOING' && task.status !== 'DONE' && (
```

**Updated:**
```tsx
{task.status !== 'UP_NEXT' && task.status !== 'DONE' && (
```

---

### Visual Result

| Before (List View) | After |
|--------------------|-------|
| `[checkbox]` | `[checkbox] [▶]` |

The Play button appears for all tasks except those already in `UP_NEXT` or `DONE`.

---

### Files Changed

| File | Changes |
|------|---------|
| `src/components/EnhancedTaskGridView.tsx` | Add `Play` icon import; update Done column to include Up Next button using existing `onStatusChange` |
| `src/components/TaskCard.tsx` | Update button condition to allow `DOING` → `UP_NEXT` |

