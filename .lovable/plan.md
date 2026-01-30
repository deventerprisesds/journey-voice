

## Fix Missing Status Options in Task Detail Modal

### Problem
The status dropdown is missing `UP_NEXT`, `READY`, `BLOCKED`, and `PLANNING` workflow statuses.

### Solution
Add all workflow statuses and fix the labels for category backlogs.

#### File: `src/components/TaskDetailModal.tsx` (lines 495-505)

**Current:**
```tsx
<SelectContent>
  <SelectItem value="BACKLOG">Backlog</SelectItem>
  <SelectItem value="TODO">To Do</SelectItem>
  <SelectItem value="DOING">In Progress</SelectItem>
  <SelectItem value="DONE">Done</SelectItem>
  <SelectItem value="LIFE">Life Lane</SelectItem>
  <SelectItem value="CAREER">Career Lane</SelectItem>
  <SelectItem value="VENTURES">Ventures Lane</SelectItem>
  <SelectItem value="EDUCATION">Education Lane</SelectItem>
  <SelectItem value="PROF_EDUCATION">Prof Education Lane</SelectItem>
</SelectContent>
```

**Updated:**
```tsx
<SelectContent>
  {/* Workflow statuses */}
  <SelectItem value="BACKLOG">Backlog</SelectItem>
  <SelectItem value="TODO">To Do</SelectItem>
  <SelectItem value="READY">Ready</SelectItem>
  <SelectItem value="UP_NEXT">Up Next</SelectItem>
  <SelectItem value="DOING">Doing</SelectItem>
  <SelectItem value="DONE">Done</SelectItem>
  <SelectItem value="BLOCKED">Blocked</SelectItem>
  <SelectItem value="PLANNING">Planning</SelectItem>
  {/* Category backlogs */}
  <SelectItem value="LIFE">Life Backlog</SelectItem>
  <SelectItem value="CAREER">Career Backlog</SelectItem>
  <SelectItem value="VENTURES">Ventures Backlog</SelectItem>
  <SelectItem value="EDUCATION">Education Backlog</SelectItem>
  <SelectItem value="PROF_EDUCATION">Prof Education Backlog</SelectItem>
</SelectContent>
```

---

### Status Categories

| Type | Statuses |
|------|----------|
| **Workflow** | BACKLOG → TODO → READY → UP_NEXT → DOING → DONE |
| **States** | BLOCKED, PLANNING |
| **Category Backlogs** | LIFE, CAREER, VENTURES, EDUCATION, PROF_EDUCATION |

---

### Files Changed

| File | Change |
|------|--------|
| `src/components/TaskDetailModal.tsx` | Add missing workflow statuses, rename "Lane" → "Backlog" |

