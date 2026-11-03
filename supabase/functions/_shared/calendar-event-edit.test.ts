// WHAT:       offline tests for calendar edit/delete (BUILD-calendar-edit). No network: provider calls
//             go through a fake fetch, so no real calendar is ever touched.
// WHY:        update_calendar_event / delete_calendar_event act on the owner's real calendar; the
//             matcher must never guess and the delete guard must never let an unconfirmed delete through.
// SUPERSEDES: nothing
// SUPERSEDED-BY: nothing -- current
// EVIDENCE:   huddle-extension-app docs/qc-evidence/BUILD-calendar-edit.md
// Run: node --experimental-strip-types --test supabase/functions/_shared/calendar-event-edit.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeProvider,
  matchCalendarEvents,
  buildEventPatch,
  deleteGate,
  toProviderBody,
  eventUrl,
  performCalendarEdit,
  type CalendarEventRow,
} from './calendar-event-edit.ts';
import { getToolDefinitions } from './tool-definitions.ts';

const ROWS: CalendarEventRow[] = [
  { external_event_id: 'AAA', title: 'Sync with Dana', start_time: '2026-11-04T20:00:00.000Z', end_time: '2026-11-04T21:00:00.000Z', provider: 'office365' },
  { external_event_id: 'BBB', title: 'Study block', start_time: '2026-11-05T14:00:00.000Z', end_time: '2026-11-05T16:00:00.000Z', provider: 'google' },
  { external_event_id: 'CCC', title: 'Study block', start_time: '2026-11-06T14:00:00.000Z', end_time: '2026-11-06T16:00:00.000Z', provider: 'google' },
  { external_event_id: 'DDD', title: 'Dentist', start_time: '2026-11-04T20:05:00.000Z', end_time: '2026-11-04T20:35:00.000Z', provider: 'outlook' },
];

test('normalizeProvider maps calendar_connections spellings', () => {
  assert.equal(normalizeProvider('office365'), 'outlook');
  assert.equal(normalizeProvider('Outlook'), 'outlook');
  assert.equal(normalizeProvider('google'), 'google');
  assert.equal(normalizeProvider('icloud'), null);
  assert.equal(normalizeProvider(undefined), null);
});

test('event_id is authoritative', () => {
  const m = matchCalendarEvents(ROWS, { event_id: 'BBB', match_title: 'Dana' });
  assert.equal(m.status, 'unique');
  assert.equal(m.status === 'unique' && m.event.external_event_id, 'BBB');
  assert.equal(matchCalendarEvents(ROWS, { event_id: 'ZZZ' }).status, 'none');
});

test('"my 3pm with Dana": time + title picks exactly one', () => {
  // 3pm EST = 20:00Z; Dentist at 20:05 is within the time window but fails the title.
  const m = matchCalendarEvents(ROWS, { match_title: 'Dana', match_start: '2026-11-04T15:00:00-05:00' });
  assert.equal(m.status, 'unique');
  assert.equal(m.status === 'unique' && m.event.external_event_id, 'AAA');
});

test('time alone that hits two events is AMBIGUOUS, never a guess', () => {
  const m = matchCalendarEvents(ROWS, { match_start: '2026-11-04T20:00:00Z' });
  assert.equal(m.status, 'ambiguous');
  assert.deepEqual(m.status === 'ambiguous' && m.candidates.map((c) => c.external_event_id).sort(), ['AAA', 'DDD']);
});

test('title alone that hits two events is AMBIGUOUS', () => {
  const m = matchCalendarEvents(ROWS, { match_title: 'study block' });
  assert.equal(m.status, 'ambiguous');
  assert.equal(m.status === 'ambiguous' && m.candidates.length, 2);
});

test('title + date narrows a repeated title to one', () => {
  const m = matchCalendarEvents(ROWS, { match_title: 'study', match_start: '2026-11-05T09:00:00-05:00' });
  assert.equal(m.status, 'unique');
  assert.equal(m.status === 'unique' && m.event.external_event_id, 'BBB');
});

