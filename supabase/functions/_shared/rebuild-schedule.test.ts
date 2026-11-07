// WHAT:       unit tests for _shared/rebuild-schedule.ts (rebuild_schedule agent tool) + static wiring checks.
// WHY:        prove the consent guard, caller scoping (userId never from args), the today/week body,
//             and that every builder outcome (ok / switched off / per-user error / HTTP error / absent)
//             becomes an honest result -- with a mocked fetch, no real scheduling run.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   owner 2026-11-07 screenshot: Iris "I can't directly trigger the nightly scheduling job".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRebuildBody, normaliseScope, rebuildSchedule, type FetchLike } from './rebuild-schedule.ts';

const ME = 'user-me';

function mockFetch(status: number, payload: any) {
  const calls: Array<{ url: string; body: any; auth: string }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    return { ok: status >= 200 && status < 300, status, json: async () => payload };
  };
  return { fetch, calls };
}
const deps = (f: FetchLike) => ({ supabaseUrl: 'https://x.supabase.co', serviceKey: 'svc', fetch: f });

test('R1 refuses without user_explicitly_requested, and never calls the builder', async () => {
  const m = mockFetch(200, {});
  for (const args of [{}, { user_explicitly_requested: false }, { user_explicitly_requested: 'true' }]) {
    const r = await rebuildSchedule(deps(m.fetch), ME, args);
    assert.equal(r.success, false);
    assert.match(String(r.error), /explicitly asked/);
  }
  assert.equal(m.calls.length, 0);
});

test('R2 default scope is today -> singleDay:true; week -> singleDay:false', () => {
  assert.equal(normaliseScope(undefined), 'today');
  assert.equal(normaliseScope('bogus'), 'today');
  assert.equal(normaliseScope('week'), 'week');
  assert.deepEqual(buildRebuildBody(ME, 'today'), { userId: ME, singleDay: true, triggerSource: 'agent_reschedule_today' });
  assert.equal(buildRebuildBody(ME, 'week').singleDay, false);
});

test('R3 calls nightly-schedule-builder for the CALLER only, ignoring any user id in args', async () => {
  const m = mockFetch(200, { success: true, results: { [ME]: { totalScheduled: 4, daysProcessed: 1, runId: 'r1' } } });
  const r = await rebuildSchedule(deps(m.fetch), ME, { user_explicitly_requested: true, userId: 'someone-else', user_id: 'someone-else' });
  assert.equal(m.calls.length, 1);
  assert.equal(m.calls[0].url, 'https://x.supabase.co/functions/v1/nightly-schedule-builder');
  assert.equal(m.calls[0].body.userId, ME);
  assert.equal(m.calls[0].auth, 'Bearer svc');
  assert.equal(r.success, true);
  assert.equal(r.totalScheduled, 4);
  assert.match(String(r.message), /Rebuilt today's schedule — 4 tasks placed/);
});

test('R4 week scope runs the 7-day job and says so', async () => {
  const m = mockFetch(200, { results: { [ME]: { totalScheduled: 1, daysProcessed: 7 } } });
  const r = await rebuildSchedule(deps(m.fetch), ME, { user_explicitly_requested: true, scope: 'week' });
  assert.equal(m.calls[0].body.singleDay, false);
  assert.match(String(r.message), /next 7 days — 1 task placed/);
});

test('R5 nightly switched off -> honest failure, not success', async () => {
  const m = mockFetch(200, { results: { [ME]: { skipped: 'nightly_schedule_off' } } });
  const r = await rebuildSchedule(deps(m.fetch), ME, { user_explicitly_requested: true });
  assert.equal(r.success, false);
  assert.match(String(r.error), /switched off/);
});

test('R6 per-user builder error -> failure carrying the error', async () => {
  const m = mockFetch(200, { results: { [ME]: { error: 'boom' } } });
  const r = await rebuildSchedule(deps(m.fetch), ME, { user_explicitly_requested: true });
  assert.equal(r.success, false);
  assert.match(String(r.error), /boom/);
});

test('R7 HTTP 500 -> failure; user missing from prefs -> failure with the builder message', async () => {
  const a = await rebuildSchedule(deps(mockFetch(500, { error: 'down' }).fetch), ME, { user_explicitly_requested: true });
  assert.equal(a.success, false);
  assert.match(String(a.error), /HTTP 500.*down/);
  const b = await rebuildSchedule(deps(mockFetch(200, { message: `User ${ME} not found in scheduling prefs` }).fetch), ME, { user_explicitly_requested: true });
  assert.equal(b.success, false);
  assert.match(String(b.error), /not found in scheduling prefs/);
});

test('R8 network throw -> failure, no exception escapes', async () => {
  const f: FetchLike = async () => { throw new Error('ECONNRESET'); };
  const r = await rebuildSchedule(deps(f), ME, { user_explicitly_requested: true });
  assert.equal(r.success, false);
  assert.match(String(r.error), /ECONNRESET/);
});

test('W1 execute-tool dispatches rebuild_schedule with the dispatch userId', () => {
  const src = readFileSync(new URL('../execute-tool/index.ts', import.meta.url), 'utf8');
  assert.match(src, /case 'rebuild_schedule':\s*\n\s*return calendarEditResponse\(await rebuildSchedule\(\{[^}]*\}, userId, args \?\? \{\}\)\);/);
});

test('W2 tool definition exists and requires user_explicitly_requested', () => {
  const src = readFileSync(new URL('./tool-definitions.ts', import.meta.url), 'utf8');
  const i = src.indexOf('name: "rebuild_schedule"');
  assert.ok(i > 0, 'rebuild_schedule definition missing');
  const block = src.slice(i, src.indexOf('name: "', i + 10));
  assert.match(block, /required: \["user_explicitly_requested"\]/);
  assert.match(block, /enum: \["today", "week"\]/);
});
