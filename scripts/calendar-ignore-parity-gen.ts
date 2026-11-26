// WHAT:       Generates supabase/functions/_shared/calendar-ignore-parity.fixture.json: calendar events + the owner's
//             resolved ignore rules, with `expected` PRODUCED by journey's own isIgnoredCalendarEvent.
// WHY:        Owner 2026-11-26 option A: Huddle applies the SAME ignore decision as TaskOS. The fixture is copied
//             byte-for-byte into huddle-extension-app (scripts/fixtures/) and both repos test against it, so a rule
//             change mirrored in only one repo fails a suite (huddle .claude/ac-huddle-calendar-ignore.md AC-23/24).
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   supabase/functions/_shared/calendar-ignore-parity.test.ts (journey side of the check).
// Run (from the repo root):
//   node --experimental-strip-types --no-warnings scripts/calendar-ignore-parity-gen.ts
// After regenerating: copy the file to huddle-extension-app scripts/fixtures/ and update the sha256 in BOTH tests.
import { writeFileSync } from 'node:fs';
import { isIgnoredCalendarEvent, resolveIgnoreRules } from '../supabase/functions/_shared/calendar-ignore.ts';

const OWNER = 'owner@example.org';
const P = (email: string, extra: Record<string, unknown> = {}) => ({ email, ...extra });
const GROUP = [P(OWNER), P('dana@example.org'), P('pat@example.org')];
const BASE = { calendarIgnoreTitles: ['work block'], calendarIgnoreTentative: true, calendarIgnoreCategories: ['Purple category'] };
const OFF = { ...BASE, calendarIgnoreTentative: false };

