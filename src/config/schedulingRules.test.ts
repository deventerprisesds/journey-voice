// WHAT:       Unit coverage for `mergeSchedulingConfig` — the READ-TIME NORMALISER: its six
//             per-field defaulting semantics, `priorityBoost`'s round trip, the structural guard
//             that every declared+defaulted field is emitted, and the pass-through-without-
//             invented-defaults rule for `nudges`/`assignments`.
// WHY:        AC-6a requires each of the six semantics to be proven INDIVIDUALLY, so that
//             collapsing the function to `{...DEFAULT, ...userConfig}` fails loudly rather than
//             passing a single coarse "the merge works" assertion. `priorityBoost` was declared in
//             SchedulingConfig and in DEFAULT_SCHEDULING_CONFIG but omitted from the return
//             literal, so its Settings toggle could never round-trip; the structural check here is
//             what catches the NEXT field someone forgets.
// SUPERSEDES: nothing.
// SUPERSEDED-BY: nothing — current.
// EVIDENCE:   docs/impl/laneC-config-save.md (design + mutation results: M1 and M2 both FIRED);
//             docs/ac/nudge-and-ordering-ACs.md AC-6a/6c; docs/verify/nudge-delivery-loop1.md §F1.
//
// The SAVE-path half of AC-6 (patch semantics, probe-key survival, removeConfigKeys) cannot live
// in this runner: it must mock the aliased `@/integrations/supabase/client` import, which node's
// test runner cannot do without --experimental-test-module-mocks. That suite exists and passes
// (12/12) against the real service module under bun — see docs/impl/laneC-tests/save-check.test.ts
// and the "how to run it" note in docs/impl/laneC-config-save.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeSchedulingConfig,
  DEFAULT_SCHEDULING_CONFIG,
  CONFIG_ROUNDTRIP_PROBE_KEY,
} from './schedulingRules.ts';

// ── AC-6a: the six semantics a spread cannot express, asserted one by one ────────────────────

test('AC-6a.1 partial timeWindows: the other windows survive from defaults', () => {
  const r = mergeSchedulingConfig({
    timeWindows: { morning: { start: 5, end: 8, days: [1] } } as never,
  });
  assert.equal(r.timeWindows.morning.start, 5);
  assert.equal(r.timeWindows.business_hours.start, 9);
  assert.equal(r.timeWindows.evening.end, 22);
});

test('AC-6a.2 contextRules is a TWO-level merge: priorityMappings survive a keywords-only save', () => {
  const r = mergeSchedulingConfig({
    contextRules: { keywords: { zzz: ['morning', 'LIFE'] } } as never,
  });
  assert.equal(r.contextRules.priorityMappings.urgent, 4);
  assert.deepEqual(r.contextRules.keywords.zzz, ['morning', 'LIFE']);
  assert.deepEqual(r.contextRules.keywords.study, ['evening', 'PROF_EDUCATION']);
});

test('AC-6a.3 categoryMappings migrates a legacy string defaultTimeWindow to an array', () => {
  const r = mergeSchedulingConfig({
    categoryMappings: {
      LIFE: { defaultTimeWindow: 'evening', defaultStatus: 'LIFE', estimatedDuration: 30 },
    } as never,
  });
  assert.deepEqual(r.categoryMappings.LIFE.defaultTimeWindow, ['evening']);
});

test('AC-6a.4 a blank customAIInstructions means "use the default", not an empty prompt', () => {
  assert.equal(
    mergeSchedulingConfig({ customAIInstructions: '   ' }).customAIInstructions,
    DEFAULT_SCHEDULING_CONFIG.customAIInstructions,
  );
  assert.equal(mergeSchedulingConfig({ customAIInstructions: 'mine' }).customAIInstructions, 'mine');
});

test('AC-6a.5 an invalid scoringModel is normalised to composite, not passed through', () => {
  assert.equal(mergeSchedulingConfig({ scoringModel: 'nonsense' as never }).scoringModel, 'composite');
  assert.equal(mergeSchedulingConfig({ scoringModel: 'priority-rank' }).scoringModel, 'priority-rank');
});

test('AC-6a.6 an absent timezone falls back to the default', () => {
  assert.equal(mergeSchedulingConfig({}).timezone, DEFAULT_SCHEDULING_CONFIG.timezone);
  assert.equal(mergeSchedulingConfig({ timezone: 'Europe/London' }).timezone, 'Europe/London');
});

