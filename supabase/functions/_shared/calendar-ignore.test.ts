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
import { isIgnoredEvent, resolveIgnoreTitles, resolveIgnoreRules, isIgnoredCalendarEvent, isTentativeGroup, purgeTentativeGroups, loadIgnoreRules, TENTATIVE_GROUP_MIN_OTHERS, resolveIgnoreCategories, hasIgnoredCategory, hasAnyIgnoreRule, normalizeCategories, purgeIgnoredCategoryRows } from './calendar-ignore.ts';

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
    assert.match(src, /const keptOutlook = await applyIgnoreList\(supabaseClient, connection, eventsToUpsert\);\n\s*const outlookTodayChanged = await detectTodayChange\(supabaseClient, connection, keptOutlook\);\n\s*const \{ error: upsertError, data: upsertData \} = await supabaseClient\n\s*\.from\('external_calendar_events'\)\n\s*\.upsert\(keptOutlook/);
    assert.match(src, /const keptGoogle = await applyIgnoreList\(supabaseClient, connection, eventsToUpsert\);\n\s*const googleTodayChanged = await detectTodayChange\(supabaseClient, connection, keptGoogle\);\n\s*const \{ error: upsertError \} = await supabaseClient\n\s*\.from\('external_calendar_events'\)\n\s*\.upsert\(keptGoogle/);
  });
});

