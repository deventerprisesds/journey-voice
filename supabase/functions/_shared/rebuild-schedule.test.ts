// WHAT:       unit tests for _shared/rebuild-schedule.ts (rebuild_schedule agent tool) + static wiring checks.
// WHY:        prove the consent guard, caller scoping (userId never from args), the today/week body, that a
//             start returns WITHOUT waiting on the builder (the 30s-timeout bug), and that status reports
//             finished / still running / failed honestly -- with mocks, no real scheduling run.
// SUPERSEDES: the synchronous-v1 tests (5b67201).  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   owner 2026-11-07: Iris "timed out after 30 seconds" on a run that actually finished
//             (chat.pending_turns u-1794079732903).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildRebuildBody,
  normaliseScope,
  rebuildSchedule,
  type BuildRow,
  type FetchLike,
  type RebuildDeps,
} from './rebuild-schedule.ts';

const ME = 'user-me';
const T0 = Date.parse('2026-11-07T19:30:00Z');

function harness(opts: { rows?: (BuildRow | null)[]; fetchNeverResolves?: boolean; fetchThrows?: boolean } = {}) {
  const calls: Array<{ url: string; body: any; auth: string }> = [];
  const held: Promise<unknown>[] = [];
  const reads: Array<{ userId: string; since: string }> = [];
  let clock = T0;
  const rows = [...(opts.rows ?? [])];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    if (opts.fetchThrows) return Promise.reject(new Error('ECONNRESET'));
    if (opts.fetchNeverResolves) return new Promise(() => {});
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  };
  const deps: RebuildDeps = {
    supabaseUrl: 'https://x.supabase.co',
    serviceKey: 'svc',
    fetch,
    waitUntil: (p) => { held.push(p); },
    latestBuildSince: async (userId, since) => {
      reads.push({ userId, since });
      return rows.length ? (rows.shift() ?? null) : null;
    },
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
  };
  return { deps, calls, held, reads };
}

test('R1 start refuses without user_explicitly_requested, and never calls the builder', async () => {
  const h = harness();
  for (const args of [{}, { user_explicitly_requested: false }, { user_explicitly_requested: 'true' }, { action: 'start' }]) {
    const r = await rebuildSchedule(h.deps, ME, args);
    assert.equal(r.success, false);
    assert.match(String(r.error), /explicitly asked/);
  }
  assert.equal(h.calls.length, 0);
  assert.equal(h.held.length, 0);
});

test('R2 default scope is today -> singleDay:true; week -> singleDay:false', () => {
  assert.equal(normaliseScope(undefined), 'today');
  assert.equal(normaliseScope('bogus'), 'today');
  assert.equal(normaliseScope('week'), 'week');
  assert.deepEqual(buildRebuildBody(ME, 'today'), { userId: ME, singleDay: true, triggerSource: 'agent_reschedule_today' });
  assert.equal(buildRebuildBody(ME, 'week').singleDay, false);
});

test('R3 start kicks nightly-schedule-builder for the CALLER only, ignoring any user id in args', async () => {
  const h = harness();
  const r = await rebuildSchedule(h.deps, ME, { user_explicitly_requested: true, userId: 'someone-else', user_id: 'someone-else' });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, 'https://x.supabase.co/functions/v1/nightly-schedule-builder');
  assert.equal(h.calls[0].body.userId, ME);
  assert.equal(h.calls[0].auth, 'Bearer svc');
  assert.equal(r.success, true);
  assert.equal(r.started, true);
});

test('R4 start returns at once even if the builder never answers, and holds the run open with waitUntil', async () => {
  const h = harness({ fetchNeverResolves: true });
  const r = await Promise.race([
    rebuildSchedule(h.deps, ME, { user_explicitly_requested: true, scope: 'week' }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('start blocked on the builder')), 500)),
  ]) as any;
  assert.equal(r.success, true);
  assert.equal(r.started, true);
  assert.equal(r.scope, 'week');
  assert.equal(h.calls[0].body.singleDay, false);
  assert.equal(h.held.length, 1, 'background run must be handed to waitUntil');
  assert.equal(r.started_at, new Date(T0 - 1000).toISOString());
  assert.match(String(r.message), /do NOT say it is done/);
});

