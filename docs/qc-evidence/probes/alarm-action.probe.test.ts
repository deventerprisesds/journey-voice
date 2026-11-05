// WHAT: adversarial probes of alarm-action + _shared/action-token.ts running the REAL handler source.
// WHY:  C2 of VERIFY-restore-j13-alarm-actions-1: user/task scoping, forgery, expiry, allow-list, logging.
// SUPERSEDES: nothing. SUPERSEDED-BY: nothing -- current.
// EVIDENCE: docs/qc-evidence/VERIFY-restore-j13-alarm-actions-1.md (C2).
// RUN: node --experimental-strip-types --test docs/qc-evidence/probes/alarm-action.probe.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENV, ROOT, setDb, ops, loadHandler, post, captureConsole, type Db } from './harness.ts';
import { mintActionToken, verifyActionToken, b64urlEncode, b64urlDecode } from '../../../supabase/functions/_shared/action-token.ts';

const X = '11111111-1111-4111-8111-111111111111';
const Y = '22222222-2222-4222-8222-222222222222';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // X's task
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // Y's task
const KEY = ENV.SUPABASE_SERVICE_ROLE_KEY;
const now = () => Math.floor(Date.now() / 1000);

function freshDb(): Db {
  return {
    tasks: [
      { id: A, user_id: X, status: 'TODO', tags: ['x'], start_time: '2026-10-27T09:00:00Z', end_time: '2026-10-27T10:00:00Z', is_scheduled: true },
      { id: B, user_id: Y, status: 'TODO', tags: ['y'], start_time: '2026-10-27T09:00:00Z', end_time: '2026-10-27T10:00:00Z', is_scheduled: true },
    ],
    scheduled_notifications: [
      { id: 'n1', task_id: A, notification_type: 'task_start', delivered_at: null, failed_at: null },
      { id: 'n2', task_id: B, notification_type: 'task_start', delivered_at: null, failed_at: null },
    ],
    activity_log: [],
  };
}
const snap = (db: Db) => JSON.stringify({ t: db.tasks, n: db.scheduled_notifications });

let handler: (r: Request) => Promise<Response>;
const call = async (body: unknown) => { const r = await handler(post(body)); return { status: r.status, body: await r.json() }; };
const writes = () => ops.filter(o => o.kind !== 'select' && o.table !== 'activity_log');

test.before(async () => { handler = await loadHandler('alarm-action'); });

test('C2a: token (X,A) DONE changes A only, scoped by id AND user_id', async () => {
  const db = freshDb(); setDb(db);
  const tok = await mintActionToken(X, A, { secret: KEY });
  const r = await call({ op: 'set_status', token: tok, status: 'DONE' });
  assert.equal(r.status, 200); assert.equal(r.body.matched, 1); assert.equal(r.body.changed, true);
  assert.equal(db.tasks[0].status, 'DONE'); assert.ok(db.tasks[0].completed_at);
  assert.equal(db.tasks[1].status, 'TODO');
  const upd = ops.find(o => o.kind === 'update' && o.table === 'tasks')!;
  assert.deepEqual(upd.filters, [['eq', 'id', A], ['eq', 'user_id', X]]);
});

test('C2a: a validly-signed token (X,B) where B belongs to Y cannot touch B (matched 0, no write)', async () => {
  const db = freshDb(); setDb(db); const before = snap(db);
  const tok = await mintActionToken(X, B, { secret: KEY });
  for (const status of ['DONE', 'BACKLOG', 'PARK', 'DOING']) {
    const r = await call({ op: 'set_status', token: tok, status });
    assert.equal(r.status, 200); assert.equal(r.body.matched, 0); assert.equal(r.body.changed, false);
  }
  assert.equal(snap(db), before, 'Y task and its scheduled_notifications untouched');
  assert.equal(writes().length, 0, 'no update/delete issued for B');
});

test('C2a: token (Y,A) cannot touch X task A', async () => {
  const db = freshDb(); setDb(db); const before = snap(db);
  const tok = await mintActionToken(Y, A, { secret: KEY });
  const r = await call({ op: 'set_status', token: tok, status: 'PARK' });
  assert.equal(r.body.matched, 0); assert.equal(snap(db), before); assert.equal(writes().length, 0);
});

test('C2a: body fields cannot override the token claims (userId/taskId in the body are ignored)', async () => {
  const db = freshDb(); setDb(db);
  const tok = await mintActionToken(X, A, { secret: KEY });
  const r = await call({ op: 'set_status', token: tok, status: 'DONE', taskId: B, userId: Y, user_id: Y, id: B });
  assert.equal(r.body.matched, 1); assert.equal(db.tasks[1].status, 'TODO'); assert.equal(db.tasks[0].status, 'DONE');
});

