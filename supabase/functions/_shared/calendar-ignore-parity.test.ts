// WHAT:       journey half of the TaskOS<->Huddle calendar-ignore parity check: journey's isIgnoredCalendarEvent
//             must still produce every `expected` verdict in the shared fixture, and the fixture's bytes must
//             match the sha256 pinned here (the SAME sha256 is pinned in Huddle's parity test,
//             huddle-extension-app scripts/calendar-ignore-parity.test.ts).
// WHY:        Owner 2026-11-26 option A: Huddle applies the same decision as TaskOS. A journey rule change that is
//             not mirrored in Huddle must fail a suite, never neither (AC-24 in
//             huddle-extension-app .claude/ac-huddle-calendar-ignore.md).
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   scripts/calendar-ignore-parity-gen.ts generated the fixture.
// Run: node --experimental-strip-types --no-warnings --test supabase/functions/_shared/calendar-ignore-parity.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isIgnoredCalendarEvent, resolveIgnoreRules } from './calendar-ignore.ts';

/** Update in BOTH repos when the fixture is regenerated (see the generator header). */
export const PARITY_FIXTURE_SHA256 = '18c15b8fadcadccc32435af37242b32aa5b231df46d903b9de96ab2c5cc11360';
const bytes = readFileSync(new URL('./calendar-ignore-parity.fixture.json', import.meta.url));
const fixture = JSON.parse(bytes.toString('utf8'));

test('PAR-J1 the fixture bytes match the sha256 pinned in both repos', () => {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), PARITY_FIXTURE_SHA256);
});

test('PAR-J2 journey still produces every expected verdict (and the recorded rules are what journey resolves)', () => {
  assert.ok(fixture.rows.length >= 40, `rows: ${fixture.rows.length}`);
  let n = 0;
  for (const r of fixture.rows) {
    const rules = resolveIgnoreRules(r.config ?? {}, r.config ? ['owner@example.org'] : []);
    assert.deepEqual(rules, r.rules, `${r.id} rules`);
    assert.equal(isIgnoredCalendarEvent(r.event, r.rules) ? 'IGNORE' : 'KEEP', r.expected, r.id);
    n++;
  }
  console.log(`${n}/${fixture.rows.length} parity`);
});