test('R5 a builder transport failure inside the background run never throws out of start', async () => {
  const h = harness({ fetchThrows: true });
  const r = await rebuildSchedule(h.deps, ME, { user_explicitly_requested: true });
  assert.equal(r.success, true);
  await Promise.all(h.held); // must resolve, not reject
});

test('S1 status: finished run -> placed count, scope from the row, no consent needed', async () => {
  const h = harness({ rows: [{ status: 'completed', created_at: '2026-11-07T19:31:10Z', metadata: { total_scheduled: 9, singleDay: false, days_processed: 7 } }] });
  const r = await rebuildSchedule(h.deps, ME, { action: 'status', since: '2026-11-07T19:29:59Z' });
  assert.equal(r.success, true);
  assert.equal(r.finished, true);
  assert.equal(r.totalScheduled, 9);
  assert.match(String(r.message), /next 7 days — 9 tasks placed/);
  assert.equal(h.reads[0].userId, ME);
  assert.equal(h.reads[0].since, '2026-11-07T19:29:59.000Z');
});

test('S2 status: nothing yet -> polls up to the cap, then "not finished" (never claims done)', async () => {
  const h = harness({ rows: [] });
  const r = await rebuildSchedule(h.deps, ME, { action: 'status', since: '2026-11-07T19:29:59Z' });
  assert.equal(r.success, true);
  assert.equal(r.finished, false);
  assert.match(String(r.message), /not finished/);
  assert.ok(h.reads.length >= 2, 'should poll more than once');
  // capped wait: even if asked for 10 minutes it stops at the 20s cap
  const h2 = harness({ rows: [] });
  await rebuildSchedule(h2.deps, ME, { action: 'status', since: '2026-11-07T19:29:59Z', wait_ms: 600000 });
  assert.ok(h2.reads.length <= 7, `polled ${h2.reads.length} times — the wait cap did not hold`);
});

test('S3 status: run lands on a later poll -> finished', async () => {
  const h = harness({ rows: [null, null, { status: 'completed', created_at: '2026-11-07T19:31:00Z', metadata: { total_scheduled: 1, singleDay: true } }] });
  const r = await rebuildSchedule(h.deps, ME, { action: 'status', since: '2026-11-07T19:29:59Z' });
  assert.equal(r.finished, true);
  assert.match(String(r.message), /today's schedule — 1 task placed/);
});

test('S4 status: builder error row -> failure carrying the error', async () => {
  const h = harness({ rows: [{ status: 'error', created_at: '2026-11-07T19:31:00Z', metadata: { error: 'boom' } }] });
  const r = await rebuildSchedule(h.deps, ME, { action: 'status', since: '2026-11-07T19:29:59Z' });
  assert.equal(r.success, false);
  assert.match(String(r.error), /boom/);
});

test('S5 status without a usable since looks back at most 15 minutes', async () => {
  const h = harness({ rows: [null] });
  await rebuildSchedule(h.deps, ME, { action: 'status', since: 'yesterday', wait_ms: 0 });
  assert.equal(h.reads[0].since, new Date(T0 - 15 * 60_000).toISOString());
});

test('W1 execute-tool dispatches rebuild_schedule with the dispatch userId and real deps', () => {
  const src = readFileSync(new URL('../execute-tool/index.ts', import.meta.url), 'utf8');
  assert.match(src, /case 'rebuild_schedule':\s*\n\s*return calendarEditResponse\(await rebuildSchedule\(makeRebuildDeps\(supabase, SUPABASE_URL, SUPABASE_SERVICE_KEY, fetch\), userId, args \?\? \{\}\)\);/);
});

test('W2 tool definition: start/status actions, today/week scope, consent field documented', () => {
  const src = readFileSync(new URL('./tool-definitions.ts', import.meta.url), 'utf8');
  const i = src.indexOf('name: "rebuild_schedule"');
  assert.ok(i > 0, 'rebuild_schedule definition missing');
  const block = src.slice(i, src.indexOf('name: "', i + 10));
  assert.match(block, /enum: \["start", "status"\]/);
  assert.match(block, /enum: \["today", "week"\]/);
  assert.match(block, /user_explicitly_requested/);
  assert.match(block, /A start is NOT a finish/);
});
