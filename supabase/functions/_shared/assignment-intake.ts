// WHAT:       The PURE planner for the nightly assignment intake: given the owner's Nexus
//             `content.assignments` rows and their existing journey tasks, decide exactly which
//             tasks to CREATE, which linked tasks to UPDATE (due date, title, submitted/graded flag),
//             which to leave alone, and the one Iris digest that summarises it. No I/O.
// WHY:        Every decision the sync makes must be unit-testable AND previewable with zero writes
//             (dry run). Owner rulings 2026-10-28 this encodes, verbatim in effect:
//               - a course is current iff it has open items dated today or later (no Nexus write);
//               - only dated items, due today or later, become tasks;
//               - the due date is the Nexus instant exactly (the old sync wrote
//                 `toISOString().split('T')[0] + 'T23:59:59Z'`, a UTC day: Sun 11:59 pm ET became
//                 Mon 7:59 pm ET);
//               - on refresh: auto-update due date + title, FLAG submitted/graded (never auto-close),
//                 never touch a task the owner marked DONE, and at most one Iris message per run.
// SUPERSEDES: the inline per-assignment logic of nightly-assignment-sync/index.ts on main 9c81e5f
//             (which read journey `public.assignments`, frozen 2026-04-06).
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   docs/qc-evidence/FINDINGS-assignment-spreading.md §1c, §2, §5 P1 (AC-P1-1..AC-P1-10);
//             tests in assignment-intake.test.ts.
//
// WHY THE SUBMITTED/GRADED FLAG IS A TAG (and not only scheduling_context): nightly-schedule-builder
// REPLACES `tasks.scheduling_context` wholesale whenever it places a task (main lines 835, 1380, 1490).
// A flag kept only there would be wiped every night, the next sync would see "not yet flagged" and
// send the same Iris message again — a nightly nag. The builder never writes `tags`, and Huddle's
// board already renders tags as chips, so `nexus-submitted` is both durable and visible. The
// `scheduling_context.nexus_status` / `nexus_changes` fields are written too, as best-effort history.

import { localDateOf, zonedTimeToUtc } from './timezone.ts';
import type { NexusAssignmentRow } from './nexus-read.ts';

export const ASSIGNMENT_TITLE_PREFIX = '📚 ';
/** Nexus statuses that mean "the owner handed it in" — flagged on the card, never auto-closed. */
export const NEXUS_CLOSED_STATUSES = ['submitted', 'graded', 'completed'];
export const NEXUS_FLAG_TAG_PREFIX = 'nexus-';
const VALID_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const MAX_DESCRIPTION = 4000;

export interface ExistingTask {
  id: string;
  title: string;
  status: string | null;
  completed_at: string | null;
  assignment_id: string | null;
  due_date: string | null;
  tags?: string[] | null;
  scheduling_context?: Record<string, unknown> | null;
}

export interface FieldChange { field: 'title' | 'due_date' | 'nexus_status'; from: string | null; to: string | null }

export interface PlannedCreate {
  assignmentId: string;
  courseCode: string | null;
  insert: Record<string, unknown>;
}

export interface PlannedUpdate {
  taskId: string;
  assignmentId: string;
  /** 'refresh' = an already-linked task; 'link' = an unlinked card with the same title, now linked. */
  kind: 'refresh' | 'link';
  title: string;          // the card's title AFTER the update, for the digest
  courseCode: string | null;
  changes: FieldChange[];
  /** The Nexus closed status newly flagged on this run ('submitted'/'graded'/...), 'reopened', or null. */
  flag: string | null;
  patch: Record<string, unknown>;
}

export interface SyncPlan {
  scanned: number;
  currentCourses: string[];
  creates: PlannedCreate[];
  updates: PlannedUpdate[];
  untouchedDone: Array<{ taskId: string; assignmentId: string; title: string }>;
  excluded: { closed: number; undated: number; pastDue: number; nonCurrentCourse: number; noBoard: number };
}

export interface PlanInput {
  rows: NexusAssignmentRow[];
  tasks: ExistingTask[];
  todayISO: string;       // the owner's LOCAL today, YYYY-MM-DD
  timezone: string;
  boardId: string | null; // oldest default board (#43); null = cannot create
  userId: string;
  nowISO: string;
}

const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();
export const isNexusClosed = (status: unknown) => NEXUS_CLOSED_STATUSES.includes(lower(status));
export const isTaskDone = (t: Pick<ExistingTask, 'status' | 'completed_at'>) =>
  t.status === 'DONE' || t.completed_at != null;
