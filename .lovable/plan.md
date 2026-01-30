

## Add Play Button to Today's Schedule Tasks

### Problem
Tasks in the "Today's Schedule" section don't have a Play button to quickly start working on them. Users have to either open the task detail modal or manually change the status.

### Solution
Add a Play button to each scheduled task in Today's Schedule, matching the pattern used in the "Up Next" section.

---

### Implementation

#### File: `src/components/FocusView.tsx`

**Location: Lines 352-389** (the task rendering inside Today's Schedule)

**Current structure:**
```tsx
<div className="flex items-center gap-2">
  <Checkbox ... />
  <div className="flex-1 min-w-0">
    {/* time, title, category, duration */}
  </div>
</div>
```

**Updated structure:**
```tsx
<div className="flex items-center gap-2">
  <Checkbox ... />
  <div className="flex-1 min-w-0">
    {/* time, title, category, duration */}
  </div>
  {/* NEW: Play button (only show if not already DOING) */}
  {task.status !== 'DOING' && (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2 hover:bg-green-100 dark:hover:bg-green-900 flex-shrink-0"
      onClick={(e) => {
        e.stopPropagation();
        handleStartTask(task.id);
      }}
      title="Start working on this task"
    >
      <Play className="h-3 w-3 text-green-600" />
    </Button>
  )}
</div>
```

---

### Behavior

| Task Status | Button Shown |
|-------------|--------------|
| TODO, READY, UP_NEXT | Play button visible |
| DOING | No play button (already in progress) |
| DONE | No play button (completed) |

---

### Files Changed

| File | Change |
|------|--------|
| `src/components/FocusView.tsx` | Add Play button to scheduled task items |

