// WHAT:       DEADLINE REMINDERS ("time card" nag) as pure functions: the stored list's shape, seed and
//             validator, which occurrence is live now, which hourly slot is due, whether that slot may fire
//             (quiet hours, not-before, deadline, switched-off, Done), which task an occurrence reuses, the
//             nag row the scheduler inserts, and the channels delivery fans that row out to.
// WHY:        Owner 2026-11-22 / 2026-11-26: a weekly must-do (submit the time card) that nags every hour
//             from Fri 7pm, respects quiet hours, starts again Sat 8am and stops at Sat 8pm or the moment he
//             taps Done; editable in Settings, on/off, and he can add similar items. Tier 1 (decides whether
//             a notification fires and parses times/days), so every rule here is a pure, tested function.
//             STORAGE: user_scheduling_prefs.config.deadlineReminders, next to config.activities. The
//             recurrence shape (days / everyNWeeks / anchorDate) and the clock parser are Activities' own
//             (`occursOn`, `parseClockTime`), reused rather than re-implemented.
// SUPERSEDES: nothing.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   .claude/ac-deadline-reminders.md (59 ACs, S-1..S-35, H1-H10);
//             supabase/functions/_shared/deadline-reminders.test.ts; .claude/BUILD-deadline-reminders.md

import { occursOn, parseClockTime, type Activity } from './activities.ts';
import { zonedTimeToUtc, getTzOffsetMinutesAt } from './timezone.ts';
import { localClockParts, DEFAULT_TIMEZONE } from './digest-content.ts';
import { isInQuietHours } from '../notification-scheduler/reminder-rules.ts';

/** The scheduled_notifications.notification_type of one nag. A full-screen alarm, NOT a task_start_* type (H2). */
export const DEADLINE_REMINDER_TYPE = 'deadline_reminder';

/** config key in user_scheduling_prefs.config (beside `activities`). */
export const DEADLINE_REMINDERS_KEY = 'deadlineReminders';

