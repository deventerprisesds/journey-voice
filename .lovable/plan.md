
## UI Layout Overhaul: Comms Panel + Kanban Tabs

This plan addresses two major UI changes based on your wireframe:
1. **Comms Panel**: Persistent right-side panel (1/3 width), collapsible, always accessible
2. **Kanban Tabs**: Reorganize columns into tabbed categories with standardized workflow columns

---

## Part 1: Persistent Comms Panel Layout

### Current State
- CommsHome at `/` is a **full-page takeover** with embedded CommsConsole
- Navigating to Tasks, Calendar, etc. completely leaves the comms interface
- No way to have Kanban and Comms visible simultaneously

### Target State
- **Three-column layout**: Left nav sidebar | Main content (2/3) | Comms panel (1/3)
- Comms panel is **collapsible** from the right side
- Toggle button to expand/collapse the panel
- Works across all routes (Tasks, Calendar, Agenda, etc.)

### Implementation

#### 1. Create `MainLayout.tsx` (New Component)

A wrapper that provides the persistent three-column structure:

```text
+----------------+---------------------------+------------------+
|    Sidebar     |       Main Content        |   Comms Panel    |
|   (nav menu)   |   (Tasks/Calendar/etc)    |   (voice/chat)   |
|   ~56-200px    |        flex-1             |   ~1/3 or 400px  |
|   collapsible  |                           |   collapsible    |
+----------------+---------------------------+------------------+
```

Key features:
- Extract NavigationSection from AssistantSidebar to use in the left column
- Add a collapse/expand toggle for the right Comms panel
- Store panel open state in `CommsConsoleContext` (already has `isPanelOpen`)

#### 2. Update `App.tsx` Routes

Wrap authenticated routes with MainLayout:
- `/tasks` shows TasksPage in main content + Comms panel on right
- `/calendar` shows Calendar in main content + Comms panel on right
- `/` becomes a welcome/dashboard view OR just shows the Tasks route

#### 3. Add Panel Mode to `CommsConsole.tsx`

Add a `mode="panel"` prop that renders a narrower, right-side version without its own navigation (navigation moves to MainLayout's left sidebar).

#### 4. Mobile Behavior
- On mobile, hide the right comms panel by default
- Show a floating button to open it as a full-screen Sheet/drawer
- Maintain existing Sheet-based navigation for the left sidebar

---

## Part 2: Tabbed Kanban Board

### Current State
- All columns displayed horizontally: Blocked, Backlog, Life, Career, Prof. Education, Ventures, Planning, Ready, Up Next, Doing, Done
- Very wide, requires horizontal scrolling
- No way to focus on a specific life domain

### Target State (From Your Wireframe)
Tabs at the top: **Today | Career | Prof. Education | Ventures | Life**

Each tab shows **6 standardized columns**:
| Column | Purpose |
|--------|---------|
| Backlog | Items for this category, not yet prioritized |
| Blocked | Items stuck/waiting on something |
| Ready | Prioritized and ready to work on |
| Up Next | Queued for immediate attention |
| Doing | Currently in progress |
| Done | Completed items |

### How Tabs Map to Tasks

- **Today Tab**: Shows tasks where `due_date = today` OR `status = UP_NEXT/DOING`, across ALL categories
- **Career Tab**: Shows tasks where `category = 'CAREER'`
- **Prof. Education Tab**: Shows tasks where `category = 'PROF_EDUCATION'` or `'EDUCATION'`
- **Ventures Tab**: Shows tasks where `category = 'VENTURES'`
- **Life Tab**: Shows tasks where `category = 'LIFE'`

The current `status` field maps to the standardized columns:
- `BACKLOG`/`TODO` to "Backlog"
- `BLOCKED` to "Blocked"
- `READY` to "Ready"
- `UP_NEXT`/`PLANNING` to "Up Next"
- `DOING` to "Doing"
- `DONE` to "Done"

Old category-as-status values (e.g., `status = 'CAREER'`) will be migrated to proper status/category pairs.

### Implementation

#### 1. Create `TabbedKanbanBoard.tsx` (New Component)

Wraps the existing KanbanBoard with tab navigation:
- Uses `@radix-ui/react-tabs` (already installed via shadcn)
- Stores active tab in URL query param (`?tab=career`) for bookmarkability
- Filters tasks by category before passing to column renderer

#### 2. Update `KanbanBoard.tsx`

- Add `categoryFilter` prop to show only tasks of a specific category
- Add `todayMode` prop to show cross-category tasks due today
- Reduce default columns to the 6 standardized ones (hide category columns)

#### 3. Standardize Column Configuration

Instead of 11 columns, each tab view uses 6:

```typescript
const STANDARD_COLUMNS = [
  { name: 'Backlog', status: 'BACKLOG' },
  { name: 'Blocked', status: 'BLOCKED' },
  { name: 'Ready', status: 'READY' },
  { name: 'Up Next', status: 'UP_NEXT' },
  { name: 'Doing', status: 'DOING' },
  { name: 'Done', status: 'DONE' },
];
```

#### 4. Data Migration (Optional)

Normalize existing tasks where `status` matches a category name:
- `status: 'CAREER'` becomes `status: 'BACKLOG', category: 'CAREER'`
- `status: 'VENTURES'` becomes `status: 'BACKLOG', category: 'VENTURES'`
- etc.

This can be done via a SQL migration or handled in-app with a mapping function.

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/components/MainLayout.tsx` | **Create** | Three-column layout wrapper with persistent nav + comms panel |
| `src/components/TabbedKanbanBoard.tsx` | **Create** | Tab navigation wrapper for Kanban |
| `src/App.tsx` | **Modify** | Wrap routes with MainLayout |
| `src/components/KanbanBoard.tsx` | **Modify** | Add categoryFilter prop, use standardized columns |
| `src/components/CommsConsole/CommsConsole.tsx` | **Modify** | Add panel mode for right-side display |
| `src/pages/TasksPage.tsx` | **Modify** | Use TabbedKanbanBoard instead of KanbanBoard |
| `src/pages/CommsHome.tsx` | **Modify** or **Delete** | Convert to dashboard or remove (MainLayout handles comms) |
| `src/contexts/CommsConsoleContext.tsx` | **Modify** | Ensure isPanelOpen defaults to true |

---

## Technical Considerations

1. **Drag-and-drop**: Maintain existing @hello-pangea/dnd functionality within each tab's columns

2. **State persistence**: 
   - Tab selection persisted in URL (`/tasks?view=kanban&tab=career`)
   - Comms panel open/closed in localStorage

3. **Responsive breakpoints**:
   - Desktop (>1024px): Full three-column layout
   - Tablet (768-1024px): Two columns, comms panel in drawer
   - Mobile (<768px): Single column, both sidebars in drawers

4. **Task filtering logic**:
   - "Today" tab: `due_date = today OR status IN ('UP_NEXT', 'DOING')`
   - Category tabs: `category = 'CAREER'` (etc.)

5. **Column resizing**: Using `react-resizable-panels` (already installed) for user-adjustable widths

---

## Summary

This overhaul transforms the app from a "navigate between separate pages" model to a **unified workspace** where:
- The Comms panel is always accessible on the right (collapsible)
- The Kanban board is focused via category tabs instead of horizontal scrolling
- Each tab presents a clean 6-column workflow

All existing functionality (drag-and-drop, task editing, voice assistant, filters) is preserved.
