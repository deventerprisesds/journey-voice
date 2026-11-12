// WHAT:       Tests for done-slot.ts and its wiring into STEP 1.25 of nightly-schedule-builder.
// WHY:        A DONE task must stay on the schedule once its slot has started (owner 2026-11-12).
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   2026-11-12 08:34 ET rebuild removed "Create two Trinnex images" (DONE at 07:45, slot 08:00-10:00).
// Run: node --experimental-strip-types --no-warnings --test supabase/functions/_shared/done-slot.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freesSlot } from './done-slot.ts';

const now = new Date('2026-11-12T13:34:29Z'); // 08:34 ET

describe('done tasks keep their slot once it has started', () => {
  it('DS-1 the real case: slot 08:00-10:00 ET, rebuilt at 08:34 -> stays', () => {
    assert.equal(freesSlot('2026-11-12T13:00:00Z', now), false);
  });
  it('DS-2 earlier days stay; a slot later today or tomorrow is freed', () => {
    assert.equal(freesSlot('2026-11-11T14:00:00Z', now), false);
    assert.equal(freesSlot('2026-11-12T20:00:00Z', now), true);
    assert.equal(freesSlot('2026-11-13T13:00:00Z', now), true);
  });
  it('DS-3 missing or junk start times are never removed', () => {
    for (const v of [null, undefined, '', 'not a date']) assert.equal(freesSlot(v as any, now), false);
  });
  it('DS-4 STEP 1.25 filters through freesSlot before clearing', () => {
    const src = readFileSync(new URL('../nightly-schedule-builder/index.ts', import.meta.url), 'utf8');
    const step = src.indexOf('STEP 1.25');
    const filt = src.indexOf('.filter((t: any) => frees_slot(t.start_time, now))', step);
    const clear = src.indexOf('for (const dt of doneTasks)', step);
    assert.ok(step > 0 && filt > step && clear > filt, 'filter sits between the read and the clear');
  });
});
