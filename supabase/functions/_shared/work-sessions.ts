// WHAT:       P3 + P4, PURE: plan each open, dated assignment as N work-session cards spread from today
//             to its finish-by date (default 7 days before due), inside the coursework windows and the
//             per-day coursework cap, and say which assignments no longer fit (the P4 early warning).
// WHY:        Owner 2026-10-28: "I have been surprised about things due and not working on them a little
//             at a time until done." Main placed each assignment as ONE 90-min block, at most once per
//             night, with deadline privilege only ≤7 days (sort) / ≤48 h (guaranteed) out (FINDINGS §3).
//             Owner decisions 2026-10-29: each session is its own card + calendar block ("📚 <title> —
//             session N of M") with its own alarm and Done; finish-by 7 days before due ("I like to
//             finish one week ahead not one day"); 90-min sessions; 180 min effort when Nexus has none;
//             spread from today; re-spread nightly from remaining = effort − finished sessions; missed
//             sessions re-placed, never duplicated; never move a session marked DONE or edited by hand;
//             if finish-by is already past but the due date is not, spread from today to due − a small
//             buffer and warn that day; never schedule after the due date; never drop silently.
// SUPERSEDES: nothing (main has no session concept; FINDINGS §4: no branch has one either).
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   docs/qc-evidence/FINDINGS-assignment-spreading.md §3, §5 P3/P4 and the build log;
//             tests in work-sessions.test.ts.
//
// IDENTITY (why `assignment_id` carries the session key). A session's link to its assignment must
// survive every other writer. `nightly-schedule-builder` REPLACES `scheduling_context` wholesale on
// placement and nothing in the repo writes `assignment_id` except the intake. So a session row's
// `assignment_id` is `<nexusAssignmentId>::session-<k>`: stable (idempotent, never duplicated), the
// intake's exact-id lookup never mistakes it for the assignment itself, and the builder's existing
// "assignment_id IS NOT NULL ⇒ coursework" rules (daily cap reconciliation) count sessions as
// coursework for free. `scheduling_context.session` holds only re-derivable state (the last placement,
// for hand-edit detection, and the planned date).

import { localDateOf, zonedTimeToUtc } from './timezone.ts';
import { getPreferredWindows, type TimeWindow } from './scheduling-defaults.ts';

export const SESSION_TAG = 'work-session';
export const RETIRED_TAG = 'session-not-needed';
export const AT_RISK_TAG = 'sessions-at-risk';
const SESSION_KEY_RE = /^(.+)::session-(\d+)$/;
const CLOSED_FLAG_TAGS = ['nexus-submitted', 'nexus-graded', 'nexus-completed'];

export interface SessionConfig {
  enabled: boolean;
  finishBufferDays: number;     // finish-by = due date − this many days (owner: 7)
  sessionMinutes: number;       // one session's length (owner: 90)
  defaultEffortMinutes: number; // total effort when the card has no estimate (owner: 180)
  lateBufferHours: number;      // when finish-by is already past: last session ends ≥ this long before due
  todayLeadMinutes: number;     // never start a session sooner than this from "now"
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  enabled: true,
  finishBufferDays: 7,
  sessionMinutes: 90,
  defaultEffortMinutes: 180,
  lateBufferHours: 1,
  todayLeadMinutes: 15,
};

/** `config.assignmentSessions` from user_scheduling_prefs, over the seeded defaults (all editable). */
export function resolveSessionConfig(userConfig: any): SessionConfig {
  const raw = (userConfig && typeof userConfig === 'object') ? userConfig.assignmentSessions : null;
  const num = (v: unknown, min: number, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min ? v : fallback;
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SESSION_CONFIG };
  return {
    enabled: raw.enabled === false ? false : true,
    finishBufferDays: num(raw.finishBufferDays, 0, DEFAULT_SESSION_CONFIG.finishBufferDays),
    sessionMinutes: num(raw.sessionMinutes, 15, DEFAULT_SESSION_CONFIG.sessionMinutes),
    defaultEffortMinutes: num(raw.defaultEffortMinutes, 15, DEFAULT_SESSION_CONFIG.defaultEffortMinutes),
    lateBufferHours: num(raw.lateBufferHours, 0, DEFAULT_SESSION_CONFIG.lateBufferHours),
    todayLeadMinutes: num(raw.todayLeadMinutes, 0, DEFAULT_SESSION_CONFIG.todayLeadMinutes),
  };
}