// ── priorityBoost: the field that could not round-trip at all ────────────────────────────────

test('priorityBoost round-trips: absent -> true, explicit false -> false', () => {
  assert.equal(mergeSchedulingConfig({}).priorityBoost, true);
  assert.equal(mergeSchedulingConfig({ priorityBoost: true }).priorityBoost, true);
  assert.equal(mergeSchedulingConfig({ priorityBoost: false }).priorityBoost, false);
});

test('STRUCTURAL: every key of DEFAULT_SCHEDULING_CONFIG is emitted by the normaliser', () => {
  // This is the check that generalises the priorityBoost defect. A field declared in the
  // interface AND given a default but missing from the return literal can never be saved, and
  // nothing else in the codebase would notice.
  const emitted = mergeSchedulingConfig({});
  const missing = Object.keys(DEFAULT_SCHEDULING_CONFIG).filter((k) => !(k in emitted));
  assert.deepEqual(missing, [], `normaliser omits declared field(s): ${missing.join(', ')}`);
});

// ── nudges / assignments: validated pass-through, never an invented client default ───────────

test('unset nudges/assignments are OMITTED so the server default still applies', () => {
  const r = mergeSchedulingConfig({});
  assert.equal('nudges' in r, false);
  assert.equal('assignments' in r, false);
});

test('assignments values pass through; course ids are trimmed and de-duplicated', () => {
  const r = mergeSchedulingConfig({
    assignments: { soonDays: 7, recentOverdueDays: 14, activeCourseIds: ['a', 'a', ' b '] },
  });
  assert.equal(r.assignments?.soonDays, 7);
  assert.equal(r.assignments?.recentOverdueDays, 14);
  assert.deepEqual(r.assignments?.activeCourseIds, ['a', 'b']);
});

test('an out-of-range or non-numeric nudge hour is DROPPED, never clamped to a guess', () => {
  // Dropping lets the server's documented default apply. Clamping 25 -> 23 would invent a
  // delivery time the user never chose and hide the bad value.
  assert.equal(mergeSchedulingConfig({ nudges: { deliverAtLocalHour: 25 } }).nudges?.deliverAtLocalHour, undefined);
  assert.equal(mergeSchedulingConfig({ nudges: { deliverAtLocalHour: -1 } }).nudges?.deliverAtLocalHour, undefined);
  assert.equal(mergeSchedulingConfig({ nudges: { deliverAtLocalHour: '8am' as never } }).nudges?.deliverAtLocalHour, undefined);
  assert.equal(mergeSchedulingConfig({ nudges: { deliverAtLocalHour: 1.5 } }).nudges?.deliverAtLocalHour, undefined);
  // 0 is midnight — a real, choosable value that must not be dropped as falsy.
  assert.equal(mergeSchedulingConfig({ nudges: { deliverAtLocalHour: 0 } }).nudges?.deliverAtLocalHour, 0);
});

// ── AC-6c: the probe key ─────────────────────────────────────────────────────────────────────

test('AC-6c the probe key is dropped by the NORMALISER (correct) — the SAVE path is what preserves it', () => {
  // A read-time normaliser is entitled to emit only the shape it knows; that is not the defect.
  // The defect was using its output as the save payload. The probe's survival is therefore
  // asserted against saveUserSchedulingConfig (docs/impl/laneC-tests/save-check.test.ts), not here.
  const r = mergeSchedulingConfig({ [CONFIG_ROUNDTRIP_PROBE_KEY]: { v: 1 } } as never);
  assert.equal(CONFIG_ROUNDTRIP_PROBE_KEY in r, false);
  assert.equal(CONFIG_ROUNDTRIP_PROBE_KEY, '__ac6_probe');
});

test('the normaliser mutates neither its input nor DEFAULT_SCHEDULING_CONFIG', () => {
  const input = { assignments: { soonDays: 3 } };
  const before = JSON.stringify(input);
  mergeSchedulingConfig(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(DEFAULT_SCHEDULING_CONFIG.priorityBoost, true);
  assert.equal(DEFAULT_SCHEDULING_CONFIG.scoringModel, 'composite');
});
