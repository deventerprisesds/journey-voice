// WHAT:       Tests for the Settings "ignore these Outlook categories" helpers and their save path.
// WHY:        Owner 2026-11-22: "ignore a category with purple being the category to turn on for ignoring now".
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   .claude/ac-calendar-ignore-categories.md AC-29..AC-33.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OUTLOOK_DEFAULT_CATEGORIES, cleanCategoryList, isCategoryListed, setCategory, addCategories } from './calendarIgnoreCategories.ts';
import { mergeStoredConfig } from './mergeStoredConfig.ts';

test('CAT-1 AC-31 the six Outlook default colour names, in order', () => {
  assert.deepEqual([...OUTLOOK_DEFAULT_CATEGORIES], ['Red category', 'Orange category', 'Yellow category', 'Green category', 'Blue category', 'Purple category']);
});

test('CAT-2 AC-32 unticking the last one saves an EXPLICIT [] that actually replaces the stored list', () => {
  const next = setCategory(['Purple category'], 'Purple category', false);
  assert.deepEqual(next, []);
  const saved = mergeStoredConfig({ calendarIgnoreCategories: ['Purple category'], calendarIgnoreTentative: false }, { calendarIgnoreCategories: next });
  assert.deepEqual(saved.calendarIgnoreCategories, []);
  assert.equal(saved.calendarIgnoreTentative, false);
});

test('CAT-3 AC-30 an unrelated save keeps the stored list', () => {
  const saved = mergeStoredConfig({ calendarIgnoreCategories: ['Purple category'] }, { timeWindows: {}, calendarIgnoreCategories: undefined });
  assert.deepEqual(saved.calendarIgnoreCategories, ['Purple category']);
});

test('CAT-4 ticking is case-insensitive and never duplicates', () => {
  assert.deepEqual(setCategory(['purple category'], 'Purple category', true), ['Purple category']);
  assert.deepEqual(setCategory(undefined, 'Blue category', true), ['Blue category']);
  assert.equal(isCategoryListed(['purple CATEGORY'], 'Purple category'), true);
  assert.equal(isCategoryListed(['Dark Purple category'], 'Purple category'), false);
  assert.equal(isCategoryListed('Purple category', 'Purple category'), false);
});

test('CAT-5 AC-33 a typed custom name is trimmed; blanks and case-only duplicates are skipped', () => {
  assert.deepEqual(addCategories(['Purple category'], '  Client X  , , purple category,'), ['Purple category', 'Client X']);
  assert.deepEqual(addCategories(undefined, ''), []);
  assert.deepEqual(cleanCategoryList([' A ', 'a', 3, null, '']), ['A']);
});

test('CAT-6 AC-29 the Settings loader passes the stored list through (undefined when never saved)', () => {
  const src = readFileSync(new URL('../config/schedulingRules.ts', import.meta.url), 'utf8');
  assert.match(src, /calendarIgnoreCategories: Array\.isArray\(userConfig\.calendarIgnoreCategories\) \? userConfig\.calendarIgnoreCategories : undefined,/);
  const ui = readFileSync(new URL('../components/SchedulingSettings.tsx', import.meta.url), 'utf8');
  assert.match(ui, /calendarIgnoreCategories: setCategory\(config\.calendarIgnoreCategories, name, e\.target\.checked\)/);
  assert.match(ui, /calendarIgnoreCategories: addCategories\(config\.calendarIgnoreCategories, el\.value\)/);
  // A name typed without Enter is kept when the box loses focus (verifier loop 2: nothing pinned it).
  assert.match(ui, /onBlur=\{\(e\) => \{\n\s*if \(!e\.currentTarget\.value\.trim\(\)\) return;\n\s*setConfig\(\{ \.\.\.config, calendarIgnoreCategories: addCategories\(config\.calendarIgnoreCategories, e\.currentTarget\.value\) \}\);/);
});
