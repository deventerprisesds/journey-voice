/**
 * WHAT:       Tests for nudge wording, the digest's date bound / duplicate suppression, and
 *             the builder sites that persist and deliver them (AC-4.x, AC-7.x, AC-8.x).
 * WHY:        The last round's tests "could not have failed: they called my new function
 *             directly, never the path that persists and renders the message"
 *             (.claude/accuracy-log.md). So every case here starts from a REAL persisted
 *             row and ends at the string or the row the user actually gets — and the parts
 *             that live inside the Deno edge function (which node cannot import, it calls
 *             Deno.serve at module scope) are asserted against that file's SOURCE, so
 *             reinstating any of the four original defects fails a named test here.
 * SUPERSEDES: nothing.
 * SUPERSEDED-BY: nothing — current.
 * EVIDENCE:   fixtures captured live 2026-09-03; each block names its query.
 *
 * Run: `node --experimental-strip-types --test supabase/functions/_shared/nudges.test.ts`
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  buildVenueNudgeMessage,
  buildOverflowNudgeMessage,
  localTimeLabel,
  localDayOf,
  isNonWorkingDayLocal,
  venueNudge,
  overflowNudge,
  composeDigest,
  deliverNudgeDigest,
  planDigestDelivery,
  digestFingerprint,
  resolveDeliverHour,
  nextLocalHour,
  NUDGE_DIGEST_SOURCE,
  type Nudge,
} from './nudges.ts';

const TZ = 'America/New_York';
/** The primary user's LIVE config: select config->'timeWindows'->'business_hours' … */
const BUSINESS_HOURS = { start: 9, end: 17, days: [1, 2, 3, 4, 5] };

/**
 * THE REAL VENUE-NUDGE ROWS, captured 2026-09-03 via:
 *   select id, title, start_time, is_scheduled, scheduling_context->'venue_nudge'
 *   from public.tasks
 *   where user_id='a3378f93-d655-4913-b2fa-ca5b1d8020f1'
 *     and scheduling_context ? 'venue_nudge' order by start_time nulls last;
 * `stored` is the string that was ACTUALLY in the database at capture time — the
 * placement-blind template this work replaces. Every row carried the identical sentence,
 * including the one with no placement at all.
 */
const LIVE_VENUE_ROWS = [
  { id: '9102fa44-957e-4c7b-8aaa-e3d2ded70cfc', title: 'Buy new cord for Ghost', start_time: '2026-09-04T00:15:00+00:00', localWhen: 'Thu 20:15 ET' },
  { id: 'cf9e4947-a990-4818-9211-7a7ac05b9cfa', title: 'Pick up daughter from college', start_time: '2026-09-04T21:45:00+00:00', localWhen: 'Fri 17:45 ET' },
  { id: 'de043262-6d13-4b53-8b9c-5783b3350d45', title: "Pick up wife's vehicle from the shop", start_time: '2026-09-04T22:15:00+00:00', localWhen: 'Fri 18:15 ET' },
  { id: 'efce3e3b-8f44-4524-8996-6117b44f782f', title: 'Take son shoe shopping', start_time: '2026-09-05T20:00:00+00:00', localWhen: 'Sat 16:00 ET' },
  { id: 'c6e29a60-5448-439a-9ec5-7e542d453e0f', title: "Cancel or take wife's SUV for repair", start_time: '2026-09-07T22:00:00+00:00', localWhen: 'Mon 18:00 ET' },
  { id: 'f6cb9caf-8028-4b5b-88fd-73768aa43459', title: 'Go to church', start_time: null, localWhen: 'never placed (is_scheduled=false)' },
];
const STORED_TEMPLATE_FRAGMENT = 'is scheduled after work, but this kind of errand';

const BUILDER_SRC = readFileSync(
  fileURLToPath(new URL('../nightly-schedule-builder/index.ts', import.meta.url)), 'utf8',
);

