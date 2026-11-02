// WHAT:       Recurring ACTIVITIES (lunch, gym, church, haircut, standup, 1:1s) — blocks of the owner's
//             time that are NOT tasks. Expands them into per-day busy blocks every scheduler avoids,
//             and plans the "headed to the gym" push that shifts the rest of the day.
// WHY:        The owner, 2026-10-29: "we need a recurring activities concept so that things like
//             church, gym, haircut, lunch get the same treatment instead of treated like a regular task
//             when i tell the AI about them." Before this, the only busy-time sources were scheduled
//             `tasks` rows and `external_calendar_events` (read in nightly-schedule-builder,
//             batch-calendar-scheduler, smart-calendar-scheduler and execute-tool findOpenSlots), so a
//             lunch or gym visit could only exist as a task — which rolls over, gets scored, mirrors to
//             Huddle's board and can be auto-worked by an agent.
//             STORAGE (owner-approved option A): activities live in user_scheduling_prefs.config next
//             to timeWindows / caveats and are expanded at read time. They are never `tasks` rows.
// SUPERSEDES: nothing. EXTENDS config.workingHours.breakMinutes (an editable Settings value nothing
//             placed) — it is the default lunch duration below.
// SUPERSEDED-BY: nothing — current.
// EVIDENCE:   src/utils/activities.test.ts; plan + owner decision in this session's transcript.

import { zonedTimeToUtc } from './timezone.ts';

export type ActivityMode = 'locked' | 'floating';
export type ActivityKind = 'recurring' | 'one_off' | 'on_demand';

export interface Activity {
  id: string;
  name: string;
  kind: ActivityKind;
  /** locked = fixed start time; floating = placed inside [earliest, latest] around meetings. */
  mode: ActivityMode;
  /** HH:mm. Locked: the start. Floating: the preferred start. Unused for on_demand. */
  start?: string;
  durationMin: number;
  /** Floating only — the block must fit inside this range (HH:mm). */
  earliest?: string;
  latest?: string;
  /** recurring: days of week, 0=Sun..6=Sat (same shape as ScheduledCall/CeremonySchedule). */
  days?: number[];
  /** recurring: 2 = every other week, counted from anchorDate. Default 1. */
  everyNWeeks?: number;
  /** YYYY-MM-DD — first occurrence for everyNWeeks > 1. */
  anchorDate?: string;
  /** one_off: YYYY-MM-DD. */
  date?: string;
  /** Informational: which named time window this sits inside (a sub-window). */
  parentWindow?: string;
  /** Words that mean this activity when the owner talks about it ("gym", "workout", "lift"). */
  aliases?: string[];
  /** on_demand: starting it shifts the rest of the day instead of overlapping it. */
  pushesSchedule?: boolean;
  /** YYYY-MM-DD dates this activity is skipped ("skip lunch today"). */
  skipDates?: string[];
  enabled?: boolean;
  createdAt?: string;
}

/** One occurrence on one local day, in UTC ISO — the same shape every busy-slot reader uses. */
export interface ActivityBlock {
  activityId: string;
  name: string;
  start_time: string;
  end_time: string;
  locked: boolean;
  /** Floating block that could not avoid a busy slot; reserved at its preferred time anyway. */
  conflict?: boolean;
}

/**
 * SEEDED defaults, used only while the owner has never saved an `activities` list. Once they save
 * one (even an empty one) this is never read again — the seed is a first value, not a rule.
 * Lunch length comes from the existing workingHours.breakMinutes setting.
 */
export function defaultActivities(config: any): Activity[] {
  const lunchMin = Number(config?.workingHours?.breakMinutes) > 0 ? Number(config.workingHours.breakMinutes) : 60;
  return [
    {
      id: 'lunch', name: 'Lunch', kind: 'recurring', mode: 'floating',
      start: '12:00', earliest: '11:30', latest: '13:30', durationMin: lunchMin,
      days: [1, 2, 3, 4, 5], parentWindow: 'business_hours', aliases: ['lunch'], enabled: true,
    },
    {
      id: 'gym', name: 'Gym', kind: 'on_demand', mode: 'locked', durationMin: 120,
      aliases: ['gym', 'workout', 'work out', 'lift', 'lifting', 'exercise'], pushesSchedule: true, enabled: true,
    },
  ];
}

