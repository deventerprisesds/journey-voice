// =============================================================================
// WHAT:       Executable proof for the daily-brief DATA SOURCE
//             (`supabase/functions/_shared/digest-source-daily.ts`).
// WHY:        Four properties of that module are the ones a wrong deploy or a
//             lazy refactor silently breaks: the timezone fallback, the priority
//             ORDER being a property of the CODE rather than of the query, the
//             fail-closed deep link, and the empty-day null. Each has a named
//             test below and each was mutation-proved.
// EVIDENCE:   .claude/IMPL-digest-source-daily.md (every mutation verbatim).
// Run: npm test   (node --experimental-strip-types --test src/utils/*.test.ts)
// =============================================================================
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadDailyBriefPayload,
  resolveTimezone,
  PREFS_TABLE,
  TASKS_TABLE,
  EVENTS_TABLE,
} from '../../supabase/functions/_shared/digest-source-daily.ts';
import {
  MissingDeepLinkBaseError,
  DEFAULT_TIMEZONE,
  APP_BASE_URL_ENV,
  PRIORITIES_PATH,
} from '../../supabase/functions/_shared/digest-content.ts';

const USER = 'user-1';
const TODAY = '2026-09-14';
const BASE = 'https://journey.example.org';

// ---------------------------------------------------------------------------
// A fake PostgREST client.
//
// supabase-js filter builders are THENABLES -- `await from().select().eq()`
// resolves the builder itself -- so the fake is one object whose filter methods
// return `this` and which carries a `then`. `maybeSingle()` is the one method
// that resolves to a single row rather than a list.
// ---------------------------------------------------------------------------
function fakeClient(config: any = {}) {
  const calls: string[] = [];
  // `tasks` may be a FLAT row array (same rows for every tasks query) or an
  // ARRAY OF ARRAYS -- one entry per tasks query, in call order. The second form
  // is what lets a test tell the scheduled-today query apart from the open
  // query; with a flat array the two are indistinguishable and a dropped query
  // would go unnoticed.
  let tasksCall = 0;
  const taskRowsForCall = () => {
    const t = config.tasks ?? [];
    if (Array.isArray(t) && Array.isArray(t[0])) return t[tasksCall++] ?? [];
    return t;
  };
  return {
    calls,
    from(table: string) {
      calls.push(table);
      const q: any = {
        select: () => q,
        eq: () => q,
        gte: () => q,
        lt: () => q,
        is: () => q,
        not: () => q,
        maybeSingle: async () => {
          if (config.prefsThrows) throw new Error('prefs read exploded');
          return { data: config.prefs ?? null, error: null };
        },
        then: (resolve: any, reject: any) =>
          Promise.resolve({
            data:
              table === TASKS_TABLE
                ? taskRowsForCall()
                : table === EVENTS_TABLE
                  ? (config.events ?? [])
                  : [],
            error: null,
          }).then(resolve, reject),
      };
      return q;
    },
  };
}

/** A task row shaped like the real `tasks` Row columns this module selects. */
function taskRow(over: any = {}) {
  return {
    id: over.id ?? 't1',
    title: over.title ?? 'A task',
    start_time: over.start_time ?? null,
    end_time: over.end_time ?? null,
    due_date: over.due_date ?? null,
    status: over.status ?? 'TODO',
    category: over.category ?? 'CAREER',
    priority: over.priority ?? 'HIGH',
    is_priority: over.is_priority ?? false,
    priority_rank: over.priority_rank ?? null,
    pushed_count: over.pushed_count ?? 0,
    external_event_id: null,
    assignment_id: null,
    assignment_url: null,
    scheduling_context: null,
    completed_at: null,
  };
}

/** is_priority + a rank == a row the priority lane picks up. */
function priorityRow(id: string, title: string, rank: number | null) {
  return taskRow({ id, title, is_priority: true, priority_rank: rank });
}

// 9:00 AM America/New_York on 2026-09-14 (EDT, UTC-4).
function scheduledRow(id: string, title: string, utcIso: string) {
  return taskRow({ id, title, start_time: utcIso });
}