test('C2b: forged / unsigned / malformed tokens are rejected 401 with no DB write', async () => {
  const good = await mintActionToken(X, A, { secret: KEY });
  const [p, body, sig] = good.split('.');
  const forgedBody = b64urlEncode(new TextEncoder().encode(JSON.stringify({ u: Y, t: B, exp: now() + 999 })));
  const sigBytes = b64urlDecode(sig); sigBytes[0] ^= 1;
  const rawKeySig = await (async () => { // signed with the RAW service key (no domain separation)
    const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return b64urlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`v1.${body}`))));
  })();
  const cases: unknown[] = [
    `${p}.${forgedBody}.${sig}`, `${p}.${body}.`, `${p}.${body}`, `${p}.${body}.${b64urlEncode(sigBytes)}`,
    `v2.${body}.${sig}`, `V1.${body}.${sig}`, `${p}.${body}.${sig}.extra`, `${p}.${body}.!!!`,
    `${p}.${body}.${rawKeySig}`, '', 'garbage', null, undefined, 123, {}, [], ['v1', body, sig], { toString: () => good },
    await mintActionToken(X, A, { secret: 'other' }),
    good.slice(0, -1), ' ' + good,
  ];
  for (const token of cases) {
    const db = freshDb(); setDb(db); const before = snap(db);
    const r = await call({ op: 'set_status', token, status: 'DONE' });
    assert.equal(r.status, 401, `token ${JSON.stringify(String(token)).slice(0, 60)} -> ${r.status} ${JSON.stringify(r.body)}`);
    assert.equal(r.body.ok, false);
    assert.equal(snap(db), before); assert.equal(writes().length, 0);
    const t = await call({ op: 'trace', token, lines: ['x'] });
    assert.equal(t.status, 401, 'trace also rejects ' + String(token).slice(0, 40));
  }
});

