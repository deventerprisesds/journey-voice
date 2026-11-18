// WHAT:       Wiring test: the builder's day-fill candidate queries exclude work-session cards by TAG.
// WHY:        2026-11-15 22:07 ET: PASS 0 created Research Paper sessions 4-6 of 6; their ids were not in
//             managedIds (created this run), so the day loop placed them in past Sunday slots (11:30, 13:00,
//             15:30) and overwrote their session context.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   tasks rows "Research Paper 4/5/6 of 6" scheduling_context {origin, pre_schedule_status} only.
// Run: node --experimental-strip-types --no-warnings --test supabase/functions/_shared/session-leak.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

describe('work-session cards never reach the day-fill pass', () => {
  it('SL-1 both STEP 3 candidate queries filter out the work-session tag', () => {
    const src = readFileSync(new URL('../nightly-schedule-builder/index.ts', import.meta.url), 'utf8');
    const step3 = src.indexOf('STEP 3: GATHER CANDIDATES');
    const end = src.indexOf('const allCandidateIds', step3);
    const block = src.slice(step3, end);
    const hits = block.match(/\.not\('tags', 'cs', '\{work-session\}'\)/g) ?? [];
    assert.equal(hits.length, 2, 'topic-mapped query and ready/up-next query both exclude sessions');
  });
});
