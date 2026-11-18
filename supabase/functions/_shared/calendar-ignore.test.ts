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
import { isIgnoredEvent, resolveIgnoreTitles } from './calendar-ignore.ts';

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
  it('CI-4 the OneDrive feed filters before it stores (ignored rows then drop out as stale)', () => {
    const src = readFileSync(new URL('./onedrive-feed-sync.ts', import.meta.url), 'utf8');
    assert.match(src, /const ignore = await loadIgnoreTitles\(supabase, connection\.user_id\);\n\s*const rows = mapFeedEventRows\([^\n]*\)\n\s*\.filter\(\(r: \{ title\?: string \| null \}\) => !isIgnoredEvent\(r\.title, ignore\)\);/);
  });
  it('CI-5 no other file stores external calendar events without the ignore list', () => {
    // Writers that copy EXTERNAL events in. Task-created events (calendar-integration-manager) are the app's own.
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
  });
});
