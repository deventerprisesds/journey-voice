// WHAT:       unit tests for the TaskOS work-calendar feed (_shared/onedrive-feed.ts pure half and
//             _shared/onedrive-feed-sync.ts I/O half, with mocked fetch + mocked Supabase).
// WHY:        prove the feed fails closed (bad config, wrong account, missing consent, bad snapshot
//             = nothing written), maps the Power Automate connector's real field shapes, and that
//             removals only ever touch feed rows on the right connection.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   field shapes match the live appointments.json probed 2026-11-08 (huddle-extension-app
//             graph-permission-check.yml section 5, shape-only output).
// All addresses here are placeholders (example.com); the real binding lives in an edge secret.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FEED_CALENDAR_ID,
  feedAttendees,
  isFeedEventId,
  mapFeedEventRows,
  parseTaskosFeedConfig,
  validateSnapshot,
} from './onedrive-feed.ts';
import { syncFeedCalendar } from './onedrive-feed-sync.ts';

const NOW = Date.parse('2026-11-08T15:00:00Z');
const RAW_CFG = JSON.stringify({
  enabled: true,
  driveAccount: 'Me@Example.com',
  mailbox: 'Work@Example.org',
  synthetic: false,
});
const cfg = parseTaskosFeedConfig(RAW_CFG)!;

function envelope(over: Record<string, unknown> = {}, records: unknown[] = [rec()]) {
  return {
    schema_version: '1.0',
    feed_type: 'appointments_snapshot',
    source: 'power-automate-outlook',
    mailbox: 'work@example.org',
    synthetic: false,
    published_utc: '2026-11-08T14:55:00Z',
    window_start_utc: '2026-11-08T00:00:00Z',
    window_end_utc: '2026-11-15T00:00:00Z',
    complete: true,
    snapshot: { value: records },
    ...over,
  };
}
function rec(over: Record<string, unknown> = {}) {
  return {
    id: 'AAMkA1',
    subject: 'Design review',
    start: '2026-11-09T14:00:00.0000000',
    end: '2026-11-09T15:00:00.0000000',
    startWithTimeZone: '2026-11-09T09:00:00-05:00',
    endWithTimeZone: '2026-11-09T10:00:00-05:00',
    location: 'Room 4',
    organizer: 'Dana Lee <dana@example.org>',
    requiredAttendees: 'dana@example.org; Pat <pat@example.org>;',
    optionalAttendees: 'opt@example.org',
    resourceAttendees: 'room4@example.org',
    showAs: 'BUSY',
    recurrence: 'none',
    isAllDay: false,
    ...over,
  };
}

// ---------------------------------------------------------------------------------- A: config
test('A1 config: unset / blank / invalid JSON / enabled!==true / addresses without @ -> OFF', () => {
  assert.equal(parseTaskosFeedConfig(undefined), null);
  assert.equal(parseTaskosFeedConfig('  '), null);
  assert.equal(parseTaskosFeedConfig('{not json'), null);
  assert.equal(parseTaskosFeedConfig(JSON.stringify({ enabled: 'true', driveAccount: 'a@b', mailbox: 'c@d' })), null);
  assert.equal(parseTaskosFeedConfig(JSON.stringify({ enabled: true, driveAccount: 'nobody', mailbox: 'c@d' })), null);
});

test('A2 config: lower-cases addresses, defaults paths, synthetic defaults true, caps maxBytes', () => {
  assert.equal(cfg.driveAccount, 'me@example.com');
  assert.equal(cfg.mailbox, 'work@example.org');
  assert.equal(cfg.synthetic, false);
  assert.equal(cfg.appointmentsPath, '/automation/appointments/appointments.json');
  const d = parseTaskosFeedConfig(JSON.stringify({ enabled: true, driveAccount: 'a@b', mailbox: 'c@d', maxBytes: 99e9, appointmentsPath: '/../etc' }))!;
  assert.equal(d.synthetic, true);
  assert.equal(d.maxBytes, 10_000_000);
  assert.equal(d.appointmentsPath, '/automation/appointments/appointments.json');
});

