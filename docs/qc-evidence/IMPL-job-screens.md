# IMPL-job-screens

- WHAT:          Progress log + proof for the SCREENS half of the JOB category change (shared category list on
                 every screen, JOB added everywhere a category is listed/styled/iconed/filtered/counted, Settings
                 keyword-lane Select).
- WHY:           AC-job-category.md sections E and AC-C12/C13/C15: ~20 screens hand-copied the category union, so
                 JOB would be missing (unstyled, unselectable) on any copy that was not updated.
- SUPERSEDES:    nothing.
- SUPERSEDED-BY: nothing -- current.
- EVIDENCE:      branch `claude_job-screens`; base `origin/claude/jolly-archimedes-is9jyz` @ d31aef1;
                 docs/qc-evidence/AC-job-category.md (F-12, F-21, F-22, AC-E1..E11, AC-C12/C13/C15).

## Conventions used

- JOB colour token: `--category-job: 330 72% 48%` (light) / `330 72% 58%` (dark); `category.job` in tailwind.
  Hue 330 vs existing 168 (life), 262 (career), 25 (ventures), 214 (education): min distance 55 degrees (ventures).
- Tailwind-palette screens: JOB = `lime` (no category uses lime on any screen; lime ~85 deg vs pink/blue/purple/green/orange).
- Maps that never had a PERSONAL entry are typed `Record<Exclude<TaskCategory, 'PERSONAL'>, ...>` so the PERSONAL
  lookup keeps returning `undefined` exactly as before (byte-identical runtime output) while a missing JOB is
  still a type error. Maps that had PERSONAL are typed `Record<TaskCategory, ...>`.
- Column-STATUS maps (AddColumnModal, ColumnManager, status unions) are untouched: JOB is a `task_category` enum
  value, not a `task_status` value (`src/integrations/supabase/types.ts` Enums).

## Progress (one line per file)

- src/index.css: + `--category-job` light + dark. Existing tokens unchanged.
- tailwind.config.ts: + `category.job`. Existing four unchanged.
- src/types/task.ts: `Task.category` -> `TaskCategory` (shared); re-exports the type. Status union unchanged.
- src/pages/Priorities.tsx: colour + label maps typed `Record<TaskCategory>`, + JOB. Existing entries unchanged.
- src/components/DailyScheduleView.tsx: badge map typed, + JOB (token). Existing unchanged.
- src/components/EditableTaskSuggestion.tsx: union -> TaskCategory; Select + "Job" directly before "Career".
- src/components/EnhancedTaskGridView.tsx: categoryColors typed, + JOB (lime); inline-edit options + JOB before CAREER.
- src/components/TaskGridView.tsx, GanttChart.tsx: local `category` union -> TaskCategory (type only).
- src/components/KanbanBoard.tsx: bin CATEGORY_COLORS typed (PERSONAL excluded -> still "Uncategorized" bin), + JOB lime.
- src/components/FocusView.tsx, WeeklyAgendaView.tsx: badge maps typed, + JOB token classes.
- src/components/TimeSlotGrid.tsx: badge + left-border maps typed, + JOB token.
- (base branch merged: origin/claude/jolly-archimedes-is9jyz, touched supabase/ + scripts/ only; no conflict.)
- src/components/TaskCard.tsx: icon + badge maps typed (PERSONAL excluded), + JOB `Building2` icon + `category-job` badge. CAREER keeps `Briefcase`.
- src/components/TaskFilters.tsx: categoryOptions typed `TaskCategory`, + "Job" (lime) directly after Life / before Career. statusOptions untouched (status).
- src/components/TaskCreationModal.tsx: ParsedTask.category -> TaskCategory; both category Selects + "Job" before "Career".
- src/components/TaskDetailModal.tsx: Category Select + "Job" before "Career". Status Select ("... Backlog") untouched: JOB is not a status.
- src/components/SmartTaskInput.tsx: TaskSuggestion.category -> TaskCategory (type only).
- src/components/ProductivityDashboard.tsx: categoryStats typed; + JOB count APPENDED LAST (deviation, see below).
- src/components/TabbedKanbanBoard.tsx: + "Job" tab before "Career" (filters category JOB), `tab=job` accepted in both URL checks. normalizeTasks untouched.
- src/components/MainLayout.tsx: nav kanbanTabs + "Job" (`tab=job`) before "Career".
- Not changed (status-shaped, not a category list): AddColumnModal, ColumnManager, KanbanBoard statusLabels/statusColors/statusToCategory/demo seeds, EnhancedTaskGridView+TaskGridView statusColors/progressMap, GanttChart statusColors, TaskCard statusIcons/statusColors/statusFlow, workflowStatus.ts, assignmentSync.ts/assignmentFetching.ts (fixed EDUCATION/PROF_EDUCATION literals only), ItineraryEngine (single literal).

## Deviations from the brief (all to honour the "no visible change" hard constraint)

- ProductivityDashboard: JOB is the LAST tile, not before Career. The tiles sit in `grid-cols-2 md:grid-cols-4`; a 5th tile before Career would move Career/Ventures/Education to new cells (Education onto row 2 at md). Last keeps all four existing tiles in their exact cells.

## Findings (observed, not fixed -- out of scope / would change existing behaviour)

- TaskCard: `categoryIcons` has no PERSONAL entry, so a PERSONAL task renders `<undefined />` as the icon component (React throws). 0 PERSONAL rows today per .claude/memory.md, so latent. Kept identical.
- ProductivityDashboard: PERSONAL and PROF_EDUCATION have no tile, so the tile counts do not sum to the task total (AC-E9 reconciliation). Kept identical.
