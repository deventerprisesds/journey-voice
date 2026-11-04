// WHAT:       Guards the shared category list and the normaliser every write path uses.
// WHY:        The voice assistant turned "JOB" into CAREER and "PROF_EDUCATION" into EDUCATION because it
//             matched substrings before exact names; execute-tool upper-cased anything and let the insert fail.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   docs/qc-evidence/AC-job-category.md section 3b (N-1..N-11), AC-D5.
// Run: node --experimental-strip-types --test supabase/functions/_shared/categories.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATEGORY_KEYS, CATEGORY_LABELS, normalizeCategory, recognizeCategory, toCategoryKey, laneCoversCategory } from './categories.ts';

describe('CATEGORY_KEYS', () => {
  it('C-1 holds every value of the task_category enum plus JOB, JOB directly before CAREER', () => {
    assert.deepEqual([...CATEGORY_KEYS], ['LIFE', 'JOB', 'CAREER', 'VENTURES', 'EDUCATION', 'PROF_EDUCATION', 'PERSONAL']);
  });
  it('C-2 matches the generated database enum (task_category) once JOB is added', () => {
    const types = readFileSync(new URL('../../../src/integrations/supabase/types.ts', import.meta.url), 'utf8');
    const m = types.match(/task_category:\s*\n?\s*((?:\|?\s*"[A-Z_]+"\s*)+)/);
    assert.ok(m, 'task_category union not found in types.ts');
    const enumVals = [...m![1].matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]).sort();
    assert.deepEqual(enumVals, [...CATEGORY_KEYS].sort());
  });
  it('C-3 every category has a label', () => {
    for (const k of CATEGORY_KEYS) assert.ok(CATEGORY_LABELS[k]?.length, k);
  });
});

describe('normalizeCategory (section 3b)', () => {
  const rows: Array<[string, unknown, string]> = [
    ['N-1', 'JOB', 'JOB'],
    ['N-2a', 'job', 'JOB'],
    ['N-2b', ' Job ', 'JOB'],
    ['N-3', 'CAREER', 'CAREER'],
    ['N-4a', 'PROF_EDUCATION', 'PROF_EDUCATION'],
    ['N-4b', 'prof education', 'PROF_EDUCATION'],
    ['N-5a', 'job search', 'CAREER'],
    ['N-5b', 'job_search', 'CAREER'],
    ['N-6', 'work', 'JOB'],
    ['N-7', 'homework', 'EDUCATION'],
    ['N-9a', 'VENTURES', 'VENTURES'],
    ['N-9b', 'startup', 'VENTURES'],
    ['N-10a', '', 'LIFE'],
    ['N-10b', undefined, 'LIFE'],
    ['N-11', 'GARDENING', 'LIFE'],
    ['N-12', 'career', 'CAREER'],
    ['N-13', 'education', 'EDUCATION'],
    ['N-14', 'PERSONAL', 'PERSONAL'],
    ['N-8', 'networking', 'CAREER'],
    ['N-15', 'workout', 'LIFE'],
    ['N-16', 'Work', 'JOB'],
  ];
  for (const [id, input, want] of rows) {
    it(`${id} normalise`, () => assert.equal(normalizeCategory(input), want, JSON.stringify(input)));
  }
});

describe('toCategoryKey / laneCoversCategory', () => {
  it('T-1 only exact names resolve', () => {
    assert.equal(toCategoryKey('flexible'), null);
    assert.equal(toCategoryKey('TODO'), null);
    assert.equal(toCategoryKey('job'), 'JOB');
  });
  it('T-2 PERSONAL counts as LIFE and EDUCATION as PROF_EDUCATION, for the keyword rule only', () => {
    assert.equal(laneCoversCategory('LIFE', 'PERSONAL'), true);
    assert.equal(laneCoversCategory('PROF_EDUCATION', 'EDUCATION'), true);
    assert.equal(laneCoversCategory('LIFE', 'JOB'), false);
    assert.equal(laneCoversCategory('JOB', 'CAREER'), false);
    assert.equal(laneCoversCategory('EDUCATION', 'PROF_EDUCATION'), false);
  });
});

describe('recognizeCategory (UPDATE paths keep the current category on an unrecognised value)', () => {
  it('R-1 unrecognised values are null, never LIFE', () => {
    for (const v of ['FAMILY', 'Office', 'GARDENING', '', undefined]) assert.equal(recognizeCategory(v), null, String(v));
  });
  it('R-2 recognised values match normalizeCategory', () => {
    for (const v of ['JOB', 'work', 'Employment', 'job search', 'startup', 'homework']) {
      assert.equal(recognizeCategory(v), normalizeCategory(v), v);
    }
    assert.equal(recognizeCategory('Employment'), 'JOB');
  });
});