export function resolveActivities(config: any): Activity[] {
  const raw = config?.activities;
  if (!Array.isArray(raw)) return defaultActivities(config);
  return raw.filter((a: any) => a && typeof a === 'object' && a.id && a.name);
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
export function minutesToHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/**
 * Parse a clock time the owner or an agent gave ("9:30", "09:30", "09:30:00") into HH:mm, or null
 * when it is not a valid 24-hour time. Callers must REJECT null rather than fall back to "now".
 */
export function parseClockTime(input: unknown): string | null {
  const m = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/.exec(String(input ?? '').trim());
  if (!m || Number(m[1]) > 23) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

/** Day of week of a LOCAL calendar date. Pure date math — no timezone needed for a date-only value. */
export function localDayOfWeek(dateISO: string): number {
  return new Date(dateUtcMs(dateISO)).getUTCDay();
}

function dateUtcMs(dateISO: string): number {
  const [y, m, d] = dateISO.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((dateUtcMs(toISO) - dateUtcMs(fromISO)) / 86400000);
}

/** Does this activity happen (get a block) on this local date? on_demand activities never do. */
export function occursOn(a: Activity, dateISO: string): boolean {
  if (a.enabled === false) return false;
  if (a.skipDates?.includes(dateISO)) return false;
  if (a.kind === 'on_demand') return false;
  if (a.kind === 'one_off') return a.date === dateISO;
  if (!a.days?.includes(localDayOfWeek(dateISO))) return false;
  const n = a.everyNWeeks && a.everyNWeeks > 1 ? Math.floor(a.everyNWeeks) : 1;
  if (n === 1) return true;
  const anchor = a.anchorDate && YMD.test(a.anchorDate) ? a.anchorDate : null;
  if (!anchor) return true; // no anchor to count from — treat as weekly rather than silently never
  const diff = daysBetween(anchor, dateISO);
  if (diff < 0) return false;
  return Math.floor(diff / 7) % n === 0;
}

interface Span { startMs: number; endMs: number }
const overlaps = (a: Span, b: Span) => a.startMs < b.endMs && b.startMs < a.endMs;

/**
 * Every activity block on one local day. Locked blocks are placed first at their time; floating
 * blocks then take their preferred start, or slide in 15-minute steps inside [earliest, latest] to
 * avoid `busy` (calendar events + scheduled tasks) and the blocks already placed. A floating block
 * with no free spot is still reserved at its preferred time, flagged `conflict` — lunch does not
 * disappear because the day is full.
 */
export function expandActivitiesForDate(
  activities: Activity[],
  dateISO: string,
  tz: string,
  busy: Array<{ start_time: string; end_time: string }> = [],
): ActivityBlock[] {
  const toMs = (hhmm: string) => new Date(zonedTimeToUtc(dateISO, hhmm, tz)).getTime();
  const busySpans: Span[] = busy
    .filter((b) => b?.start_time && b?.end_time)
    .map((b) => ({ startMs: new Date(b.start_time).getTime(), endMs: new Date(b.end_time).getTime() }));
  const placed: Array<ActivityBlock & Span> = [];
  const todays = activities.filter((a) => occursOn(a, dateISO) && a.start && HHMM.test(a.start) && a.durationMin > 0);

  for (const a of todays.filter((x) => x.mode === 'locked')) {
    const startMs = toMs(a.start!);
    const endMs = startMs + a.durationMin * 60000;
    placed.push({ activityId: a.id, name: a.name, locked: true, startMs, endMs,
      start_time: new Date(startMs).toISOString(), end_time: new Date(endMs).toISOString() });
  }

  for (const a of todays.filter((x) => x.mode === 'floating')) {
    const rawPref = toMinutes(a.start!);
    const lo = a.earliest && HHMM.test(a.earliest) ? toMinutes(a.earliest) : rawPref;
    const hi = Math.max(lo, (a.latest && HHMM.test(a.latest) ? toMinutes(a.latest) : rawPref + a.durationMin) - a.durationMin);
    // Every candidate stays inside [lo, hi] — a preferred start outside its own range is pulled to
    // the nearest edge, so a floating block can never be placed outside the range it declares.
    const pref = Math.min(hi, Math.max(lo, rawPref));
    // Try the preferred start first, then nearest-first outward in 15-minute steps.
    const candidates = [pref];
    for (let step = 15; pref - step >= lo || pref + step <= hi; step += 15) {
      if (pref + step <= hi) candidates.push(pref + step);
      if (pref - step >= lo) candidates.push(pref - step);
    }
    let chosen: Span | null = null;
    for (const m of candidates) {
      const startMs = toMs(minutesToHHMM(m));
      const span = { startMs, endMs: startMs + a.durationMin * 60000 };
      if (!busySpans.some((b) => overlaps(b, span)) && !placed.some((p) => overlaps(p, span))) { chosen = span; break; }
    }
    const conflict = !chosen;
    if (!chosen) { const s = toMs(minutesToHHMM(pref)); chosen = { startMs: s, endMs: s + a.durationMin * 60000 }; }
    placed.push({ activityId: a.id, name: a.name, locked: false, ...chosen, conflict: conflict || undefined,
      start_time: new Date(chosen.startMs).toISOString(), end_time: new Date(chosen.endMs).toISOString() });
  }

  return placed
    .sort((x, y) => x.startMs - y.startMs)
    .map(({ startMs: _s, endMs: _e, ...b }) => b);
}

/** Local YYYY-MM-DD dates covered by a UTC [startIso, endIso] range, in `tz`. */
export function localDatesInRange(startIso: string, endIso: string, tz: string): string[] {
  const fmt = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: tz });
  const out: string[] = [];
  const endMs = new Date(endIso).getTime();
  for (let ms = new Date(startIso).getTime(); ms <= endMs + 1; ms += 3600000) {
    const d = fmt(ms);
    if (!out.includes(d)) out.push(d);
  }
  return out;
}

