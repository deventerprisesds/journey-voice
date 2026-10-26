// WHAT:       Executable guards for J10 (overdue reminders at the USER's 9am, never in quiet hours) and
//             J13's calendar skip (no second, task-less alarm for a task's own calendar copy).
// WHY:        live notification-scheduler v581 = main fired overdue pushes at 09:00 UTC = 05:00 New York,
//             un-gated by quiet hours. The New York case below uses the one live New York user's real
//             settings (America/New_York, quiet 22:00-06:00, read 2026-10-26).
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   docs/qc-evidence/RESTORE-step4-j10.md
//             run: TZ=UTC node --experimental-strip-types --test supabase/functions/notification-scheduler/reminder-rules.test.ts
//             (TZ=UTC matches the Supabase edge runtime; `isInQuietHours` is main's code moved verbatim
//             and depends on it.)

import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {
  OVERDUE_REMINDER_LOCAL_HOUR,
  generateOverdueReminders,
  isInQuietHours,
  isTaskBackedEvent,
  overdueRemindersAllowed,
} from './reminder-rules.ts';

if (new Date(0).getTimezoneOffset() !== 0) {
  throw new Error('run with TZ=UTC (the Supabase edge runtime clock); see the header');
}

const NY = { timezone: 'America/New_York', quiet_hours_start: '22:00:00', quiet_hours_end: '06:00:00', overdue_reminders_enabled: true };
const UTC_USER = { timezone: 'UTC', quiet_hours_start: '22:00:00', quiet_hours_end: '08:00:00', overdue_reminders_enabled: true };

// A task that is exactly 3 days overdue on 2026-10-26 (the generator fires every 3rd day).
const OVERDUE_3D = [{ id: 't1', title: 'Test-file the report', due_date: '2026-10-23T00:00:00Z' }];

/** What the scheduler decides for one 15-minute tick: the gate, then the generator. */
function overdueAt(isoNow: string, prefs: typeof NY, tasks = OVERDUE_3D) {
  const now = new Date(isoNow);
  if (!overdueRemindersAllowed(prefs, isInQuietHours(now, prefs))) return [];
  return generateOverdueReminders(tasks, 'u1', now, prefs.timezone);
}

test('local hour constant is 9', () => {
  assert.equal(OVERDUE_REMINDER_LOCAL_HOUR, 9);
});

test('New York, EDT: 13:05 UTC = 09:05 local -> one overdue reminder', () => {
  const r = overdueAt('2026-10-26T13:05:00Z', NY);
  assert.equal(r.length, 1);
  assert.equal(r[0].notification_type, 'overdue_reminder');
  assert.equal(r[0].title, 'Task Overdue (3 days)');
});

test('New York, EDT: 09:05 UTC = 05:05 local (what main fired on) -> nothing', () => {
  assert.equal(overdueAt('2026-10-26T09:05:00Z', NY).length, 0);
});

test('New York, EST after DST ends: 14:05 UTC = 09:05 local fires; 09:05 UTC = 04:05 local does not', () => {
  const tasks = [{ id: 't2', title: 'Test-renew', due_date: '2026-11-06T00:00:00Z' }]; // 3 days before 11-09
  assert.equal(overdueAt('2026-11-09T14:05:00Z', NY, tasks).length, 1);
  assert.equal(overdueAt('2026-11-09T13:05:00Z', NY, tasks).length, 0); // 08:05 EST
  assert.equal(overdueAt('2026-11-09T09:05:00Z', NY, tasks).length, 0); // 04:05 EST
});

test('only the first 15-minute tick of 9am local fires (once a day)', () => {
  assert.equal(overdueAt('2026-10-26T13:14:00Z', NY).length, 1);
  assert.equal(overdueAt('2026-10-26T13:15:00Z', NY).length, 0);
});

test('UTC users are unchanged: 09:05 UTC still fires', () => {
  assert.equal(overdueAt('2026-10-26T09:05:00Z', UTC_USER).length, 1);
});

test('quiet hours: 05:05 New York is inside 22:00-06:00, so overdue reminders are not allowed at all', () => {
  const now = new Date('2026-10-26T09:05:00Z');
  assert.equal(isInQuietHours(now, NY), true);
  assert.equal(overdueRemindersAllowed(NY, true), false);
});

test('quiet hours that cover 9am suppress the 9am overdue reminder', () => {
  const lateSleeper = { ...NY, quiet_hours_start: '21:00:00', quiet_hours_end: '09:30:00' };
  assert.equal(isInQuietHours(new Date('2026-10-26T13:05:00Z'), lateSleeper), true);
  assert.equal(overdueAt('2026-10-26T13:05:00Z', lateSleeper).length, 0);
});

test('disabled overdue reminders stay off outside quiet hours', () => {
  assert.equal(overdueRemindersAllowed({ overdue_reminders_enabled: false }, false), false);
  assert.equal(overdueRemindersAllowed({ overdue_reminders_enabled: true }, false), true);
});

test('J13: an event that is a task mirror (either link side) is skipped; a real meeting is not', () => {
  const linked = new Set(['evt-linked']);
  assert.equal(isTaskBackedEvent({ source_task_id: 'task-9', external_event_id: 'evt-a' }, linked), true);
  assert.equal(isTaskBackedEvent({ source_task_id: null, external_event_id: 'evt-linked' }, linked), true);
  assert.equal(isTaskBackedEvent({ source_task_id: null, external_event_id: 'evt-meeting' }, linked), false);
  assert.equal(isTaskBackedEvent({ source_task_id: null, external_event_id: null }, linked), false);
});

// index.ts calls serve() on import, so its wiring cannot be exercised; assert it statically instead.
// Each line below is the call site whose removal would reinstate the old behaviour.
test('index.ts wiring: the scheduler actually calls the gated, timezone-aware rules', () => {
  const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.match(src, /if \(overdueRemindersAllowed\(prefs, inQuietHours\)\) \{/);
  assert.match(src, /generateOverdueReminders\(tasks \|\| \[\], prefs\.user_id, now, prefs\.timezone\)/);
  assert.match(src, /if \(isTaskBackedEvent\(event, taskBackedEventIds\)\) \{\s*\n[^\n]*\n\s*continue;/);
  // (generateDueReminders, unused dead code from main, still reads now.getHours() === 9 -- untouched.)
  assert.doesNotMatch(src, /now\.getHours\(\) === 9 && now\.getMinutes\(\) < 15/);
});
