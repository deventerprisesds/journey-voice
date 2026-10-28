// WHAT: probes of alarm-action op "feedback" (phone alarm thumbs up/down + note) running the REAL handler.
// WHY:  Feedback is the owner's record of how alarmed items were scheduled; a retry must not duplicate it,
//       a token must only ever file feedback for its own user and task, and junk must be refused.
// SUPERSEDES: nothing. SUPERSEDED-BY: nothing -- current.
// EVIDENCE: supabase/functions/alarm-action/index.ts (op "feedback").
// RUN: node --experimental-strip-types --test docs/qc-evidence/probes/alarm-feedback.probe.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { ENV, setDb, loadHandler, post, type Db } from './harness.ts';
import { mintActionToken } from '../../../supabase/functions/_shared/action-token.ts';

const X = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const KEY = ENV.SUPABASE_SERVICE_ROLE_KEY;

const freshDb = (): Db => ({ tasks: [{ id: A, user_id: X, status: 'TODO' }], activity_log: [] });
const feedbackRows = (db: Db) => db.activity_log.filter(r => r.activity_type === 'alarm_feedback');

let handler: (r: Request) => Promise<Response>;
const call = async (body: unknown) => { const r = await handler(post(body)); return { status: r.status, body: await r.json() }; };

test.before(async () => { handler = await loadHandler('alarm-action'); });

test('thumbs down + note is stored once, scoped to the token user and task', async () => {
  const db = freshDb(); setDb(db);
  const token = await mintActionToken(X, A, { secret: KEY });
  const r = await call({
    op: 'feedback', token, feedbackId: 'fb-1', rating: 'down', note: '  Too early, put this after lunch  ',
    feedbackAt: 1761580000000,
    alarm: { tag: 'alarm-x', title: 'Gym', scheduledFor: '2026-10-27T09:00:00-04:00', firedAt: 1761579000000, taskId: 'ignored' },
  });
  assert.equal(r.status, 200); assert.deepEqual(r.body, { ok: true, saved: true, duplicate: false });
  const rows = feedbackRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, X);
  assert.equal(rows[0].status, 'completed');
  assert.equal(rows[0].metadata.taskId, A, 'task comes from the token, never the body');
  assert.equal(rows[0].metadata.rating, 'down');
  assert.equal(rows[0].metadata.note, 'Too early, put this after lunch');
  assert.equal(rows[0].metadata.alarm.title, 'Gym');
  assert.equal(rows[0].metadata.alarm.firedAt, 1761579000000);
  assert.equal(rows[0].metadata.alarm.taskId, undefined, 'only listed alarm fields are kept');
});

test('a retry with the same feedbackId does not add a second row', async () => {
  const db = freshDb(); setDb(db);
  const token = await mintActionToken(X, A, { secret: KEY });
  const body = { op: 'feedback', token, feedbackId: 'fb-2', rating: 'up' };
  assert.equal((await call(body)).body.duplicate, false);
  const again = await call(body);
  assert.equal(again.status, 200); assert.equal(again.body.duplicate, true);
  assert.equal(feedbackRows(db).length, 1);
});

test('a note alone (no thumbs) is accepted; neither is refused', async () => {
  const db = freshDb(); setDb(db);
  const token = await mintActionToken(X, A, { secret: KEY });
  assert.equal((await call({ op: 'feedback', token, feedbackId: 'fb-3', note: 'move to evenings' })).status, 200);
  assert.equal(feedbackRows(db)[0].metadata.rating, null);
  const empty = await call({ op: 'feedback', token, feedbackId: 'fb-4', note: '   ' });
  assert.equal(empty.status, 400); assert.equal(empty.body.reason, 'empty_feedback');
  assert.equal(feedbackRows(db).length, 1);
});

test('bad rating, missing id and forged token are refused without writing', async () => {
  const db = freshDb(); setDb(db);
  const token = await mintActionToken(X, A, { secret: KEY });
  assert.equal((await call({ op: 'feedback', token, feedbackId: 'fb-5', rating: 'meh' })).body.reason, 'bad_rating');
  assert.equal((await call({ op: 'feedback', token, rating: 'up' })).body.reason, 'bad_feedback_id');
  const forged = await mintActionToken(X, A, { secret: 'not-the-key' });
  const r = await call({ op: 'feedback', token: forged, feedbackId: 'fb-6', rating: 'up' });
  assert.equal(r.status, 401); assert.equal(r.body.reason, 'bad_token');
  assert.equal(feedbackRows(db).length, 0);
});

test('a token expired a few days ago still files feedback (it waited in the phone queue)', async () => {
  const db = freshDb(); setDb(db);
  const token = await mintActionToken(X, A, { secret: KEY, ttlSec: -3 * 24 * 60 * 60 });
  const r = await call({ op: 'feedback', token, feedbackId: 'fb-7', rating: 'up' });
  assert.equal(r.status, 200); assert.equal(feedbackRows(db).length, 1);
});

test('an over-long note is capped at 2000 chars', async () => {
  const db = freshDb(); setDb(db);
  const token = await mintActionToken(X, A, { secret: KEY });
  await call({ op: 'feedback', token, feedbackId: 'fb-8', note: 'x'.repeat(5000) });
  assert.equal(feedbackRows(db)[0].metadata.note.length, 2000);
});
