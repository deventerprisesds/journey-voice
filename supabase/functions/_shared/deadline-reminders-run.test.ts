// WHAT:       Guards for the per-user deadline-reminder run (_shared/deadline-reminders-run.ts) against an
//             in-memory Supabase double that enforces the two unique keys the feature relies on.
// WHY:        AC-O1..O3, O5, O6, N6, N10..N12, E3/G5, P3 and H6/R3 are about what lands in the database across
//             repeat runs and failures -- only a stateful double can show them without the live project.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   .claude/ac-deadline-reminders.md; .claude/BUILD-deadline-reminders.md

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDeadlineRemindersForUser } from './deadline-reminders-run.ts';
import { defaultDeadlineReminders } from './deadline-reminders.ts';

type Row = Record<string, any>;

/** Minimal PostgREST-shaped double. Unique keys: tasks(user_id, deadline_reminder_ref), nags(user,task,type,slot). */
function fakeDb(seed: { config?: any; tasks?: Row[]; failTaskSelectAfterInsert?: boolean } = {}) {
  const db: Record<string, Row[]> = {
    user_scheduling_prefs: [{ user_id: 'u1', timezone: 'America/New_York', config: 'config' in seed ? seed.config : { deadlineReminders: defaultDeadlineReminders() } }],
    boards: [{ id: 'b1', user_id: 'u1', is_default: true, created_at: '2025-01-01' }],
    tasks: seed.tasks ?? [],
    scheduled_notifications: [],
  };
  const calls: string[] = [];
  let ids = 0;
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let op: 'select' | 'insert' | 'update' | 'upsert' = 'select';
    let payload: any;
    let upsertOpts: any;
    const q: any = {
      select() { return q; },
      eq(c: string, v: any) { filters.push((r) => r[c] === v); return q; },
      not(c: string, _op: string, _v: any) { filters.push((r) => r[c] !== null && r[c] !== undefined); return q; },
      gte(c: string, v: any) { filters.push((r) => !r[c] || r[c] >= v); return q; },
      in(c: string, v: any[]) { filters.push((r) => v.includes(r[c])); return q; },
      order() { return q; },
      limit() { return q; },
      insert(p: any) { op = 'insert'; payload = p; return q; },
      update(p: any) { op = 'update'; payload = p; return q; },
      upsert(p: any, o: any) { op = 'upsert'; payload = p; upsertOpts = o; return q; },
      maybeSingle() { return run().then((r: any) => ({ data: r.data?.[0] ?? null, error: r.error })); },
      single() { return run().then((r: any) => ({ data: r.data?.[0] ?? null, error: r.error ?? (r.data?.[0] ? null : { message: 'none' }) })); },
      then(res: any, rej: any) { return run().then(res, rej); },
    };
    const run = async () => {
      calls.push(`${table}.${op}`);
      const rows = db[table];
      if (op === 'select') return { data: rows.filter((r) => filters.every((f) => f(r))), error: null };
      if (op === 'update') { rows.filter((r) => filters.every((f) => f(r))).forEach((r) => Object.assign(r, payload)); return { data: null, error: null }; }
      const row = { id: `${table}-${++ids}`, created_at: new Date().toISOString(), ...payload };
      if (table === 'tasks' && rows.some((r) => r.user_id === row.user_id && r.deadline_reminder_ref === row.deadline_reminder_ref)) {
        return { data: null, error: { code: '23505', message: 'duplicate key' } };
      }
      if (table === 'scheduled_notifications') {
        if (!row.task_id || !row.scheduled_for) return { data: null, error: { code: '23502', message: 'null' } };
        const dup = rows.some((r) => r.user_id === row.user_id && r.task_id === row.task_id
          && r.notification_type === row.notification_type && r.scheduled_for === row.scheduled_for);
        if (dup) return op === 'upsert' && upsertOpts?.ignoreDuplicates ? { data: [], error: null } : { data: null, error: { code: '23505' } };
      }
      rows.push(row);
      if (table === 'tasks' && seed.failTaskSelectAfterInsert) { seed.failTaskSelectAfterInsert = false; throw new Error('crash after write'); }
      return { data: [row], error: null };
    };
    return q;
  };
  return { client: { from }, db, calls };
}

const PREFS = { user_id: 'u1', timezone: 'America/New_York', quiet_hours_start: '22:00:00', quiet_hours_end: '06:00:00' };
const at = (iso: string) => new Date(iso);
const FRI_1910 = at('2026-11-28T00:10:00Z');  // Fri 19:10 EST
const FRI_1940 = at('2026-11-28T00:40:00Z');
const SAT_1005 = at('2026-11-28T15:05:00Z');  // Sat 10:05 EST

