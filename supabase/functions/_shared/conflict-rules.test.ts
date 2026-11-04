// WHAT:       Tests for owner-defined conflict rules (conflict-rules.ts) and their wiring into the builder sort.
// WHY:        Owner 2026-11-04: weights must be data the owner sets, used only when tasks compete.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   _shared/conflict-rules.ts header.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveConflictRules, conflictWeightOf } from './conflict-rules.ts';

const rules = resolveConflictRules({
  conflictRules: [
    { id: 'c', label: 'Coursework', match: { kind: 'coursework' }, weight: 30 },
    { id: 'v', match: { kind: 'category', value: 'ventures' }, weight: 5 },
    { id: 't', match: { kind: 'tag', value: 'Urgent-Client' }, weight: 12 },
    { id: 'off', match: { kind: 'category', value: 'LIFE' }, weight: 99, enabled: false },
    { id: 'bad', match: { kind: 'nonsense' }, weight: 50 },
    { id: 'nan', match: { kind: 'tag', value: 'x' }, weight: 'high' },
  ],
});

describe('conflict rules', () => {
  it('CR-1 no rules configured = everything weighs 0 (today\'s behaviour, nothing hard-coded)', () => {
    assert.deepEqual(resolveConflictRules({}), []);
    assert.equal(conflictWeightOf({ category: 'PROF_EDUCATION', assignment_id: 'x' }, []), 0);
  });

  it('CR-2 malformed or disabled rules are dropped, never guessed', () => {
    assert.deepEqual(rules.map((r) => r.id), ['c', 'v', 't']);
  });

  it('CR-3 "coursework" matches an assignment card AND its work sessions, not other education tasks', () => {
    assert.equal(conflictWeightOf({ category: 'PROF_EDUCATION', assignment_id: 'nx1' }, rules), 30);
    assert.equal(conflictWeightOf({ category: 'PROF_EDUCATION', assignment_id: 'nx1::session-2' }, rules), 30);
    assert.equal(conflictWeightOf({ category: 'PROF_EDUCATION', assignment_id: null }, rules), 0, 'e.g. "Start AI certification course"');
  });

  it('CR-4 category and tag selectors are case-insensitive; the highest matching weight wins', () => {
    assert.equal(conflictWeightOf({ category: 'VENTURES' }, rules), 5);
    assert.equal(conflictWeightOf({ category: 'VENTURES', tags: ['urgent-client'] }, rules), 12);
    assert.equal(conflictWeightOf({ category: 'LIFE' }, rules), 0, 'disabled rule ignored');
  });

  it('CR-5 the builder sort compares conflict weight BEFORE is_priority for ordinary candidates', () => {
    const src = readFileSync(new URL('../nightly-schedule-builder/index.ts', import.meta.url), 'utf8');
    const i = src.indexOf('// Everyone else (Tier C + non-assignment) competes on the same comparator');
    assert.ok(i > 0, 'comparator found');
    const block = src.slice(i, i + 900);
    const w = block.indexOf('conflictWeightOf(');
    const p = block.indexOf('is_priority');
    assert.ok(w > 0 && p > 0 && w < p, 'conflict weight is compared first');
    assert.match(src, /const conflictRules = resolveConflictRules\(config\);/);
  });
});