/** Blocks for every local day a busy-slot query covers. Callers append these to their busy list. */
export function activityBusySlots(
  config: any,
  startIso: string,
  endIso: string,
  tz: string,
  busy: Array<{ start_time: string; end_time: string }> = [],
): ActivityBlock[] {
  const activities = resolveActivities(config);
  if (!activities.length) return [];
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  return localDatesInRange(startIso, endIso, tz)
    .flatMap((d) => expandActivitiesForDate(activities, d, tz, busy))
    .filter((b) => new Date(b.end_time).getTime() > startMs && new Date(b.start_time).getTime() < endMs);
}

/** The activity the owner is talking about, matched on name or alias as a whole word. */
export function matchActivity(activities: Activity[], text: string): Activity | null {
  const t = ` ${String(text || '').toLowerCase().replace(/[^a-z0-9:\s]/g, ' ')} `;
  for (const a of activities) {
    if (a.enabled === false) continue;
    const words = [a.name, ...(a.aliases || [])].map((w) => String(w).toLowerCase().trim()).filter(Boolean);
    if (words.some((w) => t.includes(` ${w} `))) return a;
  }
  return null;
}

/**
 * Validate a tool/Settings payload into an Activity. Returns an error string rather than storing an
 * activity that can never produce a block.
 */
export function normalizeActivity(input: any, now: Date = new Date()): { activity?: Activity; error?: string } {
  const name = String(input?.name ?? '').trim().slice(0, 80);
  if (!name) return { error: 'name is required' };
  const kind: ActivityKind = ['recurring', 'one_off', 'on_demand'].includes(input?.kind) ? input.kind
    : input?.date ? 'one_off' : Array.isArray(input?.days) && input.days.length ? 'recurring' : 'on_demand';
  const mode: ActivityMode = input?.mode === 'floating' ? 'floating' : 'locked';
  const durationMin = Math.round(Number(input?.duration_min ?? input?.durationMin ?? 60));
  if (!(durationMin >= 5 && durationMin <= 12 * 60)) return { error: 'duration must be between 5 and 720 minutes' };
  // "9:30" and "09:30:00" are normalized the same way start_activity does; anything else is rejected.
  const rawStart = input?.start ?? input?.start_time;
  const start = rawStart === undefined || rawStart === null ? rawStart : (parseClockTime(rawStart) ?? rawStart);
  if (kind !== 'on_demand' && !(typeof start === 'string' && HHMM.test(start))) {
    return { error: 'start (HH:mm, 24-hour) is required for a scheduled activity' };
  }
  const a: Activity = {
    id: String(input?.id || `act_${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`),
    name, kind, mode, durationMin, enabled: input?.enabled !== false, createdAt: input?.createdAt ?? now.toISOString(),
  };
  if (kind !== 'on_demand') a.start = start;
  if (kind === 'recurring') {
    const days = (Array.isArray(input?.days) ? input.days : []).map(Number).filter((d: number) => d >= 0 && d <= 6);
    if (!days.length) return { error: 'days (0=Sun..6=Sat) are required for a recurring activity' };
    a.days = [...new Set<number>(days)].sort();
    const n = Math.floor(Number(input?.every_n_weeks ?? input?.everyNWeeks ?? 1));
    if (n > 1) {
      a.everyNWeeks = n;
      const anchor = input?.anchor_date ?? input?.anchorDate;
      a.anchorDate = typeof anchor === 'string' && YMD.test(anchor) ? anchor : now.toISOString().slice(0, 10);
    }
  }
  if (kind === 'one_off') {
    if (!(typeof input?.date === 'string' && YMD.test(input.date))) return { error: 'date (YYYY-MM-DD) is required for a one-off activity' };
    a.date = input.date;
  }
  if (mode === 'floating') {
    for (const k of ['earliest', 'latest'] as const) {
      if (input?.[k] !== undefined && !(typeof input[k] === 'string' && HHMM.test(input[k]))) return { error: `${k} must be HH:mm` };
    }
    a.earliest = input?.earliest ?? a.start;
    a.latest = input?.latest ?? (a.start ? minutesToHHMM(toMinutes(a.start) + durationMin) : undefined);
    if (a.earliest && a.latest && toMinutes(a.latest) - toMinutes(a.earliest) < durationMin) {
      return { error: 'the earliest-latest range is shorter than the activity' };
    }
  }
  if (typeof input?.parent_window === 'string' || typeof input?.parentWindow === 'string') a.parentWindow = input.parent_window ?? input.parentWindow;
  const aliases = (Array.isArray(input?.aliases) ? input.aliases : []).map((s: any) => String(s).toLowerCase().trim()).filter(Boolean);
  a.aliases = [...new Set([name.toLowerCase(), ...aliases])];
  // snake_case (a tool update) wins over the stored camelCase value, so `pushes_schedule: false` clears it.
  const pushes = input?.pushes_schedule ?? input?.pushesSchedule;
  if (pushes === true) a.pushesSchedule = true;
  if (Array.isArray(input?.skipDates)) a.skipDates = input.skipDates.filter((d: any) => typeof d === 'string' && YMD.test(d));
  return { activity: a };
}

