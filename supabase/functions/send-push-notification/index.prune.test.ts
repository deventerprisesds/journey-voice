// WHAT:       runs the REAL send-push-notification handler (remote imports stubbed by the probe harness)
//             with FCM's HTTP response faked per device token, and pins the J14 prune: only a row FCM
//             rejects with 404 + UNREGISTERED is deleted, only that one row, and the deletion is logged.
// WHY:        PR #65's body listed "the UNREGISTERED prune match" as NOT PROVEN -- no test exercised it.
//             A prune that over-matches deletes live phone registrations (the user's alarms stop on that
//             phone); one with no row filter deletes every registration in the table.
// SUPERSEDES: nothing. SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   docs/qc-evidence/RESTORE-step3-j13-j14.md, "Re-sync 2026-11-04" (tests + mutation table).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ENV, setDb, loadHandler, post, captureConsole, type Db } from '../../../docs/qc-evidence/probes/harness.ts';

const X = '11111111-1111-4111-8111-111111111111';
const Y = '22222222-2222-4222-8222-222222222222';
const SERVICE = { authorization: `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}` };

// The body FCM v1 returns for an app install that no longer exists (documented FcmError shape).
const UNREGISTERED_BODY = JSON.stringify({ error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND',
  details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } });
// A 404 that is NOT an unregistered token (e.g. a wrong project id): the token may be fine.
const NOT_FOUND_BODY = JSON.stringify({ error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' } });
// A transient server error that happens to echo the word: must never cost a registration.
const UNAVAILABLE_BODY = JSON.stringify({ error: { code: 503, message: 'UNREGISTERED check unavailable, retry', status: 'UNAVAILABLE' } });

/** device token -> [http status, body] FCM answers with. Anything not listed gets 200. */
const fcmAnswer: Record<string, [number, string]> = {};

function freshDb(): Db {
  return {
    push_subscriptions: [
      { id: 'dead', user_id: X, endpoint: `fcm:${X}`, fcm_token: 'dead-token', p256dh_key: '', auth_key: '' },
      { id: 'live', user_id: X, endpoint: `fcm:app:huddle:${X}`, fcm_token: 'live-token', p256dh_key: '', auth_key: '' },
      { id: 'web', user_id: X, endpoint: 'https://web.push/x', fcm_token: null, p256dh_key: 'p', auth_key: 'a' },
      { id: 'other', user_id: Y, endpoint: `fcm:${Y}`, fcm_token: 'y-token', p256dh_key: '', auth_key: '' },
    ],
    activity_log: [],
  };
}

let handler: (r: Request) => Promise<Response>;

test.before(async () => {
  const kp = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...pkcs8))}\n-----END PRIVATE KEY-----\n`;
  ENV.FIREBASE_SERVICE_ACCOUNT_KEY = JSON.stringify({ client_email: 'sa@probe', token_uri: 'https://oauth.probe/token', project_id: 'probe', private_key: pem });
  ENV.VAPID_PUBLIC_KEY = 'vp'; ENV.VAPID_PRIVATE_KEY = 'vk';
  (globalThis as any).fetch = async (url: string, init: any) => {
    if (url === 'https://oauth.probe/token') return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
    if (String(url).startsWith('https://fcm.googleapis.com/')) {
      const tok = JSON.parse(init.body).message.token;
      const [status, body] = fcmAnswer[tok] ?? [200, '{}'];
      return new Response(body, { status });
    }
    throw new Error('unexpected fetch ' + url);
  };
  handler = await loadHandler('send-push-notification');
});

async function sendTo(db: Db, answers: Record<string, [number, string]>) {
  for (const k of Object.keys(fcmAnswer)) delete fcmAnswer[k];
  Object.assign(fcmAnswer, answers);
  setDb(db);
  const { value: r } = await captureConsole(() => handler(post({ userId: X, title: 't', body: 'b', channel: 'calendar_events' }, SERVICE)));
  assert.equal(r.status, 200);
  return { ids: db.push_subscriptions.map(s => s.id).sort(), pruned: db.activity_log.filter(a => a.activity_type === 'fcm_token_pruned') };
}

test('PR-unregistered: a 404 UNREGISTERED row is deleted and logged fcm_token_pruned', async () => {
  const db = freshDb();
  const r = await sendTo(db, { 'dead-token': [404, UNREGISTERED_BODY] });
  assert.ok(!r.ids.includes('dead'), 'the dead row is gone');
  assert.equal(r.pruned.length, 1);
  assert.equal(r.pruned[0].user_id, X);
  assert.equal(r.pruned[0].metadata.token_prefix, 'dead-token');
});

test('PR-only-that-row: pruning one dead token keeps every other registration (same user and other users)', async () => {
  const db = freshDb();
  const r = await sendTo(db, { 'dead-token': [404, UNREGISTERED_BODY] });
  assert.deepEqual(r.ids, ['live', 'other', 'web']);
});

test('PR-404-not-unregistered: a 404 without UNREGISTERED keeps the row', async () => {
  const db = freshDb();
  const r = await sendTo(db, { 'dead-token': [404, NOT_FOUND_BODY] });
  assert.ok(r.ids.includes('dead')); assert.equal(r.pruned.length, 0);
});

test('PR-transient: a non-404 failure keeps the row even when its body mentions UNREGISTERED', async () => {
  const db = freshDb();
  const r = await sendTo(db, { 'dead-token': [503, UNAVAILABLE_BODY] });
  assert.ok(r.ids.includes('dead')); assert.equal(r.pruned.length, 0);
});

test('PR-success: a delivered push deletes nothing', async () => {
  const db = freshDb();
  const r = await sendTo(db, {});
  assert.deepEqual(r.ids, ['dead', 'live', 'other', 'web']); assert.equal(r.pruned.length, 0);
});
