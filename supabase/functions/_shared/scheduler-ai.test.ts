// WHAT:       Tests for scheduler-ai.ts (gateway -> OpenAI fallback) and the builder's restore-on-failure wiring.
// WHY:        2026-11-14/15 every placement got 403 credit_limit_reached and the owner's weekend was empty.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   function_logs 2026-11-15 05:00:09 batch-calendar-scheduler "AI API error: 403".
// Run: node --experimental-strip-types --no-warnings --test supabase/functions/_shared/scheduler-ai.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { callSchedulerAI, shouldFallBack, LOVABLE_URL, OPENAI_URL } from './scheduler-ai.ts';
import { restorableRows } from './per-day-rebuild.ts';

const reply = (content: string) => JSON.stringify({ choices: [{ message: { content } }] });
function fakeFetch(map: Record<string, { status: number; body: string }>) {
  const calls: string[] = [];
  const f = async (url: string) => {
    calls.push(url);
    const r = map[url] ?? { status: 599, body: 'unmapped' };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body };
  };
  return { f, calls };
}
const CREDIT_403 = '{"status":403,"type":"credit_limit_reached","title":"Workspace credit limit reached"}';

describe('placement AI falls back when the gateway refuses', () => {
  it('SA-1 OpenAI is asked first and, when healthy, alone (owner: "I use openai")', async () => {
    const { f, calls } = fakeFetch({ [OPENAI_URL]: { status: 200, body: reply('[]') } });
    const r = await callSchedulerAI('p', { lovable: 'k1', openai: 'k2' }, f);
    assert.equal(r.ok, true);
    assert.equal(r.provider, 'openai');
    assert.deepEqual(calls, [OPENAI_URL]);
  });
  it('SA-2 Lovable is only the fallback: OpenAI 429 -> Lovable answers', async () => {
    const { f, calls } = fakeFetch({ [OPENAI_URL]: { status: 429, body: 'quota' }, [LOVABLE_URL]: { status: 200, body: reply('[1]') } });
    const r = await callSchedulerAI('p', { lovable: 'k1', openai: 'k2' }, f);
    assert.equal(r.provider, 'lovable');
    assert.deepEqual(calls, [OPENAI_URL, LOVABLE_URL]);
  });
  it('SA-3 402/429/5xx/network fall back; a 400 (bad prompt) does not', () => {
    for (const s of [0, 401, 402, 403, 408, 429, 500, 502, 503]) assert.equal(shouldFallBack(s), true, String(s));
    for (const s of [400, 404, 422]) assert.equal(shouldFallBack(s), false, String(s));
  });
  it('SA-4 both refuse -> not ok, both attempts recorded, never throws', async () => {
    const { f } = fakeFetch({ [LOVABLE_URL]: { status: 403, body: CREDIT_403 }, [OPENAI_URL]: { status: 429, body: 'quota' } });
    const r = await callSchedulerAI('p', { lovable: 'k1', openai: 'k2' }, f);
    assert.equal(r.ok, false);
    assert.deepEqual(r.attempts.map((a) => a.provider), ['openai', 'lovable']);
  });
  it('SA-5 both schedulers go through callSchedulerAI; no bare gateway call is left', () => {
    for (const fn of ['batch-calendar-scheduler', 'smart-calendar-scheduler']) {
      const src = readFileSync(new URL(`../${fn}/index.ts`, import.meta.url), 'utf8');
      assert.match(src, /const ai = await callSchedulerAI\(/, fn);
      assert.ok(!src.includes("fetch('https://ai.gateway.lovable.dev"), `${fn}: no direct gateway call left`);
    }
  });
});

describe('a failed day keeps its previous schedule', () => {
  it('RC-1 rows not re-placed elsewhere are restored; re-placed or slotless rows are not', () => {
    const rows = [{ id: 'a', start_time: 'x' }, { id: 'b', start_time: 'y' }, { id: 'c', start_time: null }];
    assert.deepEqual(restorableRows(rows, new Set(['b'])).map((r) => r.id), ['a']);
  });
  it('RC-2 the builder restores the day on a scheduler error before moving on', () => {
    const src = readFileSync(new URL('../nightly-schedule-builder/index.ts', import.meta.url), 'utf8');
    const err = src.indexOf('console.error(`    ❌ Scheduler error: ${schedulerResponse.status} ${errText}`);');
    const restore = src.indexOf("await restoreClearedDay(targetISO, `scheduler ${schedulerResponse.status}`);", err);
    const cont = src.indexOf('continue;', err);
    assert.ok(err > 0 && restore > err && restore < cont, 'restore runs between the error and the continue');
  });
});