// ── "Headed to the gym": push the rest of the day ─────────────────────────────────────────────

export interface PushItem {
  id: string;
  title: string;
  kind: 'task' | 'activity' | 'event';
  startMs: number;
  endMs: number;
  /** false for calendar events and locked activities — never moved. */
  movable: boolean;
  /** Latest end this item may have today (end of its window / the day). */
  limitMs: number;
}

export interface PushPlan {
  moves: Array<{ id: string; title: string; kind: PushItem['kind']; fromMs: number; startMs: number; endMs: number }>;
  /** Movable items that no longer fit today — unschedule them for the next build. */
  overflow: Array<{ id: string; title: string; kind: PushItem['kind'] }>;
  /** Immovable items the new block overlaps — the agent asks the owner about these. */
  conflicts: Array<{ id: string; title: string; kind: PushItem['kind']; startMs: number; endMs: number }>;
}

/**
 * Insert [blockStart, blockEnd] and shift every movable item it displaces later, keeping their
 * order. Rules:
 *  - Items that end at or before blockStart are untouched.
 *  - An item in progress at blockStart is interrupted and moves whole (you left it for the gym).
 *  - Each displaced item starts at max(its own start, the end of the previous placed item), then
 *    hops past any immovable item it would overlap. Items far enough later stay where they are.
 *  - An item that would end after its limit overflows (unscheduled), and does not consume time.
 *  - Immovable items overlapping the block are reported as conflicts, never moved.
 */
export function planPush(items: PushItem[], blockStartMs: number, blockEndMs: number): PushPlan {
  const block: Span = { startMs: blockStartMs, endMs: blockEndMs };
  const immovable = items.filter((i) => !i.movable);
  const conflicts = immovable
    .filter((i) => overlaps(i, block))
    .map(({ id, title, kind, startMs, endMs }) => ({ id, title, kind, startMs, endMs }));
  const walls: Span[] = [block, ...immovable].sort((a, b) => a.startMs - b.startMs);

  const moves: PushPlan['moves'] = [];
  const overflow: PushPlan['overflow'] = [];
  let cursor = blockEndMs;
  const displaced = items
    .filter((i) => i.movable && i.endMs > blockStartMs)
    .sort((a, b) => a.startMs - b.startMs);

  for (const it of displaced) {
    const dur = it.endMs - it.startMs;
    let start = Math.max(it.startMs, cursor);
    // Hop over walls until a clean gap is found (walls are sorted, so one pass per wall suffices).
    for (let guard = 0; guard < walls.length + 1; guard++) {
      const hit = walls.find((w) => overlaps(w, { startMs: start, endMs: start + dur }));
      if (!hit) break;
      start = hit.endMs;
    }
    if (start + dur > it.limitMs) {
      overflow.push({ id: it.id, title: it.title, kind: it.kind });
      continue;
    }
    if (start !== it.startMs) moves.push({ id: it.id, title: it.title, kind: it.kind, fromMs: it.startMs, startMs: start, endMs: start + dur });
    cursor = start + dur;
  }
  return { moves, overflow, conflicts };
}