test('AC-O1: Fri 19:10 creates ONE occurrence task (due = Sat 20:00 local) and one nag', async () => {
  const f = fakeDb();
  const r = await runDeadlineRemindersForUser(f.client, PREFS, FRI_1910);
  assert.equal(r.tasksCreated, 1);
  assert.equal(f.db.tasks.length, 1);
  const t = f.db.tasks[0];
  assert.equal(t.deadline_reminder_ref, 'time-card@2026-11-27');
  assert.equal(t.due_date, '2026-11-29T01:00:00.000Z');
  assert.equal(t.board_id, 'b1');
  assert.notEqual(t.status, 'DONE');
  assert.equal(f.db.scheduled_notifications.length, 1);
  assert.equal(f.db.scheduled_notifications[0].task_id, t.id);
  assert.equal(f.db.scheduled_notifications[0].queued_during_quiet, false);
});

test('AC-O2 / AC-N6: three runs in the same hour leave one task and one nag row', async () => {
  const f = fakeDb();
  for (const now of [FRI_1910, FRI_1940, at('2026-11-28T00:55:00Z')]) {
    const r = await runDeadlineRemindersForUser(f.client, PREFS, now);
    assert.deepEqual(r.errors, [], 'a repeat run is a quiet no-op, not a duplicate-key error');
  }
  assert.equal(f.db.tasks.length, 1);
  assert.equal(f.db.scheduled_notifications.length, 1);
  await runDeadlineRemindersForUser(f.client, PREFS, SAT_1005);
  assert.equal(f.db.tasks.length, 1, 'later hours reuse the task');
  assert.equal(f.db.scheduled_notifications.length, 2);
});

test('AC-O3: a crash right after the task write -> next run reuses it and still nags', async () => {
  const f = fakeDb({ failTaskSelectAfterInsert: true });
  const r1 = await runDeadlineRemindersForUser(f.client, PREFS, FRI_1910);
  assert.equal(r1.errors.length, 1);
  assert.equal(f.db.tasks.length, 1);
  await runDeadlineRemindersForUser(f.client, PREFS, at('2026-11-28T01:05:00Z'));
  assert.equal(f.db.tasks.length, 1);
  assert.equal(f.db.scheduled_notifications.length, 1);
});

test('AC-O2 race: a task the read did not see is refused by the unique key, re-read and reused (no second task)', async () => {
  // created_at older than the look-back, so the one SELECT misses it -- the same shape as a concurrent run.
  const f = fakeDb({ tasks: [{ id: 'seen-late', user_id: 'u1', status: 'TODO', created_at: '2020-01-01T00:00:00Z',
    deadline_reminder_ref: 'time-card@2026-11-27', due_date: '2026-11-29T01:00:00.000Z' }] });
  const r = await runDeadlineRemindersForUser(f.client, PREFS, FRI_1910);
  assert.equal(f.db.tasks.length, 1);
  assert.equal(r.tasksCreated, 0);
  assert.equal(f.db.scheduled_notifications.length, 1);
  assert.equal(f.db.scheduled_notifications[0].task_id, 'seen-late');
});

test('AC-N10 / AC-N11: a DONE occurrence task gets no new task and no nag', async () => {
  const f = fakeDb({ tasks: [{ id: 'tk', user_id: 'u1', status: 'DONE', deadline_reminder_ref: 'time-card@2026-11-27', due_date: '2026-11-29T01:00:00.000Z' }] });
  const r = await runDeadlineRemindersForUser(f.client, PREFS, SAT_1005);
  assert.equal(f.db.tasks.length, 1);
  assert.equal(f.db.scheduled_notifications.length, 0);
  assert.deepEqual(r.skipped, [{ itemId: 'time-card', reason: 'done' }]);
});

test('AC-N12: reopened before the deadline -> nags resume at the next slot', async () => {
  const f = fakeDb({ tasks: [{ id: 'tk', user_id: 'u1', status: 'TODO', deadline_reminder_ref: 'time-card@2026-11-27', due_date: '2026-11-29T01:00:00.000Z' }] });
  await runDeadlineRemindersForUser(f.client, PREFS, SAT_1005);
  assert.equal(f.db.scheduled_notifications.length, 1);
  assert.equal(f.db.scheduled_notifications[0].task_id, 'tk');
});

test('AC-O5 / AC-O6: an old open task is left alone; the next Friday gets a NEW task and nags only it', async () => {
  const old = { id: 'old', user_id: 'u1', status: 'TODO', title: 'Submit time card', deadline_reminder_ref: 'time-card@2026-11-20', due_date: '2026-11-22T01:00:00.000Z' };
  const f = fakeDb({ tasks: [{ ...old }] });
  await runDeadlineRemindersForUser(f.client, PREFS, at('2026-11-29T15:00:00Z')); // Sun: nothing live
  assert.deepEqual(f.db.tasks, [old]);
  await runDeadlineRemindersForUser(f.client, PREFS, FRI_1910);
  assert.equal(f.db.tasks.length, 2);
  assert.deepEqual(f.db.tasks[0], old, 'old task unchanged');
  assert.ok(f.db.scheduled_notifications.every((n) => n.task_id !== 'old'));
});

