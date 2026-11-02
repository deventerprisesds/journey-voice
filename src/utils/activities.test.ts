/**
 * Guard for recurring ACTIVITIES (_shared/activities.ts) — lunch, gym, church, haircut, 1:1s.
 *
 * What must hold:
 *  - Activities occur on the right days (weekly, every-N-weeks, one-off, skipped, on-demand never).
 *  - A floating activity (lunch) slides around a meeting instead of sitting on top of it.
 *  - The seed only applies until the owner saves a list; lunch length follows breakMinutes.
 *  - "Headed to the gym" shifts displaced work later in order, never moves meetings or locked
 *    activities, and overflows what no longer fits instead of squeezing it past its window.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activityBusySlots,
  defaultActivities,
  expandActivitiesForDate,
  matchActivity,
  normalizeActivity,
  occursOn,
  planPush,
  resolveActivities,
  type Activity,
  type PushItem,
} from '../../supabase/functions/_shared/activities.ts';

const TZ = 'America/New_York';
// 2026-11-03 is a Tuesday; New York is UTC-5 (EST) on that date.
const TUE = '2026-11-03';
const at = (hhmm: string, date = TUE) => new Date(`${date}T${hhmm}:00-05:00`).getTime();
const iso = (hhmm: string, date = TUE) => new Date(at(hhmm, date)).toISOString();

const weekly = (over: Partial<Activity> = {}): Activity => ({
  id: 'a', name: 'Church', kind: 'recurring', mode: 'locked', start: '10:00', durationMin: 90, days: [2], ...over,
});

test('recurring activity occurs only on its days', () => {
  assert.equal(occursOn(weekly(), TUE), true);
  assert.equal(occursOn(weekly(), '2026-11-04'), false);
});

test('every-other-week counts from the anchor and never fires before it', () => {
  const biweekly = weekly({ everyNWeeks: 2, anchorDate: TUE });
  assert.equal(occursOn(biweekly, TUE), true);
  assert.equal(occursOn(biweekly, '2026-11-10'), false);
  assert.equal(occursOn(biweekly, '2026-11-17'), true);
  assert.equal(occursOn(biweekly, '2026-10-27'), false);
});

test('one-off, skipped, disabled and on-demand activities', () => {
  assert.equal(occursOn({ id: 'h', name: 'Haircut', kind: 'one_off', mode: 'locked', start: '11:00', durationMin: 45, date: TUE }, TUE), true);
  assert.equal(occursOn({ id: 'h', name: 'Haircut', kind: 'one_off', mode: 'locked', start: '11:00', durationMin: 45, date: TUE }, '2026-11-04'), false);
  assert.equal(occursOn(weekly({ skipDates: [TUE] }), TUE), false);
  assert.equal(occursOn(weekly({ enabled: false }), TUE), false);
  assert.equal(occursOn({ id: 'g', name: 'Gym', kind: 'on_demand', mode: 'locked', durationMin: 120 }, TUE), false);
});

test('locked activity becomes a busy block at its exact time, in UTC', () => {
  const [b] = expandActivitiesForDate([weekly()], TUE, TZ);
  assert.equal(b.start_time, iso('10:00'));
  assert.equal(b.end_time, iso('11:30'));
  assert.equal(b.locked, true);
});

test('floating lunch takes its preferred time when free', () => {
  const [lunch] = expandActivitiesForDate(defaultActivities({}), TUE, TZ);
  assert.equal(lunch.name, 'Lunch');
  assert.equal(lunch.start_time, iso('12:00'));
  assert.equal(lunch.end_time, iso('13:00'));
});

test('floating lunch slides around a meeting instead of overlapping it', () => {
  const meeting = { start_time: iso('11:45'), end_time: iso('12:45') };
  const [lunch] = expandActivitiesForDate(defaultActivities({}), TUE, TZ, [meeting]);
  // Every legal start (11:30..12:30, since lunch must end by 13:30) overlaps 11:45-12:45, so lunch
  // is still reserved at its preferred 12:00 and flagged rather than dropped.
  assert.equal(lunch.conflict, true);
  assert.equal(lunch.start_time, iso('12:00'));
  const early = { start_time: iso('12:00'), end_time: iso('12:30') };
  const [moved] = expandActivitiesForDate(defaultActivities({}), TUE, TZ, [early]);
  assert.equal(moved.conflict, undefined);
  assert.equal(moved.start_time, iso('12:30'));
});

test('floating blocks avoid locked activities too', () => {
  const standup = weekly({ id: 's', name: 'Standup', start: '12:00', durationMin: 30 });
  const blocks = expandActivitiesForDate([standup, ...defaultActivities({})], TUE, TZ);
  const lunch = blocks.find((b) => b.name === 'Lunch')!;
  assert.equal(lunch.start_time, iso('12:30'));
});

test('seed applies only until a list is saved; lunch follows breakMinutes', () => {
  assert.deepEqual(resolveActivities({ activities: [] }), []);
  const seeded = resolveActivities({ workingHours: { breakMinutes: 45 } });
  assert.equal(seeded.find((a) => a.id === 'lunch')!.durationMin, 45);
  assert.equal(seeded.find((a) => a.id === 'gym')!.pushesSchedule, true);
});

test('activityBusySlots covers every local day in a multi-day range', () => {
  const cfg = { activities: [weekly({ days: [2, 3] })] };
  const slots = activityBusySlots(cfg, iso('00:00'), iso('23:59', '2026-11-04'), TZ);
  assert.equal(slots.length, 2);
});

test('matchActivity matches name or alias as a whole word', () => {
  const acts = defaultActivities({});
  assert.equal(matchActivity(acts, "I'm headed to the gym")?.id, 'gym');
  assert.equal(matchActivity(acts, 'going to work out')?.id, 'gym');
  assert.equal(matchActivity(acts, 'gymnastics recap email'), null);
});

test('normalizeActivity rejects activities that can never produce a block', () => {
  assert.match(normalizeActivity({ name: 'Church', kind: 'recurring', start: '10:00' }).error!, /days/);
  assert.match(normalizeActivity({ name: 'Church', days: [0] }).error!, /start/);
  assert.match(normalizeActivity({ name: 'Haircut', kind: 'one_off', start: '11:00' }).error!, /date/);
  const ok = normalizeActivity({ name: 'Church', days: [0], start: '10:00', duration_min: 90 });
  assert.equal(ok.activity?.kind, 'recurring');
  assert.deepEqual(ok.activity?.aliases, ['church']);
});

// ── push ──────────────────────────────────────────────────────────────────────────────────────
const task = (id: string, s: string, e: string, limit = '17:00'): PushItem =>
  ({ id, title: id, kind: 'task', startMs: at(s), endMs: at(e), movable: true, limitMs: at(limit) });
const wall = (id: string, s: string, e: string, kind: PushItem['kind'] = 'event'): PushItem =>
  ({ id, title: id, kind, startMs: at(s), endMs: at(e), movable: false, limitMs: at(e) });

test('gym at 10:05 shifts the email and research after it, in order', () => {
  const plan = planPush([task('email', '10:00', '10:30'), task('research', '10:30', '12:00')], at('10:05'), at('12:05'));
  assert.deepEqual(plan.moves.map((m) => [m.id, new Date(m.startMs).toISOString()]), [
    ['email', iso('12:05')],
    ['research', iso('12:35')],
  ]);
  assert.deepEqual(plan.overflow, []);
});

test('meetings and locked activities never move; overlapping ones are conflicts', () => {
  const plan = planPush([wall('standup', '12:00', '12:15', 'activity'), task('email', '10:00', '10:30')], at('10:05'), at('12:05'));
  assert.deepEqual(plan.conflicts.map((c) => c.id), ['standup']);
  assert.ok(!plan.moves.some((m) => m.id === 'standup'));
  // email cannot start inside standup — it hops to 12:15.
  assert.equal(plan.moves[0].startMs, at('12:15'));
});

test('displaced work hops over a later meeting rather than overlapping it', () => {
  const plan = planPush([task('a', '11:00', '12:00'), wall('mtg', '13:00', '14:00')], at('11:00'), at('12:30'));
  assert.equal(plan.moves[0].startMs, at('14:00'));
});

test('work that no longer fits its window overflows instead of running past it', () => {
  const plan = planPush([task('post', '15:00', '16:30')], at('15:00'), at('17:00'));
  assert.deepEqual(plan.overflow.map((o) => o.id), ['post']);
  assert.deepEqual(plan.moves, []);
});

test('items far enough after the block stay where they are', () => {
  const plan = planPush([task('late', '15:00', '15:30')], at('10:00'), at('12:00'));
  assert.deepEqual(plan.moves, []);
});

test('items that ended before the block are untouched', () => {
  const plan = planPush([task('early', '09:00', '10:00')], at('10:00'), at('12:00'));
  assert.deepEqual(plan.moves, []);
  assert.deepEqual(plan.overflow, []);
});