const courseKey = (r: NexusAssignmentRow) => r.course_id ?? `program:${r.program_id ?? 'none'}`;
const courseCodeOf = (r: NexusAssignmentRow) => r.courses?.code ?? r.courses?.name ?? null;
export const taskTitleFor = (r: NexusAssignmentRow) => `${ASSIGNMENT_TITLE_PREFIX}${String(r.title ?? '').trim()}`;

/** The Nexus due instant, exactly, as a UTC ISO string — never re-anchored to a UTC calendar day. */
export function nexusDueInstant(due: string | null | undefined): string | null {
  if (!due) return null;
  const d = new Date(due);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Is this row dated on or after the owner's local today? (Dated-only + from-today rules.) */
export function isDatedTodayOrLater(r: NexusAssignmentRow, todayISO: string, tz: string): boolean {
  const due = nexusDueInstant(r.due_date);
  if (!due) return false;
  const local = localDateOf(due, tz);
  return local !== null && local >= todayISO;
}

/** Owner 2026-10-28: a course is current iff it has ≥1 OPEN item dated today or later. */
export function currentCourseKeys(rows: NexusAssignmentRow[], todayISO: string, tz: string): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    if (!isNexusClosed(r.status) && isDatedTodayOrLater(r, todayISO, tz)) out.add(courseKey(r));
  }
  return out;
}

/** Same mapping main used (nightly-assignment-sync 184-190): 45 / 90 / 180, default 90. */
export function estimateFromEffort(loe: string | null | undefined): number {
  const v = lower(loe);
  if (!v) return 90;
  if (v.includes('low') || v.includes('small')) return 45;
  if (v.includes('high') || v.includes('large')) return 180;
  return 90;
}

function priorityOf(p: unknown): string {
  const up = String(p ?? '').trim().toUpperCase();
  return VALID_PRIORITIES.includes(up) ? up : 'HIGH';
}

const sameInstant = (a: string | null, b: string | null) =>
  a !== null && b !== null && Date.parse(a) === Date.parse(b);

export function planAssignmentSync(input: PlanInput): SyncPlan {
  const { rows, tasks, todayISO, timezone, boardId, userId, nowISO } = input;
  const current = currentCourseKeys(rows, todayISO, timezone);
  const plan: SyncPlan = {
    scanned: rows.length,
    currentCourses: [...new Set(rows.filter((r) => current.has(courseKey(r))).map((r) => courseCodeOf(r) ?? courseKey(r)))],
    creates: [],
    updates: [],
    untouchedDone: [],
    excluded: { closed: 0, undated: 0, pastDue: 0, nonCurrentCourse: 0, noBoard: 0 },
  };

  const linked = new Map<string, ExistingTask[]>();
  const legacyByTitle = new Map<string, ExistingTask>();
  for (const t of tasks) {
    if (t.assignment_id) {
      const list = linked.get(t.assignment_id) ?? [];
      list.push(t);
      linked.set(t.assignment_id, list);
    } else if (!isTaskDone(t) && !legacyByTitle.has(t.title)) {
      legacyByTitle.set(t.title, t);
    }
  }

  for (const r of rows) {
    if (!r?.id) continue;
    const code = courseCodeOf(r);
    const linkedTasks = linked.get(r.id);

    // ---- REFRESH: an already-linked task (any date, any course — it is on the board already) ----
    if (linkedTasks && linkedTasks.length) {
      for (const t of linkedTasks) {
        if (isTaskDone(t)) {
          // Owner rule: never touch a task he marked DONE. Not even a flag.
          plan.untouchedDone.push({ taskId: t.id, assignmentId: r.id, title: t.title });
          continue;
        }
        const u = planRefresh(t, r, code, nowISO);
        if (u) plan.updates.push(u);
      }
      continue;
    }

    // ---- CREATE gate: open, dated, due today or later, in a current course ----
    if (isNexusClosed(r.status)) { plan.excluded.closed++; continue; }
    const due = nexusDueInstant(r.due_date);
    if (!due) { plan.excluded.undated++; continue; }
    if (!isDatedTodayOrLater(r, todayISO, timezone)) { plan.excluded.pastDue++; continue; }
    if (!current.has(courseKey(r))) { plan.excluded.nonCurrentCourse++; continue; }

    const title = taskTitleFor(r);
    const legacy = legacyByTitle.get(title) ?? legacyByTitle.get(String(r.title ?? '').trim());
    if (legacy) {
      // An unlinked card with this exact title already exists: link it instead of duplicating it.
      legacyByTitle.delete(legacy.title);
      const changes: FieldChange[] = [];
      if (!sameInstant(legacy.due_date, due)) changes.push({ field: 'due_date', from: legacy.due_date, to: due });
      plan.updates.push({
        taskId: legacy.id,
        assignmentId: r.id,
        kind: 'link',
        title: legacy.title,
        courseCode: code,
        changes,
        flag: null,
        patch: {
          assignment_id: r.id,
          due_date: due,
          scheduling_context: {
            ...(legacy.scheduling_context ?? {}),
            source: code ?? 'Nexus', origin: 'nexus-azure', course_id: r.course_id ?? null,
            ...(changes.length ? { nexus_changes: changes.map((c) => ({ at: nowISO, ...c })) } : {}),
          },
          updated_at: nowISO,
        },
      });
      continue;
    }

    if (!boardId) { plan.excluded.noBoard++; continue; }

    const description = (r.description && String(r.description).trim())
      ? String(r.description).slice(0, MAX_DESCRIPTION)
      : `Assignment from ${code ?? 'Nexus'}. Due: ${formatDue(due, timezone)}`;
    plan.creates.push({
      assignmentId: r.id,
      courseCode: code,
      insert: {
        title,
        description,
        category: 'PROF_EDUCATION',
        priority: priorityOf(r.priority),
        // #28/#33: status is a workflow lane, never a category. Dated → UP_NEXT (every import is dated).
        status: 'UP_NEXT',
        due_date: due,
        estimate_minutes: estimateFromEffort(r.level_of_effort),
        is_scheduled: false,
        board_id: boardId,
        user_id: userId,
        assignment_id: r.id,
        scheduling_context: {
          source: code ?? 'Nexus', origin: 'nexus-azure', course_id: r.course_id ?? null,
          nexus_status: lower(r.status) || null,
        },
      },
    });
  }
  // Deadline order, so the digest and the dry run read soonest-first.
  plan.creates.sort((a, b) => Date.parse(a.insert.due_date as string) - Date.parse(b.insert.due_date as string));
  return plan;
}

