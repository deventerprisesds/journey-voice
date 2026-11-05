// WHAT:       Tests for the per-account nightly on/off switch (nightly-switch.ts + its builder wiring).
// WHY:        Owner 2026-11-05: control in Settings which accounts the nightly schedule runs for.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   cron.job 11 and the builder ran every user_scheduling_prefs row with no filter.
// Run: node --experimental-strip-types --no-warnings --test supabase/functions/_shared/nightly-switch.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nightlySetting, skipNightlyRun } from './nightly-switch.ts';

describe('nightly on/off switch', () => {
  it('NS-1 defaults ON: no key, empty object, null, junk values all build', () => {
    for (const cfg of [undefined, null, {}, { nightlySchedule: null }, { nightlySchedule: {} },
      { nightlySchedule: { enabled: 'false' } }, { nightlySchedule: { enabled: 0 } }, { nightlySchedule: true }]) {
      assert.equal(nightlySetting(cfg).enabled, true, JSON.stringify(cfg));
      assert.equal(skipNightlyRun(cfg, 'cron'), false, JSON.stringify(cfg));
    }
  });

  it('NS-2 enabled:false skips the scheduled run only', () => {
    const off = { nightlySchedule: { enabled: false } };
    assert.equal(skipNightlyRun(off, 'cron'), true);
    assert.equal(skipNightlyRun(off, 'manual_reschedule'), false, 'an asked-for rebuild still runs');
    assert.equal(skipNightlyRun({ nightlySchedule: { enabled: true } }, 'cron'), false);
  });

  it('NS-3 label is trimmed, and blank/non-string labels are null', () => {
    assert.equal(nightlySetting({ nightlySchedule: { label: '  Demo  ' } }).label, 'Demo');
    assert.equal(nightlySetting({ nightlySchedule: { label: '   ' } }).label, null);
    assert.equal(nightlySetting({ nightlySchedule: { label: 5 } }).label, null);
  });

  it('NS-4 the builder checks the switch inside the per-account loop, before any work', () => {
    const src = readFileSync(new URL('../nightly-schedule-builder/index.ts', import.meta.url), 'utf8');
    const loop = src.indexOf('for (const userPref of filteredUsers)');
    const check = src.indexOf('skipNightlyRun(config, triggerSource)', loop);
    const firstWork = src.indexOf('resolveConfig(config)', loop);
    assert.ok(loop > 0 && check > loop, 'switch is read inside the account loop');
    assert.ok(check < firstWork, 'switch is read before the account is processed');
  });
});