export interface DeadlineReminder {
  id: string;
  name: string;
  enabled: boolean;
  /** Start day(s) of week, 0=Sun..6=Sat (Activities' shape). */
  days: number[];
  /** HH:mm local -- when the nagging starts on the start day. */
  start: string;
  /** Whole days after the start day that the deadline falls on (0 = same day). */
  deadlineAfterDays: number;
  /** HH:mm local on the deadline day. The deadline slot itself fires (G1: inclusive). */
  deadline: string;
  /** HH:mm local: on every day AFTER the start day, nothing fires before this time (S-30, S-33). */
  notBefore?: string;
  /** Minutes between nags, counted from the start time (G2). Default 60. */
  intervalMinutes: number;
  respectQuietHours: boolean;
  email: boolean;
  chat: boolean;
  /** 2 = every other week counted from anchorDate (Activities' semantics, judged on the START date). */
  everyNWeeks?: number;
  anchorDate?: string;
  /** ISO instant the item was last switched On. Slots before it never fire (AC-E5: no catch-up). */
  enabledSince?: string;
  createdAt?: string;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;
const MIN_MS = 60000;

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The owner's seeded first item: weekly, Fri 19:00 to Sat 20:00, hourly, not before 08:00. */
export function defaultDeadlineReminders(): DeadlineReminder[] {
  return [{
    id: 'time-card',
    name: 'Submit time card',
    enabled: true,
    days: [5],
    start: '19:00',
    deadlineAfterDays: 1,
    deadline: '20:00',
    notBefore: '08:00',
    intervalMinutes: 60,
    respectQuietHours: true,
    email: true,
    chat: true,
  }];
}

/**
 * The list the scheduler and Settings use. A MISSING key gets the seed (same as `resolveActivities`);
 * a stored list, even an empty one, is used as-is and the seed is never re-added (AC-S3).
 */
export function resolveDeadlineReminders(config: any): DeadlineReminder[] {
  const raw = config?.[DEADLINE_REMINDERS_KEY];
  if (!Array.isArray(raw)) return defaultDeadlineReminders();
  return raw.filter((r: any) => r && typeof r === 'object' && r.id && r.name);
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Minimum gap in days between consecutive start days (7 for a single weekly day). */
export function minStartGapDays(days: number[]): number {
  const s = [...new Set(days)].sort((a, b) => a - b);
  if (s.length <= 1) return 7;
  let gap = 7;
  for (let i = 0; i < s.length; i++) {
    const next = i + 1 < s.length ? s[i + 1] : s[0] + 7;
    gap = Math.min(gap, next - s[i]);
  }
  return gap;
}

/** Window length in minutes from start to deadline (may be <= 0 for an invalid item). */
export function windowMinutes(r: Pick<DeadlineReminder, 'start' | 'deadline' | 'deadlineAfterDays'>): number {
  return r.deadlineAfterDays * 1440 + toMin(r.deadline) - toMin(r.start);
}

export interface NormalizeResult { item?: DeadlineReminder; error?: string; field?: string }

/**
 * Validate one Settings payload. Returns an error naming the field instead of storing an item that can
 * never fire or fires 12 hours wrong. Times use Activities' `parseClockTime` grammar ONLY (S-1..S-12).
 */
export function normalizeDeadlineReminder(input: any, now: Date = new Date()): NormalizeResult {
  const name = String(input?.name ?? '').trim().slice(0, 80);
  if (!name) return { error: 'Name is required', field: 'name' };

  const rawDays = Array.isArray(input?.days) ? input.days : [];
  const days: number[] = [];
  for (const d of rawDays) {
    if (typeof d === 'string' && d.trim() === '') return { error: 'Day is not a weekday', field: 'days' };
    const n = Number(d);
    // Integers 0..6 only: 7 is not Sunday (S-16) and 5.5 is not a day (S-18).
    if (!Number.isInteger(n) || n < 0 || n > 6) return { error: 'Day must be a weekday (Sun..Sat)', field: 'days' };
    if (!days.includes(n)) days.push(n);
  }
  if (!days.length) return { error: 'Choose a start day', field: 'days' };
  days.sort((a, b) => a - b);

  const start = parseClockTime(input?.start);
  if (!start) return { error: 'Start time must be HH:mm (24-hour)', field: 'start' };
  const deadline = parseClockTime(input?.deadline);
  if (!deadline) return { error: 'Deadline time must be HH:mm (24-hour)', field: 'deadline' };
  let notBefore: string | undefined;
  if (input?.notBefore !== undefined && input?.notBefore !== null && String(input.notBefore).trim() !== '') {
    const nb = parseClockTime(input.notBefore);
    if (!nb) return { error: 'Not-before time must be HH:mm (24-hour)', field: 'notBefore' };
    notBefore = nb;
  }

  const after = Number(input?.deadlineAfterDays ?? 0);
  if (!Number.isInteger(after) || after < 0 || after > 7) return { error: 'Deadline day must be within a week of the start', field: 'deadline' };

  const interval = Number(input?.intervalMinutes ?? 60);
  if (!Number.isInteger(interval) || interval < 15 || interval > 720 || interval % 15 !== 0) {
    return { error: 'Repeat every must be 15 to 720 minutes, in steps of 15', field: 'intervalMinutes' };
  }

  const win = windowMinutes({ start, deadline, deadlineAfterDays: after });
  if (win <= 0) return { error: 'Deadline must be after the start', field: 'deadline' };
  if (win > minStartGapDays(days) * 1440 || win > 7 * 1440) {
    return { error: 'Deadline is too far after the start (it would overlap the next one)', field: 'deadline' };
  }

  const item: DeadlineReminder = {
    id: String(input?.id || `dl_${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`),
    name,
    enabled: input?.enabled !== false,
    days,
    start,
    deadlineAfterDays: after,
    deadline,
    intervalMinutes: interval,
    respectQuietHours: input?.respectQuietHours !== false,
    email: input?.email !== false,
    chat: input?.chat !== false,
    createdAt: typeof input?.createdAt === 'string' ? input.createdAt : now.toISOString(),
  };
  if (notBefore) item.notBefore = notBefore;
  const n = Math.floor(Number(input?.everyNWeeks ?? 1));
  if (n > 1) {
    item.everyNWeeks = n;
    const anchor = input?.anchorDate;
    item.anchorDate = typeof anchor === 'string' && YMD.test(anchor) ? anchor : nextLocalDateOnWeekday(now, days[0]);
  }
  if (typeof input?.enabledSince === 'string' && !isNaN(Date.parse(input.enabledSince))) item.enabledSince = input.enabledSince;
  return { item };
}

/** The next calendar date (UTC date math, today inclusive) that falls on `weekday`. Anchor default (AC-S12). */
function nextLocalDateOnWeekday(now: Date, weekday: number): string {
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const delta = (weekday - new Date(base).getUTCDay() + 7) % 7;
  return new Date(base + delta * DAY_MS).toISOString().slice(0, 10);
}

function addDays(dateISO: string, n: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}
function daysBetween(fromISO: string, toISO: string): number {
  const ms = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((ms(toISO) - ms(fromISO)) / DAY_MS);
}
function localDateISO(ms: number, tz: string): string {
  const p = localClockParts(new Date(ms), tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
function localMinuteOfDay(ms: number, tz: string): number {
  const p = localClockParts(new Date(ms), tz);
  return p.hour * 60 + p.minute;
}

/**
 * Local wall time -> UTC ms, robust across DST (zonedTimeToUtc takes the offset at the naive instant,
 * which is one hour off right after a transition; re-check the offset at the result and correct once).
 */
export function localToUtcMs(dateISO: string, hhmm: string, tz: string): number {
  let ms = Date.parse(zonedTimeToUtc(dateISO, hhmm, tz));
  const [y, m, d] = dateISO.split('-').map(Number);
  const wanted = Date.UTC(y, m - 1, d, Number(hhmm.slice(0, 2)), Number(hhmm.slice(3, 5)));
  const off = getTzOffsetMinutesAt(new Date(ms), tz);
  const corrected = wanted - off * MIN_MS;
  if (corrected !== ms && getTzOffsetMinutesAt(new Date(corrected), tz) === off) ms = corrected;
  return ms;
}

export interface Occurrence {
  itemId: string;
  /** Local YYYY-MM-DD of the occurrence START (membership is judged on this date only, AC-O7). */
  startDate: string;
  startMs: number;
  deadlineMs: number;
  /** Stable reference stored on the occurrence task: `<itemId>@<startDate>` (S-35: by reference, not title). */
  ref: string;
}

export const occurrenceRef = (itemId: string, startDate: string) => `${itemId}@${startDate}`;

/** Does the item recur on this local START date? Reuses Activities' `occursOn` (days/everyNWeeks/anchor). */
export function startsOn(r: DeadlineReminder, dateISO: string): boolean {
  const asActivity: Activity = {
    id: r.id, name: r.name, kind: 'recurring', mode: 'locked', durationMin: 1,
    days: r.days, everyNWeeks: r.everyNWeeks, anchorDate: r.anchorDate, enabled: true,
  };
  return occursOn(asActivity, dateISO);
}

/** The slot (UTC ms) that is "current" at `now`: the latest start + k*interval <= now. */
export function currentSlotMs(occ: Occurrence, intervalMinutes: number, nowMs: number): number | null {
  if (nowMs < occ.startMs) return null;
  const step = intervalMinutes * MIN_MS;
  const slot = occ.startMs + Math.floor((nowMs - occ.startMs) / step) * step;
  return slot <= occ.deadlineMs ? slot : null;
}

/**
 * The occurrence live at `now`: started, and its current slot is at or before the deadline. Disabled
 * items have none (AC-O8, AC-E1). Weekday is judged on the LOCAL clock (AC-T1, S-21).
 */
export function liveOccurrence(r: DeadlineReminder, now: Date, tz: string | null | undefined): Occurrence | null {
  if (!r || r.enabled === false) return null;
  const zone = tz || DEFAULT_TIMEZONE;
  if (!HHMM.test(r.start) || !HHMM.test(r.deadline) || windowMinutes(r) <= 0) return null;
  const nowMs = now.getTime();
  const today = localDateISO(nowMs, zone);
  let best: Occurrence | null = null;
  for (let back = 0; back <= 8; back++) {
    const startDate = addDays(today, -back);
    if (!startsOn(r, startDate)) continue;
    const startMs = localToUtcMs(startDate, r.start, zone);
    const deadlineMs = localToUtcMs(addDays(startDate, r.deadlineAfterDays), r.deadline, zone);
    const occ: Occurrence = { itemId: r.id, startDate, startMs, deadlineMs, ref: occurrenceRef(r.id, startDate) };
    if (currentSlotMs(occ, r.intervalMinutes || 60, nowMs) === null) continue;
    if (!best || occ.startMs > best.startMs) best = occ;
  }
  return best;
}

export interface QuietPrefs { timezone: string | null; quiet_hours_start: string | null; quiet_hours_end: string | null }

export type SlotVerdict =
  | { fire: true }
  | { fire: false; reason: 'quiet_hours' | 'not_before' | 'after_deadline' | 'before_enabled' | 'stale' };

/**
 * May this slot fire on a run at `now`? Quiet hours are checked at the slot AND at now (a run inside quiet
 * hours never sends, H3); not-before applies on every day after the start day (S-30/S-33); the deadline
 * slot itself fires (G1); a slot from before the item was switched on never fires (AC-E5); a slot older
 * than one interval is never back-filled (AC-N7).
 */
export function slotVerdict(
  r: DeadlineReminder,
  occ: Occurrence,
  slotMs: number,
  now: Date,
  quiet: QuietPrefs,
): SlotVerdict {
  const zone = quiet.timezone || DEFAULT_TIMEZONE;
  if (slotMs > occ.deadlineMs) return { fire: false, reason: 'after_deadline' };
  if (now.getTime() - slotMs >= (r.intervalMinutes || 60) * MIN_MS || now.getTime() < slotMs) return { fire: false, reason: 'stale' };
  if (r.enabledSince && slotMs < Date.parse(r.enabledSince)) return { fire: false, reason: 'before_enabled' };
  if (r.respectQuietHours !== false) {
    const qp = { ...quiet, timezone: zone };
    if (isInQuietHours(new Date(slotMs), qp) || isInQuietHours(now, qp)) return { fire: false, reason: 'quiet_hours' };
  }
  if (r.notBefore && HHMM.test(r.notBefore) && localDateISO(slotMs, zone) !== occ.startDate
      && localMinuteOfDay(slotMs, zone) < toMin(r.notBefore)) {
    return { fire: false, reason: 'not_before' };
  }
  return { fire: true };
}

export interface OccurrenceTaskLite { id: string; status: string; deadline_reminder_ref: string | null; due_date?: string | null }

/**
 * The existing task an occurrence uses: the one with its exact ref, else (AC-E6: the start moved) one of the
 * same item whose start date is within the same recurrence gap. Never adopts a task by title (S-35).
 */
export function pickOccurrenceTask(
  tasks: OccurrenceTaskLite[],
  r: DeadlineReminder,
  occ: Occurrence,
): OccurrenceTaskLite | null {
  const exact = tasks.find((t) => t.deadline_reminder_ref === occ.ref);
  if (exact) return exact;
  const gap = minStartGapDays(r.days);
  const prefix = `${r.id}@`;
  const near = tasks
    .filter((t) => typeof t.deadline_reminder_ref === 'string' && t.deadline_reminder_ref.startsWith(prefix))
    .map((t) => ({ t, d: Math.abs(daysBetween(t.deadline_reminder_ref!.slice(prefix.length), occ.startDate)) }))
    .filter((x) => Number.isFinite(x.d) && x.d < gap)
    .sort((a, b) => a.d - b.d);
  return near.length ? near[0].t : null;
}

/** "Sat 8:00 PM" in the owner's timezone (AC-D9). */
export function formatDeadline(ms: number, tz: string | null | undefined): string {
  const p = localClockParts(new Date(ms), tz || DEFAULT_TIMEZONE);
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${DAY_NAMES[p.weekday]} ${h12}:${String(p.minute).padStart(2, '0')} ${p.hour < 12 ? 'AM' : 'PM'}`;
}

export function nagTitle(r: DeadlineReminder, occ: Occurrence, tz: string | null | undefined): string {
  return `${r.name} due by ${formatDeadline(occ.deadlineMs, tz)}`;
}
export function nagBody(r: DeadlineReminder, occ: Occurrence, tz: string | null | undefined): string {
  return `${r.name} must be done by ${formatDeadline(occ.deadlineMs, tz)}. Tap Done once it is submitted; until then I'll remind you every ${r.intervalMinutes === 60 ? 'hour' : `${r.intervalMinutes} minutes`}.`;
}

export interface NagMetadata {
  source: 'deadline_reminder';
  itemId: string;
  ref: string;
  email: boolean;
  chat: boolean;
  deadline: string;
}

/** The scheduled_notifications row for one slot. Never queued for quiet hours (H3, AC-N4). */
export function buildNagRow(userId: string, taskId: string, r: DeadlineReminder, occ: Occurrence, slotMs: number, tz: string | null | undefined) {
  const metadata: NagMetadata = {
    source: 'deadline_reminder', itemId: r.id, ref: occ.ref, email: r.email === true, chat: r.chat === true,
    deadline: new Date(occ.deadlineMs).toISOString(),
  };
  return {
    user_id: userId,
    task_id: taskId,
    notification_type: DEADLINE_REMINDER_TYPE,
    title: nagTitle(r, occ, tz),
    body: nagBody(r, occ, tz),
    scheduled_for: new Date(slotMs).toISOString(),
    queued_during_quiet: false,
    metadata,
  };
}

/**
 * Non-push channels delivery fans a row out to. For a nag the item's own email switch decides (H4: the
 * owner's global channels lack EMAIL); every OTHER type keeps the global filter exactly (AC-R4).
 */
export function deliveryChannelsFor(notificationType: string, globalChannels: string[], metadata: any): string[] {
  if (notificationType === DEADLINE_REMINDER_TYPE) return metadata?.email === true ? ['EMAIL'] : [];
  return (globalChannels || []).filter((c) => !['PUSH', 'OUTLOOK_EVENT', 'GOOGLE_EVENT'].includes(c));
}

/** True when a nag row asks for a TaskOS chat message (H5). */
export function wantsChat(notificationType: string, metadata: any): boolean {
  return notificationType === DEADLINE_REMINDER_TYPE && metadata?.chat === true;
}

/** Settings helper: what to store when the On switch flips. Turning On stamps enabledSince (AC-E5). */
export function setEnabled(r: DeadlineReminder, on: boolean, now: Date = new Date()): DeadlineReminder {
  if (on === (r.enabled !== false)) return r;
  return on ? { ...r, enabled: true, enabledSince: now.toISOString() } : { ...r, enabled: false };
}
