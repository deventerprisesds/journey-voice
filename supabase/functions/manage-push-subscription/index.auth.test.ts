// WHAT: runs the REAL manage-push-subscription handler (remote imports stubbed by the probe harness)
//       and checks WHO may register a phone (`subscribe_fcm`) and trigger the J14 cross-user dedupe.
// WHY:  C2-SEC1 / owner-approved Option A (2026-10-27): `verify_jwt = false` and `userId` comes from
//       the body, so before this anyone with the APK and a user id could replace that user's phone
//       token with their own, and delete other users' rows for a token they know.
// SUPERSEDES: nothing. SUPERSEDED-BY: nothing -- current.
// EVIDENCE: docs/qc-evidence/RESTORE-step3-j13-j14-security.md ("Fix 2 -- registration: Option A")
import test from 'node:test';
import assert from 'node:assert/strict';
import { ENV, setDb, loadHandler, post, jwtUsers, ops, type Db } from '../../../docs/qc-evidence/probes/harness.ts';

const X = '11111111-1111-4111-8111-111111111111'; // owner
const Z = '33333333-3333-4333-8333-333333333333'; // someone else
const ANON_KEY = 'public-anon-key';
const bearer = (t: string) => ({ authorization: `Bearer ${t}`, apikey: ANON_KEY });

let handler: (r: Request) => Promise<Response>;
test.before(async () => {
  jwtUsers['jwt-of-x'] = X;
  jwtUsers['jwt-of-z'] = Z;
  handler = await loadHandler('manage-push-subscription');
});
const call = async (body: unknown, h: Record<string, string>) => { const r = await handler(post(body, h)); return { status: r.status, body: await r.json() }; };

const freshDb = (): Db => ({
  push_subscriptions: [
    { id: 'x1', user_id: X, endpoint: `fcm:${X}`, fcm_token: 'owner-phone', p256dh_key: '', auth_key: '' },
    { id: 'z1', user_id: Z, endpoint: `fcm:${Z}`, fcm_token: 'shared-phone', p256dh_key: '', auth_key: '' },
  ],
  activity_log: [],
});
const writes = () => ops.filter(o => o.table === 'push_subscriptions' && o.kind !== 'select');

test('subscribe_fcm: the user\'s own JWT is accepted and replaces their phone token', async () => {
  const db = freshDb(); setDb(db);
  const r = await call({ action: 'subscribe_fcm', fcmToken: 'owner-phone-rotated', userId: X, source: 'native' }, bearer('jwt-of-x'));
  assert.equal(r.status, 200);
  assert.equal(db.push_subscriptions.find(s => s.user_id === X)!.fcm_token, 'owner-phone-rotated');
});

test('subscribe_fcm: ANOTHER user\'s valid JWT is refused with 401 and writes nothing', async () => {
  const db = freshDb(); setDb(db);
  const r = await call({ action: 'subscribe_fcm', fcmToken: 'attacker-phone', userId: X }, bearer('jwt-of-z'));
  assert.equal(r.status, 401);
  assert.equal(db.push_subscriptions.find(s => s.user_id === X)!.fcm_token, 'owner-phone');
  assert.deepEqual(writes(), []);
});

test('subscribe_fcm: the anon key as bearer is refused with 401 and writes nothing', async () => {
  const db = freshDb(); setDb(db);
  const r = await call({ action: 'subscribe_fcm', fcmToken: 'attacker-phone', userId: X }, bearer(ANON_KEY));
  assert.equal(r.status, 401);
  assert.equal(db.push_subscriptions.find(s => s.user_id === X)!.fcm_token, 'owner-phone');
  assert.deepEqual(writes(), []);
});

test('subscribe_fcm: no bearer at all is refused with 401 and writes nothing', async () => {
  const db = freshDb(); setDb(db);
  const r = await call({ action: 'subscribe_fcm', fcmToken: 'attacker-phone', userId: X }, { apikey: ANON_KEY });
  assert.equal(r.status, 401);
  assert.deepEqual(writes(), []);
});

test('subscribe_fcm: service-role key, forged JWT, key only in apikey -> 401', async () => {
  for (const h of [bearer(ENV.SUPABASE_SERVICE_ROLE_KEY), bearer('forged.jwt.value'), { apikey: 'jwt-of-x' }, { authorization: 'jwt-of-x' }]) {
    const db = freshDb(); setDb(db);
    const r = await call({ action: 'subscribe_fcm', fcmToken: 'attacker-phone', userId: X }, h);
    assert.equal(r.status, 401, JSON.stringify(h));
    assert.deepEqual(writes(), [], JSON.stringify(h));
  }
});

test('J14 dedupe: refused without a matching JWT -- another user\'s row for that token survives', async () => {
  const db = freshDb(); setDb(db);
  // Caller claims to be X and registers the token Z's phone holds; with Z's (non-matching) JWT, or the anon key.
  for (const h of [bearer('jwt-of-z'), bearer(ANON_KEY)]) {
    const r = await call({ action: 'subscribe_fcm', fcmToken: 'shared-phone', userId: X }, h);
    assert.equal(r.status, 401);
    assert.equal(db.push_subscriptions.some(s => s.user_id === Z && s.fcm_token === 'shared-phone'), true, "Z's row must not be deleted");
  }
  assert.equal(ops.some(o => o.table === 'push_subscriptions' && o.kind === 'delete'), false);
});

test('J14 dedupe: still runs for the verified owner (one device, one owner)', async () => {
  const db = freshDb(); setDb(db);
  const r = await call({ action: 'subscribe_fcm', fcmToken: 'shared-phone', userId: X }, bearer('jwt-of-x'));
  assert.equal(r.status, 200);
  assert.equal(db.push_subscriptions.find(s => s.user_id === X)!.fcm_token, 'shared-phone');
  assert.equal(db.push_subscriptions.some(s => s.user_id === Z), false);
});
