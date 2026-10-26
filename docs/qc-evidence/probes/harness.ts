// WHAT: test harness that loads a real Supabase edge-function handler (unchanged source) under node,
//       with the three remote imports (std serve, supabase-js, web-push) replaced by in-memory stubs.
// WHY:  PR #65's record says alarm-action's user scoping / status allow-list, send-push's 404 prune and
//       manage-push's dedupe are untested because they are serve() handlers. This runs the real code.
// SUPERSEDES: nothing. SUPERSEDED-BY: nothing -- current.
// EVIDENCE: docs/qc-evidence/VERIFY-restore-j13-alarm-actions-1.md (C2, C3).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../../..');
export const ENV: Record<string, string> = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'probe-service-role-key',
};
(globalThis as any).Deno = { env: { get: (k: string) => ENV[k] } };

export type Row = Record<string, any>;
export interface Db { [table: string]: Row[] }
export const ops: { table: string; kind: string; filters: [string, string, any][]; payload?: any }[] = [];

function match(r: Row, f: [string, string, any][]) {
  return f.every(([op, c, v]) => {
    const x = r[c];
    if (op === 'eq') return x !== null && x !== undefined && x === v;
    if (op === 'neq') return x !== null && x !== undefined && x !== v; // SQL: NULL <> v is not true
    if (op === 'is') return v === null ? x === null || x === undefined : x === v;
    if (op === 'like') { const re = new RegExp('^' + String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$'); return typeof x === 'string' && re.test(x); }
    if (op === 'notlike') { const re = new RegExp('^' + String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$'); return !(typeof x === 'string' && re.test(x)); }
    throw new Error('unsupported op ' + op);
  });
}

export function makeClient(db: Db) {
  return {
    from(table: string) {
      db[table] ??= [];
      const st: { kind: string; filters: [string, string, any][]; payload?: any; single?: boolean; upsertOn?: string } = { kind: 'select', filters: [] };
      const b: any = {
        select() { if (st.kind === 'select') st.kind = 'select'; return b; },
        insert(p: any) { st.kind = 'insert'; st.payload = p; return b; },
        update(p: any) { st.kind = 'update'; st.payload = p; return b; },
        upsert(p: any, o?: any) { st.kind = 'upsert'; st.payload = p; st.upsertOn = o?.onConflict; return b; },
        delete() { st.kind = 'delete'; return b; },
        eq(c: string, v: any) { st.filters.push(['eq', c, v]); return b; },
        neq(c: string, v: any) { st.filters.push(['neq', c, v]); return b; },
        is(c: string, v: any) { st.filters.push(['is', c, v]); return b; },
        like(c: string, v: any) { st.filters.push(['like', c, v]); return b; },
        not(c: string, op: string, v: any) { if (op !== 'like') throw new Error('not ' + op); st.filters.push(['notlike', c, v]); return b; },
        maybeSingle() { st.single = true; return b; },
        then(res: any, rej: any) {
          try {
            ops.push({ table, kind: st.kind, filters: st.filters, payload: st.payload });
            const rows = db[table];
            let out: any = null;
            if (st.kind === 'select') { const m = rows.filter(r => match(r, st.filters)); out = st.single ? (m[0] ?? null) : m; }
            else if (st.kind === 'insert') { for (const p of [].concat(st.payload)) rows.push({ ...p }); }
            else if (st.kind === 'update') { for (const r of rows) if (match(r, st.filters)) Object.assign(r, st.payload); }
            else if (st.kind === 'delete') { db[table] = rows.filter(r => !match(r, st.filters)); }
            else if (st.kind === 'upsert') {
              const keys = (st.upsertOn ?? 'id').split(',');
              const ex = rows.find(r => keys.every(k => r[k] === st.payload[k]));
              if (ex) Object.assign(ex, st.payload); else rows.push({ id: 'new-' + rows.length, ...st.payload });
            }
            return Promise.resolve({ data: out, error: null }).then(res, rej);
          } catch (e) { return Promise.reject(e).then(res, rej); }
        },
      };
      return b;
    },
  };
}

let current: Db = {};
export function setDb(db: Db) { current = db; ops.length = 0; }
(globalThis as any).__mkClient = () => makeClient(current);
(globalThis as any).__webpush = { sent: [] as any[], setVapidDetails() {}, async sendNotification(sub: any, payload: string) { (globalThis as any).__webpush.sent.push({ sub, payload }); } };

/** Load an edge function's index.ts with its remote imports stubbed; returns its serve() handler. */
export async function loadHandler(fn: string): Promise<(req: Request) => Promise<Response>> {
  const src = readFileSync(resolve(ROOT, 'supabase/functions', fn, 'index.ts'), 'utf8');
  const shared = pathToFileURL(resolve(ROOT, 'supabase/functions/_shared/action-token.ts')).href;
  let out = src
    .replace(/^import \{ serve \} from "https:\/\/deno\.land\/std@[^"]+\/http\/server\.ts";$/m, 'const serve = (h: any) => { (globalThis as any).__handler = h; };')
    .replace(/^import \{ createClient \} from "https:\/\/esm\.sh\/@supabase\/supabase-js@[^"]+";$/m, 'const createClient = (..._a: any[]) => (globalThis as any).__mkClient();')
    .replace(/^import webpush from "npm:web-push@[^"]+";$/m, 'const webpush = (globalThis as any).__webpush;')
    .replace(/"\.\.\/_shared\/action-token\.ts"/, JSON.stringify(shared));
  if (/^import .* from "(https|npm):/m.test(out)) throw new Error('unstubbed remote import left in ' + fn);
  if (!out.includes('globalThis as any).__handler')) throw new Error('serve() stub not applied in ' + fn);
  const dir = resolve(tmpdir(), 'verify65-handlers'); mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `${fn}-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`);
  writeFileSync(file, out);
  await import(pathToFileURL(file).href);
  return (globalThis as any).__handler;
}

export const post = (body: unknown) => new Request('https://x/functions/v1/f', { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

/** Capture everything written to console while fn runs. */
export async function captureConsole<T>(fn: () => Promise<T>): Promise<{ value: T; text: string }> {
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };
  let text = '';
  const cap = (...a: any[]) => { text += a.map(x => typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })()).join(' ') + '\n'; };
  Object.assign(console, { log: cap, warn: cap, error: cap, info: cap, debug: cap });
  try { const value = await fn(); return { value, text }; } finally { Object.assign(console, orig); }
}