// --- Deno.env stubbing ------------------------------------------------------
// The module reads APP_BASE_URL through `globalThis.Deno` so the fail-closed
// path is reachable from a node test. An untestable fail-closed branch is not
// fail-closed, it is unverified.
let savedDeno: any;
function setEnv(value: string | undefined) {
  (globalThis as any).Deno = {
    env: { get: (k: string) => (k === APP_BASE_URL_ENV ? value : undefined) },
  };
}
beforeEach(() => { savedDeno = (globalThis as any).Deno; });
afterEach(() => { (globalThis as any).Deno = savedDeno; });

// ===========================================================================
describe('digest-source-daily — timezone resolution', () => {
  it('TZ-FALLBACK: a null timezone column falls back to DEFAULT_TIMEZONE', async () => {
    setEnv(BASE);
    const client = fakeClient({
      prefs: { timezone: null },
      tasks: [priorityRow('p1', 'Ranked', 1)],
    });
    const payload = await loadDailyBriefPayload(client as any, USER, { todayStr: TODAY });
    assert.ok(payload, 'a ranked priority must produce a brief');
    assert.equal(payload!.timezone, DEFAULT_TIMEZONE);
    assert.ok(client.calls.includes(PREFS_TABLE), 'the prefs table must actually be read');
  });

  it('TZ-FALLBACK: a missing prefs row falls back rather than skipping the user', async () => {
    setEnv(BASE);
    const client = fakeClient({ prefs: null, tasks: [priorityRow('p1', 'Ranked', 1)] });
    const payload = await loadDailyBriefPayload(client as any, USER, { todayStr: TODAY });
    assert.equal(payload!.timezone, DEFAULT_TIMEZONE);
  });

  it('TZ-FALLBACK: a prefs read ERROR falls back rather than throwing', async () => {
    const client = fakeClient({ prefsThrows: true });
    assert.equal(await resolveTimezone(client as any, USER), DEFAULT_TIMEZONE);
  });

  it('TZ-REAL: a configured timezone is used as-is, not overwritten by the default', async () => {
    setEnv(BASE);
    const client = fakeClient({
      prefs: { timezone: 'Asia/Tokyo' },
      tasks: [priorityRow('p1', 'Ranked', 1)],
    });
    const payload = await loadDailyBriefPayload(client as any, USER, { todayStr: TODAY });
    assert.equal(payload!.timezone, 'Asia/Tokyo');
    assert.notEqual(payload!.timezone, DEFAULT_TIMEZONE);
  });
});

// ===========================================================================
describe('digest-source-daily — priority ORDER is a property of the code', () => {
  it('ORDER: a SHUFFLED query result still arrives rank ASC', async () => {
    setEnv(BASE);
    // Deliberately shuffled, and deliberately NOT in rank order: the stated trap
    // is a test that passes only because the DB happened to order the rows.
    const client = fakeClient({
      prefs: { timezone: DEFAULT_TIMEZONE },
      tasks: [
        priorityRow('p3', 'Third', 3),
        priorityRow('p1', 'First', 1),
        priorityRow('p4', 'Fourth', 4),
        priorityRow('p2', 'Second', 2),
      ],
    });
    const payload = await loadDailyBriefPayload(client as any, USER, { todayStr: TODAY });
    assert.deepEqual(payload!.priorities.map((p) => p.rank), [1, 2, 3, 4]);
    assert.deepEqual(
      payload!.priorities.map((p) => p.title),
      ['First', 'Second', 'Third', 'Fourth'],
    );
  });

  it('ORDER: an unranked priority sorts LAST, never as rank 0', async () => {
    setEnv(BASE);
    const client = fakeClient({
      prefs: { timezone: DEFAULT_TIMEZONE },
      tasks: [priorityRow('u', 'Unranked', null), priorityRow('r', 'Ranked', 7)],
    });
    const payload = await loadDailyBriefPayload(client as any, USER, { todayStr: TODAY });
    assert.deepEqual(payload!.priorities.map((p) => p.title), ['Ranked', 'Unranked']);
  });

  it('ORDER: a DONE task never reaches the priority lane', async () => {
    setEnv(BASE);
    const done = taskRow({ id: 'd', title: 'Done', is_priority: true, priority_rank: 1, status: 'DONE' });
    const client = fakeClient({
      prefs: { timezone: DEFAULT_TIMEZONE },
      tasks: [done, priorityRow('p2', 'Live', 2)],
    });
    const payload = await loadDailyBriefPayload(client as any, USER, { todayStr: TODAY });
    assert.deepEqual(payload!.priorities.map((p) => p.title), ['Live']);
  });
});

