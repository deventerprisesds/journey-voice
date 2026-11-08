// WHAT:       unit tests for _shared/calendar-edit.ts (update_calendar_event / delete_calendar_event).
// WHY:        prove find-by-id, time+title match, ambiguity, the delete-consent guard and the
//             caller scoping with a mocked fetch and mocked DB -- no real calendar call.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   huddle-extension-app docs/qc-evidence/BUILD-calendar-edit.md
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPatch,
  deleteCalendarEvent,
  matchEventRows,
  updateCalendarEvent,
  type CalendarEditDeps,
  type CalendarEventRow,
} from './calendar-edit.ts';

const ME = 'user-me';
const OTHER = 'user-other';

const ROWS: Record<string, CalendarEventRow[]> = {
  [ME]: [
    { external_event_id: 'o-1', title: '1:1 with Dana', start_time: '2026-11-05T15:00:00Z', end_time: '2026-11-05T15:30:00Z', provider: 'outlook' },
    { external_event_id: 'g-1', title: 'Study block', start_time: '2026-11-06T13:00:00Z', end_time: '2026-11-06T15:00:00Z', provider: 'google' },
    { external_event_id: 'g-2', title: 'Study block', start_time: '2026-11-06T14:00:00Z', end_time: '2026-11-06T15:00:00Z', provider: 'google' },
    { external_event_id: 'feed:work@example.com:AAMk1', title: 'Work standup', start_time: '2026-11-07T14:00:00Z', end_time: '2026-11-07T14:30:00Z', provider: 'outlook' },
  ],
  [OTHER]: [
    { external_event_id: 'x-1', title: '1:1 with Dana', start_time: '2026-11-05T15:00:00Z', end_time: '2026-11-05T16:00:00Z', provider: 'outlook' },
  ],
};

function mkDeps(status = 200) {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
  const tokenCalls: string[] = [];
  const deps: CalendarEditDeps = {
    async loadEventRows(userId, from, to) {
      return (ROWS[userId] ?? []).filter((r) => r.start_time >= from && r.start_time <= to);
    },
    async loadEventById(userId, id) {
      return (ROWS[userId] ?? []).find((r) => r.external_event_id === id) ?? null;
    },
    async getAccessToken(userId, provider) {
      tokenCalls.push(`${userId}:${provider}`);
      return { token: `tok-${userId}-${provider}` };
    },
    async fetch(url, init) {
      calls.push({ url, ...init });
      return { ok: status >= 200 && status < 300, status, text: async () => '' };
    },
  };
  return { deps, calls, tokenCalls };
}

test('update by event_id: Outlook PATCH, keeps duration, uses caller token', async () => {
  const { deps, calls, tokenCalls } = mkDeps();
  const r = await updateCalendarEvent(deps, ME, { event_id: 'o-1', new_start_time: '2026-11-05T16:00:00Z' });
  assert.equal(r.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'PATCH');
  assert.equal(calls[0].url, 'https://graph.microsoft.com/v1.0/me/events/o-1');
  assert.equal(calls[0].headers.Authorization, `Bearer tok-${ME}-outlook`);
  const body = JSON.parse(calls[0].body!);
  assert.deepEqual(body.start, { dateTime: '2026-11-05T16:00:00.000', timeZone: 'UTC' });
  assert.deepEqual(body.end, { dateTime: '2026-11-05T16:30:00.000', timeZone: 'UTC' });
  assert.deepEqual(tokenCalls, [`${ME}:outlook`]);
});

test('update by time+title: unique match -> Google PATCH on primary', async () => {
  const { deps, calls } = mkDeps();
  const r = await updateCalendarEvent(deps, ME, { match_title: 'study', match_start_time: '2026-11-06T12:30:00Z', new_title: 'Deep work' });
  assert.equal(r.success, true);
  assert.equal(calls[0].url, 'https://www.googleapis.com/calendar/v3/calendars/primary/events/g-1');
  assert.deepEqual(JSON.parse(calls[0].body!), { summary: 'Deep work' });
});

test('ambiguous match returns candidates and makes NO provider call', async () => {
  const { deps, calls, tokenCalls } = mkDeps();
  const r = await updateCalendarEvent(deps, ME, { match_title: 'Study block', match_start_time: '2026-11-06T13:30:00Z', new_title: 'x' });
  assert.equal(r.success, false);
  assert.equal(r.ambiguous, true);
  assert.equal((r.candidates as unknown[]).length, 2);
  assert.equal(calls.length, 0);
  assert.equal(tokenCalls.length, 0);
});

test('delete with ambiguous match never deletes', async () => {
  const { deps, calls } = mkDeps();
  const r = await deleteCalendarEvent(deps, ME, { match_title: 'Study block', match_start_time: '2026-11-06T13:30:00Z', user_explicitly_requested: true });
  assert.equal(r.ambiguous, true);
  assert.equal(calls.length, 0);
});

