// WHAT: probes of manage-push-subscription `subscribe_fcm` (REAL handler, remote imports stubbed),
//       pinning what registration does TODAY. Registration auth was NOT enforced (see the record).
// WHY:  C2-SEC1: subscribe_fcm trusts body.userId. Enforcing a JWT would break the Android native
//       registrar (FcmRegistrar.kt:34 sends the anon key), so the owner decides. These probes make the
//       open gap explicit instead of silent; the `todo` is the test to turn on once it is enforced.
// SUPERSEDES: nothing. SUPERSEDED-BY: nothing -- current.
// EVIDENCE: docs/qc-evidence/RESTORE-step3-j13-j14-security.md ("Left for the owner").
// RUN: node --experimental-strip-types --test docs/qc-evidence/probes/push-auth.probe.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { setDb, loadHandler, post, type Db } from './harness.ts';

const X = '11111111-1111-4111-8111-111111111111'; // owner
const Z = '33333333-3333-4333-8333-333333333333'; // attacker
const ANON = { authorization: 'Bearer public-anon-key', apikey: 'public-anon-key' };

let handler: (r: Request) => Promise<Response>;
test.before(async () => { handler = await loadHandler('manage-push-subscription'); });
const call = async (body: unknown, h = ANON) => { const r = await handler(post(body, h)); return { status: r.status, body: await r.json() }; };

const freshDb = (): Db => ({
  push_subscriptions: [
    { id: 'x1', user_id: X, endpoint: `fcm:${X}`, fcm_token: 'owner-phone', p256dh_key: '', auth_key: '' },
    { id: 'z1', user_id: Z, endpoint: `fcm:${Z}`, fcm_token: 'attacker-phone', p256dh_key: '', auth_key: '' },
  ],
  activity_log: [],
});

test('own-user subscribe_fcm (as the Android native registrar sends it, anon key) is accepted', async () => {
  const db = freshDb(); setDb(db);
  const r = await call({ action: 'subscribe_fcm', fcmToken: 'owner-phone-rotated', userId: X, source: 'native' });
  assert.equal(r.status, 200);
  assert.equal(db.push_subscriptions.find(s => s.user_id === X)!.fcm_token, 'owner-phone-rotated');
});

test('KNOWN GAP (owner decision): cross-user subscribe_fcm is ACCEPTED and takes over the owner\'s FCM row', async () => {
  const db = freshDb(); setDb(db);
  const r = await call({ action: 'subscribe_fcm', fcmToken: 'attacker-phone', userId: X });
  assert.equal(r.status, 200, 'still accepted: registration auth is not enforced');
  assert.equal(db.push_subscriptions.find(s => s.user_id === X)!.fcm_token, 'attacker-phone', "owner's journey FCM row now points at the attacker's device");
  assert.equal(db.push_subscriptions.some(s => s.user_id === Z), false, "J14 dedupe deleted the attacker's own row -- and would delete ANY other user's row for a token the caller knows");
});

test.todo('cross-user subscribe_fcm is refused with 401 (turn on when the owner picks an enforcement option)');
