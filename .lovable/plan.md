

# Redesign Assignments Page: Tabs + Program Selector

## Problem

The current Assignments page uses dropdown selects for status filtering and has no program-level grouping (EMBA vs MIT). The reference UI from emba-nexus shows a cleaner pattern: horizontal tab bar for status, and a program selector at the top.

## Design

### Layout (top to bottom, 411px mobile)

1. **Header**: "Assignments" title + Sync button + subtitle text
2. **Program selector**: Segmented toggle — "EMBA" | "MIT" | "All" — EMBA selected by default. Fetches from `programs` table.
3. **Course filter dropdown**: Kept as-is but scoped to selected program
4. **Status tab bar**: Horizontal scrollable tabs replacing the status dropdown:
   - "All Assignments" | "Due Next" | "Overdue" | "Active" | "Submitted"
   - "Due Next" = upcoming tasks sorted by nearest due date
   - "Active" = tasks currently in progress (status DOING/UP_NEXT)
   - "Submitted" = completed/DONE tasks
5. **Course accordion list**: Each course shown as an expandable row with chevron + assignment count (matching the reference). Clicking expands to show assignment cards underneath.
6. **Stats row removed** — the tabs themselves communicate status counts via badge indicators

### Data Flow

- Fetch `programs` table to get program names/IDs
- Join tasks via `assignment_id` → `assignments.program_id` to determine which program each task belongs to
- Since the tasks table doesn't have `program_id` directly, query `assignments` table to get the program mapping, then filter client-side

### Status Mapping

| Tab | Filter logic |
|-----|-------------|
| All Assignments | No status filter |
| Due Next | Not DONE, has due_date, sorted by nearest due |
| Overdue | Not DONE, due_date in past |
| Active | status is DOING or UP_NEXT |
| Submitted | status is DONE or completed_at set |

## Changes

### `src/pages/Assignments.tsx` — Full redesign

1. Add state for `programFilter` (default: first program or 'EMBA')
2. Fetch `programs` table on mount to populate program toggle
3. Fetch `assignments` table (just `id, program_id`) to build a task→program lookup map
4. Replace status `<Select>` with `<Tabs>` component using values: `all`, `due_next`, `overdue`, `active`, `submitted`
5. Add program segmented control using existing `<Tabs>` or button group at top
6. Replace flat card list with collapsible course sections (Collapsible component) — each showing course name + count, expandable to reveal assignment cards
7. Scope course dropdown options to only courses within the selected program
8. Keep existing TaskDetailModal integration and sync button

### No backend changes needed

All filtering is client-side. The `programs` and `assignments` tables already exist with the necessary relationships.

## Files Changed

| File | Change |
|------|--------|
| `src/pages/Assignments.tsx` | Add program toggle, replace status dropdown with tab bar, use collapsible course sections |