describe('every calendar write path applies the ignore list', () => {
  it('CI-4 the OneDrive feed filters before it stores, with the work mailbox counted as the owner', () => {
    const src = readFileSync(new URL('./onedrive-feed-sync.ts', import.meta.url), 'utf8');
    assert.match(src, /const ignore = await loadIgnoreRules\(supabase, connection\.user_id, \[cfg\.mailbox, cfg\.driveAccount\]\);\n\s*const rows = mapFeedEventRows\([^\n]*\)\n\s*\.filter\(\(r: \{ title\?: string \| null; show_as\?: string \| null; attendees\?: unknown; categories\?: unknown \}\) => !isIgnoredCalendarEvent\(r, ignore\)\);/);
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

// Owner 2026-11-22: "ignore a category with purple being the category to turn on for ignoring now".
// Spelling table: .claude/ac-calendar-ignore-categories.md S-1..S-18. Exact name match after trim + case-fold.
describe('ignore by Outlook category', () => {
  const PURPLE = resolveIgnoreRules({ calendarIgnoreCategories: ['Purple category'] });
  const busy = (categories: unknown, title = 'Sprint Review') => ({ title, show_as: 'busy', categories });
  it('CC-1 AC-1 resolves to trimmed lower-case names; titles/tentative/owners unchanged', () => {
    const before = resolveIgnoreRules({}, ['o@x.com']);
    const after = resolveIgnoreRules({ calendarIgnoreCategories: ['Purple category'] }, ['o@x.com']);
    assert.deepEqual(after.categories, ['purple category']);
    assert.deepEqual([after.phrases, after.tentative, after.ownerEmails], [before.phrases, before.tentative, before.ownerEmails]);
  });
  it('CC-2 AC-2/3 malformed config ignores NOTHING by category; junk entries dropped, never coerced', () => {
    for (const v of [undefined, null, 'Purple category', 3, {}]) assert.deepEqual(resolveIgnoreCategories({ calendarIgnoreCategories: v }), [], String(v));
    assert.deepEqual(resolveIgnoreCategories({ calendarIgnoreCategories: [' Purple category ', '', '   ', 3, null, {}] }), ['purple category']);
    assert.deepEqual(resolveIgnoreCategories(null), []);
  });
  it('CC-3 spelling table S-1..S-18', () => {
    const rows: [string, unknown, unknown, boolean][] = [
      ['S-1', ['Purple category'], PURPLE, true],
      ['S-2', ['purple CATEGORY'], PURPLE, true],
      ['S-3', [' Purple category '], PURPLE, true],
      ['S-4', ['Blue category', 'Purple category'], PURPLE, true],
      ['S-5', ['Blue category'], PURPLE, false],
      ['S-6', ['Purple'], PURPLE, false],
      ['S-7', ['Dark Purple category'], PURPLE, false],
      ['S-8', ['Purple category 2'], PURPLE, false],
      ['S-9a', [''], PURPLE, false],
      ['S-9b', ['   '], PURPLE, false],
      ['S-10a', null, PURPLE, false],
      ['S-10b', undefined, PURPLE, false],
      ['S-10c', [], PURPLE, false],
      ['S-11', 'Purple category', PURPLE, false],
      ['S-12', [7, null, {}], PURPLE, false],
      ['S-14', ['Purple category'], resolveIgnoreRules({ calendarIgnoreCategories: ['purple category'] }), true],
      ['S-15', ['Purple category'], resolveIgnoreRules({ calendarIgnoreCategories: [] }), false],
      ['S-16', ['Purple category'], resolveIgnoreRules({ calendarIgnoreCategories: 'Purple category' }), false],
      ['S-18', ['Purple Category'], PURPLE, true],
      ['AC-9', ['Purple categoryX'], PURPLE, false],
      ['AC-10', ['  PURPLE CATEGORY  '], PURPLE, true],
    ];
    for (const [id, cats, rules, want] of rows) assert.equal(isIgnoredCalendarEvent(busy(cats), rules as never), want, id);
    // S-13 / AC-8: the title never feeds the category rule.
    assert.equal(isIgnoredCalendarEvent(busy([], 'Purple category review'), PURPLE), false, 'S-13');
  });
  it('CC-4 AC-6 / S-17 the tentative switch OFF does not turn the category rule off', () => {
    const rules = resolveIgnoreRules({ calendarIgnoreTentative: false, calendarIgnoreCategories: ['Purple category'] });
    assert.equal(rules.tentative, false);
    assert.equal(isIgnoredCalendarEvent(busy(['Purple category']), rules), true);
    const grp = [{ email: 'a@x.com' }, { email: 'b@x.com' }];
    assert.equal(isIgnoredCalendarEvent({ title: 'Retro', show_as: 'tentative', attendees: grp, categories: ['Purple category'] }, rules), true);
  });
  it('CC-5 AC-22 a writer may skip filtering only when NO rule is on (categories count)', () => {
    assert.equal(hasAnyIgnoreRule({ phrases: [], tentative: false, categories: ['purple category'], ownerEmails: [] }), true);
    assert.equal(hasAnyIgnoreRule({ phrases: [], tentative: false, categories: [], ownerEmails: [] }), false);
    assert.equal(hasAnyIgnoreRule({ phrases: [], tentative: false, ownerEmails: [] }), false);
  });
  it('CC-6 normalizeCategories keeps string names only', () => {
    assert.deepEqual(normalizeCategories(['Purple category', 3, '', null]), ['Purple category']);
    assert.deepEqual(normalizeCategories('Purple category'), []);
    assert.equal(hasIgnoredCategory(['Purple category'], []), false);
  });
  it('CC-7 AC-23/24 purge deletes by id: dropped external ids AND stored rows carrying a listed category; never TaskOS rows', async () => {
    const calls: { op: string; arg?: unknown }[] = [];
    const q = (rows: unknown[]) => {
      const b: Record<string, unknown> = {};
      for (const m of ['eq', 'is', 'not']) b[m] = (...a: unknown[]) => { calls.push({ op: m, arg: a }); return b; };
      b.in = (...a: unknown[]) => { calls.push({ op: 'in', arg: a }); return b; };
      b.then = (r: (v: unknown) => void) => r({ data: rows, error: null });
      return b;
    };
    let selects = 0;
    const client = {
      from: () => ({
        select: (cols: string) => { selects++; return cols === 'id' ? q([{ id: 'stored-retagged' }]) : q([
          { id: 'old-purple', categories: ['Purple category'] }, { id: 'blue', categories: ['Blue category'] }, { id: 'odd', categories: 'Purple category' },
        ]); },
        delete: () => ({ in: async (c: string, ids: unknown) => { calls.push({ op: 'delete', arg: [c, ids] }); return { error: null }; } }),
      }),
    };
    const n = await purgeIgnoredCategoryRows(client, { id: 'c1' }, PURPLE, ['EXT-1']);
    assert.equal(n, 2);
    assert.deepEqual(calls.filter((c) => c.op === 'delete'), [{ op: 'delete', arg: ['id', ['stored-retagged', 'old-purple']] }]);
    assert.ok(calls.filter((c) => c.op === 'is').every((c) => JSON.stringify(c.arg) === '["source_task_id",null]'));
    assert.equal(calls.filter((c) => c.op === 'is').length, 2, 'both selects exclude TaskOS-created rows');
    assert.ok(calls.some((c) => c.op === 'in' && JSON.stringify(c.arg) === '["external_event_id",["EXT-1"]]'));
    assert.equal(selects, 2);
    // Rule off -> no reads, no deletes.
    assert.equal(await purgeIgnoredCategoryRows(client, { id: 'c1' }, resolveIgnoreRules({}), ['EXT-1']), 0);
    assert.equal(selects, 2);
  });
  it('CC-8 AC-26 a failing purge is non-fatal', async () => {
    const b: Record<string, unknown> = {};
    for (const m of ['eq', 'is', 'not', 'in']) b[m] = () => b;
    b.then = (r: (v: unknown) => void) => r({ data: [{ id: 'x', categories: ['Purple category'] }], error: null });
    const client = { from: () => ({ select: () => b, delete: () => ({ in: async () => ({ error: { message: 'boom' } }) }) }) };
    assert.equal(await purgeIgnoredCategoryRows(client, { id: 'c1' }, PURPLE, []), 0);
  });
  it('CC-9 AC-19/21/22/23/25 delta-sync requests, stores and enforces categories on both providers', () => {
    const src = readFileSync(new URL('../calendar-delta-sync/index.ts', import.meta.url), 'utf8');
    assert.match(src, /\$select=id,subject,body,start,end,isAllDay,location,showAs,seriesMasterId,attendees,organizer,categories`/);
    assert.match(src, /categories: normalizeCategories\(event\.categories\),/);
    assert.match(src, /categories: \[\], \/\/ Google has no categories/);
    assert.match(src, /if \(!hasAnyIgnoreRule\(rules\)\) return rows;/);
    assert.doesNotMatch(src, /if \(!rules\.phrases\.length && !rules\.tentative\) return rows;/);
    assert.match(src, /await purgeIgnoredCategoryRows\(supabaseClient, connection, rules, dropped\);/);
  });
  it('CC-10 AC-27/28 the integration manager carries categories (Outlook) and [] (Google) onto the row it filters', () => {
    const src = readFileSync(new URL('../calendar-integration-manager/index.ts', import.meta.url), 'utf8');
    assert.match(src, /categories: event\.categories \?\? \[\],/);
    assert.match(src, /categories: normalizeCategories\(event\.categories\),/);
    assert.match(src, /categories: \[\], \/\/ Google has no categories/);
  });
});
