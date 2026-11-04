// WHAT:       Tests for resolveCategoryWeights (scheduling-defaults.ts): education outranks other work in a
//             contested slot by default; the owner's saved weights win per category.
// WHY:        Owner 2026-11-04: "education should have heavier weight if a conflict" -- the scorer had no
//             category term, so a priority-flagged Ventures task (+10..15) always beat coursework.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   nightly build 2026-11-04 SCORING_AUDIT: Ventures priority tasks scored 25, coursework 19-21.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveCategoryWeights, DEFAULT_CATEGORY_WEIGHTS } from './scheduling-defaults.ts';

describe('category weights', () => {
  it('CW-1 unsaved: education seeded above Ventures (Ventures 0)', () => {
    const w = resolveCategoryWeights({});
    assert.ok((w.PROF_EDUCATION ?? 0) > (w.VENTURES ?? 0));
    assert.ok((w.PROF_EDUCATION ?? 0) >= 16, 'beats a priority-flagged Ventures bonus (+10..+15)');
    assert.deepEqual(w, DEFAULT_CATEGORY_WEIGHTS);
  });
  it('CW-2 saved values win per category; other seeds remain; junk ignored', () => {
    const w = resolveCategoryWeights({ categoryWeights: { PROF_EDUCATION: 5, VENTURES: 2, LIFE: 'x' } });
    assert.equal(w.PROF_EDUCATION, 5);
    assert.equal(w.VENTURES, 2);
    assert.equal(w.EDUCATION, 20);
    assert.equal(w.LIFE, undefined);
  });
  it('CW-3 the builder adds the category weight to every candidate score', () => {
    const src = readFileSync(new URL('../nightly-schedule-builder/index.ts', import.meta.url), 'utf8');
    assert.match(src, /const categoryWeights = resolveCategoryWeights\(config\);/);
    assert.match(src, /score \+= categoryWeights\[String\(task\.category\)\] \?\? 0;/);
  });
});
