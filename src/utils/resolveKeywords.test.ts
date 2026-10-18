import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveKeywords } from './resolveKeywords.ts';

/**
 * A keyword the owner removed must stay removed on screen (and so on the next Save).
 * Run: node --experimental-strip-types --test src/utils/resolveKeywords.test.ts
 */
const defaults = { bill: ['business_hours', 'LIFE'], email: ['business_hours', 'CAREER'] };

describe('resolveKeywords', () => {
  it('R1 a stored list replaces the defaults: a removed default keyword does not come back', () => {
    const out = resolveKeywords({ email: ['business_hours', 'CAREER'] }, defaults);
    assert.equal('bill' in out, false);
    assert.deepEqual(out, { email: ['business_hours', 'CAREER'] });
  });
  it('R2 nothing stored -> the defaults', () => {
    assert.deepEqual(resolveKeywords(undefined, defaults), defaults);
  });
  it('R3 an empty stored map -> the defaults (never a screen with zero keywords by accident)', () => {
    assert.deepEqual(resolveKeywords({}, defaults), defaults);
  });
  it('R4 a stored value overrides the default for the same keyword', () => {
    assert.deepEqual(resolveKeywords({ email: ['evening', 'LIFE'] }, defaults).email, ['evening', 'LIFE']);
  });
  it('R5 does not mutate the defaults it was given', () => {
    const out = resolveKeywords(undefined, defaults);
    out.extra = ['morning', 'LIFE'];
    assert.equal('extra' in defaults, false);
  });
});
