

# Prioritization Dashboard — 3x2+ Grid Layout

## Layout Specification

```text
DESKTOP (xl+): 3 columns, categories fill left-to-right, top-to-bottom
Minimum 2 rows means at least 4 categories visible (or empty slots in row 2)

+--[Left Nav]--+------------[Main Content]-------------+--[Assistant]--+
|              |                                        |               |
|              |  Priorities                [Group|Task] |               |
|              |                                        |               |
|              |  +-- CAREER --+ +- PROF ED -+ +- VENTURES -+          |
|              |  | > Network  | | > DataSci | | > StartupX |          |
|              |  |   - Task 1 | |   - Task 5| |   - Task 9 |          |
|              |  | > CareerDev| | > CertPrep| |            |          |
|              |  |   - Task 3 | |   - Task 7| | + Add Group|          |
|              |  | + Add Group| | + Add Grp | |            |          |
|              |  +------------+ +----------+ +------------+          |
|              |                                        |               |
|              |  +-- LIFE ----+ +- EDUCATION+ +- PERSONAL -+          |
|              |  | > Home     | | > Courses | | > Health   |          |
|              |  |   - Task 10| |   - Task 12|   - Task 14|          |
|              |  | + Add Group| | + Add Grp | | + Add Group|          |
|              |  +------------+ +----------+ +------------+          |
|              |                                        |               |
+--------------+----------------------------------------+---------------+

TABLET (md): 2 columns, categories wrap into more rows

+-- CAREER -------+ +-- PROF ED ------+
| ...              | | ...             |
+-----------------+ +-----------------+
+-- VENTURES -----+ +-- LIFE ---------+
| ...              | | ...             |
+-----------------+ +-----------------+
+-- EDUCATION ----+ +-- PERSONAL -----+
| ...              | | ...             |
+-----------------+ +-----------------+

MOBILE: Single column, full-width stacked cards

+-- CAREER -------------------+
| > Professional Networking    |
|   - Task 1          HIGH     |
|   - Task 2          MED      |
| > Career Development         |
|   - Task 3                   |
| + Add Group                  |
+-----------------------------+
+-- PROF ED ------------------+
| ...                          |
+-----------------------------+
```

## Key Design Decisions

- Grid: `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4`
- With 6 default categories (CAREER, PROF_EDUCATION, EDUCATION, VENTURES, LIFE, PERSONAL), you get a natural 3x2 grid on desktop
- If a user has fewer than 4 categories, the second row still renders (may have 1-3 items)
- If more than 6, additional rows wrap naturally
- Each category is a Card with a colored top border accent
- Category order follows the key order from `categoryMappings` in the user's scheduling config
- On mobile, each category card is full-width with compact padding

## Technical Plan

### New Files

| File | Purpose |
|------|---------|
| `src/pages/Priorities.tsx` | Main page: loads user config for categories, fetches topic groups + tasks, renders the responsive grid, handles drag-and-drop reordering of topic groups within categories |
| `src/components/priorities/CategoryColumn.tsx` | Card for one category: header with name/color/count, Droppable zone, list of TopicGroupPanels, Add Group button |
| `src/components/priorities/TopicGroupPanel.tsx` | Collapsible + Draggable panel: topic name, task count, expandable task list with priority badges and due dates, click-to-edit via TaskDetailModal |
| `src/components/priorities/AddTopicGroupDialog.tsx` | Dialog to create a new topic group under a specific category, inserts into `task_topic_index` |

### Modified Files

| File | Change |
|------|--------|
| `src/App.tsx` | Add route: `/priorities` pointing to new Priorities page |
| `src/components/MainLayout.tsx` | Add "Priorities" nav item with `Layers` icon between Agenda and Settings in the `navItems` array |

### Data Flow

1. Load user's `categoryMappings` from `user_scheduling_prefs` (keys become the section headers)
2. Fall back to `DEFAULT_SCHEDULING_CONFIG.categoryMappings` if no user config
3. Fetch `task_topic_index` for the user's topic groups
4. Fetch `task_topic_mappings` to link tasks to topic groups
5. Fetch active tasks (exclude DONE/BLOCKED)
6. Assign each topic group to a category based on majority category of its mapped tasks
7. Unmapped tasks go into an "Uncategorized" panel per category
8. Topic groups with no category-matched tasks go into an "Other" column at the end

### View Toggle (Group vs Task)

- **Group View** (default): 3-col grid of category cards, each containing collapsible topic group panels with nested tasks
- **Task View**: Same 3-col grid but each category card shows a flat sorted task list (no topic group nesting), sorted by priority then due date

### Responsive Behavior Summary

| Breakpoint | Columns | Notes |
|------------|---------|-------|
| < 768px (mobile) | 1 | Full-width stacked cards, compact padding, touch-friendly tap targets |
| 768-1279px (tablet) | 2 | Cards wrap into rows of 2 |
| 1280px+ (desktop) | 3 | 3-column grid, minimum 2 rows with 6 default categories |

### Reorder Persistence

Topic group order within a category stored in `localStorage` keyed by `priorities-order-{userId}-{category}`. Future enhancement: add `position` column to `task_topic_index`.

