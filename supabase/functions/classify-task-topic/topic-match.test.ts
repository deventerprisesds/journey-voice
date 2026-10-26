// WHAT:       Executable guards for J11: near-duplicate topic names resolve to the existing topic, and
//             genuinely different subjects stay apart. Fixtures are REAL topic names read from the live
//             task_topic_index on 2026-10-26.
// WHY:        live classify-task-topic v306 = main forked a new topic whenever the model's name differed
//             slightly (38 -> 95 live topics since the 08-25 cleanup).
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   docs/qc-evidence/RESTORE-step5-j11.md
//             run: node --experimental-strip-types --test supabase/functions/classify-task-topic/topic-match.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findMatchingTopic, normalizeTopicName } from './topic-match.ts';

const LIVE = [
  { id: 'cd', topic_name: 'Career Development' },
  { id: 'ad', topic_name: 'Application Development' },
  { id: 'pc', topic_name: 'Personal Communication' },
  { id: 'vm', topic_name: 'Vehicle Maintenance' },
  { id: 'gd', topic_name: 'Geospatial Development' },
  { id: 'rr', topic_name: 'Research Resource Management' },
];

test('filler, case, punctuation and word order collapse to one key', () => {
  const k = normalizeTopicName('Career Development');
  for (const v of ['Career Development Tasks', 'career development', 'Development Career', 'Career-Development!']) {
    assert.equal(normalizeTopicName(v), k, v);
  }
  // Real dormant clusters from the 08-25 cleanup.
  assert.equal(normalizeTopicName('Family Grooming Plans'), normalizeTopicName('Family Grooming Management'));
  assert.equal(normalizeTopicName('Family Grooming Tasks'), normalizeTopicName('Family Grooming Management'));
  assert.equal(normalizeTopicName('General Life Tasks'), normalizeTopicName('Life Management Tasks'));
  assert.equal(normalizeTopicName('Venture Development Projects'), normalizeTopicName('Venture Development'));
});

test('a name that is ALL filler keeps its words instead of collapsing to an empty key', () => {
  assert.equal(normalizeTopicName('Project Management'), 'management project');
  assert.notEqual(normalizeTopicName('Project Management'), normalizeTopicName('Task Planning'));
});

test('near-duplicate names resolve to the EXISTING live topic', () => {
  assert.equal(findMatchingTopic(LIVE, 'Career Development Tasks')?.id, 'cd');
  assert.equal(findMatchingTopic(LIVE, 'Application Development Management')?.id, 'ad'); // created live 2026-09-14
  assert.equal(findMatchingTopic(LIVE, 'Personal Communication Management')?.id, 'pc');
  assert.equal(findMatchingTopic(LIVE, 'career development')?.id, 'cd');
});

test('genuinely different subjects do NOT match (deliberately conservative)', () => {
  assert.equal(findMatchingTopic(LIVE, 'Car Rental Management'), undefined);
  assert.equal(findMatchingTopic(LIVE, 'Geospatial Development Tools'), undefined); // live today, a subset variant
  assert.equal(findMatchingTopic(LIVE, 'Research Material Management'), undefined);
  assert.equal(findMatchingTopic(LIVE, 'Vehicle Rental'), undefined);
});

test('an exact match wins over an earlier near match', () => {
  const list = [{ id: 'near', topic_name: 'Career Development Tasks' }, { id: 'exact', topic_name: 'Career Development' }];
  assert.equal(findMatchingTopic(list, 'Career Development')?.id, 'exact');
});

// index.ts calls serve() and reads Deno.env on import, so its wiring is asserted statically.
test('index.ts wiring: live-only list, match for BOTH answers, and revive uses the same lookup', () => {
  const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.match(src, /\.is\('archived_at', null\)\s*\n\s*\.is\('merged_into', null\)/);
  assert.match(src, /const liveMatch = findMatchingTopic\(topics, classification\.topic_name\);/);
  assert.match(src, /if \(classification\.action === 'new' && liveMatch\) \{\n[^\n]*\n\s*classification\.action = 'existing';/);
  assert.match(src, /const matchingTopic = liveMatch;/);
  assert.match(src, /const dormantMatch: any = findMatchingTopic\(dormant \|\| \[\], classification\.topic_name\);/);
  assert.match(src, /STRONGLY PREFER AN EXISTING TOPIC/);
});
