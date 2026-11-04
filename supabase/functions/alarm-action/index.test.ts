// WHAT:       runs the REAL alarm-action handler (remote imports stubbed by the probe harness) and pins
//             the two guards that decide what a phone alarm button may change: per-user scoping (a
//             token only ever touches its own user's task) and the status allow-list.
// WHY:        PR #65's body listed "alarm-action's per-user scoping and status allow-list" as NOT
//             PROVEN. The verifier's probes (docs/qc-evidence/probes/alarm-action.probe.test.ts)
//             exercised them, but that directory is not a `npm test` root, so nothing re-runs them.
//             This file is the durable copy, inside the collected supabase/functions root.
// SUPERSEDES: nothing (the probe file stays as verifier evidence). SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   docs/qc-evidence/RESTORE-step3-j13-j14.md, "Re-sync 2026-11-04" (tests + mutation table).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ENV, setDb, ops, loadHandler, post, type Db } from '../../../docs/qc-evidence/probes/harness.ts';
import { mintActionToken } from '../_shared/action-token.ts';

const X = '11111111-1111-4111-8111-111111111111';
const Y = '22222222-2222-4222-8222-222222222222';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // X's task
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // Y's task
const KEY = ENV.SUPABASE_SERVICE_ROLE_KEY;

function freshDb(): Db {
  return {
    tasks: [
      { id: A, user_id: X, status: 'TODO', tags: ['x'], start_time: '2026-11-04T09:00:00Z', end_time: '2026-11-04T10:00:00Z', is_scheduled: true },
      { id: B, user_id: Y, status: 'TODO', tags: ['y'], start_time: '2026-11-04T09:00:00Z', end_time: '2026-11-04T10:00:00Z', is_scheduled: true },
    ],
    scheduled_notifications: [
      { id: 'n1', task_id: A, notification_type: 'task_start', delivered_at: null, failed_at: null },
      { id: 'n2', task_id: B, notification_type: 'task_start', delivered_at: null, failed_at: null },
    ],
    activity_log: [],
  };
}
const snap = (db: Db) => JSON.stringify({ t: db.tasks, n: db.scheduled_notifications });
const writes = () => ops.filter(o => o.kind !== 'select' && o.table !== 'activity_log');

let handler: (r: Request) => Promise<Response>;
const call = async (body: unknown) => { const r = await handler(post(body)); return { status: r.status, body: await r.json() }; };

test.before(async () => { handler = await loadHandler('alarm-action'); });

test('AA-scope-own: a token for (X, A) sets A to DONE and leaves Y task B alone', async () => {
  const db = freshDb(); setDb(db);
  const r = await call({ op: 'set_status', token: await mintActionToken(X, A, { secret: KEY }), status: 'DONE' });
  assert.equal(r.status, 200); assert.equal(r.body.matched, 1); assert.equal(r.body.changed, true);
  assert.equal(db.tasks[0].status, 'DONE'); assert.ok(db.tasks[0].completed_at);
  assert.equal(db.tasks[1].status, 'TODO');
});

test('AA-scope-cross: a valid token for (X, B) cannot change Y task B or its queued alarms, for any status', async () => {
  const tok = await mintActionToken(X, B, { secret: KEY });
  for (const status of ['DONE', 'DOING', 'BACKLOG', 'PARK']) {
    const db = freshDb(); setDb(db); const before = snap(db);
    const r = await call({ op: 'set_status', token: tok, status });
    assert.equal(r.status, 200, status); assert.equal(r.body.matched, 0, status); assert.equal(r.body.changed, false, status);
    assert.equal(snap(db), before, `${status}: B and its scheduled_notifications untouched`);
    assert.equal(writes().length, 0, `${status}: no update/delete issued`);
  }
});

test('AA-scope-write-filter: the task UPDATE itself is filtered by both id and user_id', async () => {
  const db = freshDb(); setDb(db);
  await call({ op: 'set_status', token: await mintActionToken(X, A, { secret: KEY }), status: 'DOING' });
  const upd = ops.find(o => o.kind === 'update' && o.table === 'tasks');
  assert.ok(upd, 'an update was issued');
  assert.deepEqual(upd!.filters, [['eq', 'id', A], ['eq', 'user_id', X]]);
});

test('AA-scope-body: userId / taskId in the request body cannot override the token claims', async () => {
  const db = freshDb(); setDb(db);
  const r = await call({ op: 'set_status', token: await mintActionToken(X, A, { secret: KEY }), status: 'DONE', taskId: B, userId: Y, user_id: Y, id: B });
  assert.equal(r.body.matched, 1);
  assert.equal(db.tasks[0].status, 'DONE'); assert.equal(db.tasks[1].status, 'TODO');
});

test('AA-allow-reject: a status outside DOING/DONE/BACKLOG/PARK is refused 400 before any DB call', async () => {
  const tok = await mintActionToken(X, A, { secret: KEY });
  for (const status of ['IN_PROGRESS', 'TODO', 'COMPLETED', 'CANCELLED', 'ARCHIVED', '', ' DONE', 'DONE ', "DONE'--", '__proto__', null, 1]) {
    const db = freshDb(); setDb(db); const before = snap(db);
    const r = await call({ op: 'set_status', token: tok, status });
    assert.equal(r.status, 400, `status ${JSON.stringify(status)}`); assert.equal(r.body.reason, 'bad_status');
    assert.equal(snap(db), before); assert.equal(ops.length, 0, 'no DB call at all');
  }
});

test('AA-allow-accept: each allowed status, in any case, writes the expected task status', async () => {
  const tok = await mintActionToken(X, A, { secret: KEY });
  const written: Record<string, string> = {};
  for (const status of ['done', 'Doing', 'BACKLOG', 'park']) {
    const db = freshDb(); setDb(db);
    const r = await call({ op: 'set_status', token: tok, status });
    assert.equal(r.status, 200, status); written[status] = db.tasks[0].status;
  }
  assert.deepEqual(written, { done: 'DONE', Doing: 'DOING', BACKLOG: 'BACKLOG', park: 'BACKLOG' });
});
