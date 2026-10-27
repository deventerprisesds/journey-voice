// WHAT: unit tests for _shared/push-auth.ts (the checks gating alarm action-token minting).
// WHY:  C2-SEC1: a token minted for the wrong task or for an unauthorised caller lets a phone change
//       a task it should not. These pin each check in isolation; the handler wiring is pinned by
//       send-push-notification/index.auth.test.ts.
// SUPERSEDES: nothing. SUPERSEDED-BY: nothing -- current.
// EVIDENCE: docs/qc-evidence/RESTORE-step3-j13-j14-security.md
import test from 'node:test';
import assert from 'node:assert/strict';
import { taskBelongsTo, bearerToken, constantTimeEqual, mintCaller } from './push-auth.ts';

const X = '11111111-1111-4111-8111-111111111111';
const Y = '22222222-2222-4222-8222-222222222222';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** Minimal `.from('tasks').select().eq('id',…).maybeSingle()` stub; records the filters it saw. */
function client(rows: Record<string, any>[], opts: { error?: boolean; throws?: boolean } = {}) {
  const seen: any[] = [];
  return {
    seen,
    from(table: string) {
      const f: [string, any][] = [];
      const b: any = {
        select(cols: string) { seen.push({ table, cols }); return b; },
        eq(c: string, v: any) { f.push([c, v]); seen.push({ eq: [c, v] }); return b; },
        async maybeSingle() {
          if (opts.throws) throw new Error('network');
          if (opts.error) return { data: null, error: { message: 'boom' } };
          return { data: rows.find(r => f.every(([c, v]) => r[c] === v)) ?? null, error: null };
        },
      };
      return b;
    },
  };
}

test('taskBelongsTo: true only for the owning user, reading tasks by id', async () => {
  const c = client([{ id: A, user_id: X }]);
  assert.equal(await taskBelongsTo(c, A, X), true);
  assert.deepEqual(c.seen.slice(0, 2), [{ table: 'tasks', cols: 'user_id' }, { eq: ['id', A] }]);
  assert.equal(await taskBelongsTo(c, A, Y), false);
});

test('taskBelongsTo: missing task, read error, thrown error, bad inputs -> false', async () => {
  assert.equal(await taskBelongsTo(client([]), A, X), false);
  assert.equal(await taskBelongsTo(client([{ id: A, user_id: X }], { error: true }), A, X), false);
  assert.equal(await taskBelongsTo(client([{ id: A, user_id: X }], { throws: true }), A, X), false);
  assert.equal(await taskBelongsTo(client([{ id: A, user_id: null }]), A, X), false);
  for (const [t, u] of [[A, ''], ['', X], [A, undefined], [undefined, X], [A, 123], [{}, X]] as any[]) {
    assert.equal(await taskBelongsTo(client([{ id: A, user_id: X }]), t, u), false);
  }
});

const req = (h: Record<string, string>) => new Request('https://x/f', { method: 'POST', headers: h });
const SK = 'service-role-key-for-tests';
const authClient = (users: Record<string, string>, throws = false) => ({
  auth: { async getUser(jwt: string) { if (throws) throw new Error('down'); const id = users[jwt]; return id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: 'bad jwt' } }; } },
});

test('bearerToken: only a well-formed Bearer header', () => {
  assert.equal(bearerToken(req({ authorization: 'Bearer abc' })), 'abc');
  assert.equal(bearerToken(req({ authorization: 'bearer   abc  ' })), 'abc');
  for (const h of ['', 'Bearer', 'Bearer ', 'Basic abc', 'Bearer a b', 'abc']) assert.equal(bearerToken(req(h ? { authorization: h } : {})), '');
});

test('constantTimeEqual: equal only for identical strings', async () => {
  assert.equal(await constantTimeEqual(SK, SK), true);
  for (const o of [SK + 'x', SK.slice(0, -1), '', SK.toUpperCase(), ' ' + SK]) assert.equal(await constantTimeEqual(o, SK), false);
});

test('mintCaller: service role, owner JWT, everything else none', async () => {
  const c = authClient({ jx: X, jy: Y });
  assert.equal(await mintCaller(req({ authorization: `Bearer ${SK}` }), c, X, SK), 'service_role');
  assert.equal(await mintCaller(req({ authorization: 'Bearer jx' }), c, X, SK), 'owner_jwt');
  assert.equal(await mintCaller(req({ authorization: 'Bearer jy' }), c, X, SK), 'none');
  assert.equal(await mintCaller(req({ authorization: 'Bearer anon' }), c, X, SK), 'none');
  assert.equal(await mintCaller(req({}), c, X, SK), 'none');
  assert.equal(await mintCaller(req({ apikey: SK }), c, X, SK), 'none');
  assert.equal(await mintCaller(req({ authorization: 'Bearer jx' }), c, '', SK), 'none');
  assert.equal(await mintCaller(req({ authorization: 'Bearer jx' }), authClient({ jx: X }, true), X, SK), 'none');
  assert.equal(await mintCaller(req({ authorization: 'Bearer jx' }), {}, X, SK), 'none');
  // An unset service key must never make "Bearer <anything>" count as service role.
  assert.equal(await mintCaller(req({ authorization: 'Bearer x' }), c, X, ''), 'none');
});