function planRefresh(t: ExistingTask, r: NexusAssignmentRow, code: string | null, nowISO: string): PlannedUpdate | null {
  const changes: FieldChange[] = [];
  const patch: Record<string, unknown> = {};

  const wantTitle = taskTitleFor(r);
  if (String(r.title ?? '').trim() && t.title !== wantTitle) {
    changes.push({ field: 'title', from: t.title, to: wantTitle });
    patch.title = wantTitle;
  }
  const wantDue = nexusDueInstant(r.due_date);
  // A Nexus row that LOST its date does not null the card's date — nothing to refresh to.
  if (wantDue && !sameInstant(t.due_date, wantDue)) {
    changes.push({ field: 'due_date', from: t.due_date, to: wantDue });
    patch.due_date = wantDue;
  }

  // Submitted/graded: FLAG via a durable tag, never touch `status` (owner: never auto-close).
  const tags = Array.isArray(t.tags) ? t.tags : [];
  const flagTags = tags.filter((x) => NEXUS_CLOSED_STATUSES.some((s) => x === `${NEXUS_FLAG_TAG_PREFIX}${s}`));
  const nexusStatus = lower(r.status);
  let flag: string | null = null;
  if (isNexusClosed(nexusStatus)) {
    const want = `${NEXUS_FLAG_TAG_PREFIX}${nexusStatus}`;
    if (!tags.includes(want)) {
      flag = nexusStatus;
      patch.tags = [...tags.filter((x) => !flagTags.includes(x)), want];
      changes.push({ field: 'nexus_status', from: flagTags[0]?.slice(NEXUS_FLAG_TAG_PREFIX.length) ?? null, to: nexusStatus });
    }
  } else if (flagTags.length) {
    // Nexus shows it open again (e.g. a resubmission was requested): drop the stale flag.
    flag = 'reopened';
    patch.tags = tags.filter((x) => !flagTags.includes(x));
    changes.push({ field: 'nexus_status', from: flagTags[0].slice(NEXUS_FLAG_TAG_PREFIX.length), to: nexusStatus || null });
  }

  if (!changes.length) return null;
  const sc = (t.scheduling_context && typeof t.scheduling_context === 'object') ? t.scheduling_context : {};
  const prior = Array.isArray((sc as any).nexus_changes) ? (sc as any).nexus_changes : [];
  patch.scheduling_context = {
    ...sc,
    nexus_status: nexusStatus || null,
    nexus_changes: [...prior, ...changes.map((c) => ({ at: nowISO, ...c }))],
  };
  patch.updated_at = nowISO;
  return {
    taskId: t.id,
    assignmentId: r.id,
    kind: 'refresh',
    title: (patch.title as string) ?? t.title,
    courseCode: code,
    changes,
    flag,
    patch,
  };
}

