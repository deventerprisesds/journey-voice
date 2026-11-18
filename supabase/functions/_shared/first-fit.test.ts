// WHAT:       Tests for first-fit.ts and its wiring into batch-calendar-scheduler's rejection path.
// WHY:        Rejected AI placements were dropped, leaving weekdays empty (2026-11-17 build).
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   function_logs 2026-11-18 01:22: Thu 11-19 0 of 3 placed, business_hours 240/540 free.
// Run: node --experimental-strip-types --no-warnings --test supabase/functions/_shared/first-fit.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { firstFit } from './first-fit.ts';

const H = 3600000;
const day = Date.UTC(2026, 10, 19, 5); // Thu 11-19 00:00 ET
const at = (h: number, m = 0) => day + h * H + m * 60000;
const business = (s: number, e: number) => s >= at(8) && e <= at(17);

describe('first free gap for a rejected task', () => {
  it('FF-1 the real case: 2h JOB task skips the 09:30-11:30 1:1 and lands in the first free business-hours gap', () => {
    const busy = [{ start: at(8), end: at(9, 30) }, { start: at(9, 30), end: at(11, 30) }, { start: at(11, 45), end: at(13, 45) }];
    const r = firstFit({ dayStartMs: day, durationMs: 2 * H, notBeforeMs: 0, busy, isAllowed: business });
    assert.deepEqual(r, { start: at(13, 45), end: at(15, 45) });
  });
  it('FF-2 never in the past, never outside allowed hours, null when nothing fits', () => {
    const r = firstFit({ dayStartMs: day, durationMs: H, notBeforeMs: at(16, 10), busy: [], isAllowed: business });
    assert.equal(r, null, '16:15 + 1h ends after 17:00');
    const r2 = firstFit({ dayStartMs: day, durationMs: H, notBeforeMs: at(10, 5), busy: [], isAllowed: business });
    assert.deepEqual(r2, { start: at(10, 15), end: at(11, 15) });
  });
  it('FF-3 the scheduler retries every rejected task through firstFit before the sanity check', () => {
    const src = readFileSync(new URL('../batch-calendar-scheduler/index.ts', import.meta.url), 'utf8');
    const rej = src.indexOf('Post-AI validation rejected');
    const fit = src.indexOf('firstFit({', rej);
    const sanity = src.indexOf('POST-VALIDATION 3: Common-sense sanity check', rej);
    assert.ok(rej > 0 && fit > rej && fit < sanity, 'fallback runs after rejection and before the sanity check');
  });
});
