// =============================================================================
// WHAT:       The list of real WORKFLOW lanes a task can sit in, and a guard that accepts a
//             status suggestion only if it names one.
// WHY:        `task_status` is a Postgres enum that contains BOTH workflow lanes (BACKLOG,
//             DOING, …) AND four CATEGORY names (LIFE, CAREER, PROF_EDUCATION, VENTURES) that
//             leaked in historically — migration 20250925163916 seeded board columns named
//             after them. So `Task['status']` admits a category and NO type-based check can
//             tell the two apart; the distinction has to be written down, which is this file.
//
//             Measured 2026-10-08: 11 live rows carried `status = VENTURES`. The parser was one
//             source (#28). The other, still live until this change, was
//             `smart-calendar-scheduler` PRIORITY 3 returning `mapping.defaultStatus` — a
//             CATEGORY — which `taskScheduling.ts` wrote straight into `tasks.status`. Without
//             this guard the 11 rows would have come back on the next scheduling pass.
//
//             EDUCATION and PERSONAL are worse: they are categories that are NOT in
//             `task_status` at all, so Postgres rejects the insert outright. That is how task
//             creation failed with no visible cause.
// SUPERSEDES: nothing.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   .claude/accuracy-log.md (2026-10-08); journey PRs #28/#29/#30.
// Run: npm test
// =============================================================================

/** Every member of the `task_status` enum, as the DB defines it. */
export type TaskStatus =
  | 'BACKLOG' | 'TODO' | 'PLANNING' | 'READY' | 'UP_NEXT' | 'DOING' | 'IN_REVIEW'
  | 'BLOCKED' | 'DONE'
  // --- below: category names that live in task_status for historical reasons only ---
  | 'LIFE' | 'CAREER' | 'PROF_EDUCATION' | 'VENTURES';

/**
 * The lanes that are genuinely a WORKFLOW position.
 *
 * The four category-shaped enum members are deliberately absent. That absence IS the guard —
 * do not "complete" this list from the enum.
 */
export const WORKFLOW_STATUSES: readonly TaskStatus[] = [
  'BACKLOG', 'TODO', 'PLANNING', 'READY', 'UP_NEXT', 'DOING', 'IN_REVIEW', 'BLOCKED', 'DONE',
];

const WORKFLOW_SET: ReadonlySet<string> = new Set(WORKFLOW_STATUSES);

/** True for a real workflow lane; false for a category, a typo, or anything non-string. */
export function isWorkflowStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && WORKFLOW_SET.has(value);
}

/**
 * Accept an upstream status suggestion only if it names a real workflow lane, else null.
 *
 * Kept as a guard even though the source is fixed: a suggestion arrives over HTTP from a
 * SEPARATELY DEPLOYED edge function, so the client can never assume the two are in step. The
 * caller's `?? task.status` fallback then means an unrecognised value leaves the task where it
 * was rather than moving it somewhere wrong.
 */
export function asWorkflowStatus(value: unknown): TaskStatus | null {
  return isWorkflowStatus(value) ? value : null;
}

/**
 * The lane a NEW task belongs in: dated work is queued up, undated work goes to the backlog.
 *
 * This is journey's own existing server-side rule, implemented at
 * `supabase/functions/execute-tool/index.ts:1482`. It is restated here so the several client
 * writers stop each inventing their own answer — which is how two of them ended up with a
 * private copy of a `mapCategoryToStatus` helper.
 */
export function defaultStatusForNewTask(opts: { dated: boolean }): TaskStatus {
  return opts.dated ? 'UP_NEXT' : 'BACKLOG';
}
