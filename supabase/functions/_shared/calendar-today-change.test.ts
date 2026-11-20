// WHAT:       Tests for calendar-today-change.ts (does a sync change TODAY?) and the calendar-change rebuild kick.
// WHY:        Owner 2026-11-20: a meeting accepted mid-day must reach today's plan immediately.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   docs/qc-evidence/BUILD-tentative-group-only.md.
// Run: node --experimental-strip-types --no-warnings --test supabase/functions/_shared/calendar-today-change.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { todayCalendarChanged, detectTodayChange } from './calendar-today-change.ts';
import { kickCalendarChangeRebuild, buildCalendarChangeBody, type RebuildDeps } from './rebuild-schedule.ts';

const TZ = 'America/New_York';
// 2026-11-20 12:00 New York (17:00Z).
const NOW = Date.parse('2026-11-20T17:00:00Z');
const TODAY_2PM = '2026-11-20T19:00:00Z'; // 14:00 NY
const TOMORROW_2PM = '2026-11-21T19:00:00Z';
const LATE_TONIGHT_UTC_TOMORROW = '2026-11-21T03:30:00Z'; // 22:30 NY on the 20th: still TODAY locally

describe('todayCalendarChanged', () => {
  it('TC-1 a today event flipped tentative -> busy triggers a rebuild', () => {
    const before = new Map([['e1', 'tentative']]);
    assert.equal(todayCalendarChanged([{ external_event_id: 'e1', start_time: TODAY_2PM, show_as: 'busy' }], before, TZ, NOW), true);
  });
  it('TC-2 a tomorrow-only change does not', () => {
    const before = new Map([['e1', 'tentative']]);
    assert.equal(todayCalendarChanged([{ external_event_id: 'e1', start_time: TOMORROW_2PM, show_as: 'busy' }], before, TZ, NOW), false);
    assert.equal(todayCalendarChanged([{ external_event_id: 'new', start_time: TOMORROW_2PM, show_as: 'busy' }], new Map(), TZ, NOW), false);
  });
  it('TC-3 a NEW event starting today triggers; "today" is the local date, not the UTC one', () => {
    assert.equal(todayCalendarChanged([{ external_event_id: 'n', start_time: TODAY_2PM, show_as: 'tentative' }], new Map(), TZ, NOW), true);
    assert.equal(todayCalendarChanged([{ external_event_id: 'n', start_time: LATE_TONIGHT_UTC_TOMORROW, show_as: 'busy' }], new Map(), TZ, NOW), true);
  });
  it('TC-4 an unchanged or still-tentative today event does not', () => {
    assert.equal(todayCalendarChanged([{ external_event_id: 'e', start_time: TODAY_2PM, show_as: 'busy' }], new Map([['e', 'busy']]), TZ, NOW), false);
    assert.equal(todayCalendarChanged([{ external_event_id: 'e', start_time: TODAY_2PM, show_as: 'tentative' }], new Map([['e', 'tentative']]), TZ, NOW), false);
  });
  it('TC-5 detectTodayChange reads the stored show_as for today rows only, before the upsert', async () => {
    const reads: unknown[] = [];
    const client = {
      from(table: string) {
        if (table === 'user_scheduling_prefs') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { timezone: TZ } }) }) }) };
        const b: any = {
          select: () => b,
          eq: () => b,
          in: async (_c: string, ids: string[]) => { reads.push(ids); return { data: [{ external_event_id: 'e1', show_as: 'tentative' }], error: null }; },
        };
        return b;
      },
    };
    const kept = [
      { external_event_id: 'e1', start_time: TODAY_2PM, show_as: 'busy' },
      { external_event_id: 'e2', start_time: TOMORROW_2PM, show_as: 'busy' },
    ];
    assert.equal(await detectTodayChange(client, { id: 'c', user_id: 'u' }, kept, NOW), true);
    assert.deepEqual(reads, [['e1']]);
    assert.equal(await detectTodayChange(client, { id: 'c', user_id: 'u' }, [kept[1]], NOW), false);
    assert.equal(reads.length, 1, 'no read when nothing starts today');
  });
});

describe('calendar-change rebuild kick', () => {
  function deps(inFlight: boolean) {
    const posts: string[] = [];
    const recorded: unknown[] = [];
    const d: RebuildDeps = {
      supabaseUrl: 'https://x.supabase.co',
      serviceKey: 'k',
      fetch: async (_u, init) => { posts.push(init.body); return { ok: true, status: 200, json: async () => ({}) }; },
      waitUntil: () => {},
      latestBuildSince: async () => null,
      latestRequestSince: async () => (inFlight ? { created_at: '2026-11-20T16:58:00Z', metadata: {} } : null),
      recordRequest: async (...a) => { recorded.push(a); },
      now: () => NOW,
    };
    return { d, posts, recorded };
  }
  it('TC-6 posts {userId, singleDay:true, triggerSource:"calendar_change"} and records the request', async () => {
    const { d, posts, recorded } = deps(false);
    assert.deepEqual(await kickCalendarChangeRebuild(d, 'u1'), { started: true });
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(posts.map((p) => JSON.parse(p)), [{ userId: 'u1', singleDay: true, triggerSource: 'calendar_change' }]);
    assert.deepEqual(buildCalendarChangeBody('u1'), { userId: 'u1', singleDay: true, triggerSource: 'calendar_change' });
    assert.equal((recorded[0] as unknown[])[3], 'calendar_change');
  });
  it('TC-7 a rebuild already running is not stacked', async () => {
    const { d, posts } = deps(true);
    assert.deepEqual(await kickCalendarChangeRebuild(d, 'u1'), { started: false, reason: 'already_running' });
    assert.equal(posts.length, 0);
  });
  it('TC-8 delta-sync kicks at most once per user per run, after the loop, only for a today change', () => {
    const src = readFileSync(new URL('../calendar-delta-sync/index.ts', import.meta.url), 'utf8');
    assert.match(src, /const todayChangedUsers = new Set<string>\(\);/);
    assert.match(src, /if \(result\.today_changed\) todayChangedUsers\.add\(connection\.user_id\);/);
    assert.match(src, /for \(const uid of todayChangedUsers\) \{\n\s*const kick = await kickCalendarChangeRebuild\(deps, uid\);/);
    assert.match(src, /if \(outlookTodayChanged\) result\.today_changed = true;/);
    assert.match(src, /if \(googleTodayChanged\) result\.today_changed = true;/);
    assert.match(src, /if \(feed\.todayChanged\) result\.today_changed = true;/);
    const feed = readFileSync(new URL('./onedrive-feed-sync.ts', import.meta.url), 'utf8');
    assert.match(feed, /const todayChanged = await detectTodayChange\(supabase, connection, rows, nowMs\);\n\s*if \(rows\.length\) \{/);
  });
});
