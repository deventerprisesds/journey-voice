// WHAT:       Executable guards for deadline reminders (_shared/deadline-reminders.ts): the spelling table
//             S-1..S-35, the owner's reference week (16 slots), quiet hours / not-before / deadline / Done,
//             no back-fill, late-in-hour runs, every-other-week, DST weeks, and the delivery channel split.
// WHY:        Tier 1 -- this module decides whether a full-screen alarm, an email and a chat message go out.
//             Every test here is pure (no server clock dependence): it must also pass with a non-UTC process
//             TZ (AC-T4 / H10), e.g. `TZ=America/Los_Angeles node scripts/run-tests.mjs`.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   .claude/ac-deadline-reminders.md; .claude/BUILD-deadline-reminders.md

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEADLINE_REMINDER_TYPE,
  buildNagRow,
  currentSlotMs,
  defaultDeadlineReminders,
  deliveryChannelsFor,
  formatDeadline,
  liveOccurrence,
  normalizeDeadlineReminder,
  pickOccurrenceTask,
  resolveDeadlineReminders,
  setEnabled,
  slotVerdict,
  wantsChat,
  nagPushFailed,
  nagEmailFailed,
  nagDeliveredUpdate,
  type DeadlineReminder,
} from './deadline-reminders.ts';
import { activityBusySlots } from './activities.ts';

const NY = 'America/New_York';
const QUIET = { timezone: NY, quiet_hours_start: '22:00:00', quiet_hours_end: '06:00:00' };
const NOQUIET = { timezone: NY, quiet_hours_start: null, quiet_hours_end: null };
const timeCard = (): DeadlineReminder => defaultDeadlineReminders()[0];

/** Local wall time in New York -> Date, for an explicit offset (EST -05:00 or EDT -04:00). */
const ny = (date: string, hhmm: string, off = '-05:00') => new Date(`${date}T${hhmm}:00${off}`);

