// =============================================================================
// WHAT:       executable proof for the multi-select channel rules.
// WHY:        loop 2 of verification: "handleToggleCallCommsMode has no test — C7 is the one claim
//             this loop could not mutation-prove." The behaviour was confirmed by READING the
//             source, which is weaker than running it, and leaves the two load-bearing rules
//             (legacy fallback, last-channel floor) undefended against a future edit.
// EVIDENCE:   .claude/VERIFY-digest-delivery-loop2.md, unclaimed finding 3.
// Run: npm test
// =============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectedCommsModes, toggleCommsMode } from './commsModes.ts';

describe('selectedCommsModes — the legacy fallback', () => {
  it('prefers the multi-select array when it has entries', () => {
    assert.deepEqual(
      selectedCommsModes({ commsModes: ['email', 'slack'], commsMode: 'phone' }),
      ['email', 'slack'],
    );
  });

  it('falls back to the scalar for an EXISTING row that has no array', () => {
    // Every stored row predating the multi-select control looks like this. If the fallback broke,
    // every one of them would silently become a phone call.
    assert.deepEqual(selectedCommsModes({ commsMode: 'email' }), ['email']);
    assert.deepEqual(selectedCommsModes({ commsModes: [], commsMode: 'slack' }), ['slack']);
  });

  it("defaults to phone only when there is nothing at all — matching the server's last resort", () => {
    // notification-delivery/index.ts:178 ends `?? 'phone'` for the identical reason.
    assert.deepEqual(selectedCommsModes({}), ['phone']);
    assert.deepEqual(selectedCommsModes({ commsModes: [], commsMode: undefined }), ['phone']);
  });
});

describe('toggleCommsMode', () => {
  it('adds a channel without disturbing the existing ones', () => {
    const r = toggleCommsMode({ commsModes: ['email'], commsMode: 'email' }, 'slack', true);
    assert.deepEqual(r.commsModes, ['email', 'slack']);
  });

  it('adding a channel already present is idempotent, not a duplicate', () => {
    const r = toggleCommsMode({ commsModes: ['email'], commsMode: 'email' }, 'email', true);
    assert.deepEqual(r.commsModes, ['email']);
  });

  it('removes a channel when more than one remains', () => {
    const r = toggleCommsMode({ commsModes: ['email', 'slack'], commsMode: 'email' }, 'email', false);
    assert.deepEqual(r.commsModes, ['slack']);
  });

  it('REFUSES to remove the last channel — a call with none delivers nowhere', () => {
    // The floor. Without it a user can save a call that schedules, fires, and silently reaches
    // no one — indistinguishable from a broken sender, which is the bug this whole lane started as.
    const call = { commsModes: ['email' as const], commsMode: 'email' as const };
    const r = toggleCommsMode(call, 'email', false);
    assert.equal(r, call, 'the toggle must be a no-op, returning the same object');
    assert.deepEqual(r.commsModes, ['email']);
  });

  it('refuses the last channel even when it was only ever the legacy scalar', () => {
    const call = { commsMode: 'phone' as const };
    const r = toggleCommsMode(call, 'phone', false);
    assert.deepEqual(selectedCommsModes(r), ['phone']);
  });

  it('keeps the scalar in step with the head of the array', () => {
    // scheduleNextOccurrence copies `comms_mode` onto tomorrow's row. A stale scalar would
    // resurrect a channel the user just switched off, one day later.
    const r = toggleCommsMode({ commsModes: ['email', 'slack'], commsMode: 'email' }, 'email', false);
    assert.equal(r.commsMode, 'slack', 'the scalar must follow, not keep the removed channel');
    assert.equal(r.commsMode, r.commsModes![0]);
  });

  it('never mutates the input', () => {
    const call = { commsModes: ['email' as const], commsMode: 'email' as const };
    const before = JSON.stringify(call);
    toggleCommsMode(call, 'slack', true);
    assert.equal(JSON.stringify(call), before);
  });

  it('survives a full round trip back to one channel', () => {
    let call: { commsMode?: 'phone' | 'app_message' | 'slack' | 'email'; commsModes?: ('phone' | 'app_message' | 'slack' | 'email')[] } =
      { commsMode: 'phone' };
    for (const m of ['email', 'slack', 'app_message'] as const) call = toggleCommsMode(call, m, true);
    assert.deepEqual(call.commsModes, ['phone', 'email', 'slack', 'app_message']);
    for (const m of ['phone', 'email', 'slack'] as const) call = toggleCommsMode(call, m, false);
    assert.deepEqual(call.commsModes, ['app_message']);
    // ...and the floor still holds at the bottom.
    call = toggleCommsMode(call, 'app_message', false);
    assert.deepEqual(call.commsModes, ['app_message']);
  });
});