test('AC-E3 / G5: moving the deadline mid-window updates the open task due date, reusing it', async () => {
  const items = [{ ...defaultDeadlineReminders()[0], deadline: '14:00' }];
  const f = fakeDb({ config: { deadlineReminders: items },
    tasks: [{ id: 'tk', user_id: 'u1', status: 'TODO', deadline_reminder_ref: 'time-card@2026-11-27', due_date: '2026-11-29T01:00:00.000Z' }] });
  const r = await runDeadlineRemindersForUser(f.client, PREFS, SAT_1005);
  assert.equal(r.tasksUpdated, 1);
  assert.equal(f.db.tasks.length, 1);
  assert.equal(f.db.tasks[0].due_date, '2026-11-28T19:00:00.000Z');
});

test('AC-P3: twenty live items -> exactly one tasks SELECT for the user', async () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ ...defaultDeadlineReminders()[0], id: `i${i}`, name: `Item ${i}` }));
  const f = fakeDb({ config: { deadlineReminders: items } });
  await runDeadlineRemindersForUser(f.client, PREFS, FRI_1910);
  assert.equal(f.calls.filter((c) => c === 'tasks.select').length, 1);
  assert.equal(f.db.tasks.length, 20);
  assert.equal(f.db.scheduled_notifications.length, 20);
});

test('AC-R3: an invalid stored item is reported and skipped; the valid one still nags', async () => {
  const items = [{ id: 'bad', name: 'Bad', days: [5], start: '7pm', deadline: '20:00', deadlineAfterDays: 1 }, defaultDeadlineReminders()[0]];
  const f = fakeDb({ config: { deadlineReminders: items } });
  const r = await runDeadlineRemindersForUser(f.client, PREFS, FRI_1910);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].kind, /^invalid_item:/);
  assert.equal(f.db.scheduled_notifications.length, 1);
});

test('AC-O8 / AC-N2: an Off item, or a quiet-hours run, inserts no nag (no task when Off)', async () => {
  const f = fakeDb({ config: { deadlineReminders: [{ ...defaultDeadlineReminders()[0], enabled: false }] } });
  await runDeadlineRemindersForUser(f.client, PREFS, FRI_1910);
  assert.equal(f.db.tasks.length + f.db.scheduled_notifications.length, 0);
  const g = fakeDb();
  await runDeadlineRemindersForUser(g.client, PREFS, at('2026-11-28T04:05:00Z')); // Fri 23:05, quiet
  assert.equal(g.db.scheduled_notifications.length, 0);
});

test('saved-only: NO saved deadlineReminders key -> zero tasks and zero nag rows (the seed never goes live)', async () => {
  for (const config of [{}, { activities: [] }, null, undefined]) {
    const f = fakeDb({ config });
    const r = await runDeadlineRemindersForUser(f.client, PREFS, FRI_1910);
    assert.equal(f.db.tasks.length, 0, JSON.stringify(config));
    assert.equal(f.db.scheduled_notifications.length, 0, JSON.stringify(config));
    assert.deepEqual(f.calls, ['user_scheduling_prefs.select'], 'no task query either');
    assert.deepEqual(r.errors, []);
  }
});

test('saved-only: a MALFORMED saved key (object, string, number) -> zero nag rows', async () => {
  for (const bad of [{ 0: defaultDeadlineReminders()[0] }, 'time-card', 5, true]) {
    const f = fakeDb({ config: { deadlineReminders: bad } });
    await runDeadlineRemindersForUser(f.client, PREFS, FRI_1910);
    assert.equal(f.db.scheduled_notifications.length + f.db.tasks.length, 0, JSON.stringify(bad));
  }
});

test('saved-only: a SAVED list (here the time card the Settings card showed, then saved) -> nags', async () => {
  const f = fakeDb({ config: { deadlineReminders: defaultDeadlineReminders() } });
  await runDeadlineRemindersForUser(f.client, PREFS, FRI_1910);
  assert.equal(f.db.tasks.length, 1);
  assert.equal(f.db.scheduled_notifications.length, 1);
});

test('AC-R1: a user whose stored list is empty makes no task query and no write', async () => {
  const f = fakeDb({ config: { deadlineReminders: [] } });
  await runDeadlineRemindersForUser(f.client, PREFS, FRI_1910);
  assert.deepEqual(f.calls, ['user_scheduling_prefs.select']);
});
