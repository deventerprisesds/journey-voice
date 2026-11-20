// WHAT:       Tests for calendar-ignore.ts and its wiring into calendar-delta-sync (both providers).
// WHY:        Owner 2026-11-18: "work block" events must never appear or take up slots.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   113 stored "Work Block" events; 11-17 build rejections "overlaps event Work Block 2".
// Run: node --experimental-strip-types --no-warnings --test supabase/functions/_shared/calendar-ignore.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { isIgnoredEvent, resolveIgnoreTitles, resolveIgnoreRules, isIgnoredCalendarEvent, isTentativeGroup, purgeTentativeGroups, loadIgnoreRules, TENTATIVE_GROUP_MIN_OTHERS } from './calendar-ignore.ts';

describe('ignored calendar events', () => {
  it('CI-1 every spelling seen in the data is ignored; real meetings are not', () => {
    const p = resolveIgnoreTitles({});
    for (const t of ['Work Block', 'Work Block 1', 'Work block 2', 'WORK BLOCK 3']) assert.equal(isIgnoredEvent(t, p), true, t);
    for (const t of ['1:1 Andrew and Von', 'Platform Weekly', 'Block party', null]) assert.equal(isIgnoredEvent(t, p), false, String(t));
  });
  it('CI-2 Settings replaces the list; an empty list ignores nothing', () => {
    assert.deepEqual(resolveIgnoreTitles({ calendarIgnoreTitles: [' Focus Time ', '', 3] }), ['focus time']);
    assert.equal(isIgnoredEvent('Work Block', resolveIgnoreTitles({ calendarIgnoreTitles: [] })), false);
  });
  it('CI-3 both delta-sync paths (Outlook, Google) filter before they store', () => {
    const src = readFileSync(new URL('../calendar-delta-sync/index.ts', import.meta.url), 'utf8');
    assert.match(src, /const keptOutlook = await applyIgnoreList\(supabaseClient, connection, eventsToUpsert\);\n\s*const \{ error: upsertError, data: upsertData \} = await supabaseClient\n\s*\.from\('external_calendar_events'\)\n\s*\.upsert\(keptOutlook/);
    assert.match(src, /const keptGoogle = await applyIgnoreList\(supabaseClient, connection, eventsToUpsert\);\n\s*const \{ error: upsertError \} = await supabaseClient\n\s*\.from\('external_calendar_events'\)\n\s*\.upsert\(keptGoogle/);
  });
});

describe('every calendar write path applies the ignore list', () => {
  it('CI-4 the OneDrive feed filters before it stores, with the work mailbox counted as the owner', () => {
    const src = readFileSync(new URL('./onedrive-feed-sync.ts', import.meta.url), 'utf8');
    assert.match(src, /const ignore = await loadIgnoreRules\(supabase, connection\.user_id, \[cfg\.mailbox, cfg\.driveAccount\]\);\n\s*const rows = mapFeedEventRows\([^\n]*\)\n\s*\.filter\(\(r: \{ title\?: string \| null; show_as\?: string \| null; attendees\?: unknown \}\) => !isIgnoredCalendarEvent\(r, ignore\)\);/);
  });
  it('CI-5 no other file stores external calendar events without the ignore list', () => {
    // Every file that upserts external_calendar_events must be listed here AND apply the ignore list.
    // calendar-integration-manager's syncCalendarEvents copies EXTERNAL events in too (2026-11-20), so it
    // filters with the same rule before its upsert.
    const allowedWriters = new Set(['calendar-delta-sync/index.ts', '_shared/onedrive-feed-sync.ts', 'calendar-integration-manager/index.ts']);
    const root = new URL('../', import.meta.url);
    const { readdirSync, statSync } = require('node:fs');
    const walk = (dir: URL, rel = ''): string[] => readdirSync(dir).flatMap((n: string) => {
      const u = new URL(n + (statSync(new URL(n, dir)).isDirectory() ? '/' : ''), dir);
      if (statSync(u).isDirectory()) return walk(u, rel + n + '/');
      return n.endsWith('.ts') && !n.endsWith('.test.ts') ? [rel + n] : [];
    });
    const writers = walk(root).filter((f) => {
      const src = readFileSync(new URL(f, root), 'utf8');
      return /from\(['"]external_calendar_events['"]\)\s*\n?\s*\.upsert\(/.test(src) || /\.from\(["']external_calendar_events["']\)\s*\.upsert/.test(src);
    });
    for (const w of writers) assert.ok(allowedWriters.has(w), `new calendar writer without the ignore list: ${w}`);
    for (const w of writers) assert.match(readFileSync(new URL(w, root), 'utf8'), /!isIgnoredCalendarEvent\(/, `${w} upserts without the ignore list`);
    const cim = readFileSync(new URL('calendar-integration-manager/index.ts', root), 'utf8');
    assert.match(cim, /const keptEvents = eventsToInsert\.filter\(\(r: any\) => !isIgnoredCalendarEvent\(r, ignore\)\);\n\n\s*const \{ error: upsertError \} = await supabaseClient\n\s*\.from\('external_calendar_events'\)\n\s*\.upsert\(keptEvents/);
  });
});

// Owner 2026-11-19 put tentative on the exclusion list; 2026-11-20 narrowed it: "only when it isn't a meeting
// with me alone but is instead a group meeting". Tentative GROUP invites (2+ other people) are ignored; own
// holds and 1:1s stay; an unknown attendee list is kept.
const OWNER = 'von@example.com';
const person = (email: string, extra: Record<string, unknown> = {}) => ({ email, ...extra });
describe('only tentative GROUP invites are ignored', () => {
  const rules = resolveIgnoreRules({}, [OWNER]);
  it('CI-6 tentative with 2+ others is ignored; busy/free/oof/unknown/null are not, whatever the attendees', () => {
    const group = [person('a@x.com'), person('b@x.com')];
    assert.equal(TENTATIVE_GROUP_MIN_OTHERS, 2);
    assert.equal(isIgnoredCalendarEvent({ title: 'Story Point Poker', show_as: 'tentative', attendees: group }, rules), true);
    assert.equal(isIgnoredCalendarEvent({ title: 'Platform Weekly', show_as: 'Tentative', attendees: group }, rules), true);
    for (const s of ['busy', 'free', 'oof', 'workingElsewhere', 'unknown', null, undefined, ''])
      assert.equal(isIgnoredCalendarEvent({ title: 'Platform Weekly', show_as: s, attendees: group }, rules), false, String(s));
  });
  it('CI-7 a title phrase still ignores whatever the availability', () => {
    assert.equal(isIgnoredCalendarEvent({ title: 'Work Block 2', show_as: 'busy' }, rules), true);
  });
  it('CI-8 Settings can turn tentative off; only an explicit false does', () => {
    const group = [person('a@x.com'), person('b@x.com')];
    assert.equal(isIgnoredCalendarEvent({ title: 'Platform Retro', show_as: 'tentative', attendees: group }, resolveIgnoreRules({ calendarIgnoreTentative: false }, [OWNER])), false);
    assert.equal(resolveIgnoreRules({ calendarIgnoreTentative: 'no' }).tentative, true);
    assert.equal(resolveIgnoreRules(null).tentative, true);
  });
  it('CI-10 solo tentative hold (only the owner, by address or self flag) is kept', () => {
    assert.equal(isIgnoredCalendarEvent({ title: 'Hold', show_as: 'tentative', attendees: [person('VON@example.com')] }, rules), false);
    assert.equal(isIgnoredCalendarEvent({ title: 'Hold', show_as: 'tentative', attendees: [person('me@other.com', { self: true })] }, rules), false);
  });
  it('CI-11 1:1 tentative (owner + exactly one other, plus a room) is kept', () => {
    const att = [person(OWNER), person('andrew@x.com'), person('room1@x.com', { resource: true })];
    assert.equal(isIgnoredCalendarEvent({ title: '1:1 Andrew and Von', show_as: 'tentative', attendees: att }, rules), false);
  });
  it('CI-12 tentative with exactly two others (and the owner) is ignored', () => {
    const att = [person(OWNER), person('a@x.com'), person('b@x.com')];
    assert.equal(isIgnoredCalendarEvent({ title: 'Story Point Poker', show_as: 'tentative', attendees: att }, rules), true);
    assert.equal(isTentativeGroup({ show_as: 'tentative', attendees: att }, [OWNER]), true);
  });
  it('CI-13 tentative with attendees:[] or no list is UNKNOWN, kept', () => {
    assert.equal(isIgnoredCalendarEvent({ title: 'Platform Weekly', show_as: 'tentative', attendees: [] }, rules), false);
    assert.equal(isIgnoredCalendarEvent({ title: 'Platform Weekly', show_as: 'tentative' }, rules), false);
  });
  it('CI-14 the feed work mailbox counts as the owner, so an owner-only work hold is kept', async () => {
    const prefsOnly = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }), limit: () => ({ maybeSingle: async () => ({ data: null }) }), then: (r: (v: unknown) => void) => r({ data: [] }) }) }) }) };
    const withMailbox = await loadIgnoreRules(prefsOnly, 'u1', ['Von@WorkCo.com']);
    const row = { title: 'Focus', show_as: 'tentative', attendees: [person('von@workco.com'), person('a@x.com')] };
    assert.equal(isIgnoredCalendarEvent(row, withMailbox), false);
    // Without the mailbox the owner counts as another person and the 1:1 looks like a group.
    const without = await loadIgnoreRules(prefsOnly, 'u1');
    assert.equal(isIgnoredCalendarEvent(row, without), true);
  });
  it('CI-15 the purge deletes stored tentative GROUP rows only, by id', async () => {
    const stored = [
      { id: 'g1', show_as: 'tentative', attendees: [person('a@x.com'), person('b@x.com')] },
      { id: 'solo', show_as: 'tentative', attendees: [person(OWNER)] },
      { id: 'oneone', show_as: 'tentative', attendees: [person(OWNER), person('a@x.com')] },
      { id: 'unknown', show_as: 'tentative', attendees: [] },
    ];
    const calls: { op: string; arg: unknown }[] = [];
    const q: any = {
      select: (c: string) => { calls.push({ op: 'select', arg: c }); return q; },
      eq: (c: string, v: unknown) => { calls.push({ op: 'eq', arg: [c, v] }); return q; },
      is: (c: string, v: unknown) => { calls.push({ op: 'is', arg: [c, v] }); return q; },
      then: (r: (v: unknown) => void) => r({ data: stored, error: null }),
      delete: () => ({ in: async (c: string, ids: unknown) => { calls.push({ op: 'delete', arg: [c, ids] }); return { error: null }; } }),
    };
    const n = await purgeTentativeGroups({ from: () => q }, { id: 'c1' }, rules);
    assert.equal(n, 1);
    assert.deepEqual(calls.filter((c) => c.op === 'delete'), [{ op: 'delete', arg: ['id', ['g1']] }]);
    assert.ok(calls.some((c) => c.op === 'is' && JSON.stringify(c.arg) === '["source_task_id",null]'));
  });
  it('CI-9 delta-sync filters with the combined rule and purges only tentative GROUP rows (no blanket purge)', () => {
    const src = readFileSync(new URL('../calendar-delta-sync/index.ts', import.meta.url), 'utf8');
    assert.match(src, /const rules = await loadIgnoreRules\(supabaseClient, connection\.user_id\);/);
    assert.match(src, /const kept = rows\.filter\(\(r\) => !isIgnoredCalendarEvent\(r, rules\)\);/);
    assert.match(src, /if \(rules\.tentative\) await purgeTentativeGroups\(supabaseClient, connection, rules\);/);
    assert.doesNotMatch(src, /\.delete\(\)[^;]*\.eq\('show_as', 'tentative'\)/);
  });
});
