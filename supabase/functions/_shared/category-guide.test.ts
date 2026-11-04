// WHAT:       Guards the category briefing the task parser sends the AI: definitions, employer, name hints.
// WHY:        Owner 2026-11-03: employer work must land in JOB even when the employer is not named, and the
//             names the AI relies on must be editable in Settings, not typed into the prompt.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   docs/qc-evidence/AC-job-category.md AC-D1..D4.
// Run: node --experimental-strip-types --test supabase/functions/_shared/category-guide.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCategoryGuide, categoryHintsFromKeywords } from './category-guide.ts';
import { CATEGORY_KEYS } from './categories.ts';

describe('categoryHintsFromKeywords', () => {
  it('G-1 only Flexible rows with a category lane are name hints', () => {
    const hints = categoryHintsFromKeywords({
      huddle: ['flexible', 'VENTURES'],
      power_bi: ['flexible', 'JOB'],
      work: ['business_hours', 'JOB'],          // a scheduling rule, not a hint
      morning: ['morning', 'flexible'],         // lane is not a category
      appointment: ['flexible', 'notacategory'],
    });
    assert.deepEqual(hints, [
      { name: 'huddle', category: 'VENTURES' },
      { name: 'power bi', category: 'JOB' },
    ]);
  });
  it('G-2 tolerates a missing keyword map', () => {
    assert.deepEqual(categoryHintsFromKeywords(undefined), []);
  });
});

describe('buildCategoryGuide', () => {
  it('G-3 names the employer from the profile, and says unnamed work is still JOB', () => {
    const g = buildCategoryGuide({ employer: 'Trinnex' });
    assert.match(g, /EMPLOYER is Trinnex/);
    assert.match(g, /whether or not "Trinnex" appears/);
  });
  it('G-4 with no employer there is no "null" or "undefined" text, and JOB still applies', () => {
    for (const employer of [null, '', '   ', undefined]) {
      const g = buildCategoryGuide({ employer });
      assert.doesNotMatch(g, /null|undefined/);
      assert.match(g, /Work for an employer is still JOB/);
    }
  });
  it('G-5 lists every category and the owner rulings', () => {
    const g = buildCategoryGuide({});
    for (const k of CATEGORY_KEYS) assert.match(g, new RegExp(`- ${k}:`));
    assert.match(g, /SDLC .*JOB, even when one of the owner's own products is named/);
    assert.match(g, /ops decks and ops process diagrams are JOB/);
  });
  it('G-6 groups the hints by category', () => {
    const g = buildCategoryGuide({ hints: [
      { name: 'huddle', category: 'VENTURES' }, { name: 'esri', category: 'JOB' }, { name: 'nexus', category: 'VENTURES' },
    ] });
    assert.match(g, /- JOB: esri/);
    assert.match(g, /- VENTURES: huddle, nexus/);
  });
  it('G-7 the hint list says the SDLC rule beats a product hint (live scorecard E-21 miss, 2026-11-04)', () => {
    const g = buildCategoryGuide({ hints: [{ name: 'sidecar', category: 'VENTURES' }] });
    assert.match(g, /NAME HINTS .*EXCEPT that rule 1 below always wins: SDLC/);
  });
});
