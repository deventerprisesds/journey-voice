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