// ---------------------------------------------------------------------------
// AC-8b — the time is real, to the minute, in am/pm
// ---------------------------------------------------------------------------
test('AC-8b every live placement is stated to the minute in am/pm, never hour-floored 24h', () => {
  // The verifier measured the old wording turning 17:45 into "17:00" and 20:15 into
  // "20:00" — a message whose whole justification is accuracy, misstating the time by up
  // to 45 minutes. These are the four real placements that raise a nudge.
  const expected: Record<string, string> = {
    'Buy new cord for Ghost': '"Buy new cord for Ghost" is scheduled at 8:15 pm, after most places close. Move it into business hours?',
    'Pick up daughter from college': '"Pick up daughter from college" is scheduled at 5:45 pm, after most places close. Move it into business hours?',
    "Pick up wife's vehicle from the shop": '"Pick up wife\'s vehicle from the shop" is scheduled at 6:15 pm, after most places close. Move it into business hours?',
    "Cancel or take wife's SUV for repair": '"Cancel or take wife\'s SUV for repair" is scheduled at 6:00 pm, after most places close. Move it into business hours?',
  };
  for (const row of LIVE_VENUE_ROWS) {
    if (!row.start_time) continue;
    const msg = buildVenueNudgeMessage(row.title, row.start_time, TZ, BUSINESS_HOURS);
    if (row.title === 'Take son shoe shopping') {
      assert.equal(msg, null, 'Sat 16:00 is a sensible daytime slot — no nudge');
      continue;
    }
    assert.equal(msg, expected[row.title], row.localWhen);
    assert.ok(!/\b\d{1,2}:00,/.test(msg!) || /:00 [ap]m/.test(msg!), 'no bare 24h form');
    assert.ok(/\d{1,2}:\d{2} (am|pm)/.test(msg!), `am/pm to the minute: ${msg}`);
  }
  assert.equal(localTimeLabel('2026-09-04T21:45:00+00:00', TZ), '5:45 pm');
  assert.equal(localTimeLabel('2026-09-04T04:00:00+00:00', TZ), '12:00 am', 'midnight is 12:00 am, not 24:00');
});

// ---------------------------------------------------------------------------
// AC-7 — the message describes the REAL placement; no placement => no nudge
// ---------------------------------------------------------------------------
test('AC-7a a task with no start_time can raise no venue nudge at all', () => {
  // The live "Go to church" row carried a venue_nudge marker with start_time NULL and
  // is_scheduled=false — a stored sentence describing a placement that never happened.
  const row = LIVE_VENUE_ROWS.find((r) => r.title === 'Go to church')!;
  assert.equal(row.start_time, null);
  // The builder's helper refuses to compose one without a slot...
  assert.match(BUILDER_SRC, /if \(!marker \|\| !startISO \|\| !title\) return null;/);
  // ...and the digest path skips it too (venueNudge needs task.start_time).
  assert.equal(venueNudge({ ...row, start_time: '' } as any, TZ, BUSINESS_HOURS), null);
});

