// WHAT:       Named tests for P2: the coursework daily cap comes from the user's Settings — weekday
//             `maxPerDay`, weekend `maxPerDayWeekend` (falls back to `maxPerDay`) — and the nightly
//             builder enforces THAT value at every cap site instead of the constant 2.
// WHY:        Main's builder used `MAX_ASSIGNMENTS_PER_DAY = 2` on every day including weekends, so a
//             whole Saturday held the same two study blocks as a Tuesday, and editing Settings did
//             nothing to the builder. Owner 2026-10-28: weekday 2, weekend 6.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current. The resolver is byte-identical to the
//             parked J8 (`claude/huddle-journey-integration-xokgv1` `_shared/scheduling-defaults.ts`),
//             so the later J8 restore merges as a no-op here.
// EVIDENCE:   docs/qc-evidence/FINDINGS-assignment-spreading.md §5 P2 (AC-P2-1..3); RESTORE-J1-J15-diff.md §J8.
// Run: node --experimental-strip-types --test supabase/functions/_shared/scheduling-caps.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  resolveCategoryDailyCap, isWeekendInTimezone, DEFAULT_CATEGORY_MAPPINGS, MAX_ASSIGNMENTS_PER_DAY,
} from './scheduling-defaults.ts';

const BUILDER = readFileSync(new URL('../nightly-schedule-builder/index.ts', import.meta.url), 'utf8');
const owner = (prof: Record<string, unknown>) => ({ categoryMappings: { PROF_EDUCATION: prof } });
const FB = { fallback: MAX_ASSIGNMENTS_PER_DAY };

describe('P2 coursework caps from Settings', () => {
  it('AC-P2-1 maxPerDay 2 / maxPerDayWeekend 6 → 2 on a weekday, 6 on Sat/Sun', () => {
    const cfg = owner({ maxPerDay: 2, maxPerDayWeekend: 6, defaultTimeWindow: ['evening', 'weekends'] });
    assert.equal(resolveCategoryDailyCap(cfg, 'PROF_EDUCATION', false, FB), 2);
    assert.equal(resolveCategoryDailyCap(cfg, 'PROF_EDUCATION', true, FB), 6);
  });

  it('AC-P2-1b every builder cap site goes through resolveCategoryDailyCap with a 0/6 weekend flag', () => {
    const calls = BUILDER.match(/resolveCategoryDailyCap\(/g) ?? [];
    assert.equal(calls.length, 3, 'pass-1 cap + top-up day cap + top-up per-task cap');
    assert.ok(!/>=\s*MAX_ASSIGNMENTS_PER_DAY/.test(BUILDER), 'no comparison against the bare constant');
    assert.ok(/placedAssignmentsToday >= assignmentCapToday/.test(BUILDER), 'pass-1 compares the resolved cap');
    assert.ok(/targetDayOfWeek === 0 \|\| targetDayOfWeek === 6,\s*\{ fallback: MAX_ASSIGNMENTS_PER_DAY \}/.test(BUILDER),
      'pass-1 passes the weekend flag');
  });

  it('AC-P2-2 no maxPerDayWeekend key (the owner\'s live row today) → weekends use maxPerDay, same as today', () => {
    const live = owner({ maxPerDay: 2, defaultStatus: 'PROF_EDUCATION', defaultTimeWindow: ['evening', 'weekends'], estimatedDuration: 90 });
    assert.equal(resolveCategoryDailyCap(live, 'PROF_EDUCATION', true, FB), 2);
    assert.equal(resolveCategoryDailyCap(live, 'PROF_EDUCATION', false, FB), 2);
  });

  it('AC-P2-2b the seeded default (no saved row) is weekday 2 / weekend 6, in BOTH backend and frontend seeds', () => {
    assert.equal(resolveCategoryDailyCap({}, 'PROF_EDUCATION', false, FB), 2);
    assert.equal(resolveCategoryDailyCap({}, 'PROF_EDUCATION', true, FB), 6);
    assert.equal(DEFAULT_CATEGORY_MAPPINGS.PROF_EDUCATION.maxPerDayWeekend, 6);
    const fe = readFileSync(new URL('../../../src/config/schedulingRules.ts', import.meta.url), 'utf8');
    assert.ok(/maxPerDay: 2,[\s\S]{0,300}maxPerDayWeekend: 6/.test(fe), 'frontend seed matches');
  });

  it('AC-P2-2c a configured 0 means none; negative / non-numeric is treated as unset', () => {
    assert.equal(resolveCategoryDailyCap(owner({ maxPerDay: 2, maxPerDayWeekend: 0 }), 'PROF_EDUCATION', true, FB), 0);
    assert.equal(resolveCategoryDailyCap(owner({ maxPerDay: 2, maxPerDayWeekend: -1 }), 'PROF_EDUCATION', true, FB), 2);
    assert.equal(resolveCategoryDailyCap(owner({ maxPerDay: '3' }), 'PROF_EDUCATION', false, FB), MAX_ASSIGNMENTS_PER_DAY);
    assert.equal(resolveCategoryDailyCap({}, 'UNKNOWN_CAT', false), Infinity);
  });

  it('AC-P2-3 weekend coursework only uses the weekends window (10–20); weekday evening 19–22 untouched', () => {
    // getActiveWindows (builder) drops every non-weekend window on Sat/Sun, so 19–22 `evening`
    // is never offered on a weekend; P2 changes only the count, not the windows.
    assert.ok(/if \(isWeekend && name !== 'weekends'\) continue;/.test(BUILDER));
    assert.ok(/if \(!isWeekend && name === 'weekends'\) continue;/.test(BUILDER));
  });

  it('TZ-1 isWeekendInTimezone uses the owner\'s zone: Fri 9 pm ET (Sat 01:00Z) is a weekday', () => {
    assert.equal(isWeekendInTimezone(new Date('2026-10-31T01:00:00Z'), 'America/New_York'), false);
    assert.equal(isWeekendInTimezone(new Date('2026-10-31T14:00:00Z'), 'America/New_York'), true);
  });
});
