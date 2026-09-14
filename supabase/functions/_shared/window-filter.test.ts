// WHAT:       Guards the scheduled-call window filter against being computed on the wrong clock.
// WHY:        `getTasksForWindow` compared `new Date(start_time).getHours()` — the RUNTIME's local
//             hour — against a window range expressed in the USER'S hours. A Supabase edge function
//             runs in UTC, so a 9:00 AM America/New_York task is hour 13 and matched no morning
//             window (6–9) at all. Measured 2026-09-14 against the owner's real board: 0 of 9 tasks
//             matched and the email read "Nothing is scheduled for this window" on a day with nine
//             tasks. The display was ALREADY timezone-correct, so the same email contradicted
//             itself — selecting the 18:00-UTC task and printing it as "2:00 PM".
// SUPERSEDES: nothing — this filter had no test.
// SUPERSEDED-BY: nothing — current.
// EVIDENCE:   .claude/actions.md ACT:window-clock; commit b8d21c3.
//
// TWO ASSERTIONS, and the second is the one that survives a refactor. W1 pins the BEHAVIOUR of the
// hour computation. W2 is a source guard: the filter lives inside an async function that needs a
// live supabase client, so it cannot be exercised directly here, and `getHours()` reintroduced
// anywhere in that file silently restores the defect with every test still green.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localClockParts } from './digest-content.ts';

test('W1 a task instant resolves to the USER\'S hour, not the runtime\'s', () => {
  // 13:00 UTC is 09:00 in New York (EDT, UTC-4). The old code saw 13 and tested it against a
  // 6–9 morning window; the correct answer is 9, which is where business_hours (9–17) begins.
  const h = localClockParts(new Date('2026-09-14T13:00:00Z'), 'America/New_York').hour;
  assert.equal(h, 9, 'the owner\'s 9am task must resolve to hour 9, not 13');

  // Winter, to prove the offset is resolved per-instant rather than a fixed -4.
  const winter = localClockParts(new Date('2026-01-14T14:00:00Z'), 'America/New_York').hour;
  assert.equal(winter, 9, 'EST is UTC-5; a fixed -4 would give 10 and drift the whole window');

  // The exact pair that made the email contradict itself.
  const pm = localClockParts(new Date('2026-09-14T18:00:00Z'), 'America/New_York').hour;
  assert.equal(pm, 14, '18:00Z is 2:00 PM ET — it must not be treated as the 18:00 local hour');
});

test('W2 the window filter never reads the runtime clock (getHours/getMinutes)', () => {
  const src = readFileSync(new URL('./call-context-builder.ts', import.meta.url), 'utf8');
  // `getUTCHours` is fine — it is explicit about which clock it means. A bare `getHours()` is the
  // defect: it silently means "whatever timezone this process happens to run in".
  const bare = src.match(/(?<!getUTC)\.get(?:Hours|Minutes)\(\)/g) ?? [];
  assert.deepEqual(bare, [], `runtime-clock read reintroduced: ${JSON.stringify(bare)}`);
  assert.match(src, /localClockParts\(/, 'the filter must resolve the hour in the user\'s timezone');
});
