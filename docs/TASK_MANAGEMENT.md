# Task Management System

> Technical reference for the task lifecycle, Kanban board, scheduling, and AI parsing.

## Task Type System

### Statuses (12)

Defined in `src/types/task.ts` and the `task_status` DB enum:

| Status | Usage |
|--------|-------|
| `BACKLOG` | Unprocessed intake |
| `TODO` | Accepted, not started |
| `READY` | All blockers cleared |
| `UP_NEXT` | Queued for today/tomorrow |
| `DOING` | Actively in progress |
| `DONE` | Completed (`completed_at` set) |
| `BLOCKED` | Has unresolved `blocked_by` |
| `PLANNING` | Needs breakdown/scoping |
| `LIFE` | Personal/life category board |
| `CAREER` | Career category board |
| `PROF_EDUCATION` | Education category board |
| `VENTURES` | Side projects board |

### Priorities (4)

`LOW`, `MEDIUM`, `HIGH`, `URGENT` — used for sort order and scheduling weight.

### Categories (6)

`LIFE`, `CAREER`, `VENTURES`, `EDUCATION`, `PROF_EDUCATION`, `PERSONAL` — maps tasks to topic groups on the Priorities page.

## Kanban Board

### Architecture

```
TabbedKanbanBoard (board tabs)
  └─ KanbanBoard (columns + cards)
       └─ TaskCard (draggable)
```

- **Drag-and-drop**: `@hello-pangea/dnd` — `DragDropContext` wraps the board, each column is a `Droppable`, each card a `Draggable`.
- **Boards**: User-created via `boards` table. Each board has ordered `columns` with a `status` mapping.
- **Column management**: `ColumnManager` and `AddColumnModal` handle CRUD. Position is integer-based with reorder on drag.

### Status Update on Drop

When a card is dropped into a new column, its `status` is updated to match the target column's `status` field. The `onDragEnd` handler:
1. Reorders within the same column (position update only)
2. Moves across columns (status + position update)
3. Optimistic UI update, then Supabase `UPDATE`

## Task Detail Modal

### Dependencies

- `blocked_by: string[]` — array of task IDs
- **Circular detection**: `DependencyTree` component walks the graph recursively before allowing a new dependency. If adding task B as a blocker of task A would create a cycle (B → ... → A), the UI prevents it.

### Checklists

- `checklist_items` table with `task_id`, `title`, `is_completed`, `position`
- `ChecklistManager` component handles inline add/edit/delete/reorder
- Completion percentage shown on `TaskCard`

### Time Tracking

- `TimeTracker` component: start/stop timer stored in component state
- `estimate_minutes` on the task for planned duration
- `start_time` / `end_time` for scheduled time slots

## Smart Scheduling

### Edge Functions

| Function | Purpose |
|----------|---------|
| `smart-calendar-scheduler` | AI-powered scheduling considering availability, priorities, energy |
| `batch-calendar-scheduler` | Bulk schedule multiple tasks in one pass |

### Scheduling Flows

1. **Re-Organize**: Triggered from Calendar view. Finds past-due scheduled tasks and reschedules them into future available slots.
2. **Fill Gaps**: Finds unscheduled `TODO`/`READY` tasks and assigns them to empty calendar slots based on priority and estimated duration.

### Scheduling Rules

Defined in `src/config/schedulingRules.ts`:
- Work hours window (configurable per user)
- Buffer between tasks
- Energy-level mapping (morning = high focus, afternoon = medium)
- Break enforcement

### Auto-Scheduling Hook

`useAutoScheduling` — watches for newly created tasks and optionally auto-schedules them based on user preferences in `SchedulingSettings`.

## AI Task Parsing

### `ai-task-parser` Edge Function

Accepts natural language input → returns structured task fields:

```
Input:  "Finish the report by Friday, high priority"
Output: { title: "Finish the report", due_date: "2026-03-13", priority: "HIGH" }
```

Used by:
- `SmartTaskInput` — inline natural language task creation
- `QuickTaskInput` — simplified version for rapid entry
- `EditableTaskSuggestion` — AI suggests task from conversation, user confirms/edits

## Demo Mode

When no authenticated user is present:
- Tasks with `demo-` prefix IDs are stored in `localStorage`
- `DemoModeBadge` component shows visual indicator
- `src/utils/demoData.ts` provides seed data
- All Supabase calls are bypassed; CRUD operations use local state

## Assignment Sync

### External Sources

- **Google Sheets**: `sync-google-sheets` and `sync-mit-sheets` edge functions pull assignment data
- Assignments stored in `assignments` and `assignments_mit` tables
- `assignment_history` tracks field-level changes between syncs

### Task Linking

- `assignment_id` and `assignment_url` on the task link to the source assignment
- `AssignmentSyncSettings` component configures sync intervals and sheet mappings
- `AssignmentSelectionContext` manages bulk selection for batch operations

## Views

| Component | Description |
|-----------|-------------|
| `KanbanBoard` | Column-based drag-and-drop |
| `TaskGridView` / `EnhancedTaskGridView` | Table/spreadsheet view |
| `FocusView` | Single-task deep focus mode |
| `GanttChart` | Timeline visualization |
| `DailyScheduleView` | Day-planner with time slots |
| `ViewSwitcher` | Toggle between views |

## Key Files

| File | Role |
|------|------|
| `src/types/task.ts` | Task, Board, Column interfaces |
| `src/components/KanbanBoard.tsx` | Main board component |
| `src/components/TaskDetailModal.tsx` | Full task editor |
| `src/components/TaskCard.tsx` | Draggable card |
| `src/services/schedulingService.ts` | Client-side scheduling logic |
| `src/utils/taskScheduling.ts` | Scheduling utilities |
| `src/config/schedulingRules.ts` | Scheduling constraints |

---

*See also: [ARCHITECTURE.md](./ARCHITECTURE.md), [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md), [EDGE_FUNCTIONS.md](./EDGE_FUNCTIONS.md)*