test('delete GUARD: refused unless user_explicitly_requested === true', async () => {
  for (const v of [undefined, false, 'true', 1]) {
    const { deps, calls, tokenCalls } = mkDeps();
    const r = await deleteCalendarEvent(deps, ME, { event_id: 'o-1', user_explicitly_requested: v as any });
    assert.equal(r.success, false, `value ${String(v)}`);
    assert.equal(r.needs_user_request, true);
    assert.equal(calls.length, 0);
    assert.equal(tokenCalls.length, 0);
  }
});

test('delete with explicit request: DELETE on provider', async () => {
  const { deps, calls } = mkDeps(204);
  const r = await deleteCalendarEvent(deps, ME, { event_id: 'g-2', user_explicitly_requested: true });
  assert.equal(r.success, true);
  assert.equal(calls[0].method, 'DELETE');
  assert.equal(calls[0].url, 'https://www.googleapis.com/calendar/v3/calendars/primary/events/g-2');
});

test('delete: provider 410 is reported as already gone, not success', async () => {
  const { deps } = mkDeps(410);
  const r = await deleteCalendarEvent(deps, ME, { event_id: 'g-2', user_explicitly_requested: true });
  assert.equal(r.success, false);
  assert.equal(r.already_gone, true);
});

test('SCOPE: another user\'s event id is not found from the caller\'s rows', async () => {
  const { deps, calls } = mkDeps();
  const r = await updateCalendarEvent(deps, ME, { event_id: 'x-1', new_title: 'hijack' });
  assert.equal(r.success, false);
  assert.equal(calls.length, 0);
});

test('SCOPE: unsynced id + provider uses ONLY the caller token', async () => {
  const { deps, calls, tokenCalls } = mkDeps();
  const r = await updateCalendarEvent(deps, ME, { event_id: 'new-9', provider: 'outlook', new_title: 'x' });
  assert.equal(r.success, true);
  assert.deepEqual(tokenCalls, [`${ME}:outlook`]);
  assert.equal(calls[0].headers.Authorization, `Bearer tok-${ME}-outlook`);
});

test('unsynced id with only a new start cannot guess the end', async () => {
  const { deps, calls } = mkDeps();
  const r = await updateCalendarEvent(deps, ME, { event_id: 'new-9', provider: 'google', new_start_time: '2026-11-07T10:00:00Z' });
  assert.equal(r.success, false);
  assert.match(String(r.error), /new_end_time is required/);
  assert.equal(calls.length, 0);
});

test('no match -> not_found with nearby events, no provider call', async () => {
  const { deps, calls } = mkDeps();
  const r = await updateCalendarEvent(deps, ME, { match_title: 'dentist', match_start_time: '2026-11-05T15:10:00Z', new_title: 'x' });
  assert.equal(r.not_found, true);
  assert.equal(calls.length, 0);
});

test('no identifying args -> error', async () => {
  const { deps } = mkDeps();
  const r = await updateCalendarEvent(deps, ME, { new_title: 'x' });
  assert.equal(r.success, false);
});

test('buildPatch rejects end before start and empty changes', () => {
  const row = ROWS[ME][0];
  assert.ok('error' in buildPatch('outlook', { new_start_time: '2026-11-05T16:00:00Z', new_end_time: '2026-11-05T15:00:00Z' }, row));
  assert.ok('error' in buildPatch('google', {}, row));
  assert.ok('error' in buildPatch('google', { new_start_time: 'not a date' }, row));
});

test('matchEventRows: provider filter and window', () => {
  const hits = matchEventRows(ROWS[ME], { match_start_time: '2026-11-06T13:30:00Z', provider: 'google' });
  assert.equal(hits.length, 2);
  assert.equal(matchEventRows(ROWS[ME], { match_start_time: '2026-11-06T18:00:00Z' }).length, 0);
});

test('FEED: update of a work-calendar feed row is refused read-only with NO token or provider call', async () => {
  const { deps, calls, tokenCalls } = mkDeps();
  const r = await updateCalendarEvent(deps, ME, { event_id: 'feed:work@example.com:AAMk1', new_title: 'x' });
  assert.equal(r.success, false);
  assert.equal(r.read_only, true);
  assert.equal(calls.length, 0);
  assert.equal(tokenCalls.length, 0);
});

test('FEED: delete of a feed row (found by title+time) is refused read-only with NO provider call', async () => {
  const { deps, calls } = mkDeps();
  const r = await deleteCalendarEvent(deps, ME, {
    match_title: 'Work standup', match_start_time: '2026-11-07T14:00:00Z', user_explicitly_requested: true,
  });
  assert.equal(r.success, false);
  assert.equal(r.read_only, true);
  assert.equal(calls.length, 0);
});
