// WHAT: runs the REAL execute-tool handler (remote imports stubbed by the probe harness) and checks
//       WHO may call `register_push_token` -- the second route that adds a device to a user's pushes.
// WHY:  Option A (owner, 2026-10-27): `verify_jwt = false` with `userId` from the body let anyone add
//       their phone to another user's alarm pushes. Allowed: the service-role key (huddle-proxy, which
//       has already checked JOURNEY_PROXY_TOKEN and resolved the user) or the user's own login.
// SUPERSEDES: nothing. SUPERSEDED-BY: nothing -- current.
// EVIDENCE: docs/qc-evidence/RESTORE-step3-j13-j14-security.md ("Fix 2 -- registration: Option A")
import test from 'node:test';
import assert from 'node:assert/strict';
import { ENV, setDb, loadHandler, post, jwtUsers, ops, type Db } from '../../../docs/qc-evidence/probes/harness.ts';

const X = '11111111-1111-4111-8111-111111111111';
const Z = '33333333-3333-4333-8333-333333333333';
const ANON_KEY = 'public-anon-key';
const bearer = (t: string) => ({ authorization: `Bearer ${t}`, apikey: ANON_KEY });
const body = { toolName: 'register_push_token', userId: X, args: { fcm_token: 'some-phone-token-0123456789abcdef', app: 'huddle' } };

let handler: (r: Request) => Promise<Response>;
test.before(async () => {
  jwtUsers['jwt-of-x'] = X;
  jwtUsers['jwt-of-z'] = Z;
  handler = await loadHandler('execute-tool');
});
const call = async (b: unknown, h: Record<string, string>) => { const r = await handler(post(b, h)); return { status: r.status, body: await r.json() }; };
const freshDb = (): Db => ({ push_subscriptions: [] });
const upserts = () => ops.filter(o => o.table === 'push_subscriptions' && o.kind === 'upsert');

test('register_push_token: service-role caller (huddle-proxy) registers the device', async () => {
  const db = freshDb(); setDb(db);
  const r = await call(body, bearer(ENV.SUPABASE_SERVICE_ROLE_KEY));
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  assert.equal(db.push_subscriptions.length, 1);
  assert.equal(db.push_subscriptions[0].user_id, X);
});

test('register_push_token: the user\'s own JWT registers the device', async () => {
  const db = freshDb(); setDb(db);
  const r = await call(body, bearer('jwt-of-x'));
  assert.equal(r.status, 200);
  assert.equal(db.push_subscriptions.length, 1);
});

test('register_push_token: another user\'s JWT, the anon key, no bearer -> 401, nothing written', async () => {
  for (const h of [bearer('jwt-of-z'), bearer(ANON_KEY), { apikey: ANON_KEY }, bearer('forged.jwt')]) {
    const db = freshDb(); setDb(db);
    const r = await call(body, h);
    assert.equal(r.status, 401, JSON.stringify(h));
    assert.equal(r.body.success, false);
    assert.deepEqual(upserts(), [], JSON.stringify(h));
    assert.equal(db.push_subscriptions.length, 0);
  }
});

test('the gate is scoped to register_push_token: other tools are not newly refused', async () => {
  setDb({ tasks: [] });
  const r = await call({ toolName: 'no_such_tool_for_probe', userId: X, args: {} }, bearer(ANON_KEY));
  assert.notEqual(r.status, 401);
});