// ===========================================================================
describe('digest-source-daily — deep link fails CLOSED', () => {


  it('LINK: a configured base yields an ABSOLUTE link to the priorities widget', async () => {
    setEnv(BASE);
    const client = fakeClient({
      prefs: { timezone: DEFAULT_TIMEZONE },
      tasks: [priorityRow('p1', 'Ranked', 1)],
    });
    const payload = await loadDailyBriefPayload(client as any, USER, { todayStr: TODAY });
    assert.equal(payload!.deepLink, BASE + PRIORITIES_PATH);
    assert.match(payload!.deepLink, /^https:\/\//);
  });
});

// ===========================================================================
describe('digest-source-daily — the empty day sends nothing', () => {
  it('EMPTY: no schedule and no priorities returns null', async () => {
    setEnv(BASE);
    const client = fakeClient({ prefs: { timezone: DEFAULT_TIMEZONE }, tasks: [], events: [] });
    assert.equal(await loadDailyBriefPayload(client as any, USER, { todayStr: TODAY }), null);
  });

  it('EMPTY: an open task that is neither scheduled nor ranked returns null', async () => {
    setEnv(BASE);
    const client = fakeClient({
      prefs: { timezone: DEFAULT_TIMEZONE },
      tasks: [taskRow({ id: 'idle', title: 'Someday' })],
    });
    assert.equal(await loadDailyBriefPayload(client as any, USER, { todayStr: TODAY }), null);
  });

  it('EMPTY: a calendar hold ALONE is still null', async () => {
    setEnv(BASE);
    const client = fakeClient({
      prefs: { timezone: DEFAULT_TIMEZONE },
      tasks: [],
      events: [{
        id: 'h1', title: 'Accepted meeting',
        start_time: '2026-09-14T18:00:00Z', end_time: '2026-09-14T19:00:00Z',
      }],
    });
    assert.equal(await loadDailyBriefPayload(client as any, USER, { todayStr: TODAY }), null);
  });

  it('NOT-EMPTY: a scheduled task alone DOES produce a brief', async () => {
    setEnv(BASE);
    const client = fakeClient({
      prefs: { timezone: DEFAULT_TIMEZONE },
      tasks: [scheduledRow('s1', 'Standup', '2026-09-14T13:00:00Z')],
      events: [{
        id: 'h1', title: 'Accepted meeting',
        start_time: '2026-09-14T18:00:00Z', end_time: '2026-09-14T19:00:00Z',
      }],
    });
    const payload = await loadDailyBriefPayload(client as any, USER, { todayStr: TODAY });
    assert.ok(payload, 'a scheduled item must produce a brief');
    assert.equal(payload!.kind, 'daily_brief');
    assert.equal(payload!.date, TODAY);
    assert.deepEqual(payload!.schedule.map((s) => s.title), ['Standup']);
    assert.equal(payload!.calendarHolds.length, 1);
    assert.equal(payload!.priorities.length, 0);
  });
});

// ===========================================================================
describe('digest-source-daily — both task populations are fetched', () => {
  it('FETCH: the scheduled-today rows and the open rows are BOTH merged in', async () => {
    setEnv(BASE);
    // Call 1 = scheduled-today (a completed item still belongs on the schedule).
    // Call 2 = open tasks (where the priority lane comes from). Neither query is
    // a subset of the other, so dropping either silently truncates the brief.
    const client = fakeClient({
      prefs: { timezone: DEFAULT_TIMEZONE },
      tasks: [
        [scheduledRow('s1', 'Standup', '2026-09-14T13:00:00Z')],
        [priorityRow('p1', 'Ranked', 1)],
      ],
    });
    const payload = await loadDailyBriefPayload(client as any, USER, { todayStr: TODAY });
    assert.deepEqual(payload!.schedule.map((s) => s.title), ['Standup']);
    assert.deepEqual(payload!.priorities.map((p) => p.title), ['Ranked']);
  });

  it('FETCH: a row returned by BOTH queries appears once, not twice', async () => {
    setEnv(BASE);
    const both = priorityRow('dup', 'Counted once', 1);
    const client = fakeClient({
      prefs: { timezone: DEFAULT_TIMEZONE },
      tasks: [[both], [both]],
    });
    const payload = await loadDailyBriefPayload(client as any, USER, { todayStr: TODAY });
    assert.equal(payload!.priorities.length, 1);
  });
});