test('C2b: signature compare uses crypto.subtle.verify (no JS string/byte equality on the MAC)', () => {
  const src = readFileSync(resolve(ROOT, 'supabase/functions/_shared/action-token.ts'), 'utf8');
  assert.match(src, /crypto\.subtle\.verify\("HMAC", key, sig,/);
  assert.doesNotMatch(src, /sig\w*\s*===|===\s*sig|timingSafe|\.every\(/);
});

test('C2c: expiry — set_status rejects any expired token (401 "expired"), even 1s late', async () => {
  for (const ageSec of [1, 3600, 6 * 86400, 29 * 86400]) {
    const db = freshDb(); setDb(db); const before = snap(db);
    const tok = await mintActionToken(X, A, { secret: KEY, nowSec: now() - 7 * 86400 - ageSec });
    const r = await call({ op: 'set_status', token: tok, status: 'DONE' });
    assert.equal(r.status, 401); assert.equal(r.body.reason, 'expired'); assert.equal(snap(db), before);
  }
  const db = freshDb(); setDb(db);
  const old = await mintActionToken(X, A, { secret: KEY, nowSec: now() - 40 * 86400 });
  const r = await call({ op: 'set_status', token: old, status: 'DONE' });
  assert.equal(r.status, 401); assert.equal(r.body.reason, 'bad_token');
});

test('C2c (observation): trace op accepts a token up to 30 days past expiry and writes up to 20 attacker-chosen lines per call', async () => {
  const db = freshDb(); setDb(db);
  const tok = await mintActionToken(X, A, { secret: KEY, nowSec: now() - 7 * 86400 - 20 * 86400 });
  const r = await call({ op: 'trace', token: tok, lines: Array.from({ length: 50 }, (_, i) => 'L' + i + 'x'.repeat(900)) });
  assert.equal(r.status, 200); assert.equal(r.body.written, 20);
  assert.ok(db.activity_log.every(l => l.user_id === X && l.metadata.message.length === 500));
});

test('C2d: key derivation — token MAC is HMAC(HMAC(serviceKey,label), msg), not HMAC(serviceKey, msg)', async () => {
  const enc = new TextEncoder();
  const tok = await mintActionToken(X, A, { secret: KEY, nowSec: 1_800_000_000 });
  const [p, body, sig] = tok.split('.');
  const root = await crypto.subtle.importKey('raw', enc.encode(KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const derived = new Uint8Array(await crypto.subtle.sign('HMAC', root, enc.encode('journey/alarm-action/v1')));
  const dk = await crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expect = b64urlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', dk, enc.encode(`${p}.${body}`))));
  assert.equal(sig, expect);
  const raw = b64urlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', root, enc.encode(`${p}.${body}`))));
  assert.notEqual(sig, raw);
  // key cache is keyed on the root secret: switching secret must not reuse the old key
  const t2 = await mintActionToken(X, A, { secret: 'k2', nowSec: 1_800_000_000 });
  assert.notEqual(t2.split('.')[2], sig);
  assert.equal(await verifyActionToken(tok, { secret: 'k2', nowSec: 1_800_000_000 }), null);
  assert.ok(await verifyActionToken(tok, { secret: KEY, nowSec: 1_800_000_000 }));
});

test('C2d: an empty service key refuses to mint/verify (no empty-key HMAC)', async () => {
  const saved = ENV.SUPABASE_SERVICE_ROLE_KEY; ENV.SUPABASE_SERVICE_ROLE_KEY = '';
  try {
    await assert.rejects(() => mintActionToken(X, A));
    await assert.rejects(() => verifyActionToken('v1.e30.' + 'A'.repeat(43))); // well-formed shape reaches signingKey()
    setDb(freshDb());
    const r = await call({ op: 'set_status', token: 'v1.e30.' + 'A'.repeat(43), status: 'DONE' });
    assert.equal(r.status, 500); // throws inside try -> "internal", no write
  } finally { ENV.SUPABASE_SERVICE_ROLE_KEY = saved; }
});

test('C2e: the token never appears in console output or in any response body', async () => {
  const tok = await mintActionToken(X, A, { secret: KEY });
  const { text, value } = await captureConsole(async () => {
    const out: string[] = [];
    setDb(freshDb());
    for (const b of [{ op: 'set_status', token: tok, status: 'DONE' }, { op: 'set_status', token: tok, status: 'nope' },
      { op: 'trace', token: tok, lines: ['hi'] }, { op: 'bogus', token: tok }, { op: 'set_status', token: tok + 'x', status: 'DONE' }]) {
      const r = await handler(post(b)); out.push(await r.text());
    }
    return out.join('\n');
  });
  const sig = tok.split('.')[2];
  assert.ok(!text.includes(sig) && !value.includes(sig), 'token signature leaked');
  setDb(freshDb()); await call({ op: 'set_status', token: tok, status: 'DONE' });
  // activity_log rows written by alarm-action
  const { activity_log } = (await (async () => { const d = freshDb(); setDb(d); await call({ op: 'set_status', token: tok, status: 'DONE' }); await call({ op: 'trace', token: tok, lines: ['x'] }); return d; })());
  assert.ok(!JSON.stringify(activity_log).includes(sig), 'token in activity_log');
});

test('C2f: status allow-list — only DOING/DONE/BACKLOG/PARK (case-insensitive) reach the DB', async () => {
  const tok = await mintActionToken(X, A, { secret: KEY });
  const bad = ['IN_PROGRESS', 'TODO', 'COMPLETED', 'CANCELLED', 'ARCHIVED', '', ' DONE', 'DONE ', 'DONE\n', 'DONE,TODO', "DONE'--",
    '__proto__', 'constructor', 'toString', null, undefined, 1, true, { toString: () => 'x' }];
  for (const status of bad) {
    const db = freshDb(); setDb(db); const before = snap(db);
    const r = await call({ op: 'set_status', token: tok, status });
    assert.equal(r.status, 400, `status ${JSON.stringify(status)} -> ${r.status}`); assert.equal(r.body.reason, 'bad_status');
    assert.equal(snap(db), before); assert.equal(ops.length, 0, 'no DB call at all');
  }
  const written: Record<string, string> = {};
  for (const status of ['done', 'Doing', 'backlog', 'park']) {
    const db = freshDb(); setDb(db);
    const r = await call({ op: 'set_status', token: tok, status });
    assert.equal(r.status, 200); written[status] = db.tasks[0].status;
  }
  assert.deepEqual(written, { done: 'DONE', Doing: 'DOING', backlog: 'BACKLOG', park: 'BACKLOG' });
  // ['DONE'] (array) -> String(['DONE']) === 'DONE': observed separately below
});

test('C2f (observation): non-string status values are coerced with String() before the allow-list', async () => {
  const tok = await mintActionToken(X, A, { secret: KEY });
  const db = freshDb(); setDb(db);
  const r = await call({ op: 'set_status', token: tok, status: ['done'] });
  // String(['done']).toUpperCase() === 'DONE' -> accepted. Harmless (still an allowed value), recorded as fact.
  assert.equal(r.status, 200); assert.equal(db.tasks[0].status, 'DONE');
});

test('C2f: PARK writes BACKLOG + parking-lot tag union, clears schedule, cancels only A queued notifications', async () => {
  const db = freshDb(); setDb(db);
  const tok = await mintActionToken(X, A, { secret: KEY });
  const r = await call({ op: 'set_status', token: tok, status: 'PARK' });
  assert.equal(r.status, 200);
  assert.deepEqual([db.tasks[0].status, db.tasks[0].tags, db.tasks[0].start_time, db.tasks[0].is_scheduled], ['BACKLOG', ['x', 'parking-lot'], null, false]);
  assert.deepEqual(db.scheduled_notifications.map(n => n.id), ['n2']);
});

test('C2b (observation): signature ENCODING is malleable — non-canonical variants of a VALID token verify', async () => {
  const good = await mintActionToken(X, A, { secret: KEY });
  const out: Record<string, number> = {};
  for (const [name, token] of [['sig+"="', good + '='], ['sig+" "', good + ' '], ['sig+"\\n"', good + '\n']] as const) {
    setDb(freshDb()); out[name] = (await call({ op: 'set_status', token, status: 'DONE' })).status;
  }
  // Same user/task/exp, same MAC bytes: no new authority is gained. Recorded as fact, not a defect.
  console.log('malleable variants ->', JSON.stringify(out));
});
