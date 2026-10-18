import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeStoredConfig } from './mergeStoredConfig.ts';

/**
 * The 2026-09-13 wipe, as a test: a Voice-settings save that sends only `customAIInstructions`
 * must leave the owner's windows, categories and keyword rules exactly as stored.
 * Run: node --experimental-strip-types --test src/utils/mergeStoredConfig.test.ts
 */
const stored = {
  timeWindows: { after_work: { start: 17, end: 19, days: [1, 2, 3, 4, 5] } },
  categoryMappings: { LIFE: { defaultTimeWindow: ['after_work', 'weekends'] } },
  contextRules: { keywords: { assignment: ['evening', 'PROF_EDUCATION'] } },
  caveats: [{ id: 'c1' }],
  customAIInstructions: 'old',
};

describe('mergeStoredConfig', () => {
  it('M1 a partial save keeps every key it did not send', () => {
    const out = mergeStoredConfig(stored, { customAIInstructions: 'new' });
    assert.deepEqual(out.timeWindows, stored.timeWindows);
    assert.deepEqual(out.categoryMappings, stored.categoryMappings);
    assert.deepEqual(out.contextRules, stored.contextRules);
    assert.deepEqual(out.caveats, stored.caveats);
    assert.equal(out.customAIInstructions, 'new');
  });
  it('M2 a section that IS sent replaces the stored section', () => {
    const tw = { after_work: { start: 17, end: 22, days: [1, 2, 3, 4, 5] } };
    assert.deepEqual(mergeStoredConfig(stored, { timeWindows: tw }).timeWindows, tw);
  });
  it('M3 undefined values never erase a stored key', () => {
    assert.deepEqual(mergeStoredConfig(stored, { timeWindows: undefined }).timeWindows, stored.timeWindows);
  });
  it('M4 nothing stored yet → the patch alone', () => {
    assert.deepEqual(mergeStoredConfig(null, { customAIInstructions: 'x' }), { customAIInstructions: 'x' });
  });
  it('M5 the stored object is not mutated', () => {
    const s = { a: 1 };
    mergeStoredConfig(s, { a: 2 });
    assert.equal(s.a, 1);
  });
});