/** Local "Day HH:mm" label for a UTC ms in New York (independent of the process TZ). */
const label = (ms: number, tz = NY) => {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms));
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g('weekday')} ${g('hour')}:${g('minute')}`;
};

/** Run the decision at every `stepMin` between [from, to], each run `offsetMin` past the hour; collect fired slots. */
function drive(r: DeadlineReminder, from: Date, to: Date, quiet = QUIET, offsetMin = 5, tz = NY): string[] {
  const fired = new Set<number>();
  for (let t = from.getTime() + offsetMin * 60000; t <= to.getTime(); t += 3600000) {
    const now = new Date(t);
    const occ = liveOccurrence(r, now, tz);
    if (!occ) continue;
    const slot = currentSlotMs(occ, r.intervalMinutes, t);
    if (slot === null) continue;
    if (slotVerdict(r, occ, slot, now, { ...quiet, timezone: tz }).fire) fired.add(slot);
  }
  return [...fired].sort((a, b) => a - b).map((ms) => label(ms, tz));
}

const REFERENCE = ['Fri 19:00', 'Fri 20:00', 'Fri 21:00',
  ...[8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((h) => `Sat ${String(h).padStart(2, '0')}:00`)];

// ── The owner's week (AC-N1..N5, N8, S-23, S-27, S-33) ─────────────────────────────────────────
test('AC-N1: the owner week fires exactly the 16 reference slots (Fri 19-21, Sat 08-20)', () => {
  assert.deepEqual(drive(timeCard(), ny('2026-11-27', '18:00'), ny('2026-11-28', '23:00')), REFERENCE);
});

test('AC-N8 / H8: runs late in the hour (:17 and :52) still fire each slot once', () => {
  assert.deepEqual(drive(timeCard(), ny('2026-11-27', '18:00'), ny('2026-11-28', '23:00'), QUIET, 17), REFERENCE);
  assert.deepEqual(drive(timeCard(), ny('2026-11-27', '18:00'), ny('2026-11-28', '23:00'), QUIET, 52), REFERENCE);
});

test('AC-N2/N3/N5: no fire in quiet hours, none at Sat 06/07 (not-before), none after Sat 20:00', () => {
  const fired = drive(timeCard(), ny('2026-11-27', '00:00'), ny('2026-11-29', '23:00'));
  for (const bad of ['Fri 22:00', 'Fri 23:00', 'Sat 00:00', 'Sat 05:00', 'Sat 06:00', 'Sat 07:00', 'Sat 21:00', 'Thu 19:00', 'Fri 18:00']) {
    assert.ok(!fired.includes(bad), `${bad} must not fire`);
  }
});

test('AC-O4: no occurrence before Fri 19:00 (Thu 19:00, Fri 18:59)', () => {
  assert.equal(liveOccurrence(timeCard(), ny('2026-11-26', '19:00'), NY), null);
  assert.equal(liveOccurrence(timeCard(), ny('2026-11-27', '18:59'), NY), null);
  assert.ok(liveOccurrence(timeCard(), ny('2026-11-27', '19:00'), NY));
});

test('AC-O5 / AC-N5: after the deadline hour there is no live occurrence', () => {
  assert.ok(liveOccurrence(timeCard(), ny('2026-11-28', '20:59'), NY));
  assert.equal(liveOccurrence(timeCard(), ny('2026-11-28', '21:00'), NY), null);
  assert.equal(liveOccurrence(timeCard(), ny('2026-11-30', '10:00'), NY), null);
});

test('AC-N7: an outage at 09:00 and 10:00 gives ONE fire at 11:05, no back-fill', () => {
  const r = timeCard();
  const now = ny('2026-11-28', '11:05');
  const occ = liveOccurrence(r, now, NY)!;
  const slot = currentSlotMs(occ, 60, now.getTime())!;
  assert.equal(label(slot), 'Sat 11:00');
  assert.deepEqual(slotVerdict(r, occ, ny('2026-11-28', '09:00').getTime(), now, QUIET), { fire: false, reason: 'stale' });
  assert.deepEqual(slotVerdict(r, occ, ny('2026-11-28', '10:00').getTime(), now, QUIET), { fire: false, reason: 'stale' });
});

test('AC-N14 / G2: slots are clock hours from the start; a run at 19:40 belongs to the 19:00 slot', () => {
  const occ = liveOccurrence(timeCard(), ny('2026-11-27', '19:40'), NY)!;
  assert.equal(label(currentSlotMs(occ, 60, ny('2026-11-27', '19:40').getTime())!), 'Fri 19:00');
  assert.equal(label(currentSlotMs(occ, 60, ny('2026-11-27', '20:00').getTime())!), 'Fri 20:00');
});

test('AC-O1: the occurrence deadline is Sat 20:00 local stored as UTC, and the ref is stable', () => {
  const occ = liveOccurrence(timeCard(), ny('2026-11-27', '19:10'), NY)!;
  assert.equal(new Date(occ.deadlineMs).toISOString(), '2026-11-29T01:00:00.000Z');
  assert.equal(occ.ref, 'time-card@2026-11-27');
  assert.equal(liveOccurrence(timeCard(), ny('2026-11-28', '15:10'), NY)!.ref, 'time-card@2026-11-27');
});

// ── Spelling table: times S-1..S-12 ────────────────────────────────────────────────────────────
const base = { name: 'X', days: [5], start: '19:00', deadline: '20:00', deadlineAfterDays: 1 };
const startOf = (s: unknown) => normalizeDeadlineReminder({ ...base, start: s }).item?.start ?? null;
test('S-1..S-5, S-7: accepted spellings normalize to HH:mm (7:00 is 07:00, never 19:00)', () => {
  assert.equal(startOf('19:00'), '19:00');
  assert.equal(startOf('7:00'), '07:00');
  assert.equal(startOf('07:00'), '07:00');
  assert.equal(startOf('19:00:00'), '19:00');
  assert.equal(startOf(' 19:00 '), '19:00');
  assert.equal(startOf('23:59'), '23:59');
});
test('S-6, S-9..S-12: rejected spellings return an error naming the field', () => {
  for (const s of ['24:00', '19:60', '19:5', '7pm', '7:00 PM', '19h', '1900', '19.00', '-1:00', '', null, undefined, '٠٧:٠٠']) {
    const res = normalizeDeadlineReminder({ ...base, start: s });
    assert.equal(res.item, undefined, `start ${JSON.stringify(s)} must be rejected`);
    assert.equal(res.field, 'start');
  }
  assert.equal(normalizeDeadlineReminder({ ...base, deadline: '24:00' }).field, 'deadline');
  assert.equal(normalizeDeadlineReminder({ ...base, notBefore: '8am' }).field, 'notBefore');
});
test('S-8: a 00:00 deadline is midnight at the START of the deadline day', () => {
  const r = normalizeDeadlineReminder({ ...base, deadline: '00:00', deadlineAfterDays: 1 }).item!;
  const occ = liveOccurrence(r, ny('2026-11-27', '19:30'), NY)!;
  assert.equal(label(occ.deadlineMs), 'Sat 00:00');
  assert.equal(normalizeDeadlineReminder({ ...base, deadline: '00:00', deadlineAfterDays: 0 }).field, 'deadline');
});

// ── Days S-13..S-22 ────────────────────────────────────────────────────────────────────────────
const daysOf = (d: unknown) => normalizeDeadlineReminder({ ...base, days: d, deadlineAfterDays: 0, deadline: '21:00' });
test('S-13..S-17, S-20: 5=Fri, 6=Sat, 0=Sun, "5" accepted, [5,5] deduped', () => {
  assert.deepEqual(daysOf([5]).item!.days, [5]);
  assert.deepEqual(daysOf([6]).item!.days, [6]);
  assert.deepEqual(daysOf([0]).item!.days, [0]);
  assert.deepEqual(daysOf(['5']).item!.days, [5]);
  assert.deepEqual(daysOf([5, 5]).item!.days, [5]);
});
test('S-16, S-18, S-19: 7, 5.5 and [] are rejected', () => {
  for (const d of [[7], [5.5], [], [-1], ['x']]) assert.equal(daysOf(d).field, 'days', JSON.stringify(d));
});
test('S-11 for days (verifier loop 1 #5): null, booleans, objects, "5.5", blank and NaN are rejected, never coerced', () => {
  for (const d of [[null], [true], [false], [{}], [[5]], ['5.5'], [' '], [''], [NaN], [undefined], ['05x']]) {
    assert.equal(daysOf(d).field, 'days', JSON.stringify(d));
  }
  assert.deepEqual(daysOf([' 5 ']).item!.days, [5]);
});
test('S-21 / AC-T1: Fri 19:00 EST is 2026-11-28T00:00Z (a UTC Saturday) and counts as FRIDAY', () => {
  const now = new Date('2026-11-28T00:05:00Z');
  const occ = liveOccurrence(timeCard(), now, NY)!;
  assert.equal(occ.startDate, '2026-11-27');
  assert.equal(new Date(occ.startMs).toISOString(), '2026-11-28T00:00:00.000Z');
});
test('S-22 / AC-T2: Fri 19:00 EDT is 23:00Z the same day; the next (EST) week it is 00:00Z', () => {
  const occ = liveOccurrence(timeCard(), new Date('2026-10-30T23:05:00Z'), NY)!;
  assert.equal(new Date(occ.startMs).toISOString(), '2026-10-30T23:00:00.000Z');
  const occ2 = liveOccurrence(timeCard(), new Date('2026-11-07T00:05:00Z'), NY)!;
  assert.equal(new Date(occ2.startMs).toISOString(), '2026-11-07T00:00:00.000Z');
  assert.equal(occ2.startDate, '2026-11-06');
});

// ── Windows and quiet hours S-23..S-33 ─────────────────────────────────────────────────────────
test('S-24, S-25, S-26: deadline before/equal to start, or more than a week later, is rejected', () => {
  assert.equal(normalizeDeadlineReminder({ ...base, deadlineAfterDays: 0, deadline: '08:00' }).field, 'deadline');
  assert.equal(normalizeDeadlineReminder({ ...base, deadlineAfterDays: 0, deadline: '19:00' }).field, 'deadline');
  assert.equal(normalizeDeadlineReminder({ ...base, deadlineAfterDays: 8, deadline: '20:00' }).field, 'deadline');
  assert.equal(normalizeDeadlineReminder({ ...base, deadlineAfterDays: 7, deadline: '20:00' }).field, 'deadline');
  assert.ok(normalizeDeadlineReminder({ ...base, deadlineAfterDays: 7, deadline: '19:00' }).item);
});
test('S-27/S-28: quiet ending AFTER not-before wins (first Saturday slot 09:00)', () => {
  const fired = drive(timeCard(), ny('2026-11-27', '18:00'), ny('2026-11-28', '23:00'),
    { timezone: NY, quiet_hours_start: '22:00:00', quiet_hours_end: '09:00:00' });
  assert.equal(fired.filter((s) => s.startsWith('Sat'))[0], 'Sat 09:00');
});
test('S-29: quiet 23:00-06:00 lets Fri 22:00 fire but not Fri 23:00', () => {
  const fired = drive(timeCard(), ny('2026-11-27', '18:00'), ny('2026-11-28', '23:00'),
    { timezone: NY, quiet_hours_start: '23:00', quiet_hours_end: '06:00' });
  assert.ok(fired.includes('Fri 22:00'));
  assert.ok(!fired.includes('Fri 23:00'));
});
test('S-30 / S-31: no quiet hours (null, or start==end) -> Fri 19..23 fire, Sat 00..07 do NOT, Sat 08..20 fire', () => {
  for (const q of [NOQUIET, { timezone: NY, quiet_hours_start: '22:00', quiet_hours_end: '22:00' }]) {
    const fired = drive(timeCard(), ny('2026-11-27', '18:00'), ny('2026-11-28', '23:00'), q);
    assert.deepEqual(fired, ['Fri 19:00', 'Fri 20:00', 'Fri 21:00', 'Fri 22:00', 'Fri 23:00', ...REFERENCE.slice(3)]);
  }
});
test('S-32 / G4: quiet hours that start before the deadline swallow the final nags (quiet wins)', () => {
  const fired = drive(timeCard(), ny('2026-11-27', '18:00'), ny('2026-11-28', '23:00'),
    { timezone: NY, quiet_hours_start: '19:00', quiet_hours_end: '06:00' });
  assert.ok(!fired.includes('Sat 19:00') && !fired.includes('Sat 20:00'));
  assert.ok(!fired.includes('Fri 19:00'), 'Fri 19:00 is inside 19:00-06:00 quiet hours too');
  assert.equal(fired.at(-1), 'Sat 18:00');
});
test('S-33: not-before does not apply on the start day', () => {
  const r = { ...timeCard(), notBefore: '20:30' };
  assert.ok(drive(r, ny('2026-11-27', '18:00'), ny('2026-11-27', '23:00')).includes('Fri 19:00'));
});
test('respectQuietHours=false fires through quiet hours but still honours not-before', () => {
  const r = { ...timeCard(), respectQuietHours: false };
  const fired = drive(r, ny('2026-11-27', '18:00'), ny('2026-11-28', '23:00'));
  assert.ok(fired.includes('Fri 23:00'));
  assert.ok(!fired.includes('Sat 03:00'));
});

// ── Over-match negatives S-34, S-35 and Activities untouched (AC-S11) ──────────────────────────
test('S-34 / AC-S11: deadline items add no Activities busy block, and an Activity named "Time card" is not a nag', () => {
  const cfg = { activities: [{ id: 'tc', name: 'Time card', kind: 'recurring', mode: 'locked', start: '19:00', durationMin: 30, days: [5] }] };
  const a = activityBusySlots(cfg, '2026-11-27T05:00:00Z', '2026-11-29T05:00:00Z', NY);
  const b = activityBusySlots({ ...cfg, deadlineReminders: defaultDeadlineReminders() }, '2026-11-27T05:00:00Z', '2026-11-29T05:00:00Z', NY);
  assert.deepEqual(b, a);
  assert.deepEqual(resolveDeadlineReminders({ ...cfg, deadlineReminders: [] }), []);
});
test('S-35 / AC-O6 / AC-E6: the occurrence task is matched by ref, never by title', () => {
  const r = timeCard();
  const occ = liveOccurrence(r, ny('2026-12-04', '19:10'), NY)!;
  const handMade = { id: 'h', status: 'TODO', deadline_reminder_ref: null };
  const lastWeek = { id: 'old', status: 'TODO', deadline_reminder_ref: 'time-card@2026-11-27' };
  assert.equal(pickOccurrenceTask([handMade, lastWeek], r, occ), null, 'last week task is not reused (O6), hand task not adopted');
  const thisWeek = { id: 'new', status: 'TODO', deadline_reminder_ref: 'time-card@2026-12-04' };
  assert.equal(pickOccurrenceTask([lastWeek, thisWeek], r, occ)?.id, 'new');
  // E6: the start day moved Fri -> Thu inside the week: the Thursday task is reused, not duplicated.
  const moved = { id: 'thu', status: 'TODO', deadline_reminder_ref: 'time-card@2026-12-03' };
  assert.equal(pickOccurrenceTask([lastWeek, moved], r, occ)?.id, 'thu');
});

// ── Seed and list (AC-S2, AC-S3) ───────────────────────────────────────────────────────────────
test('AC-S2 / AC-S3: Settings shows the time card as a starting example for a missing key; a stored [] stays empty', () => {
  const seed = resolveDeadlineReminders({});
  assert.equal(seed.length, 1);
  assert.deepEqual({ ...seed[0] }, {
    id: 'time-card', name: 'Submit time card', enabled: true, days: [5], start: '19:00', deadlineAfterDays: 1,
    deadline: '20:00', notBefore: '08:00', intervalMinutes: 60, respectQuietHours: true, email: true, chat: true,
  });
  assert.deepEqual(resolveDeadlineReminders({ deadlineReminders: [] }), []);
});
test('AC-S12: every-other-week without an anchor stores a YYYY-MM-DD anchor on the start weekday', () => {
  const it = normalizeDeadlineReminder({ ...base, everyNWeeks: 2 }, new Date('2026-11-25T12:00:00Z')).item!;
  assert.equal(it.anchorDate, '2026-11-27');
});

// ── Every other week (AC-O7) ───────────────────────────────────────────────────────────────────
test('AC-O7: every 2 weeks anchored 2026-11-27 -> 11-27, 12-11, 12-25 occur; 12-04, 12-18 do not; Saturday slots of an on week fire', () => {
  const r = { ...timeCard(), everyNWeeks: 2, anchorDate: '2026-11-27' };
  const refs = new Set<string>();
  for (let t = ny('2026-11-26', '00:00').getTime(); t < ny('2027-01-02', '00:00').getTime(); t += 3600000) {
    const occ = liveOccurrence(r, new Date(t + 5 * 60000), NY);
    if (occ) refs.add(occ.startDate);
  }
  assert.deepEqual([...refs], ['2026-11-27', '2026-12-11', '2026-12-25']);
  assert.ok(drive(r, ny('2026-12-11', '18:00'), ny('2026-12-12', '23:00')).includes('Sat 08:00'));
});

// ── Switch off/on (AC-E1, AC-E5, AC-O8) ────────────────────────────────────────────────────────
test('AC-O8 / AC-E1: an Off item has no occurrence', () => {
  assert.equal(liveOccurrence({ ...timeCard(), enabled: false }, ny('2026-11-27', '19:05'), NY), null);
});
test('AC-E5: turned back On at 12:20 -> 12:00 does not fire, 13:00 does', () => {
  const r = setEnabled({ ...timeCard(), enabled: false }, true, ny('2026-11-28', '12:20'));
  assert.equal(r.enabled, true);
  const fired = drive(r, ny('2026-11-28', '12:00'), ny('2026-11-28', '15:00'), QUIET, 25);
  assert.equal(fired[0], 'Sat 13:00');
});
test('AC-E3: moving the deadline to Sat 14:00 makes 14:00 the last slot', () => {
  const r = { ...timeCard(), deadline: '14:00' };
  assert.equal(drive(r, ny('2026-11-27', '18:00'), ny('2026-11-28', '23:00')).at(-1), 'Sat 14:00');
});

// ── DST and timezone (AC-T3, AC-T5, AC-T6) ─────────────────────────────────────────────────────
test('AC-T3: a window across the fall-back night has no duplicate instant and no gap in elapsed hours', () => {
  const r = normalizeDeadlineReminder({ name: 'Fall', days: [6], start: '22:00', deadline: '04:00', deadlineAfterDays: 1 }).item!;
  const slots: number[] = [];
  for (let t = Date.parse('2026-11-01T01:00:00Z'); t <= Date.parse('2026-11-01T11:00:00Z'); t += 3600000) {
    const occ = liveOccurrence(r, new Date(t + 300000), NY);
    if (occ) slots.push(currentSlotMs(occ, 60, t + 300000)!);
  }
  const uniq = [...new Set(slots)];
  for (let i = 1; i < uniq.length; i++) assert.equal(uniq[i] - uniq[i - 1], 3600000);
  assert.equal(uniq.length, 8, '22,23,00,01(EDT),01(EST),02,03,04(EST, the deadline, inclusive): 7 elapsed hours, 8 slots');
});
test('AC-T3: spring-forward night has no fire labelled 02:00 and no crash', () => {
  const r = normalizeDeadlineReminder({ name: 'Spring', days: [6], start: '22:00', deadline: '04:00', deadlineAfterDays: 1 }).item!;
  const fired = drive(r, ny('2026-03-07', '21:00'), new Date('2026-03-08T09:00:00Z'), NOQUIET, 5);
  assert.ok(!fired.includes('Sun 02:00'));
  assert.ok(fired.includes('Sun 03:00') && fired.includes('Sun 04:00'));
});
test('AC-T5: a Chicago timezone fires at 19:00 Chicago local', () => {
  const now = new Date('2026-11-28T01:05:00Z'); // 19:05 CST
  const occ = liveOccurrence(timeCard(), now, 'America/Chicago')!;
  assert.equal(new Date(occ.startMs).toISOString(), '2026-11-28T01:00:00.000Z');
});
test('AC-T6: a NULL timezone falls back to America/New_York', () => {
  const occ = liveOccurrence(timeCard(), new Date('2026-11-28T00:05:00Z'), null)!;
  assert.equal(occ.startDate, '2026-11-27');
});

// ── Nag row and delivery split (AC-N4, AC-D3, AC-D4, AC-D9, AC-R4, H2) ─────────────────────────
test('AC-N4 / AC-D9: the nag row is never queued for quiet hours and says what is due when, in local time', () => {
  const r = timeCard();
  const occ = liveOccurrence(r, ny('2026-11-27', '19:05'), NY)!;
  const row = buildNagRow('u1', 't1', r, occ, occ.startMs, NY);
  assert.equal(row.queued_during_quiet, false);
  assert.equal(row.notification_type, 'deadline_reminder');
  assert.equal(row.title, 'Submit time card due by Sat 8:00 PM');
  assert.equal(row.scheduled_for, '2026-11-28T00:00:00.000Z');
  assert.deepEqual(row.metadata, { source: 'deadline_reminder', itemId: 'time-card', ref: 'time-card@2026-11-27', email: true, chat: true, deadline: '2026-11-29T01:00:00.000Z' });
  assert.equal(formatDeadline(Date.parse('2026-11-28T17:00:00Z'), NY), 'Sat 12:00 PM');
});
test('AC-D3 / AC-R4: the per-item email switch decides for nags only; other types keep the global filter', () => {
  assert.deepEqual(deliveryChannelsFor(DEADLINE_REMINDER_TYPE, ['PUSH'], { email: true }), ['EMAIL']);
  assert.deepEqual(deliveryChannelsFor(DEADLINE_REMINDER_TYPE, ['PUSH', 'EMAIL', 'SLACK'], { email: false }), []);
  for (const t of ['due_reminder', 'daily_digest', 'task_start_now', 'task_start_reminder', 'calendar_event_reminder']) {
    assert.deepEqual(deliveryChannelsFor(t, ['PUSH'], { email: true }), [], t);
    assert.deepEqual(deliveryChannelsFor(t, ['PUSH', 'EMAIL', 'GOOGLE_EVENT'], {}), ['EMAIL'], t);
  }
  assert.equal(wantsChat(DEADLINE_REMINDER_TYPE, { chat: true }), true);
  assert.equal(wantsChat(DEADLINE_REMINDER_TYPE, { chat: false }), false);
  assert.equal(wantsChat('daily_digest', { chat: true }), false);
});
test('H2: the nag type is an ALARM type in delivery but not a task_start_* type', () => {
  const src = readFileSync(new URL('../notification-delivery/index.ts', import.meta.url), 'utf8');
  const alarm = /const ALARM_TYPES = \[([^\]]*)\]/.exec(src)![1];
  assert.match(alarm, /'deadline_reminder'/);
  assert.ok(!DEADLINE_REMINDER_TYPE.startsWith('task_start'));
});

// ── Delivery and scheduler wiring (source shape: both index.ts files call `serve` on import) ─────
const deliverySrc = () => readFileSync(new URL('../notification-delivery/index.ts', import.meta.url), 'utf8');
const schedulerSrc = () => readFileSync(new URL('../notification-scheduler/index.ts', import.meta.url), 'utf8');

test('H1 / AC-D6: delivery never drops a nag as "ancient" (both the keep-filter and the skip-marking)', () => {
  const hits = deliverySrc().match(/ancientTaskIds\.has\(n\.task_id\)\)? && n\.notification_type !== DEADLINE_REMINDER_TYPE/g) || [];
  assert.equal(hits.length, 2);
});
test('H4 / H5 / AC-D7 / AC-D8: delivery picks channels via deliveryChannelsFor, sends chat, records failure kinds', () => {
  const src = deliverySrc();
  assert.match(src, /const channelsForDelivery = deliveryChannelsFor\(primaryType, enabledChannels, singleRow\?\.metadata\);/);
  assert.match(src, /wantsChat\(primaryType, singleRow\.metadata\)[\s\S]{0,200}send-chat-message/);
  assert.match(src, /if \(!isNag && pushError && enabledChannels\.some\(/);
  assert.match(src, /if \(isNag && nagPushFailed\(pushError, pushData\)\) nagFailures\.push\('push_failed'\);/);
  assert.match(src, /if \(isNag && nagEmailFailed\(unifiedError, unifiedResult\)\) nagFailures\.push\('email_failed'\);/);
  assert.match(src, /deliveredUpdate = nagDeliveredUpdate\(new Date\(\)\.toISOString\(\), nagFailures, existingReason\);/);
  assert.match(src, /let deliveredUpdate: Record<string, unknown> = \{ delivered_at: new Date\(\)\.toISOString\(\), failure_reason: null \};/,
    'non-nag rows keep the original update');
});

test('AC-D8 (verifier loop 1 #1): a 200 with delivered:0 is a push failure; delivered>=1 or no data is not', () => {
  assert.equal(nagPushFailed(null, { success: true, delivered: 0, failed: 2 }), true);
  assert.equal(nagPushFailed(null, { success: true, message: 'No push subscriptions found', delivered: 0 }), true);
  assert.equal(nagPushFailed({ message: '500' }, null), true);
  assert.equal(nagPushFailed(null, { success: true, delivered: 1, failed: 1 }), false);
  assert.equal(nagPushFailed(null, null), false);
});
test('AC-D7 (verifier loop 1 #2): a 207 / success:false email is a failure, and a stored reason is never nulled', () => {
  assert.equal(nagEmailFailed(null, { success: false, outcome: 'partial' }), true);
  assert.equal(nagEmailFailed(null, { success: true, outcome: 'failed' }), true);
  assert.equal(nagEmailFailed({ message: 'x' }, null), true);
  assert.equal(nagEmailFailed(null, { success: true, outcome: 'success' }), false);
  assert.equal(nagEmailFailed(null, null), false);
  const t = '2026-11-28T00:01:00.000Z';
  assert.deepEqual(nagDeliveredUpdate(t, [], null), { delivered_at: t });
  assert.ok(!('failure_reason' in nagDeliveredUpdate(t, [], 'EMAIL: smtp 550')), 'no failure -> key left out, existing reason kept');
  assert.deepEqual(nagDeliveredUpdate(t, ['email_failed'], 'EMAIL: smtp 550'), { delivered_at: t, failure_reason: 'email_failed; EMAIL: smtp 550' });
  assert.deepEqual(nagDeliveredUpdate(t, ['push_failed', 'email_failed'], null), { delivered_at: t, failure_reason: 'push_failed,email_failed' });
});
test('H6 / AC-R3: the scheduler runs the nag pass per user in try/catch, before and apart from the bulk insert', () => {
  const src = schedulerSrc();
  const pass = src.indexOf('await runDeadlineRemindersForUser(');
  const bulk = src.indexOf('.insert(notifications)');
  assert.ok(pass > 0 && bulk > pass, 'pass runs before, and separate from, the bulk insert');
  const loop = src.slice(src.lastIndexOf('for (const prefs of allPrefs', pass), pass);
  assert.match(loop, /try \{/);
  assert.ok(!/notifications\.push/.test(src.slice(pass, bulk)), 'no nag goes into the bulk array');
});
