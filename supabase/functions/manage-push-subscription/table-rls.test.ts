// WHAT: replays every migration that touches public.push_subscriptions (filename order) and checks the
//       END STATE of its RLS policies and table grants.
// WHY:  VERIFY-phone-registration-a-1 C2-BYPASS2: the table was FOR ALL TO public USING (true) WITH CHECK (true),
//       with anon/authenticated holding every privilege, so the public anon key could read every FCM token
//       and register a device for any user through PostgREST, bypassing the edge function's login check.
//       This fails if any later migration re-opens it.
// SUPERSEDES: nothing. SUPERSEDED-BY: nothing -- current.
// EVIDENCE: docs/qc-evidence/RESTORE-step3-j13-j14-security.md ("Loop 2 fixes", fix 1)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIG = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations');
const TABLE = /(?:public\.)?push_subscriptions\b/i;
const ALL_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
const OPEN_ROLES = ['public', 'anon', 'authenticated'];

interface Policy { name: string; cmd: string; roles: string[]; using: string | null; check: string | null; permissive: boolean }

/** Strip `-- comments` so prose mentioning a policy never parses as one. */
const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, '');
const norm = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim().replace(/^\((.*)\)$/, '$1').trim().toLowerCase();

/** Take a balanced (...) group that starts at `i` (sql[i] === '('). */
function group(sql: string, i: number): [string, number] {
  let d = 0;
  for (let j = i; j < sql.length; j++) {
    if (sql[j] === '(') d++;
    else if (sql[j] === ')') { d--; if (d === 0) return [sql.slice(i, j + 1), j + 1]; }
  }
  throw new Error('unbalanced parens');
}

export function replay(files: string[]) {
  const policies = new Map<string, Policy>();
  // Supabase's default privileges give anon/authenticated/service_role every table privilege (matches live 2026-10-27).
  const grants: Record<string, Set<string>> = { anon: new Set(ALL_PRIVS), authenticated: new Set(ALL_PRIVS), service_role: new Set(ALL_PRIVS) };
  for (const f of files) {
    const stmts = stripComments(readFileSync(resolve(MIG, f), 'utf8')).split(/;\s*(?:\n|$)/);
    for (const raw of stmts) {
      const s = raw.trim();
      let m: RegExpExecArray | null;
      if ((m = /^DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?"([^"]+)"\s+ON\s+(\S+)/i.exec(s)) && TABLE.test(m[2])) { policies.delete(m[1]); continue; }
      if ((m = /^CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+(\S+)([\s\S]*)$/i.exec(s)) && TABLE.test(m[2])) {
        const rest = m[3];
        const cmd = (/\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i.exec(rest)?.[1] ?? 'ALL').toUpperCase();
        const to = /\bTO\s+([\w\s,]+?)(?=\s+USING\b|\s+WITH\s+CHECK\b|$)/i.exec(rest);
        const roles = to ? to[1].split(',').map(r => r.trim().toLowerCase()) : ['public'];
        const permissive = !/\bAS\s+RESTRICTIVE\b/i.test(rest);
        let using: string | null = null, check: string | null = null;
        const u = /\bUSING\s*\(/i.exec(rest); if (u) using = group(rest, u.index + u[0].length - 1)[0];
        const c = /\bWITH\s+CHECK\s*\(/i.exec(rest); if (c) check = group(rest, c.index + c[0].length - 1)[0];
        policies.set(m[1], { name: m[1], cmd, roles, using, check, permissive });
        continue;
      }
      if ((m = /^(GRANT|REVOKE)\s+([\w\s,]+?)\s+ON\s+(?:TABLE\s+)?(\S+)\s+(?:TO|FROM)\s+([\w\s,]+)$/i.exec(s)) && TABLE.test(m[3])) {
        const privs = /^ALL(\s+PRIVILEGES)?$/i.test(m[2].trim()) ? ALL_PRIVS : m[2].split(',').map(p => p.trim().toUpperCase());
        for (const role of m[4].split(',').map(r => r.trim().toLowerCase())) {
          grants[role] ??= new Set();
          for (const p of privs) m[1].toUpperCase() === 'GRANT' ? grants[role].add(p) : grants[role].delete(p);
        }
      }
    }
  }
  return { policies: [...policies.values()], grants };
}

const files = readdirSync(MIG).filter(f => f.endsWith('.sql') && TABLE.test(readFileSync(resolve(MIG, f), 'utf8'))).sort();
const isTrue = (e: string | null) => norm(e) === 'true';

test('push_subscriptions RLS: the parser sees the 2026-02-04 policy as open to every role (detector is live)', () => {
  const before = replay(files.filter(f => f < '20261027210000'));
  const open = before.policies.filter(p => p.roles.includes('public') && (isTrue(p.using) || isTrue(p.check)));
  assert.equal(open.length, 1, JSON.stringify(before.policies));
  assert.equal(before.grants.anon.has('INSERT'), true);
});

test('push_subscriptions RLS: no permissive qual=true / with_check=true policy remains for public, anon or authenticated', () => {
  const { policies } = replay(files);
  const bad = policies.filter(p => p.permissive && p.roles.some(r => OPEN_ROLES.includes(r)) && (isTrue(p.using) || isTrue(p.check)));
  assert.deepEqual(bad, []);
});

test('push_subscriptions RLS: authenticated may only SELECT its own rows (user_id = auth.uid())', () => {
  const { policies } = replay(files);
  const forClients = policies.filter(p => p.roles.some(r => OPEN_ROLES.includes(r)));
  assert.equal(forClients.length, 1, JSON.stringify(forClients));
  assert.equal(forClients[0].cmd, 'SELECT');
  assert.deepEqual(forClients[0].roles, ['authenticated']);
  assert.match(norm(forClients[0].using), /^user_id = \(?\s*(select\s+)?auth\.uid\(\)\s*\)?$/);
});

test('push_subscriptions grants: anon has nothing; authenticated has no INSERT/UPDATE/DELETE/TRUNCATE', () => {
  const { grants } = replay(files);
  assert.deepEqual([...grants.anon], []);
  for (const p of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) assert.equal(grants.authenticated.has(p), false, p);
  assert.equal(grants.authenticated.has('SELECT'), true);
});

test('push_subscriptions RLS: the service role keeps full access for the edge functions', () => {
  const { policies, grants } = replay(files);
  assert.ok(policies.some(p => p.cmd === 'ALL' && p.roles.includes('service_role')));
  for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) assert.equal(grants.service_role.has(p), true, p);
});

test('push_subscriptions RLS migration is re-runnable: every CREATE POLICY is preceded by a DROP POLICY IF EXISTS of the same name', () => {
  const f = '20261027210000_push_subscriptions_rls_lockdown.sql';
  const sql = stripComments(readFileSync(resolve(MIG, f), 'utf8'));
  const created = [...sql.matchAll(/CREATE\s+POLICY\s+"([^"]+)"/gi)].map(m => [m[1], m.index!] as const);
  assert.ok(created.length >= 2);
  for (const [name, at] of created) {
    const drop = new RegExp(`DROP\\s+POLICY\\s+IF\\s+EXISTS\\s+"${name}"\\s+ON\\s+public\\.push_subscriptions`, 'i').exec(sql);
    assert.ok(drop && drop.index < at, `no DROP POLICY IF EXISTS "${name}" before its CREATE`);
  }
});