test('start outside the tolerance does not match', () => {
  assert.equal(matchCalendarEvents(ROWS, { match_title: 'Dana', match_start: '2026-11-04T21:00:00Z' }).status, 'none');
});

test('no identifier, or a bad date, is invalid', () => {
  assert.equal(matchCalendarEvents(ROWS, {}).status, 'invalid');
  assert.equal(matchCalendarEvents(ROWS, { match_start: 'tomorrowish' }).status, 'invalid');
});

test('moving the start keeps the length ("3pm-4pm moved to 4" -> 4-5)', () => {
  const r = buildEventPatch({ new_start_time: '2026-11-04T16:00:00-05:00' }, ROWS[0]);
  assert.ok(r.ok);
  assert.equal(r.ok && r.patch.startISO, '2026-11-04T21:00:00.000Z');
  assert.equal(r.ok && r.patch.endISO, '2026-11-04T22:00:00.000Z');
});

test('duration only changes the length from the current start', () => {
  const r = buildEventPatch({ duration_minutes: 90 }, ROWS[1]);
  assert.ok(r.ok);
  assert.equal(r.ok && r.patch.startISO, '2026-11-05T14:00:00.000Z');
  assert.equal(r.ok && r.patch.endISO, '2026-11-05T15:30:00.000Z');
});

test('rename only does not touch the time', () => {
  const r = buildEventPatch({ new_title: 'Dana 1:1' }, ROWS[0]);
  assert.ok(r.ok);
  assert.equal(r.ok && r.patch.title, 'Dana 1:1');
  assert.equal(r.ok && r.patch.startISO, undefined);
});

test('end before start, a bad date, or nothing to change is refused', () => {
  assert.equal(buildEventPatch({ new_start_time: '2026-11-04T16:00:00Z', new_end_time: '2026-11-04T15:00:00Z' }, ROWS[0]).ok, false);
  assert.equal(buildEventPatch({ new_start_time: 'four pm' }, ROWS[0]).ok, false);
  assert.equal(buildEventPatch({}, ROWS[0]).ok, false);
});

test('DELETE GUARD: only a unique match with user_requested === true passes', () => {
  const unique = matchCalendarEvents(ROWS, { event_id: 'AAA' });
  const amb = matchCalendarEvents(ROWS, { match_title: 'study block' });
  assert.deepEqual(deleteGate({ user_requested: true }, unique), { allowed: true });
  assert.deepEqual(deleteGate({}, unique), { allowed: false, reason: 'confirmation_required' });
  assert.deepEqual(deleteGate({ user_requested: false }, unique), { allowed: false, reason: 'confirmation_required' });
  assert.deepEqual(deleteGate({ user_requested: 'true' }, unique), { allowed: false, reason: 'confirmation_required' });
  assert.deepEqual(deleteGate({ user_requested: 1 }, unique), { allowed: false, reason: 'confirmation_required' });
  assert.deepEqual(deleteGate({ user_requested: true }, amb), { allowed: false, reason: 'not_unique' });
  assert.deepEqual(deleteGate({ user_requested: true }, { status: 'none' }), { allowed: false, reason: 'not_unique' });
});

test('provider bodies use each API\'s field names, in UTC like the create path', () => {
  const p = { title: 'X', startISO: '2026-11-04T21:00:00.000Z', endISO: '2026-11-04T22:00:00.000Z' };
  assert.deepEqual(toProviderBody('outlook', p), {
    subject: 'X',
    start: { dateTime: '2026-11-04T21:00:00.000', timeZone: 'UTC' },
    end: { dateTime: '2026-11-04T22:00:00.000', timeZone: 'UTC' },
  });
  assert.deepEqual(toProviderBody('google', p), {
    summary: 'X',
    start: { dateTime: '2026-11-04T21:00:00.000Z', timeZone: 'UTC' },
    end: { dateTime: '2026-11-04T22:00:00.000Z', timeZone: 'UTC' },
  });
});

test('event URLs: Graph /me/events and Google primary, id encoded', () => {
  assert.equal(eventUrl('outlook', 'AA/B=='), 'https://graph.microsoft.com/v1.0/me/events/AA%2FB%3D%3D');
  assert.equal(eventUrl('google', 'abc_123'), 'https://www.googleapis.com/calendar/v3/calendars/primary/events/abc_123');
});

