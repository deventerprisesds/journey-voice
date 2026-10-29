/**
 * Regression guards for the loop-1 verifier findings on activities (PR #76):
 *  - a floating block is never placed outside its own earliest-latest range (even when its
 *    preferred start sits outside it);
 *  - `pushes_schedule: false` on an update clears a stored `pushesSchedule: true`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandActivitiesForDate, normalizeActivity, type Activity } from '../../supabase/functions/_shared/activities.ts';

const TZ = 'America/New_York';
const TUE = '2026-11-03';
const iso = (hhmm: string) => new Date(`${TUE}T${hhmm}:00-05:00`).toISOString();

test('a floating block whose preferred start is outside its range is pulled inside it', () => {
  const lunch: Activity = {
    id: 'lunch', name: 'Lunch', kind: 'recurring', mode: 'floating', start: '15:00',
    earliest: '11:30', latest: '13:30', durationMin: 60, days: [2],
  };
  const [b] = expandActivitiesForDate([lunch], TUE, TZ);
  assert.ok(b.start_time >= iso('11:30') && b.end_time <= iso('13:30'), `${b.start_time}-${b.end_time}`);
  assert.equal(b.start_time, iso('12:30'));
});

test('a conflicted floating block is still reserved inside its range', () => {
  const lunch: Activity = {
    id: 'lunch', name: 'Lunch', kind: 'recurring', mode: 'floating', start: '15:00',
    earliest: '11:30', latest: '13:30', durationMin: 60, days: [2],
  };
  const [b] = expandActivitiesForDate([lunch], TUE, TZ, [{ start_time: iso('11:00'), end_time: iso('14:00') }]);
  assert.equal(b.conflict, true);
  assert.ok(b.end_time <= iso('13:30'));
});

test('pushes_schedule false clears a stored pushesSchedule true', () => {
  const merged = { name: 'Gym', kind: 'on_demand', durationMin: 120, pushesSchedule: true, pushes_schedule: false };
  assert.equal(normalizeActivity(merged).activity?.pushesSchedule, undefined);
  assert.equal(normalizeActivity({ name: 'Gym', kind: 'on_demand', durationMin: 120, pushesSchedule: true }).activity?.pushesSchedule, true);
});

import { parseClockTime } from '../../supabase/functions/_shared/activities.ts';

test('start_time is normalized or rejected — never a silent fallback', () => {
  assert.equal(parseClockTime('9:30'), '09:30');
  assert.equal(parseClockTime('09:30:00'), '09:30');
  assert.equal(parseClockTime('17:05'), '17:05');
  assert.equal(parseClockTime('25:00'), null);
  assert.equal(parseClockTime('noon'), null);
  assert.equal(parseClockTime('9.30'), null);
});
