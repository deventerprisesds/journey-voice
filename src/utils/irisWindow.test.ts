// WHAT:  Guards journey's trigger for Iris's per-window message (owner, 2026-10-15: "a similar
//        message for day in the morning and for each window as they pop up").
import test from 'node:test';
import assert from 'node:assert/strict';
import { irisWindowRequest } from '../../supabase/functions/notification-delivery/iris-window.ts';

const RANGES = {
  morning: { start: 6, end: 9 }, business_hours: { start: 9, end: 17 }, after_work: { start: 17, end: 22 },
  evening: { start: 19, end: 22 }, weekends: { start: 10, end: 20 },
};
const TZ = 'America/New_York';

test('AC-IW1 a window call asks Huddle for that window, hours from journey', () => {
  assert.deepEqual(
    irisWindowRequest('window_business', 'Business call. [WINDOW:business_hours]\nBRANCH 1', 'dev@enterpriseds.io', TZ, RANGES),
    { caller: { entra_email: 'dev@enterpriseds.io' }, timeZone: TZ, window: { name: 'business_hours', start: 9, end: 17 } },
  );
});

test('AC-IW2 the MORNING window is sent as the morning edition (no window) so it shares the 8am key', () => {
  const r = irisWindowRequest('window_morning', '[WINDOW:morning] Morning kickstart', 'dev@enterpriseds.io', TZ, RANGES);
  assert.ok(r);
  assert.equal('window' in r!, false);
});

test('AC-IW3 non-window calls, unknown windows and a missing email send nothing', () => {
  assert.equal(irisWindowRequest('custom_1768837677796', '[WINDOW:morning]', 'a@b.c', TZ, RANGES), null);
  assert.equal(irisWindowRequest('window_business', 'no marker here', 'a@b.c', TZ, RANGES), null);
  assert.equal(irisWindowRequest('window_x', '[WINDOW:lunch]', 'a@b.c', TZ, RANGES), null);
  assert.equal(irisWindowRequest('window_business', '[WINDOW:business_hours]', null, TZ, RANGES), null);
});
