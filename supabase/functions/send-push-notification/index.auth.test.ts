// WHAT: runs the REAL send-push-notification handler (remote imports stubbed by the probe harness)
//       and checks WHEN it puts an alarm action token into the FCM push.
// WHY:  C2-SEC1 (docs/qc-evidence/VERIFY-restore-j13-alarm-actions-1.md): userId and taskId both come
//       from the body of an unauthenticated POST, so a token could be minted for another user's task,
//       or by any caller at all. A token must ride a push only for the push's own user's task.
// SUPERSEDES: nothing. SUPERSEDED-BY: nothing -- current.
// EVIDENCE: docs/qc-evidence/RESTORE-step3-j13-j14-security.md
import test from 'node:test';
import assert from 'node:assert/strict';
import { ENV, setDb, loadHandler, post, captureConsole, type Db } from '../../../docs/qc-evidence/probes/harness.ts';
import { verifyActionToken } from '../_shared/action-token.ts';

const X = '11111111-1111-4111-8111-111111111111';
const Y = '22222222-2222-4222-8222-222222222222';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // X's task
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // Y's task
const GONE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; // no such task
const SERVICE = { authorization: `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}` };

function freshDb(): Db {
  return {
    tasks: [{ id: A, user_id: X, status: 'TODO' }, { id: B, user_id: Y, status: 'TODO' }],
    push_subscriptions: [
      { id: 's1', user_id: X, endpoint: `fcm:${X}`, fcm_token: 'device-token-of-x', p256dh_key: '', auth_key: '' },
      { id: 's2', user_id: X, endpoint: 'https://web.push/x', fcm_token: null, p256dh_key: 'p', auth_key: 'a' },
    ],
    activity_log: [],
  };
}

const fcmSent: any[] = [];
let handler: (r: Request) => Promise<Response>;

test.before(async () => {
  // A real RSA key so send-push's own FCM JWT signing runs; fetch is stubbed so nothing leaves the box.
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
    if (String(url).startsWith('https://fcm.googleapis.com/')) { fcmSent.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); }
    throw new Error('unexpected fetch ' + url);
  };
  handler = await loadHandler('send-push-notification');
});

async function send(body: unknown, headers: Record<string, string> = SERVICE) {
  fcmSent.length = 0; (globalThis as any).__webpush.sent.length = 0;
  const { value: r, text } = await captureConsole(() => handler(post(body, headers)));
  return { status: r.status, body: await r.json(), fcm: fcmSent.map(m => m.message.data), web: [...(globalThis as any).__webpush.sent], log: text };
}

test('own task: the FCM push carries a token for exactly (userId, taskId)', async () => {
  setDb(freshDb());
  const r = await send({ userId: X, title: 't', body: 'b', channel: 'calendar_events', data: { type: 'alarm', taskId: A } });
  assert.equal(r.status, 200); assert.equal(r.body.delivered, 2);
  assert.equal(r.fcm.length, 1);
  const v = await verifyActionToken(r.fcm[0].actionToken, { secret: ENV.SUPABASE_SERVICE_ROLE_KEY });
  assert.ok(v, 'token verifies'); assert.equal(v!.userId, X); assert.equal(v!.taskId, A);
  assert.equal(r.fcm[0].actionUrl, 'https://proj.supabase.co/functions/v1/alarm-action');
  assert.ok(!r.web[0].payload.includes(r.fcm[0].actionToken), 'never in the web payload');
  assert.ok(!r.log.includes(r.fcm[0].actionToken), 'never logged');
});

test("another user's task: push still delivered, NO token minted", async () => {
  setDb(freshDb());
  const r = await send({ userId: X, title: 't', body: 'b', channel: 'calendar_events', data: { type: 'alarm', taskId: B } });
  assert.equal(r.status, 200); assert.equal(r.body.delivered, 2, 'delivery is not blocked');
  assert.equal(r.fcm.length, 1);
  assert.equal(r.fcm[0].actionToken, undefined); assert.equal(r.fcm[0].actionUrl, undefined);
  assert.equal(r.fcm[0].taskId, B, 'taskId itself is passed through unchanged');
  assert.match(r.log, /action token not minted: task does not belong to userId/);
});

test('task that does not exist: NO token minted', async () => {
  setDb(freshDb());
  const r = await send({ userId: X, title: 't', body: 'b', data: { type: 'alarm', taskId: GONE } });
  assert.equal(r.body.delivered, 2); assert.equal(r.fcm[0].actionToken, undefined);
});

test('no / non-uuid taskId: no token and no task read (unchanged)', async () => {
  for (const taskId of [undefined, '', 'not-a-uuid']) {
    setDb(freshDb());
    const r = await send({ userId: X, title: 't', body: 'b', data: { type: 'reminder', taskId } });
    assert.equal(r.body.delivered, 2); assert.equal(r.fcm[0].actionToken, undefined);
  }
});