export const sessionKey = (assignmentId: string, k: number) => `${assignmentId}::session-${k}`;
export function parseSessionKey(assignmentId: string | null | undefined): { assignmentId: string; index: number } | null {
  const m = SESSION_KEY_RE.exec(String(assignmentId ?? ''));
  return m ? { assignmentId: m[1], index: Number(m[2]) } : null;
}
export const isSessionTask = (t: { assignment_id?: string | null }) => parseSessionKey(t.assignment_id) !== null;

export interface ParentTask {
  id: string;
  title: string;
  status: string | null;
  completed_at: string | null;
  assignment_id: string | null;
  due_date: string | null;
  estimate_minutes: number | null;
  tags?: string[] | null;
  board_id?: string | null;
  priority?: string | null;
  category?: string | null;
}

export interface SessionTask {
  id: string;
  title: string;
  status: string | null;
  completed_at: string | null;
  assignment_id: string;
  start_time: string | null;
  end_time: string | null;
  estimate_minutes: number | null;
  tags?: string[] | null;
  scheduling_context?: Record<string, any> | null;
  external_event_id?: string | null;
}

export interface Interval { start: number; end: number } // epoch ms

/** One local day the planner may use: coursework windows, what is already busy, and the cap left. */
export interface DayAvailability {
  date: string;               // local YYYY-MM-DD
  windows: Interval[];
  busy: Interval[];
  capRemaining: number;       // coursework blocks still allowed that day (P2 cap minus fixed coursework)
}

export interface PlannedPlacement { date: string; start: string | null; end: string | null } // start/end null = planned date only (beyond the calendar horizon)

export interface SessionCreate {
  key: string;
  parentId: string;
  index: number;
  title: string;
  placement: PlannedPlacement;
  insert: Record<string, unknown>;
}
export interface SessionRetime {
  taskId: string;
  key: string;
  title: string;
  placement: PlannedPlacement;
  hadEvent: boolean;
  patch: Record<string, unknown>;
}
export interface SessionUnschedule { taskId: string; key: string; reason: 'parent-done' | 'parent-submitted' | 'surplus'; patch: Record<string, unknown> }

export interface AssignmentSessionPlan {
  parentId: string;
  title: string;
  due: string;
  dueLocal: string;
  finishBy: string;            // local date the owner wants it done by
  lastDate: string;            // the last local date sessions may use this run
  late: boolean;               // finish-by already passed, due not yet
  effortMinutes: number;
  effortDefaulted: boolean;
  doneMinutes: number;
  totalSessions: number;       // M
  needed: number;              // sessions still to do
  pinned: number;              // hand-edited sessions kept exactly where the owner put them
  placed: Array<{ key: string; index: number; date: string; start: string | null; end: string | null; kind: 'kept-date' | 'new-date' | 'pinned' }>;
  unplaced: number;            // sessions that do not fit before lastDate
  atRisk: boolean;
  warn: boolean;               // newly at risk this run → one P4 line
}

export interface SessionPlan {
  assignments: AssignmentSessionPlan[];
  creates: SessionCreate[];
  retimes: SessionRetime[];
  unschedules: SessionUnschedule[];
  parentTagPatches: Array<{ taskId: string; tags: string[] }>;
  /** Task ids the builder must leave alone (sessions + parents whose work is planned as sessions). */
  managedIds: string[];
  placementsByDate: Record<string, number>; // coursework blocks this pass put on each calendar day
  warnings: Array<{ parentId: string; title: string; dueLocal: string; needed: number; fit: number; late: boolean; finishBy: string }>;
}

export interface SessionPlanInput {
  parents: ParentTask[];
  sessions: SessionTask[];
  days: DayAvailability[];     // contiguous from local today
  now: Date;
  timezone: string;
  config: SessionConfig;
  horizonDays: number;         // sessions on these first N days get a calendar block (builder: 7)
}

// ---------------------------------------------------------------------------------------------
const isDone = (t: { status: string | null; completed_at: string | null }) => t.status === 'DONE' || t.completed_at != null;
const toISO = (ms: number) => new Date(ms).toISOString();
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const stripEmoji = (title: string) => title.replace(/^📚\s*/, '');
export const sessionTitle = (parentTitle: string, k: number, m: number) => `📚 ${stripEmoji(parentTitle)} — session ${k} of ${m}`;

