// WHAT:       Guards the two placement rules the owner's 2026-10-18 settings depend on:
//             a category goes ONLY in the windows it lists, and a keyword window leads then relaxes
//             to the category's windows.
// WHY:        "we will move ventures to weekends" — under the old fallback a weekends-only category
//             spread across every weekday window. "exercise can be morning or after work" — a
//             keyword used to confine a task to one window.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   huddle-extension-app .claude/actions.md ACT:scheduling-config-restore.
// Run: node --experimental-strip-types --test supabase/functions/_shared/scheduling-windows.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPreferredWindows, withKeywordWindow } from './scheduling-defaults.ts';

const WEEKDAY = ['morning', 'business_hours', 'after_work', 'evening'];
const WEEKEND = ['weekends'];
const cats = {
  VENTURES: { defaultTimeWindow: ['weekends'] },
  LIFE: { defaultTimeWindow: ['after_work', 'weekends'] },
  PROF_EDUCATION: { defaultTimeWindow: ['evening', 'weekends'] },
  ANYTIME: { defaultTimeWindow: ['flexible'] },
};

describe('getPreferredWindows', () => {
  it('W1 a weekends-only category gets NOTHING on a weekday (no spill into every window)', () => {
    assert.deepEqual(getPreferredWindows('VENTURES', cats, WEEKDAY), []);
  });
  it('W2 ...and gets the weekend window on a weekend', () => {
    assert.deepEqual(getPreferredWindows('VENTURES', cats, WEEKEND), ['weekends']);
  });
  it('W3 listed windows only, in listed order', () => {
    assert.deepEqual(getPreferredWindows('LIFE', cats, WEEKDAY), ['after_work']);
    assert.deepEqual(getPreferredWindows('PROF_EDUCATION', cats, WEEKDAY), ['evening']);
  });
  it('W4 flexible still means any open window', () => {
    assert.deepEqual(getPreferredWindows('ANYTIME', cats, WEEKDAY), WEEKDAY);
  });
  it('W5 an unmapped category keeps the old anywhere-today behaviour', () => {
    assert.deepEqual(getPreferredWindows('UNKNOWN', cats, WEEKDAY), WEEKDAY);
  });
});

describe('withKeywordWindow', () => {
  it('K1 exercise (morning) on a LIFE task = morning, then after-work', () => {
    assert.deepEqual(withKeywordWindow('morning', getPreferredWindows('LIFE', cats, WEEKDAY)), ['morning', 'after_work']);
  });
  it('K2 no duplicate when the keyword window is already the category window', () => {
    assert.deepEqual(withKeywordWindow('evening', ['evening']), ['evening']);
  });
});

// ── JOB category (owner 2026-11-03) ───────────────────────────────────────────────────────────────────────
// A saved category map used to REPLACE the defaults wholesale, so a category added later (JOB) appeared in
// Settings but the scheduler treated it as unmapped and placed it anywhere. Saved rows still win.
import { resolveConfig } from './scheduling-defaults.ts';

describe('resolveConfig fills categories the saved map does not have', () => {
  const savedWithoutJob = {
    categoryMappings: {
      CAREER: { defaultTimeWindow: ['business_hours', 'weekends'], defaultStatus: 'CAREER', estimatedDuration: 120 },
      VENTURES: { defaultTimeWindow: ['evening', 'weekends'], defaultStatus: 'VENTURES', estimatedDuration: 120 },
    },
  };
  it('J1 JOB falls back to its default row (business hours only)', () => {
    const { categoryMappings } = resolveConfig(savedWithoutJob);
    assert.deepEqual(getPreferredWindows('JOB', categoryMappings, WEEKDAY), ['business_hours']);
    assert.deepEqual(getPreferredWindows('JOB', categoryMappings, WEEKEND), []);
  });
  it('J2 a saved row is never overwritten by a default', () => {
    const { categoryMappings } = resolveConfig(savedWithoutJob);
    assert.deepEqual(categoryMappings.CAREER.defaultTimeWindow, ['business_hours', 'weekends']);
    assert.deepEqual(categoryMappings.VENTURES.defaultTimeWindow, ['evening', 'weekends']);
  });
  it('J3 with nothing saved, the defaults apply (CAREER is now after work + weekends)', () => {
    const { categoryMappings } = resolveConfig(null);
    assert.deepEqual(categoryMappings.CAREER.defaultTimeWindow, ['after_work', 'weekends']);
    assert.deepEqual(categoryMappings.JOB.defaultTimeWindow, ['business_hours']);
  });
});