// ------------------------------------------------------------------------------ B: validation
test('B1 a well-formed live snapshot passes; id-less records are skipped and counted', () => {
  const v = validateSnapshot(envelope({}, [rec(), { subject: 'no id' }]), cfg, 'appointments_snapshot', NOW);
  assert.equal(v.ok, true);
  if (v.ok) {
    assert.equal(v.records.length, 1);
    assert.equal(v.skipped, 1);
  }
});

test('B2 every envelope rule rejects', () => {
  const bad: [Record<string, unknown>, string][] = [
    [{ schema_version: '2.0' }, 'wrong_schema'],
    [{ feed_type: 'email_snapshot' }, 'wrong_feed_type'],
    [{ source: 'someone-else' }, 'wrong_source'],
    [{ mailbox: 'other@example.org' }, 'wrong_mailbox'],
    [{ synthetic: true }, 'synthetic_mismatch'],
    [{ complete: false }, 'incomplete'],
    [{ published_utc: 'yesterday' }, 'bad_timestamps'],
    [{ published_utc: '2026-11-08T16:00:00Z' }, 'bad_timestamps'], // > now + 10 min
    [{ window_end_utc: '2026-11-07T00:00:00Z' }, 'bad_timestamps'],
    [{ snapshot: {} }, 'bad_records'],
  ];
  for (const [over, reason] of bad) {
    const v = validateSnapshot(envelope(over), cfg, 'appointments_snapshot', NOW);
    assert.deepEqual(v, { ok: false, reason }, JSON.stringify(over));
  }
  assert.deepEqual(validateSnapshot([], cfg, 'appointments_snapshot', NOW), { ok: false, reason: 'not_json' });
  const many = Array.from({ length: 1000 }, (_, i) => rec({ id: `id${i}` }));
  assert.deepEqual(validateSnapshot(envelope({}, many), cfg, 'appointments_snapshot', NOW), { ok: false, reason: 'too_many_records' });
});

// --------------------------------------------------------------------------------- C: mapping
test('C1 maps a connector record onto an external_calendar_events row', () => {
  const [row] = mapFeedEventRows([rec()], cfg, { id: 'conn-1', user_id: 'u-1' }, '2026-11-08T15:00:00.000Z');
  assert.equal(row.external_event_id, 'feed:work@example.org:AAMkA1');
  assert.ok(isFeedEventId(row.external_event_id));
  assert.equal(row.calendar_id, FEED_CALENDAR_ID);
  assert.equal(row.connection_id, 'conn-1');
  assert.equal(row.user_id, 'u-1');
  assert.equal(row.start_time, '2026-11-09T14:00:00.000Z'); // offset field wins, converted to UTC
  assert.equal(row.end_time, '2026-11-09T15:00:00.000Z');
  assert.equal(row.description, null);
  assert.equal(row.location, 'Room 4');
  assert.equal(row.organizer_email, 'dana@example.org');
  assert.equal(row.show_as, 'busy');
  assert.equal(row.is_recurring, false);
  assert.equal(row.is_all_day, false);
});

test('C2 without the offset field the plain time is read as UTC; unknown showAs -> null; recurrence -> true', () => {
  const [row] = mapFeedEventRows(
    [rec({ startWithTimeZone: '', endWithTimeZone: undefined, showAs: 'weird', recurrence: 'weekly' })],
    cfg, { id: 'c', user_id: 'u' }, 'n',
  );
  assert.equal(row.start_time, '2026-11-09T14:00:00.000Z');
  assert.equal(row.show_as, null);
  assert.equal(row.is_recurring, true);
  assert.equal(mapFeedEventRows([rec({ showAs: 'WorkingElsewhere' })], cfg, { id: 'c', user_id: 'u' }, 'n')[0].show_as, 'workingElsewhere');
});