/** Subtract busy intervals from a window list; returns sorted free intervals. */
export function freeIntervals(windows: Interval[], busy: Interval[]): Interval[] {
  let free = windows.map((w) => ({ ...w })).sort((a, b) => a.start - b.start);
  for (const b of busy) {
    const next: Interval[] = [];
    for (const f of free) {
      if (b.end <= f.start || b.start >= f.end) { next.push(f); continue; }
      if (b.start > f.start) next.push({ start: f.start, end: b.start });
      if (b.end < f.end) next.push({ start: b.end, end: f.end });
    }
    free = next;
  }
  return free.filter((f) => f.end > f.start);
}

/** Earliest slot of `minutes` inside `free`, starting no earlier than `notBefore`, ending no later than `notAfter`. */
function earliestFit(free: Interval[], minutes: number, notBefore: number, notAfter: number): Interval | null {
  const len = minutes * 60000;
  for (const f of free) {
    const s = Math.max(f.start, notBefore);
    // start on a 5-minute boundary so blocks read cleanly on a calendar
    const aligned = Math.ceil(s / 300000) * 300000;
    if (aligned + len <= Math.min(f.end, notAfter)) return { start: aligned, end: aligned + len };
  }
  return null;
}

/**
 * Coursework windows for one local date, as instants, mirroring nightly-schedule-builder's
 * getActiveWindows (weekend → only `weekends`; weekday → never `weekends`; `flexible` is not a window)
 * filtered to the category's own windows via getPreferredWindows.
 */
export function courseworkWindowsFor(
  date: string,
  tz: string,
  timeWindows: Record<string, TimeWindow>,
  categoryMappings: Record<string, { defaultTimeWindow?: string[] }>,
  category = 'PROF_EDUCATION',
): Interval[] {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const isWeekend = dow === 0 || dow === 6;
  const active: string[] = [];
  for (const [name, win] of Object.entries(timeWindows)) {
    if (name === 'flexible') continue;
    if (isWeekend && name !== 'weekends') continue;
    if (!isWeekend && name === 'weekends') continue;
    if (!win.days || !win.days.includes(dow)) continue;
    if (win.end - win.start > 0) active.push(name);
  }
  const preferred = getPreferredWindows(category, categoryMappings, active);
  const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
  return preferred.map((name) => {
    const w = timeWindows[name];
    return { start: Date.parse(zonedTimeToUtc(date, hh(w.start), tz)), end: Date.parse(zonedTimeToUtc(date, hh(w.end), tz)) };
  });
}

