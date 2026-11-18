// WHAT:       Tests for calendar-ignore.ts and its wiring into calendar-delta-sync (both providers).
// WHY:        Owner 2026-11-18: "work block" events must never appear or take up slots.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   113 stored "Work Block" events; 11-17 build rejections "overlaps event Work Block 2".
// Run: node --experimental-strip-types --no-warnings --test supabase/functions/_shared/calendar-ignore.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