export function formatDue(iso: string | null, tz: string): string {
  if (!iso) return 'no date';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(iso));
}

/**
 * The ONE Iris message for a run, or null when nothing changed (owner: at most one per run).
 * Pass the creates/updates that were actually APPLIED (wet run) or planned (dry run).
 */
export function buildSyncDigest(
  applied: { creates: PlannedCreate[]; updates: PlannedUpdate[] },
  tz: string,
): { title: string; message: string; lineCount: number } | null {
  const lines: string[] = [];
  const tagOf = (code: string | null) => (code ? ` (${code})` : '');
  for (const c of applied.creates) {
    lines.push(`• New: ${c.insert.title}${tagOf(c.courseCode)} — due ${formatDue(c.insert.due_date as string, tz)}`);
  }
  for (const u of applied.updates) {
    for (const ch of u.changes) {
      if (ch.field === 'due_date') {
        lines.push(`• Due date ${u.kind === 'link' ? 'set from Nexus' : 'changed'}: ${u.title}${tagOf(u.courseCode)} — ${ch.from ? `${formatDue(ch.from, tz)} → ` : ''}${formatDue(ch.to, tz)}`);
      } else if (ch.field === 'title') {
        lines.push(`• Renamed in Nexus: "${ch.from}" → "${ch.to}"${tagOf(u.courseCode)}`);
      } else if (ch.field === 'nexus_status') {
        lines.push(u.flag === 'reopened'
          ? `• Nexus shows ${u.title}${tagOf(u.courseCode)} open again (was ${ch.from}).`
          : `• Nexus shows ${u.title}${tagOf(u.courseCode)} as ${ch.to}. I left the card open — mark it Done when you're satisfied.`);
      }
    }
    if (u.kind === 'link' && !u.changes.length) {
      lines.push(`• Linked your card ${u.title}${tagOf(u.courseCode)} to its Nexus assignment.`);
    }
  }
  if (!lines.length) return null;
  const n = applied.creates.length + applied.updates.length;
  return {
    title: `Coursework update: ${n} assignment${n === 1 ? '' : 's'}`,
    message: `Coursework update from Nexus:\n\n${lines.join('\n')}`,
    lineCount: lines.length,
  };
}

/**
 * WHEN the run's one Iris message should be delivered. The sync runs inside the 05:00 UTC build
 * (1 am ET), and the scheduled_chat path does not apply quiet hours, so "now" would ring the
 * owner's phone at 1 am. Inside the owner's own quiet hours (notification_prefs) → the instant they
 * end (today or tomorrow, local); otherwise → now. No quiet hours set → now.
 */
export function digestSendAt(
  now: Date,
  tz: string,
  quietStart: string | null | undefined,
  quietEnd: string | null | undefined,
): string {
  if (!quietStart || !quietEnd) return now.toISOString();
  const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(now).split(':').map(Number);
  const cur = parts[0] * 60 + parts[1];
  const start = toMin(quietStart);
  const end = toMin(quietEnd);
  const inQuiet = start > end ? (cur >= start || cur < end) : (cur >= start && cur < end);
  if (!inQuiet) return now.toISOString();
  const today = localDateOf(now.toISOString(), tz)!;
  let day = today;
  if (cur >= end) {
    // Evening side of an overnight window (e.g. 23:00 with 22:00–06:00): quiet ends tomorrow.
    const [y, m, d] = today.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + 1));
    day = t.toISOString().slice(0, 10);
  }
  return zonedTimeToUtc(day, quietEnd.slice(0, 5), tz);
}

/** A compact, human-checkable rendering of a plan — what the dry run returns. */
export function describePlan(plan: SyncPlan, tz: string) {
  return {
    scanned: plan.scanned,
    current_courses: plan.currentCourses,
    would_create: plan.creates.map((c) => ({
      assignment_id: c.assignmentId,
      title: c.insert.title,
      course: c.courseCode,
      due_date: c.insert.due_date,
      due_local: formatDue(c.insert.due_date as string, tz),
      status: c.insert.status,
      estimate_minutes: c.insert.estimate_minutes,
    })),
    would_update: plan.updates.map((u) => ({
      task_id: u.taskId,
      assignment_id: u.assignmentId,
      kind: u.kind,
      title: u.title,
      course: u.courseCode,
      changes: u.changes,
      flag: u.flag,
    })),
    untouched_done: plan.untouchedDone.length,
    excluded: plan.excluded,
    digest: buildSyncDigest(plan, tz),
  };
}
