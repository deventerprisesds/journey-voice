// =============================================================================
// WHAT:       executable proof for the digest delivery planner.
// WHY:        the owner got none of his digests. Measured cause: notification-scheduler:523 reads
//             the user's channel preference into `userChannels` and never uses it, invoking
//             send-push-notification unconditionally — so "I changed it to email" could not work.
//             These tests exist so that defect cannot be reintroduced by a fallback.
// EVIDENCE:   .claude/actions.md ACT:digest-delivery-journey.
// Run: npm test   (node --experimental-strip-types --test src/utils/*.test.ts)
// =============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectDigestChannels,
  inQuietHours,
  planDigestRun,
} from '../../supabase/functions/_shared/digest-delivery.ts';

/** 2026-09-14 08:05 America/New_York = 12:05 UTC (EDT, UTC-4). */
const AT_8AM_ET = new Date('2026-09-14T12:05:00Z');
/** Same wall-clock hour in January, when New York is EST (UTC-5) — proves DST is not assumed. */
const AT_8AM_ET_WINTER = new Date('2027-01-14T13:05:00Z');
const AT_3PM_ET = new Date('2026-09-14T19:05:00Z');

const prefs = (o: Record<string, unknown> = {}) => ({
  user_id: 'u1',
  timezone: 'America/New_York',
  channels: ['EMAIL'],
  daily_digest_enabled: true,
  ...o,
});

describe('selectDigestChannels', () => {
  it('keeps every read channel the user picked, in order, deduped', () => {
    assert.deepEqual(selectDigestChannels(['EMAIL', 'SLACK', 'EMAIL']), ['email', 'slack']);
  });

  it('accepts the renderer aliases the vocabulary table absorbed', () => {
    assert.deepEqual(selectDigestChannels(['app']), ['app_message']);
    assert.deepEqual(selectDigestChannels(['in_app']), ['app_message']);
  });

  it('drops PHONE — a digest is a document, not a call', () => {
    // Reading a ranked list and a drag-to-rank link down a phone line reproduces the scheduled
    // call the owner already has. Phone stays the CALL channel.
    assert.deepEqual(selectDigestChannels(['PHONE', 'EMAIL']), ['email']);
    assert.deepEqual(selectDigestChannels(['PHONE']), []);
  });

  it('drops an unrecognised channel rather than guessing at it', () => {
    assert.deepEqual(selectDigestChannels(['CARRIER_PIGEON', 'EMAIL']), ['email']);
  });

  it('an empty/absent preference yields NOTHING — never a default', () => {
    assert.deepEqual(selectDigestChannels([]), []);
    assert.deepEqual(selectDigestChannels(null), []);
    assert.deepEqual(selectDigestChannels(undefined), []);
  });
});

describe('inQuietHours', () => {
  it('handles a same-day window', () => {
    assert.equal(inQuietHours(13 * 60, '12:00', '14:00'), true);
    assert.equal(inQuietHours(11 * 60, '12:00', '14:00'), false);
    assert.equal(inQuietHours(14 * 60, '12:00', '14:00'), false, 'end is exclusive');
  });

  it('handles the OVERNIGHT window, which a naive start<=t<end gets wrong for every minute', () => {
    assert.equal(inQuietHours(23 * 60, '22:00', '07:00'), true);
    assert.equal(inQuietHours(3 * 60, '22:00', '07:00'), true);
    assert.equal(inQuietHours(8 * 60, '22:00', '07:00'), false);
  });

  it('unset or unparseable quiet hours mean no quiet hours, never all-day silence', () => {
    assert.equal(inQuietHours(3 * 60, null, null), false);
    assert.equal(inQuietHours(3 * 60, 'never', '07:00'), false);
    assert.equal(inQuietHours(3 * 60, '22:00', '22:00'), false);
  });
});

describe('planDigestRun', () => {
  it('at the local 8am with a channel, plans all three digests', () => {
    const p = planDigestRun(prefs(), AT_8AM_ET);
    assert.equal(p.skipReason, undefined);
    assert.deepEqual(p.digests, ['daily_brief', 'meetings', 'standup']);
    assert.deepEqual(p.channels, ['email']);
    assert.equal(p.date, '2026-09-14');
  });

  it("8am means the USER'S 8am in both DST and standard time", () => {
    // Same wall clock, four months apart, one hour apart in UTC. A fixed -5 or -4 fails one of these.
    const summer = planDigestRun(prefs(), AT_8AM_ET);
    const winter = planDigestRun(prefs(), AT_8AM_ET_WINTER);
    assert.equal(summer.skipReason, undefined, 'EDT');
    assert.equal(winter.skipReason, undefined, 'EST');
    assert.equal(winter.date, '2027-01-14');
  });

  it('does not fire outside the local hour', () => {
    assert.equal(planDigestRun(prefs(), AT_3PM_ET).skipReason, 'outside_local_hour');
  });

  it('NO DELIVERABLE CHANNEL sends nothing — it does NOT fall back to push', () => {
    // THE defect this module exists to end. A fallback here is what made the owner's explicit
    // email choice invisible for weeks while the logs read "delivered".
    for (const ch of [[], ['PHONE'], null] as (string[] | null)[]) {
      const p = planDigestRun(prefs({ channels: ch }), AT_8AM_ET);
      assert.equal(p.skipReason, 'no_deliverable_channel', JSON.stringify(ch));
      assert.deepEqual(p.digests, [], 'nothing may be planned without a channel');
      assert.deepEqual(p.channels, []);
    }
  });

  it('respects the digest being switched off', () => {
    assert.equal(planDigestRun(prefs({ daily_digest_enabled: false }), AT_8AM_ET).skipReason,
      'daily_digest_disabled');
  });

  it('respects quiet hours that cover 8am', () => {
    const p = planDigestRun(prefs({ quiet_hours_start: '06:00', quiet_hours_end: '09:00' }), AT_8AM_ET);
    assert.equal(p.skipReason, 'quiet_hours');
  });

  it('immediate bypasses the hour and quiet-hours gates but NOT the channel gate', () => {
    // The manual/test path must not require waiting until 8am in the user's zone...
    const ok = planDigestRun(
      prefs({ quiet_hours_start: '06:00', quiet_hours_end: '09:00' }), AT_3PM_ET, { immediate: true });
    assert.equal(ok.skipReason, undefined);
    assert.deepEqual(ok.digests, ['daily_brief', 'meetings', 'standup']);
    // ...but it must not become a way to send to nowhere either.
    const noCh = planDigestRun(prefs({ channels: [] }), AT_3PM_ET, { immediate: true });
    assert.equal(noCh.skipReason, 'no_deliverable_channel');
  });

  it('a missing timezone falls back rather than skipping the user', () => {
    const p = planDigestRun(prefs({ timezone: null }), AT_8AM_ET);
    assert.equal(p.timezone, 'America/New_York');
    assert.equal(p.skipReason, undefined);
  });

  it('every skip carries a REASON, so a run log can say why nothing was sent', () => {
    const reasons = [
      planDigestRun(prefs({ daily_digest_enabled: false }), AT_8AM_ET),
      planDigestRun(prefs(), AT_3PM_ET),
      planDigestRun(prefs({ channels: [] }), AT_8AM_ET),
    ];
    for (const r of reasons) assert.ok(r.skipReason, 'a skip with no reason is an unexplained silence');
  });
});
