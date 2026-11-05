// WHAT:       Tests for the nightly builder's per-day rebuild (per-day-rebuild.ts + its wiring).
// WHY:        A run cut off mid-week must leave unreached days on their previous schedule, never empty.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   2026-11-04 11:54Z run stopped after Fri; Sat-Mon were empty because STEP 1.1 cleared them first.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pendingIdsForDay } from './per-day-rebuild.ts';

const thu = { start: '2026-11-05T05:00:00.000Z', end: '2026-11-06T05:00:00.000Z' }; // Thu 11-05 in America/New_York (EST)

describe('per-day rebuild', () => {
  it('PD-1 picks only that local day, comparing instants across "+00:00" and ".000Z" spellings', () => {
    const pending = new Map([
      ['wed-late', '2026-11-05T04:30:00+00:00'], // Wed 11:30 pm ET -> not Thursday
      ['thu-start', '2026-11-05T05:00:00+00:00'], // Thu 00:00 ET exactly -> Thursday
      ['thu-eve', '2026-11-06T00:00:00+00:00'],   // Thu 7 pm ET -> Thursday
      ['fri-start', '2026-11-06T05:00:00.000Z'],  // Fri 00:00 ET -> not Thursday (end is exclusive)
    ]);
    assert.deepEqual(pendingIdsForDay(pending, thu, new Set()), ['thu-start', 'thu-eve']);
  });

  it('PD-2 a task already re-placed earlier in this run is not cleared from its old day', () => {
    const pending = new Map([['moved', '2026-11-06T00:00:00+00:00'], ['stays', '2026-11-06T01:00:00+00:00']]);
    assert.deepEqual(pendingIdsForDay(pending, thu, new Set(['moved'])), ['stays']);
  });

  it('PD-3 unparsable times are ignored, never cleared by accident', () => {
    assert.deepEqual(pendingIdsForDay(new Map([['x', 'not a time']]), thu, new Set()), []);
  });

  it('PD-4 the builder no longer clears the whole horizon up front, and clears each day just before filling it', () => {
    const src = readFileSync(new URL('../nightly-schedule-builder/index.ts', import.meta.url), 'utf8');
    const step11 = src.slice(src.indexOf('STEP 1.1: CLEAR FUTURE-SCHEDULED TASKS'), src.indexOf('} else {\n          // Single-day: only clear today'));
    assert.ok(step11.length > 100, 'STEP 1.1 block located');
    assert.ok(!/is_scheduled: false/.test(step11), 'full mode must not unschedule anything up front');
    assert.match(step11, /pendingRebuild\.set\(ft\.id, ft\.start_time\)/);
    assert.match(src, /=== Day \$\{dayOffset \+ 1\}\/\$\{totalDays\}[^\n]*\n\s*await clearPendingDay\(targetISO\);/);
    assert.match(src, /await clearPendingDay\(isoDay\);\n\s*const bounds = _ldub\(isoDay, timezone\);/);
  });

  it('PD-5 queued tasks stay candidates (so a later-day task can still be pulled earlier)', () => {
    const src = readFileSync(new URL('../nightly-schedule-builder/index.ts', import.meta.url), 'utf8');
    assert.equal((src.match(/\.or\(unscheduledOrPending\(\)\)/g) || []).length, 3, 'tier list + both day-candidate queries');
  });
});