test('C3 a record with no parsable start or end is dropped, not stored with a wrong time', () => {
  const rows = mapFeedEventRows([rec({ startWithTimeZone: '', start: 'garbage' })], cfg, { id: 'c', user_id: 'u' }, 'n');
  assert.equal(rows.length, 0);
});

test('C4 attendee strings -> NormalizedAttendee list, de-duplicated, flags kept', () => {
  assert.deepEqual(feedAttendees(rec({ optionalAttendees: 'opt@example.org; DANA@example.org' })), [
    { email: 'dana@example.org' },
    { email: 'pat@example.org' },
    { email: 'opt@example.org', optional: true },
    { email: 'room4@example.org', resource: true },
  ]);
});

// ------------------------------------------------------------------------------- D: sync (I/O)
type Call = { op: string; table: string; arg?: unknown; opts?: unknown };
function mkSupabase(existing: { id: string; external_event_id: string }[], upsertError: unknown = null) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      return {
        upsert(rows: unknown, opts: unknown) {
          calls.push({ op: 'upsert', table, arg: rows, opts });
          return Promise.resolve({ error: upsertError });
        },
        select(_cols: string) {
          const filters: [string, unknown][] = [];
          const b = {
            eq(col: string, val: unknown) {
              filters.push([col, val]);
              return b;
            },
            then(res: (v: unknown) => void) {
              calls.push({ op: 'select', table, arg: filters });
              res({ data: existing });
            },
          };
          return b;
        },
        delete() {
          return {
            in(col: string, ids: unknown) {
              calls.push({ op: 'delete', table, arg: { col, ids } });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  return { client, calls };
}

const ENV: Record<string, string> = {
  TASKOS_ONEDRIVE_FEED: RAW_CFG,
  MICROSOFT_CLIENT_ID: 'cid',
  MICROSOFT_CLIENT_SECRET: 'csecret',
};
(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => ENV[k] } };

const CONN = { id: 'conn-1', user_id: 'u-1', provider: 'outlook', provider_account_email: 'me@example.com' };

function mkFetch(opts: { tokenStatus?: number; tokenBody?: string; fileStatus?: number; fileBody?: string } = {}) {
  const urls: string[] = [];
  const bodies: string[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    urls.push(String(url));
    if (String(url).includes('login.microsoftonline.com')) {
      bodies.push(String(init?.body ?? ''));
      const status = opts.tokenStatus ?? 200;
      const body = opts.tokenBody ?? JSON.stringify({ access_token: 'files-token' });
      return new Response(body, { status });
    }
    return new Response(opts.fileBody ?? JSON.stringify(envelope()), { status: opts.fileStatus ?? 200 });
  }) as typeof fetch;
  return { f, urls, bodies };
}

test('D1 feature OFF / other account / Google -> nothing fetched, nothing written', async () => {
  const { client, calls } = mkSupabase([]);
  const { f, urls } = mkFetch();
  const saved = ENV.TASKOS_ONEDRIVE_FEED;
  delete ENV.TASKOS_ONEDRIVE_FEED;
  assert.deepEqual(await syncFeedCalendar(client, CONN, 'rt', f, NOW), { status: 'off' });
  ENV.TASKOS_ONEDRIVE_FEED = saved;
  assert.deepEqual(await syncFeedCalendar(client, { ...CONN, provider_account_email: 'x@example.com' }, 'rt', f, NOW), { status: 'not_this_account' });
  assert.deepEqual(await syncFeedCalendar(client, { ...CONN, provider: 'google' }, 'rt', f, NOW), { status: 'not_this_account' });
  assert.deepEqual(await syncFeedCalendar(client, CONN, null, f, NOW), { status: 'needs_reconnect' });
  assert.equal(urls.length, 0);
  assert.equal(calls.length, 0);
});

test('D2 Files.Read not yet consented (AADSTS65001) -> needs_reconnect, nothing written', async () => {
  const { client, calls } = mkSupabase([]);
  const { f, urls } = mkFetch({ tokenStatus: 400, tokenBody: '{"error":"invalid_grant","error_description":"AADSTS65001: consent"}' });
  assert.deepEqual(await syncFeedCalendar(client, CONN, 'rt', f, NOW), { status: 'needs_reconnect' });
  assert.equal(urls.length, 1);
  assert.equal(calls.length, 0);
});

test('D3 ok: mints a Files.Read token, reads /me/drive path, upserts, removes ONLY stale feed rows', async () => {
  const existing = [
    { id: 'row-keep', external_event_id: 'feed:work@example.org:AAMkA1' },
    { id: 'row-stale', external_event_id: 'feed:work@example.org:GONE' },
    { id: 'row-outlook', external_event_id: 'AAMkRealOutlookId' }, // must never be touched
  ];
  const { client, calls } = mkSupabase(existing);
  const { f, urls, bodies } = mkFetch();
  const r = await syncFeedCalendar(client, CONN, 'rt', f, NOW);
  assert.deepEqual(r, { status: 'ok', upserted: 1, removed: 1, skipped: 0 });
  assert.match(bodies[0], /scope=https%3A%2F%2Fgraph\.microsoft\.com%2FFiles\.Read/);
  assert.equal(urls[1], 'https://graph.microsoft.com/v1.0/me/drive/root:/automation/appointments/appointments.json:/content');
  const up = calls.find((c) => c.op === 'upsert')!;
  assert.deepEqual(up.opts, { onConflict: 'connection_id,external_event_id', ignoreDuplicates: false });
  const sel = calls.find((c) => c.op === 'select')!;
  assert.deepEqual(sel.arg, [['connection_id', 'conn-1'], ['calendar_id', FEED_CALENDAR_ID]]);
  const del = calls.find((c) => c.op === 'delete')!;
  assert.deepEqual(del.arg, { col: 'id', ids: ['row-stale'] });
});

test('D4 a rejected snapshot changes NOTHING (last good rows stay)', async () => {
  for (const [body, status] of [
    [JSON.stringify(envelope({ mailbox: 'other@example.org' })), 'rejected:wrong_mailbox'],
    [JSON.stringify(envelope({ complete: false })), 'rejected:incomplete'],
    ['{oops', 'rejected:not_json'],
  ] as const) {
    const { client, calls } = mkSupabase([{ id: 'r', external_event_id: 'feed:work@example.org:AAMkA1' }]);
    const { f } = mkFetch({ fileBody: body });
    assert.deepEqual(await syncFeedCalendar(client, CONN, 'rt', f, NOW), { status });
    assert.equal(calls.length, 0, status);
  }
});

test('D5 missing file -> rejected:missing; oversize -> rejected:too_large; upsert error -> error with no delete', async () => {
  let s = mkSupabase([]);
  assert.deepEqual(await syncFeedCalendar(s.client, CONN, 'rt', mkFetch({ fileStatus: 404 }).f, NOW), { status: 'rejected:missing' });
  const saved = ENV.TASKOS_ONEDRIVE_FEED;
  ENV.TASKOS_ONEDRIVE_FEED = JSON.stringify({ ...JSON.parse(saved), maxBytes: 10 });
  assert.deepEqual(await syncFeedCalendar(s.client, CONN, 'rt', mkFetch().f, NOW), { status: 'rejected:too_large' });
  ENV.TASKOS_ONEDRIVE_FEED = saved;
  assert.equal(s.calls.length, 0);
  s = mkSupabase([{ id: 'x', external_event_id: 'feed:work@example.org:OLD' }], { message: 'boom' });
  assert.deepEqual(await syncFeedCalendar(s.client, CONN, 'rt', mkFetch().f, NOW), { status: 'error' });
  assert.equal(s.calls.some((c) => c.op === 'delete'), false);
});
