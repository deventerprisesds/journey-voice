// WHAT:       The one check every journey write path uses for a task's priority (task_priority enum).
// WHY:        2026-11-19 18:21 and 18:22 UTC Iris's "create those tasks" failed twice: ai-task-parser
//             (gpt-4o-mini) returned priority "BACKLOG" (a STATUS word) and execute-tool wrote it as-is, so
//             Postgres refused the row (22P02 invalid input value for enum task_priority: "BACKLOG").
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   execute-tool logs 2026-11-19T18:21:10Z / 18:22:23Z; migration 20250924210213 (enum LOW|MEDIUM|HIGH|URGENT).

export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Spellings other surfaces offer that mean a real value: the phone-call tool offered "CRITICAL". */
const PRIORITY_ALIASES: Record<string, TaskPriority> = { CRITICAL: "URGENT" };

/** The priority if it is a real task_priority value (any case, trimmed; known aliases mapped), else null.
 *  The enum is case-sensitive in Postgres ('medium' is refused), so this is also the upper-caser. */
export function recognizePriority(v: unknown): TaskPriority | null {
  if (typeof v !== "string") return null;
  const up = v.trim().toUpperCase();
  if ((TASK_PRIORITIES as readonly string[]).includes(up)) return up as TaskPriority;
  return PRIORITY_ALIASES[up] ?? null;
}

/** For a NEW task: a real priority, or MEDIUM. A stray value (e.g. a status word) never fails the insert. */
export function normalizePriority(v: unknown): TaskPriority {
  return recognizePriority(v) ?? "MEDIUM";
}