function fakeFetch(status: number, body = '') {
  const calls: Array<{ url: string; init: any }> = [];
  const f = (async (url: string, init: any) => {
    calls.push({ url, init });
    return new Response(status === 204 ? null : body, { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

test('performCalendarEdit update: PATCH with bearer token and JSON body', async () => {
  const { f, calls } = fakeFetch(200, JSON.stringify({ id: 'AAA', subject: 'Sync with Dana', webLink: 'https://x' }));
  const r = await performCalendarEdit({
    provider: 'outlook', op: 'update', eventId: 'AAA', accessToken: 'tok',
    patch: { startISO: '2026-11-04T21:00:00.000Z', endISO: '2026-11-04T22:00:00.000Z' }, fetchImpl: f,
  });
  assert.equal(r.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'PATCH');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  assert.equal(JSON.parse(calls[0].init.body).start.dateTime, '2026-11-04T21:00:00.000');
});

test('performCalendarEdit delete: 204 ok; Google 410 counts as already gone; 404 is an error', async () => {
  const a = fakeFetch(204);
  assert.equal((await performCalendarEdit({ provider: 'outlook', op: 'delete', eventId: 'AAA', accessToken: 't', fetchImpl: a.f })).success, true);
  assert.equal(a.calls[0].init.method, 'DELETE');
  const b = fakeFetch(410);
  const rb = await performCalendarEdit({ provider: 'google', op: 'delete', eventId: 'BBB', accessToken: 't', fetchImpl: b.f });
  assert.equal(rb.success, true);
  assert.equal(rb.details?.alreadyGone, true);
  const c = fakeFetch(404, 'not found');
  const rc = await performCalendarEdit({ provider: 'outlook', op: 'delete', eventId: 'ZZZ', accessToken: 't', fetchImpl: c.f });
  assert.equal(rc.success, false);
  assert.match(rc.error ?? '', /404/);
});

test('performCalendarEdit update with an empty patch makes NO call', async () => {
  const { f, calls } = fakeFetch(200, '{}');
  const r = await performCalendarEdit({ provider: 'google', op: 'update', eventId: 'BBB', accessToken: 't', patch: {}, fetchImpl: f });
  assert.equal(r.success, false);
  assert.equal(calls.length, 0);
});

test('catalog: both tools are defined, delete demands an explicit user request', () => {
  const defs = getToolDefinitions();
  const upd = defs.find((d) => d.name === 'update_calendar_event');
  const del = defs.find((d) => d.name === 'delete_calendar_event');
  assert.ok(upd, 'update_calendar_event missing from the catalog');
  assert.ok(del, 'delete_calendar_event missing from the catalog');
  assert.match(del!.description, /ONLY use this when the user has explicitly asked/);
  assert.deepEqual((del!.parameters as any).required, ['user_requested']);
  assert.equal((del!.parameters as any).properties.user_requested.type, 'boolean');
  // create tools are untouched and still present
  for (const n of ['create_calendar_event', 'create_google_event', 'create_outlook_event']) {
    assert.ok(defs.find((d) => d.name === n), `${n} vanished`);
  }
});

test('execute-tool dispatches both new cases and gates delete through deleteGate', () => {
  const src = readFileSync(new URL('../execute-tool/index.ts', import.meta.url), 'utf8');
  assert.match(src, /case 'update_calendar_event':\s*\n\s*return await updateCalendarEvent\(supabase, userId, args\);/);
  assert.match(src, /case 'delete_calendar_event':\s*\n\s*return await deleteCalendarEvent\(supabase, userId, args\);/);
  assert.match(src, /const gate = deleteGate\(args, r\.match\);\s*\n\s*if \(!gate\.allowed\)/);
  // every candidate read is scoped to the caller
  assert.match(src, /\.from\('external_calendar_events'\)\s*\n\s*\.select\([^)]*\)\s*\n\s*\.eq\('user_id', userId\)/);
});