// ---------------------------------------------------------------------------------------------
export function planWorkSessions(input: SessionPlanInput): SessionPlan {
  const { parents, sessions, days, now, timezone: tz, config, horizonDays } = input;
  const nowMs = now.getTime();
  const today = localDateOf(now.toISOString(), tz)!;
  const horizonEnd = addDays(today, horizonDays - 1);
  const sessionMs = config.sessionMinutes * 60000;

  const plan: SessionPlan = {
    assignments: [], creates: [], retimes: [], unschedules: [], parentTagPatches: [],
    managedIds: [], placementsByDate: {}, warnings: [],
  };

  // Mutable per-day state shared across assignments (earliest due picks first).
  const state = new Map<string, { free: Interval[]; cap: number }>();
  for (const d of days) state.set(d.date, { free: freeIntervals(d.windows, d.busy), cap: d.capRemaining });
  const take = (date: string, iv: Interval) => {
    const s = state.get(date)!;
    s.free = freeIntervals(s.free, [iv]);
    s.cap -= 1;
  };

  const sessionsByAssignment = new Map<string, SessionTask[]>();
  for (const s of sessions) {
    const p = parseSessionKey(s.assignment_id);
    if (!p) continue;
    const list = sessionsByAssignment.get(p.assignmentId) ?? [];
    list.push(s);
    sessionsByAssignment.set(p.assignmentId, list);
  }
  const managed = new Set<string>(sessions.map((s) => s.id));

  const parentList = parents
    .filter((p) => p.assignment_id && !isSessionTask(p))
    .sort((a, b) => Date.parse(a.due_date ?? '9999-12-31') - Date.parse(b.due_date ?? '9999-12-31'));

  for (const parent of parentList) {
    const aId = parent.assignment_id!;
    const own = sessionsByAssignment.get(aId) ?? [];
    const pinnedOf = (s: SessionTask) => {
      // Hand-edited = it has a time, the time is not where this planner last put it, and it is not past.
      const placed = s.scheduling_context?.session?.placed_start ?? null;
      return !!(s.start_time && !isDone(s) && Date.parse(s.start_time) >= nowMs &&
        (placed === null || Date.parse(placed) !== Date.parse(s.start_time)));
    };

    const tags = parent.tags ?? [];
    const parentClosed = isDone(parent);
    const parentSubmitted = tags.some((t) => CLOSED_FLAG_TAGS.includes(t));
    if (parentClosed || parentSubmitted) {
      // AC-P3-4: no further sessions; un-started sessions come off the calendar (hand-edited ones are left alone).
      for (const s of own) {
        if (isDone(s) || pinnedOf(s)) continue;
        if (!s.start_time && (s.tags ?? []).includes(RETIRED_TAG)) continue;
        plan.unschedules.push({
          taskId: s.id, key: s.assignment_id, reason: parentClosed ? 'parent-done' : 'parent-submitted',
          patch: retirePatch(s, now),
        });
      }
      if (own.length) managed.add(parent.id);
      continue;
    }

    const dueMs = parent.due_date ? Date.parse(parent.due_date) : NaN;
    if (!Number.isFinite(dueMs) || dueMs <= nowMs) continue; // undated or already past: left to the builder's tiers

    managed.add(parent.id);
    const dueLocal = localDateOf(toISO(dueMs), tz)!;
    const finishBy = addDays(dueLocal, -config.finishBufferDays);
    const late = finishBy < today;
    const lastDate = late ? dueLocal : finishBy;
    // Never after the due instant; when late, keep a small buffer before it.
    const endLimit = late ? dueMs - config.lateBufferHours * 3600000 : Number.POSITIVE_INFINITY;

    const effortDefaulted = !(parent.estimate_minutes && parent.estimate_minutes > 0);
    const effort = effortDefaulted ? config.defaultEffortMinutes : parent.estimate_minutes!;
    const totalSessions = Math.max(1, Math.ceil(effort / config.sessionMinutes));
    const doneMinutes = own.filter(isDone).reduce((n, s) => n + (s.estimate_minutes || config.sessionMinutes), 0);
    const needed = Math.max(0, Math.ceil((effort - doneMinutes) / config.sessionMinutes));

    const open = own.filter((s) => !isDone(s)).sort((a, b) => parseSessionKey(a.assignment_id)!.index - parseSessionKey(b.assignment_id)!.index);
    const pinned = open.filter(pinnedOf);
    const movable = open.filter((s) => !pinnedOf(s));
    const ap: AssignmentSessionPlan = {
      parentId: parent.id, title: parent.title, due: toISO(dueMs), dueLocal, finishBy, lastDate, late,
      effortMinutes: effort, effortDefaulted, doneMinutes, totalSessions, needed, pinned: pinned.length,
      placed: [], unplaced: 0, atRisk: false, warn: false,
    };

    // Pinned sessions: keep exactly; they use the day's cap and time.
    const usedDates = new Set<string>();
    for (const s of pinned) {
      const date = localDateOf(s.start_time!, tz)!;
      const st = state.get(date);
      if (st) take(date, { start: Date.parse(s.start_time!), end: Date.parse(s.end_time ?? toISO(Date.parse(s.start_time!) + sessionMs)) });
      usedDates.add(date);
      ap.placed.push({ key: s.assignment_id, index: parseSessionKey(s.assignment_id)!.index, date, start: s.start_time, end: s.end_time, kind: 'pinned' });
    }

    let toPlace = Math.max(0, needed - pinned.length);
    // Surplus (effort lowered / sessions done): retire the highest-index movable sessions.
    const reuse = movable.slice(0, toPlace);
    for (const s of movable.slice(toPlace)) {
      if (!s.start_time && (s.tags ?? []).includes(RETIRED_TAG)) continue;
      plan.unschedules.push({ taskId: s.id, key: s.assignment_id, reason: 'surplus', patch: retirePatch(s, now) });
    }
    const usedIndexes = new Set(own.map((s) => parseSessionKey(s.assignment_id)!.index));
    const slotsToFill: Array<{ existing: SessionTask | null; index: number; keepDate: string | null }> = [];
    for (const s of reuse) {
      const pd = s.scheduling_context?.session?.planned_date ?? null;
      slotsToFill.push({ existing: s, index: parseSessionKey(s.assignment_id)!.index, keepDate: pd && pd >= today && pd <= lastDate ? pd : null });
    }
    let nextIndex = 1;
    while (slotsToFill.length < toPlace) {
      while (usedIndexes.has(nextIndex)) nextIndex++;
      usedIndexes.add(nextIndex);
      slotsToFill.push({ existing: null, index: nextIndex, keepDate: null });
    }

    const notBefore = (date: string) => (date === today ? nowMs + config.todayLeadMinutes * 60000 : Number.NEGATIVE_INFINITY);
    const fitsOn = (date: string) => {
      const st = state.get(date);
      if (!st || st.cap <= 0) return null;
      return earliestFit(st.free, config.sessionMinutes, notBefore(date), endLimit);
    };

    const assignments: Array<{ slot: typeof slotsToFill[number]; date: string; iv: Interval; kind: 'kept-date' | 'new-date' }> = [];
    // 1) Stable: a session that already has a planned date inside the window keeps that date if it still fits.
    const pending: typeof slotsToFill = [];
    for (const slot of slotsToFill) {
      if (slot.keepDate && !usedDates.has(slot.keepDate)) {
        const iv = fitsOn(slot.keepDate);
        if (iv) { take(slot.keepDate, iv); usedDates.add(slot.keepDate); assignments.push({ slot, date: slot.keepDate, iv, kind: 'kept-date' }); continue; }
      }
      pending.push(slot);
    }
    // 2) Spread the rest evenly over the feasible days from today to lastDate, one per day first.
    const window = days.map((d) => d.date).filter((d) => d >= today && d <= lastDate);
    let rest = pending;
    for (let round = 0; round < 2 && rest.length; round++) {
      const feasible = window.filter((d) => (round === 0 ? !usedDates.has(d) : true) && fitsOn(d) !== null);
      const next: typeof rest = [];
      if (!feasible.length) { rest.forEach((s) => next.push(s)); rest = next; break; }
      const picks = rest.length <= feasible.length
        ? rest.map((_, i) => feasible[Math.floor((i * feasible.length) / rest.length)])
        : feasible.slice();
      rest.forEach((slot, i) => {
        // Walk forward from the ideal pick to the first day that still fits (earlier days stay free).
        const ideal = i < picks.length ? feasible.indexOf(picks[i]) : -1;
        let placedHere = false;
        if (ideal >= 0) {
          for (let j = ideal; j < feasible.length; j++) {
            const d = feasible[j];
            if (round === 0 && usedDates.has(d)) continue;
            const iv = fitsOn(d);
            if (iv) { take(d, iv); usedDates.add(d); assignments.push({ slot, date: d, iv, kind: 'new-date' }); placedHere = true; break; }
          }
          if (!placedHere) {
            for (let j = ideal - 1; j >= 0; j--) {
              const d = feasible[j];
              if (round === 0 && usedDates.has(d)) continue;
              const iv = fitsOn(d);
              if (iv) { take(d, iv); usedDates.add(d); assignments.push({ slot, date: d, iv, kind: 'new-date' }); placedHere = true; break; }
            }
          }
        }
        if (!placedHere) next.push(slot);
      });
      rest = next;
    }
    ap.unplaced = rest.length;

    // Sessions in date order read 1..M on the calendar; the key index stays the stable identity.
    assignments.sort((a, b) => a.iv.start - b.iv.start);
    for (const a of assignments) {
      const inHorizon = a.date <= horizonEnd;
      const placement: PlannedPlacement = { date: a.date, start: inHorizon ? toISO(a.iv.start) : null, end: inHorizon ? toISO(a.iv.end) : null };
      if (inHorizon) plan.placementsByDate[a.date] = (plan.placementsByDate[a.date] ?? 0) + 1;
      const key = sessionKey(aId, a.slot.index);
      const title = sessionTitle(parent.title, a.slot.index, totalSessions);
      ap.placed.push({ key, index: a.slot.index, date: a.date, start: placement.start, end: placement.end, kind: a.kind });
      const ctxSession = {
        parent_task_id: parent.id, index: a.slot.index, total: totalSessions, planned_date: a.date,
        placed_start: placement.start, placed_end: placement.end, planned_at: now.toISOString(),
      };
      if (a.slot.existing) {
        const s = a.slot.existing;
        const same = (s.start_time ?? null) === placement.start && s.title === title && s.scheduling_context?.session?.planned_date === a.date;
        if (same) continue; // idempotent: nothing to write
        plan.retimes.push({
          taskId: s.id, key, title, placement, hadEvent: !!s.external_event_id,
          patch: {
            title,
            start_time: placement.start, end_time: placement.end, is_scheduled: !!placement.start,
            estimate_minutes: config.sessionMinutes,
            tags: (s.tags ?? []).filter((t) => t !== RETIRED_TAG).concat((s.tags ?? []).includes(SESSION_TAG) ? [] : [SESSION_TAG]),
            scheduling_context: { ...(s.scheduling_context ?? {}), session: ctxSession },
            updated_at: now.toISOString(),
          },
        });
      } else {
        plan.creates.push({
          key, parentId: parent.id, index: a.slot.index, title, placement,
          insert: {
            title,
            description: `Work session ${a.slot.index} of ${totalSessions} for ${stripEmoji(parent.title)} (due ${dueLocal}). Mark it Done when you finish; the rest re-plan nightly.`,
            category: parent.category ?? 'PROF_EDUCATION',
            priority: parent.priority ?? 'HIGH',
            status: 'UP_NEXT',
            due_date: null, // the parent card carries the deadline; sessions carry only their block
            estimate_minutes: config.sessionMinutes,
            start_time: placement.start, end_time: placement.end, is_scheduled: !!placement.start,
            board_id: parent.board_id ?? null,
            assignment_id: key,
            tags: [SESSION_TAG],
            scheduling_context: { origin: 'work-session', session: ctxSession },
          },
        });
      }
    }

    ap.atRisk = ap.unplaced > 0 || late;
    ap.warn = ap.atRisk && !tags.includes(AT_RISK_TAG);
    if (ap.atRisk !== tags.includes(AT_RISK_TAG)) {
      plan.parentTagPatches.push({ taskId: parent.id, tags: ap.atRisk ? [...tags, AT_RISK_TAG] : tags.filter((t) => t !== AT_RISK_TAG) });
    }
    if (ap.warn) {
      plan.warnings.push({
        parentId: parent.id, title: parent.title, dueLocal, needed: toPlace,
        fit: toPlace - ap.unplaced, late, finishBy,
      });
    }
    plan.assignments.push(ap);
  }

  plan.managedIds = [...managed];
  return plan;
}

