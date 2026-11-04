// WHAT:       Groups coursework WORK-SESSION cards under their assignment card for list views (Kanban,
//             Grid), so one assignment reads as one card: "2 of 4 sessions done · next Wed 7:00 pm".
// WHY:        Owner, 2026-11-04, after the first live build created separate "session N of M" cards:
//             "I thought it was one assignment with many 1 of x time blocks". The scheduler keeps one
//             task per session (each holds its own time block, alarm and Done button), so this is a
//             DISPLAY layer only. Owner chose it as the default with a Settings switch back to separate
//             cards: config.assignmentSessions.display = 'grouped' (default) | 'separate'.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   supabase/functions/_shared/work-sessions.ts (session identity `<assignmentId>::session-<k>`);
//             live build 2026-11-04 02:31Z created 4 session cards for 2 assignments.

export type SessionDisplay = 'grouped' | 'separate';

export const SESSION_TAG = 'work-session';
export const RETIRED_TAG = 'session-not-needed';
const SESSION_KEY_RE = /^(.+)::session-(\d+)$/;

/** Same contract as the backend's parseSessionKey (_shared/work-sessions.ts). */
export function parseSessionKey(assignmentId: string | null | undefined): { assignmentId: string; index: number } | null {
  const m = SESSION_KEY_RE.exec(String(assignmentId ?? ''));
  return m ? { assignmentId: m[1], index: Number(m[2]) } : null;
}

/** Grouped unless the owner explicitly switched to separate cards. */
export function resolveSessionDisplay(config: any): SessionDisplay {
  return config?.assignmentSessions?.display === 'separate' ? 'separate' : 'grouped';
}

interface SessionLike {
  id: string;
  title: string;
  assignment_id?: string | null;
  status?: string | null;
  completed_at?: string | null;
  start_time?: string | null;
  tags?: string[] | null;
}

export interface WorkSessionSummary<T extends SessionLike = SessionLike> {
  total: number;
  done: number;
  /** The earliest scheduled session that is not done, if any. */
  next: T | null;
  /** Every live (non-retired) session, in session order. */
  sessions: T[];
}

export type Grouped<T extends SessionLike> = T & { workSessions?: WorkSessionSummary<T> };

const isDone = (t: SessionLike) => t.status === 'DONE' || !!t.completed_at;
const isRetired = (t: SessionLike) => (t.tags ?? []).includes(RETIRED_TAG);

/**
 * Removes session cards whose assignment card is in the same list and attaches them to it as
 * `workSessions`. A session whose assignment is NOT in the list (filtered out, or not loaded) stays
 * visible on its own, so grouping can never hide work.
 */
export function groupWorkSessions<T extends SessionLike>(tasks: T[]): Grouped<T>[] {
  const parentByAssignment = new Map<string, T>();
  for (const t of tasks) {
    if (t.assignment_id && !parseSessionKey(t.assignment_id)) parentByAssignment.set(t.assignment_id, t);
  }
  const sessionsByAssignment = new Map<string, Array<{ task: T; index: number }>>();
  const absorbed = new Set<string>();
  for (const t of tasks) {
    const key = parseSessionKey(t.assignment_id);
    if (!key || !parentByAssignment.has(key.assignmentId)) continue;
    absorbed.add(t.id);
    if (isRetired(t)) continue;
    const list = sessionsByAssignment.get(key.assignmentId) ?? [];
    list.push({ task: t, index: key.index });
    sessionsByAssignment.set(key.assignmentId, list);
  }

  const out: Grouped<T>[] = [];
  for (const t of tasks) {
    if (absorbed.has(t.id)) continue;
    const list = t.assignment_id ? sessionsByAssignment.get(t.assignment_id) : undefined;
    if (!list?.length) { out.push(t); continue; }
    const sessions = list.sort((a, b) => a.index - b.index).map((s) => s.task);
    const next = sessions
      .filter((s) => !isDone(s) && s.start_time)
      .sort((a, b) => Date.parse(a.start_time!) - Date.parse(b.start_time!))[0] ?? null;
    out.push({ ...t, workSessions: { total: sessions.length, done: sessions.filter(isDone).length, next, sessions } });
  }
  return out;
}

/** The assignment card a session belongs to, from a full task list (for the detail view). */
export function findSessionParent<T extends SessionLike>(session: T, tasks: T[]): T | null {
  const key = parseSessionKey(session.assignment_id);
  if (!key) return null;
  return tasks.find((t) => t.assignment_id === key.assignmentId) ?? null;
}

/** All live sessions of an assignment card, in session order (for the detail view). */
export function sessionsOf<T extends SessionLike>(parent: T, tasks: T[]): T[] {
  if (!parent.assignment_id || parseSessionKey(parent.assignment_id)) return [];
  return tasks
    .map((t) => ({ t, key: parseSessionKey(t.assignment_id) }))
    .filter(({ t, key }) => key?.assignmentId === parent.assignment_id && !isRetired(t))
    .sort((a, b) => a.key!.index - b.key!.index)
    .map(({ t }) => t);
}
