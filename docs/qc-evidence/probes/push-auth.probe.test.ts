// WHAT: probes of manage-push-subscription `subscribe_fcm` (REAL handler, remote imports stubbed),
//       pinning who may register a phone.
// WHY:  C2-SEC1: subscribe_fcm trusted body.userId. The owner chose Option A (2026-10-27): the Android
//       native registrar sends the user's session token from APK 1.0.13, and the server refuses any
//       registration whose bearer is not that user's login. The former KNOWN GAP probe is now a real
//       assertion; the `todo` is gone. Handler tests: supabase/functions/manage-push-subscription/index.auth.test.ts.
// SUPERSEDES: nothing. SUPERSEDED-BY: nothing -- current.
// EVIDENCE: docs/qc-evidence/RESTORE-step3-j13-j14-security.md ("Left for the owner").
// RUN: node --experimental-strip-types --test docs/qc-evidence/probes/push-auth.probe.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { setDb, loadHandler, post, jwtUsers, type Db } from './harness.ts';

const X = '11111111-1111-4111-8111-111111111111'; // owner
const Z = '33333333-3333-4333-8333-333333333333'; // attacker
const ANON = { authorization: 'Bearer public-anon-key', apikey: 'public-anon-key' };
const OWNER_JWT = { authorization: 'Bearer probe-jwt-x', apikey: 'public-anon-key' };
const ATTACKER_JWT = { authorization: 'Bearer probe-jwt-z', apikey: 'public-anon-key' };

let handler: (r: Request) => Promise<Response>;
test.before(async () => { jwtUsers['probe-jwt-x'] = X; jwtUsers['probe-jwt-z'] = Z; handler = await loadHandler('manage-push-subscription'); });
const call = async (body: unknown, h = ANON) => { const r = await handler(post(body, h)); return { status: r.status, body: await r.json() }; };

const freshDb = (): Db => ({
  push_subscriptions: [
    { id: 'x1', user_id: X, endpoint: `fcm:${X}`, fcm_token: 'owner-phone', p256dh_key: '', auth_key: '' },
    { id: 'z1', user_id: Z, endpoint: `fcm:${Z}`, fcm_token: 'attacker-phone', p256dh_key: '', auth_key: '' },
  ],
  activity_log: [],
});

test('own-user subscribe_fcm with the user\'s own JWT (Android native >= 1.0.13, web app) is accepted', async () => {
  const db = freshDb(); setDb(db);
  const r = await call({ action: 'subscribe_fcm', fcmToken: 'owner-phone-rotated', userId: X, source: 'native' }, OWNER_JWT);
  assert.equal(r.status, 200);
  assert.equal(db.push_subscriptions.find(s => s.user_id === X)!.fcm_token, 'owner-phone-rotated');
});

test('subscribe_fcm with only the anon key (as the Android native registrar sent it before 1.0.13) is refused with 401', async () => {
  const db = freshDb(); setDb(db);
  const r = await call({ action: 'subscribe_fcm', fcmToken: 'owner-phone-rotated', userId: X, source: 'native' });
  assert.equal(r.status, 401);
  assert.equal(db.push_subscriptions.find(s => s.user_id === X)!.fcm_token, 'owner-phone');
});

test('cross-user subscribe_fcm is refused with 401: the owner\'s FCM row and the other user\'s row are untouched', async () => {
  for (const h of [ANON, ATTACKER_JWT]) {
    const db = freshDb(); setDb(db);
    const r = await call({ action: 'subscribe_fcm', fcmToken: 'attacker-phone', userId: X }, h);
    assert.equal(r.status, 401);
    assert.equal(db.push_subscriptions.find(s => s.user_id === X)!.fcm_token, 'owner-phone', "owner's FCM row still points at the owner's device");
    assert.equal(db.push_subscriptions.some(s => s.user_id === Z), true, "J14 dedupe did not run for an unverified caller");
  }
});
