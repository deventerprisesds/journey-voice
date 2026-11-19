// WHAT:       The one check every journey write path uses for a task's priority (task_priority enum).
// WHY:        2026-11-19 18:21 and 18:22 UTC Iris's "create those tasks" failed twice: ai-task-parser
//             (gpt-4o-mini) returned priority "BACKLOG" (a STATUS word) and execute-tool wrote it as-is, so
//             Postgres refused the row (22P02 invalid input value for enum task_priority: "BACKLOG").
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   execute-tool logs 2026-11-19T18:21:10Z / 18:22:23Z; migration 20250924210213 (enum LOW|MEDIUM|HIGH|URGENT).

export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** The priority if it is a real task_priority value (any case, trimmed), else null. */
export function recognizePriority(v: unknown): TaskPriority | null {
  if (typeof v !== "string") return null;
  const up = v.trim().toUpperCase();
  return (TASK_PRIORITIES as readonly string[]).includes(up) ? (up as TaskPriority) : null;
}

/** For a NEW task: a real priority, or MEDIUM. A stray value (e.g. a status word) never fails the insert. */
export function normalizePriority(v: unknown): TaskPriority {
  return recognizePriority(v) ?? "MEDIUM";
}
