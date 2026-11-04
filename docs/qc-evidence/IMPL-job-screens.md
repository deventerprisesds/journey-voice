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
- src/components/SchedulingSettings.tsx: keyword lane free-text Input -> Select: "No category (applies to all)" + CATEGORY_KEYS
  in order with CATEGORY_LABELS. value = `toCategoryKey(stored) ?? sentinel`; config is only rewritten in onValueChange, so a
  non-category stored lane (e.g. `flexible`) shows "No category" and saves back byte-for-byte; picking "No category" stores
  `flexible`; "Add Keyword" seeds `['flexible','flexible']` (was `['flexible','LIFE']`). + helper line under the description.
  Window Select and keyword Input untouched. Note: Radix Select does not fire onValueChange when the already-shown option is
  re-picked, so re-picking "No category" on a row that already shows it leaves the stored value as it was (by design of (b)).
- (base merged again @ 64f1645: coordinator's CATEGORY_LABELS.LIFE back to 'Life'; ROLLOUT sql doc. No conflict.)

## Proof (run 2026-11-04 in this worktree, node_modules symlinked from the coordinator's install)

| check | base 64f1645 | this branch | result |
|---|---|---|---|
| `npm test` | -- | tests 490, pass 490, fail 0, suites 67 | PASS |
| `tsc --noEmit -p tsconfig.app.json` error count | 32 | 27 | 0 new errors (comm of line-number-stripped error lists: NEW = empty) |
| errors gone vs base | -- | 5 | all 5 were `category: ... | "JOB"` from the DB enum not assignable to `Task` (TaskCreationModal, Calendar, assignmentSync x2, taskScheduling) |
| tsc errors mentioning a category map | -- | 0 | `grep -i categor` on tsc output = none |
| `vite build` | exit 0 | exit 0 | PASS (only the pre-existing >500 kB chunk warning) |
| built CSS rules | 1368 | 1378 | REMOVED: none except `:root`/`.dark`, which are identical once `--category-job` is removed (script check = True for both). ADDED: only `*-category-job*`, `*-lime-{50,100,300,700}`, `w-[200px]` (Settings Select) |

Type-guard mutation proof (`mutate.sh`, anchor/replacement from files):
- deleted `JOB: 'bg-category-job/10 ...'` from TaskCard.tsx `categoryColors`, test = tsc filtered to TaskCard+JOB.
- `FIRED: 'G:category-map-job' failed with the defect reinstated.` / `restored: src/components/TaskCard.tsx matches HEAD` / `tree clean`.
- tsc text with the line removed: `src/components/TaskCard.tsx(114,7): error TS2741: Property 'JOB' is missing in type '{ LIFE: string; CAREER: string; VENTURES: string; EDUCATION: string; PROF_EDUCATION: string; }' but required in type 'Record<"CAREER" | "PROF_EDUCATION" | "VENTURES" | "LIFE" | "EDUCATION" | "JOB", string>'.`

AC-E1 grep (`'LIFE' \| 'CAREER'|\['LIFE', 'CAREER'|"LIFE", "CAREER"` over src, excl. types.ts/tests/backup): 5 hits, ALL
STATUS unions/lists, not category lists: types/task.ts:21,97 (`status`), workflowStatus.ts:30 (status), TabbedKanbanBoard.tsx:25
(`categoryStatuses`, normalizeTasks -- told to keep), RealtimeVoiceAssistant.ts:1641 (status; file out of scope). The AC's pattern
cannot tell a status union from a category union.

## Before/after per file (evidence: `git diff origin/claude/jolly-archimedes-is9jyz HEAD -- src tailwind.config.ts`, every `-` line listed below)

Every removed line in the diff is one of: an import line (gains `TaskCategory`), a map/array declaration header (gains a type
annotation), a category union replaced by `TaskCategory`, or a list that is re-emitted with JOB inserted. No label text, colour
class, icon or entry order line of an existing category was removed or edited. The one exception is intentional: the Settings
keyword-lane free-text Input (AC-C12) and the Add Keyword seed `'LIFE'` (AC-C15).

| file | change | existing categories unchanged: labels/colours/order |
|---|---|---|
| src/index.css | + `--category-job` in :root and .dark | yes -- built :root/.dark identical minus the new var |
| tailwind.config.ts | + `category.job` | yes -- 4 existing keys untouched |
| src/types/task.ts | category union -> TaskCategory (re-export) | yes -- type only; status union untouched |
| src/pages/Priorities.tsx | maps typed Record<TaskCategory>, + JOB | yes -- only header lines changed, + JOB lines |
| DailyScheduleView.tsx | map typed (excl. PERSONAL), + JOB | yes |
| EditableTaskSuggestion.tsx | union -> TaskCategory, + "Job" option before "Career" | yes -- Life, Career, Ventures, Education, Prof. Education text/order kept |
| EnhancedTaskGridView.tsx | categoryColors typed (excl. PERSONAL), + JOB lime; edit options + JOB before CAREER | yes |
| TaskGridView.tsx, GanttChart.tsx | category union -> TaskCategory | yes -- type only |
| KanbanBoard.tsx | bin map typed (excl. PERSONAL), + JOB lime | yes -- PERSONAL still "Uncategorized" bin |
| FocusView.tsx, WeeklyAgendaView.tsx | badge maps typed (excl. PERSONAL), + JOB token | yes |
| TimeSlotGrid.tsx | badge + border maps typed (excl. PERSONAL), + JOB token | yes |
| TaskCard.tsx | icon + badge maps typed (excl. PERSONAL), + JOB Building2 + token | yes -- CAREER keeps Briefcase |
| TaskFilters.tsx | categoryOptions typed, + Job (lime) before Career | yes -- status options untouched |
| TaskCreationModal.tsx | union -> TaskCategory, + "Job" in both Selects before "Career" | yes |
| TaskDetailModal.tsx | + "Job" in Category Select before "Career" | yes -- status Select untouched |
| SmartTaskInput.tsx | union -> TaskCategory | yes -- type only |
| ProductivityDashboard.tsx | map typed, + JOB tile LAST | yes -- see Deviations |
| TabbedKanbanBoard.tsx | + Job tab before Career, `tab=job` accepted | yes -- existing tabs' labels/filters/order kept (they shift right by one pill) |
| MainLayout.tsx | + Job nav entry before Career | yes -- existing entries kept |
| SchedulingSettings.tsx | lane Input -> Select; Add seed; helper line | n/a (the control itself is the requested change) |

## Not done / for the coordinator

- AC-E3/E4/E5 (Playwright pixel + computed-style + option-text diff on the deployed app) were not run: they need the
  `verify-uat.yml` GHA runner with a fixture board; out of reach from this worktree. Static evidence above (CSS rule diff,
  removed-line audit) is the local substitute -- MECHANISM ONLY, not user-confirmed.
- Board tabs: adding the Job pill shifts the existing pills right by one pill width (the owner-approved tab; unavoidable).