test('AC-7a the message is composed at the PERSISTENCE site, not at window-plan time', () => {
  // The defect: the sentence was written into venueNudgeByTaskId during window-plan
  // resolution, BEFORE the placement loop, so it could not describe the real slot.
  // The marker must now carry no message at all...
  assert.match(BUILDER_SRC, /venueNudgeByTaskId = new Map<string, \{ toWindow: string \}>\(\)/);
  assert.match(BUILDER_SRC, /venueNudgeByTaskId\.set\(task\.id, \{ toWindow: 'business_hours' \}\)/);
  // ...and BOTH persistence sites must compose from the slot they are about to write.
  const composedFromSlot = BUILDER_SRC.match(/buildVenueNudgePayload\([\s\S]{0,200}?slot\.start_time/g) ?? [];
  assert.equal(composedFromSlot.length, 2, 'main write + reshuffle-retry write both compose from slot.start_time');
});

test('AC-7b no nudge sentence is constructed outside _shared/nudges.ts', () => {
  // The exact grep the accuracy log names as the one command that would have settled the
  // last round, plus the wider phrases. The builder must contain none of them.
  assert.doesNotMatch(BUILDER_SRC, /after work/i);
  assert.doesNotMatch(BUILDER_SRC, /business.hours slot/i);
  assert.doesNotMatch(BUILDER_SRC, /most places (close|open)/i);
  assert.doesNotMatch(BUILDER_SRC, /couldn't fit/i, 'the overflow sentence moved here too');
  assert.doesNotMatch(BUILDER_SRC, /You could bump/i);
  // The overflow sentence is now composed by the shared function, with the same content.
  assert.equal(
    buildOverflowNudgeMessage({
      title: 'Go to church', overflowDate: '2026-09-03', reason: 'no_window_capacity',
      impactFactors: ['is_priority', 'overdue'], bumpTitle: null,
    }),
    '"Go to church" is high-impact (is_priority, overdue) but couldn\'t fit 2026-09-03 (no window capacity).',
  );
  assert.match(
    buildOverflowNudgeMessage({
      title: 'A', overflowDate: '2026-09-03', reason: 'daily_hours_cap', bumpTitle: 'B',
    }),
    /daily hours budget reached\)\. You could bump "B"/,
  );
});

test('AC-7c the stored sentence and the digest sentence are the SAME string', () => {
  // Three surfaces render the stored `venue_nudge.message` verbatim (DailyReviewModal,
  // buildDayContext x2) while the digest re-derives its own. They agree only if both come
  // from one function given the same row — assert that on every real row, and assert the
  // old stored strings are the ones being replaced.
  for (const row of LIVE_VENUE_ROWS) {
    if (!row.start_time) continue;
    const persisted = buildVenueNudgeMessage(row.title, row.start_time, TZ, BUSINESS_HOURS);
    const inDigest = venueNudge(row as any, TZ, BUSINESS_HOURS);
    if (persisted === null) {
      assert.equal(inDigest, null, `${row.title}: silent in one surface must mean silent in all`);
    } else {
      assert.equal(inDigest!.message, persisted, `${row.title}: digest and stored text differ`);
    }
    // And the sentence being replaced is gone for good.
    assert.ok(!String(persisted ?? '').includes(STORED_TEMPLATE_FRAGMENT));
  }
});

// ---------------------------------------------------------------------------
// AC-8c — the working week comes from config, not a hardcoded Sat/Sun
// ---------------------------------------------------------------------------
test('AC-8c the non-working-day test honours the configured days array', () => {
  const tueToSat = { start: 9, end: 17, days: [2, 3, 4, 5, 6] };
  const sat11 = '2026-09-05T15:00:00Z'; // Sat 11:00 ET
  const mon11 = '2026-09-07T15:00:00Z'; // Mon 11:00 ET
  assert.equal(isNonWorkingDayLocal(sat11, TZ, tueToSat), false, 'Saturday is a WORKING day here');
  assert.equal(isNonWorkingDayLocal(mon11, TZ, tueToSat), true, 'Monday is the day off here');
  assert.equal(buildVenueNudgeMessage('Bank run', sat11, TZ, tueToSat), null, 'Sat 11:00 is inside business hours for this user');
  assert.equal(buildVenueNudgeMessage('Bank run', mon11, TZ, tueToSat), null, 'Mon 11:00 is a sensible daytime slot on a day off');
  // A genuinely awkward hour on the day off still speaks up.
  assert.match(
    String(buildVenueNudgeMessage('Bank run', '2026-09-07T13:00:00Z', TZ, tueToSat)),
    /is on a day off at 9:00 am/,
  );
  // Default (no days configured) is still Mon–Fri.
  assert.equal(isNonWorkingDayLocal(sat11, TZ, { start: 9, end: 17 }), true);
});

// ---------------------------------------------------------------------------
// AC-8d — the delivery hour is validated, and can never mean "send now"
// ---------------------------------------------------------------------------
test('AC-8d an invalid deliverAtLocalHour falls back to 8 and never sends immediately', () => {
  const cronRun = new Date('2026-09-04T05:00:00Z'); // the real cron: 01:00 ET
  for (const raw of [25, -1, NaN, '8am', null, undefined, 8, 0, 23, 7.5, '']) {
    const hour = resolveDeliverHour(raw as unknown, 8);
    assert.ok(Number.isInteger(hour) && hour >= 0 && hour <= 23, `hour out of range for ${String(raw)}`);
    const scheduled = nextLocalHour(cronRun, hour, TZ);
    assert.notEqual(scheduled, cronRun.toISOString(), `${String(raw)} degraded to an immediate 1am push`);
  }
  assert.equal(resolveDeliverHour(25), 8);
  assert.equal(resolveDeliverHour(-1), 8);
  assert.equal(resolveDeliverHour('8am'), 8);
  assert.equal(resolveDeliverHour(7.5), 8);
  assert.equal(resolveDeliverHour(0), 0, 'midnight is a legitimate choice, not a falsy fallback');
  assert.equal(resolveDeliverHour(19), 19);
  // The valid default still lands on 08:00 local the same morning.
  assert.equal(nextLocalHour(cronRun, 8, TZ), '2026-09-04T12:00:00.000Z');
});

// ---------------------------------------------------------------------------
// AC-8a — the digest is bounded to the day it will be READ on
// ---------------------------------------------------------------------------
test('AC-8a the placedToday query is bounded to the digest local day, in the user timezone', () => {
  // The live rows span 2026-09-03 .. 2026-09-07, so an unbounded query means a Friday
  // 08:00 digest nags about a Monday placement and a Thursday one already past.
  const block = BUILDER_SRC.slice(BUILDER_SRC.indexOf('const { data: placedToday }'));
  assert.match(block.slice(0, 600), /\.gte\('start_time', digestDayBounds\.start\)/);
  assert.match(block.slice(0, 600), /\.lt\('start_time', digestDayBounds\.end\)/);
  // Derived from the DIGEST's local date via the timezone-safe helper, not from UTC.
  assert.match(BUILDER_SRC, /const digestLocalDate = localDayOf\(digestAtIso, timezone\);/);
  assert.match(BUILDER_SRC, /const digestDayBounds = localDateToUtcBounds\(digestLocalDate, timezone\);/);

  // The trap a UTC boundary would fall into: the 20:15 ET row is 00:15 UTC the NEXT day.
  assert.equal(localDayOf('2026-09-04T00:15:00+00:00', TZ), '2026-09-03');
  assert.notEqual(localDayOf('2026-09-04T00:15:00+00:00', 'UTC'), '2026-09-03');
});

// ---------------------------------------------------------------------------
// AC-4 — one digest, and only one
// ---------------------------------------------------------------------------
/** Minimal PostgREST-shaped fake: enough of select/insert/delete to run the real code. */
function fakeSupabase(initialRows: any[] = []) {
  const state = { rows: [...initialRows], inserts: [] as any[], deletedIds: [] as string[] };
  let seq = 0;
  const from = () => {
    let mode: 'select' | 'insert' | 'delete' = 'select';
    let payload: any = null;
    const filters: Array<[string, string, any]> = [];
    const run = () => {
      if (mode === 'insert') {
        const row = { id: `new-${++seq}`, delivered_at: null, ...payload };
        state.inserts.push(payload);
        state.rows.push(row);
        return { data: [row], error: null };
      }
      if (mode === 'delete') {
        const ids = (filters.find((f) => f[0] === 'in')?.[2] ?? []) as string[];
        state.deletedIds.push(...ids);
        state.rows = state.rows.filter((r) => !ids.includes(r.id));
        return { data: null, error: null };
      }
      let out = state.rows;
      for (const [op, col, val] of filters) {
        if (op === 'eq') out = out.filter((r) => r[col] === val);
        if (op === 'is') out = out.filter((r) => (r[col] ?? null) === val);
      }
      return { data: out, error: null };
    };
    const b: any = {
      select: () => b,
      insert: (o: any) => { mode = 'insert'; payload = o; return b; },
      delete: () => { mode = 'delete'; return b; },
      eq: (c: string, v: any) => { filters.push(['eq', c, v]); return b; },
      is: (c: string, v: any) => { filters.push(['is', c, v]); return b; },
      in: (c: string, v: any) => { filters.push(['in', c, v]); return b; },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  };
  return { client: { from } as any, state };
}

/** The digest the live data would actually produce, built by the real functions. */
function liveNudges(): Nudge[] {
  const out: Nudge[] = [];
  for (const row of LIVE_VENUE_ROWS) {
    if (!row.start_time) continue;
    const n = venueNudge(row as any, TZ, BUSINESS_HOURS);
    if (n) out.push(n);
  }
  out.push(overflowNudge(
    { task_id: 'f6cb9caf-8028-4b5b-88fd-73768aa43459', overflow_date: '2026-09-03',
      message: null, suggested_bump_task_id: null, suggested_bump_title: null },
    'Go to church',
  ));
  return out;
}

test('AC-4b an identical digest is suppressed BY KEY, and a changed one supersedes', async () => {
  const nudges = liveNudges();
  assert.ok(nudges.length >= 2);
  const { client, state } = fakeSupabase();

  const first = await deliverNudgeDigest(client, 'u1', nudges, { scheduledFor: '2026-09-04T12:00:00Z' });
  assert.equal(first, nudges.length, 'first delivery queues the digest');
  assert.equal(state.inserts.length, 1);
  assert.equal(state.inserts[0].metadata.source, NUDGE_DIGEST_SOURCE);
  assert.deepEqual(
    state.inserts[0].metadata.nudges.map((n: any) => n.key).sort(),
    nudges.map((n) => n.key).sort(),
  );

  const second = await deliverNudgeDigest(client, 'u1', nudges, { scheduledFor: '2026-09-04T12:00:00Z' });
  assert.equal(second, 0, 'the same nudge set does NOT queue a second digest');
  assert.equal(state.inserts.length, 1, 'still exactly one insert');
  assert.equal(state.rows.filter((r) => r.metadata?.source === NUDGE_DIGEST_SOURCE).length, 1);

  // A DIFFERENT key (same task, next local date) is genuinely new: it supersedes rather
  // than accumulating, so the user is told about it without ever getting two digests.
  const tomorrow = nudges.map((n) => ({ ...n, key: n.key.replace('2026-09-03', '2026-09-04').replace('2026-09-04', '2026-09-05') }));
  const third = await deliverNudgeDigest(client, 'u1', tomorrow, { scheduledFor: '2026-09-05T12:00:00Z' });
  assert.equal(third, tomorrow.length, 'a new key IS delivered');
  assert.equal(state.inserts.length, 2, 'a second insert happened');
  assert.equal(state.deletedIds.length, 1, 'and the stale undelivered digest was removed');
  assert.equal(state.rows.filter((r) => r.metadata?.source === NUDGE_DIGEST_SOURCE).length, 1,
    'never two undelivered digests at once');
});

test('AC-4d nothing accumulates against yesterday\'s undelivered digest', () => {
  // Policy, stated once and asserted: SUPERSEDE. An undelivered digest that does not
  // exactly match the current nudge set is deleted and replaced, so the count of
  // undelivered digests is 1 under every path — never 2.
  const nudges = liveNudges();
  const stale = {
    id: 'yesterday', delivered_at: null,
    metadata: { source: NUDGE_DIGEST_SOURCE, nudges: [{ key: 'venue:abc:2026-09-02' }] },
  };
  const plan = planDigestDelivery(nudges, [stale]);
  assert.equal(plan.action, 'supersede');
  assert.deepEqual(plan.supersedeIds, ['yesterday']);

  // Identical set => skip, not supersede (so we do not churn a perfectly good row).
  const same = { id: 'today', delivered_at: null, metadata: { source: NUDGE_DIGEST_SOURCE, nudges } };
  assert.equal(planDigestDelivery(nudges, [same]).action, 'skip');

  // Two undelivered digests (however they got there) are always collapsed to one.
  const two = planDigestDelivery(nudges, [same, stale]);
  assert.equal(two.action, 'supersede');
  assert.equal(two.supersedeIds.length, 2);

  // Rows belonging to other features are never touched.
  const foreign = { id: 'dedup-notice', delivered_at: null, metadata: { source: 'task-dedup' } };
  assert.equal(planDigestDelivery(nudges, [foreign]).action, 'insert');
  assert.equal(digestFingerprint(nudges), nudges.map((n) => n.key).sort().join('|'));
});

test('AC-4a a single-day rebuild queues no digest, and the purge uses columns that exist', () => {
  // Vector 1: FocusView "Reschedule today" and DailyReviewModal "Confirm schedule" both
  // call the builder with singleDay:true. The delivery block must be gated on it.
  assert.match(BUILDER_SRC, /if \(!dryRun && !singleDay\) \{/);
  assert.match(BUILDER_SRC, /Nudge digest skipped: single-day rebuild/);

  // Vector 3: the purge filtered on `status` and `send_at`, NEITHER of which exists on
  // public.scheduled_notifications (verified 2026-09-03 against information_schema).
  // PostgREST rejected it and the try/catch reported it as non-fatal, so it never once
  // deleted a row.
  // Comment lines are stripped first: the block's own comment NAMES the two dead columns
  // to explain the defect, and asserting over the raw text would match that prose.
  const purge = BUILDER_SRC.slice(
    BUILDER_SRC.indexOf('purge undelivered notifications'),
    BUILDER_SRC.indexOf('STEP 1.25'),
  ).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(purge.length > 0, 'purge block found');
  assert.doesNotMatch(purge, /\.eq\('status', 'pending'\)/);
  assert.doesNotMatch(purge, /send_at/);
  assert.match(purge, /\.is\('delivered_at', null\)/);
  assert.match(purge, /\.gte\('scheduled_for', todayStartIso\)/);
  assert.match(purge, /\.lt\('scheduled_for', todayEndIso\)/);
  // ...and a failure is now surfaced rather than swallowed.
  assert.match(purge, /console\.error\(`  ❌ Failed to purge/);
});

test('AC-4 the digest text itself is one message, not one per nudge', () => {
  const nudges = liveNudges();
  const { title, message } = composeDigest(nudges);
  assert.equal(title, `${nudges.length} things worth a look`);
  assert.equal(message.split('\n').length, nudges.length + 1);
  for (const n of nudges) assert.ok(message.includes(n.message));
  assert.equal(composeDigest([nudges[0]]).title, 'One thing worth a look');
});