function retirePatch(s: SessionTask, now: Date): Record<string, unknown> {
  const tags = s.tags ?? [];
  return {
    start_time: null, end_time: null, is_scheduled: false,
    tags: tags.includes(RETIRED_TAG) ? tags : [...tags, RETIRED_TAG],
    scheduling_context: { ...(s.scheduling_context ?? {}), session: { ...(s.scheduling_context?.session ?? {}), placed_start: null, placed_end: null, retired_at: now.toISOString() } },
    updated_at: now.toISOString(),
  };
}

/** The P4 lines (empty → no message). One message per run; the caller merges it with the intake digest. */
export function buildSessionWarningLines(plan: SessionPlan, tz: string): string[] {
  const fmt = (d: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
    .format(new Date(`${d}T12:00:00Z`));
  void tz;
  return plan.warnings.map((w) => w.late
    ? `• ⚠️ ${w.title} is due ${fmt(w.dueLocal)} — already inside your one-week finish window. I've put ${w.fit} of ${w.needed} session${w.needed === 1 ? '' : 's'} before it${w.fit < w.needed ? `; ${w.needed - w.fit} won't fit — want to free up time?` : '.'}`
    : `• ⚠️ ${w.title}: only ${w.fit} of ${w.needed} work sessions fit before your finish-by date ${fmt(w.finishBy)} (due ${fmt(w.dueLocal)}). Free up some coursework time or tell me to adjust the plan.`);
}

/** Compact, human-checkable view of the session plan (dry run + logs). */
export function describeSessionPlan(plan: SessionPlan, tz: string) {
  const local = (iso: string | null) => iso
    ? new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
    : null;
  return {
    assignments: plan.assignments.map((a) => ({
      title: a.title, due_local: a.dueLocal, finish_by: a.finishBy, last_date: a.lastDate, late: a.late,
      effort_minutes: a.effortMinutes, effort_defaulted: a.effortDefaulted, done_minutes: a.doneMinutes,
      sessions_total: a.totalSessions, sessions_needed: a.needed, unplaced: a.unplaced, at_risk: a.atRisk,
      sessions: a.placed.map((p) => ({
        index: p.index, date: p.date, kind: p.kind,
        block: p.start ? `${local(p.start)} – ${new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(p.end!))}` : '(planned date; calendar block added when within 7 days)',
      })),
    })),
    would_create: plan.creates.length,
    would_retime: plan.retimes.length,
    would_unschedule: plan.unschedules.length,
    warnings: buildSessionWarningLines(plan, tz),
  };
}