type Case = { id: string; note: string; config: Record<string, unknown> | null; event: Record<string, unknown> };
const ev = (o: Record<string, unknown>) => ({ title: 'Team sync', show_as: 'busy', attendees: [], categories: [], ...o });
const cases: Case[] = [
  { id: 'S-1', note: 'exact stored category', config: BASE, event: ev({ categories: ['Purple category'] }) },
  { id: 'S-2', note: 'case-fold', config: BASE, event: ev({ categories: ['purple CATEGORY'] }) },
  { id: 'S-3', note: 'trim', config: BASE, event: ev({ categories: [' Purple category '] }) },
  { id: 'S-4', note: 'ANY category', config: BASE, event: ev({ categories: ['Blue category', 'Purple category'] }) },
  { id: 'S-5', note: 'other category', config: BASE, event: ev({ categories: ['Blue category'] }) },
  { id: 'S-6', note: 'prefix only', config: BASE, event: ev({ categories: ['Purple'] }) },
  { id: 'S-7', note: 'list entry is a substring', config: BASE, event: ev({ categories: ['Dark Purple category'] }) },
  { id: 'S-8', note: 'suffix', config: BASE, event: ev({ categories: ['Purple category 2'] }) },
  { id: 'S-9a', note: 'blank name', config: BASE, event: ev({ categories: [''] }) },
  { id: 'S-9b', note: 'spaces name', config: BASE, event: ev({ categories: ['   '] }) },
  { id: 'S-10a', note: 'categories null', config: BASE, event: ev({ categories: null }) },
  { id: 'S-10b', note: 'categories absent', config: BASE, event: { title: 'Team sync', show_as: 'busy', attendees: [] } },
  { id: 'S-10c', note: 'categories []', config: BASE, event: ev({ categories: [] }) },
  { id: 'S-11', note: 'categories a string', config: BASE, event: ev({ categories: 'Purple category' }) },
  { id: 'S-12', note: 'non-string elements', config: BASE, event: ev({ categories: [7, null, {}] }) },
  { id: 'S-13', note: 'title must not feed the category rule', config: BASE, event: ev({ title: 'Purple category sync' }) },
  { id: 'S-14', note: 'case-fold on the list side', config: { ...BASE, calendarIgnoreCategories: ['purple category'] }, event: ev({ categories: ['Purple category'] }) },
  { id: 'S-15', note: 'owner unticked', config: { ...BASE, calendarIgnoreCategories: [] }, event: ev({ categories: ['Purple category'] }) },
  { id: 'S-16', note: 'malformed config list', config: { ...BASE, calendarIgnoreCategories: 'Purple category' }, event: ev({ categories: ['Purple category'] }) },
  { id: 'S-17', note: 'category independent of tentative switch', config: OFF, event: ev({ show_as: 'tentative', attendees: GROUP, categories: ['Purple category'] }) },
  { id: 'S-18', note: 'capital C', config: BASE, event: ev({ categories: ['Purple Category'] }) },
  { id: 'S-19', note: 'fallback: no category rule', config: null, event: ev({ categories: ['Purple category'] }) },
  { id: 'S-20', note: 'fallback: work block seed', config: null, event: ev({ title: 'Work Block 2' }) },
  { id: 'S-21', note: 'switch off: tentative group kept', config: OFF, event: ev({ show_as: 'tentative', attendees: GROUP }) },
  { id: 'S-22a', note: 'tentative, attendees absent', config: BASE, event: { title: 'Team sync', show_as: 'tentative', categories: [] } },
  { id: 'S-22b', note: 'tentative, attendees null', config: BASE, event: ev({ show_as: 'tentative', attendees: null }) },
  { id: 'S-22c', note: 'tentative, attendees not an array', config: BASE, event: ev({ show_as: 'tentative', attendees: 'dana@example.org; pat@example.org' }) },
  { id: 'S-23', note: 'owner (other case) + 1 person', config: BASE, event: ev({ show_as: 'tentative', attendees: [P(' Owner@Example.ORG '), P('dana@example.org')] }) },
  { id: 'S-24', note: '2 people + 1 room', config: BASE, event: ev({ show_as: 'tentative', attendees: [P('dana@example.org'), P('pat@example.org'), P('room4@example.org', { resource: true })] }) },
  { id: 'S-25a', note: 'showAs Tentative (Graph casing)', config: BASE, event: ev({ show_as: 'Tentative', attendees: GROUP }) },
  { id: 'S-25b', note: 'showAs tentative', config: BASE, event: ev({ show_as: 'tentative', attendees: GROUP }) },
  { id: 'S-26', note: 'title upper case', config: BASE, event: ev({ title: 'WORK BLOCK' }) },
  { id: 'S-27', note: 'title over-match negative', config: BASE, event: ev({ title: 'Networking block party' }) },
  { id: 'AC-16a', note: 'switch off: solo hold', config: OFF, event: ev({ show_as: 'tentative', attendees: [P(OWNER)] }) },
  { id: 'AC-16b', note: 'switch off: 1:1', config: OFF, event: ev({ show_as: 'tentative', attendees: [P(OWNER), P('dana@example.org')] }) },
  { id: 'AC-17a', note: 'switch on: solo hold', config: BASE, event: ev({ show_as: 'tentative', attendees: [P(OWNER)] }) },
  { id: 'AC-17b', note: 'switch on: 1:1 (+ room)', config: BASE, event: ev({ show_as: 'tentative', attendees: [P(OWNER), P('dana@example.org'), P('room4@example.org', { resource: true })] }) },
  { id: 'AC-17c', note: 'switch on: group', config: BASE, event: ev({ show_as: 'tentative', attendees: GROUP }) },
  { id: 'AC-19', note: 'owner + room + self + empty + 1 person', config: BASE, event: ev({ show_as: 'tentative', attendees: [P(OWNER), P('room@example.org', { resource: true }), P('me@alias.example', { self: true }), P(''), P('dana@example.org')] }) },
  { id: 'AC-20a', note: 'owner list phrase focus', config: { ...BASE, calendarIgnoreTitles: ['work block', 'focus'] }, event: ev({ title: 'Focus time' }) },
  { id: 'AC-20b', note: 'owner cleared list: focus kept', config: { ...BASE, calendarIgnoreTitles: [] }, event: ev({ title: 'Focus time' }) },
  { id: 'AC-20c', note: 'owner cleared list: work block kept', config: { ...BASE, calendarIgnoreTitles: [] }, event: ev({ title: 'Work Block 1' }) },
  { id: 'AC-21a', note: 'title only matches', config: { ...BASE, calendarIgnoreTentative: false, calendarIgnoreCategories: [] }, event: ev({ title: 'Work Block' }) },
  { id: 'AC-21b', note: 'tentative busy (not tentative) group kept', config: BASE, event: ev({ attendees: GROUP }) },
  { id: 'AC-30', note: 'ordinary meeting', config: BASE, event: ev({ title: '1:1 Andrew and Von', attendees: [P(OWNER), P('andrew@example.org')] }) },
];

const rows = cases.map((c) => {
  const rules = resolveIgnoreRules(c.config ?? {}, c.config ? [OWNER] : []);
  return { id: c.id, note: c.note, fallback: c.config === null, config: c.config, rules, event: c.event, expected: isIgnoredCalendarEvent(c.event, rules) ? 'IGNORE' : 'KEEP' };
});
const out = {
  _meta: {
    what: 'Calendar-ignore parity fixture shared by journey-voice and huddle-extension-app (byte-identical copies).',
    generatedBy: 'node --experimental-strip-types --no-warnings scripts/calendar-ignore-parity-gen.ts (journey-voice repo root)',
    expectedFrom: "journey supabase/functions/_shared/calendar-ignore.ts isIgnoredCalendarEvent(event, resolveIgnoreRules(config ?? {}, config ? [owner] : []))",
    rowShape: 'event uses journey stored-row names (title, show_as, attendees, categories); Huddle maps title->subject, show_as->showAs',
    fallbackRows: 'fallback:true rows = journey unreachable; rules = resolveIgnoreRules({}) with no owner addresses',
  },
  rows,
};
writeFileSync(new URL('../supabase/functions/_shared/calendar-ignore-parity.fixture.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${rows.length} rows: ${rows.filter((r) => r.expected === 'IGNORE').length} IGNORE, ${rows.filter((r) => r.expected === 'KEEP').length} KEEP`);
