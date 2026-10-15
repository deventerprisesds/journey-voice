// WHAT:       Tests for the email/Slack briefing renderer.
// WHY:        The fixture below is the REAL body journey emailed, copied verbatim from the live
//             payload logged 2026-09-08 — not an invented example. The headline assertion is that
//             none of its stage directions survive into what a person receives.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stripVoiceScript, renderBriefingBody, nextDays } from '../../supabase/functions/notification-delivery/notification-body.ts';
import { containsCallScript } from '../../supabase/functions/_shared/digest-content.ts';

// Verbatim from the live 2026-09-08 send-unified-notification payload.
const REAL_SCRIPT = `Time for your morning kickstart. [WINDOW:morning]
Morning kickstart call.

BRANCH 1 (morning tasks exist):
- Greet: "Hello Sir."
- List morning tasks for this time window
- List all remaining tasks for the rest of the day
- Ask: "Would you like to confirm these for today, adjust them, or skip?"
- If confirm: "Understood. I will call you back later. Goodbye."
- If adjust: Capture edits, confirm changes.

BRANCH 2 (no morning tasks):
- Greet: "Hello Sir."
- Say: "I am just calling to help you get started with your day. I will call you back in a few hours. Goodbye."`;

const TASKS = [
  { title: 'Required Assignment 8.1', start_time: '2026-09-14T13:00:00Z', status: 'TODO' },
  { title: 'Pay Black Card Credit Card', start_time: '2026-09-14T18:00:00Z', status: 'TODO' },
  { title: 'Already finished', start_time: '2026-09-14T19:00:00Z', status: 'DONE' },
];

// ---------------------------------------------------------------------------
// AC-B1 — THE HEADLINE: no stage direction reaches the reader.
// ---------------------------------------------------------------------------
test('AC-B1 the rendered body contains NONE of the voice script', () => {
  const out = renderBriefingBody({
    callName: 'Morning Kickstart', context: REAL_SCRIPT, tasks: TASKS, timezone: 'America/New_York',
  });
  for (const leak of [
    '[WINDOW:', 'BRANCH 1', 'BRANCH 2', 'Hello Sir', 'Greet:',
    'Would you like to confirm these', 'Capture edits', 'Goodbye',
  ]) {
    assert.ok(!out.includes(leak), `stage direction leaked into the email: ${leak}\n---\n${out}`);
  }
});

test('AC-B2 the reader gets their actual schedule, with times and DONE excluded', () => {
  const out = renderBriefingBody({
    callName: 'Morning Kickstart', context: REAL_SCRIPT, tasks: TASKS, timezone: 'America/New_York',
  });
  assert.match(out, /Required Assignment 8\.1/);
  assert.match(out, /Pay Black Card Credit Card/);
  assert.ok(!out.includes('Already finished'), 'a DONE task must not appear on the briefing');
  assert.match(out, /On your schedule \(2\)/, 'the count must reflect OPEN tasks only');
  assert.match(out, /9:00 AM/, '13:00Z is 9am Eastern — times are rendered in the user timezone');
});

// ---------------------------------------------------------------------------
// AC-B3 — the user's OWN words survive. Stripping must not become censoring.
// ---------------------------------------------------------------------------
test('AC-B3 free prose the user typed is KEPT, only scaffolding is removed', () => {
  // A real custom call from the live config.
  const custom = 'Custom check-in call. Items to cover are to make sure teeth were brushed. ' +
    'Madison is ready. Morning emails were finished. [WINDOW:evening]';
  const out = renderBriefingBody({ callName: 'Test call', context: custom, tasks: [] });
  assert.match(out, /teeth were brushed/, "the user's own instruction must survive");
  assert.match(out, /Madison is ready/);
  assert.ok(!out.includes('[WINDOW:'), 'the routing marker is machinery, not content');
});

test('AC-B4 a context that is ONLY script renders no guidance section at all', () => {
  const onlyScript = '[WINDOW:morning]\nBRANCH 1 (x):\n- Greet: "Hello Sir."\n- Say: "bye"';
  assert.equal(stripVoiceScript(onlyScript), '', 'nothing human-readable remains');
  const out = renderBriefingBody({ callName: 'Kickstart', context: onlyScript, tasks: TASKS });
  assert.match(out, /Time for your kickstart\./);
  assert.match(out, /On your schedule/);
});

// ---------------------------------------------------------------------------
// AC-B5 — an empty schedule SAYS SO. Silence reads as breakage.
// ---------------------------------------------------------------------------
test('AC-B5 no tasks produces an explicit statement, never an empty body', () => {
  const out = renderBriefingBody({ callName: 'Daily Wrap-up', context: REAL_SCRIPT, tasks: [] });
  assert.match(out, /Nothing is scheduled for this window/);
  assert.ok(out.trim().length > 20, 'a near-empty body is indistinguishable from a failure');
});

test('AC-B6 missing/degenerate inputs never throw and never emit placeholders', () => {
  assert.equal(stripVoiceScript(null), '');
  assert.equal(stripVoiceScript(undefined), '');
  assert.equal(stripVoiceScript(''), '');
  const out = renderBriefingBody({ callName: '', context: null, tasks: undefined });
  assert.ok(out.length > 0);
  assert.ok(!out.includes('undefined') && !out.includes('null'),
    'a degraded body must not leak literal undefined/null to the reader');
  // A task with no start_time still renders, without a bogus time.
  const noTime = renderBriefingBody({ callName: 'X', tasks: [{ title: 'Untimed task' }] });
  assert.match(noTime, /Untimed task/);
  assert.ok(!/Invalid Date/.test(noTime));
});

// ---------------------------------------------------------------------------
// AC-B7/B8 -- the ONE-SENTENCE REGRESSION, measured in the owner's inbox.
//
// On 2026-09-14 four real scheduled-call emails arrived reading, in their entirety,
// "Time for your evening start." / "Time for your morning kickstart." -- because the delivery
// function had been wired to `renderScheduledCall`, whose read-channel branch is literally
// `const body = `${subject}.`` (digest-content.ts:608). Stripping the voice script was correct;
// sending nothing in its place made the notification pointless. The owner: "each email had
// exactly one sentence... this proves nothing."
//
// B7 is the regression itself. B8 is the composition guard: restoring the richer body must not
// quietly undo the leak protection that the thin renderer was introduced to provide.
// ---------------------------------------------------------------------------
test('AC-B7 a briefing carries the REAL tasks, not just the opening sentence', () => {
  const out = renderBriefingBody({
    callName: 'Morning Kickstart',
    context: REAL_SCRIPT,
    tasks: [
      { title: 'Finish MIT AI Strategy Brief', start_time: '2026-09-14T13:00:00Z', status: 'UP_NEXT' },
      { title: 'Transfer funds for bills', start_time: '2026-09-14T15:30:00Z', status: 'BACKLOG' },
      { title: 'Already handled', status: 'DONE' },
    ],
    timezone: 'America/New_York',
  });
  assert.match(out, /Finish MIT AI Strategy Brief/, 'the task list is the POINT of the email');
  assert.match(out, /Transfer funds for bills/);
  assert.ok(!out.includes('Already handled'), 'DONE work must not be presented as upcoming');
  // The exact shape of the defect: body === opening sentence and nothing else.
  assert.notEqual(out.trim(), 'Time for your morning kickstart.');
  assert.ok(out.split('\n').filter((l) => l.trim()).length >= 3,
    `a one-line body is the regression this guards; got: ${JSON.stringify(out)}`);
});

test('AC-B8 the richer briefing still passes the call-script leak detector', () => {
  // Composition guard. renderBriefingBody and containsCallScript were written by different
  // passes for opposite purposes -- one adds content, one refuses content -- and nothing had
  // ever asserted they agree on a REAL script.
  const out = renderBriefingBody({
    callName: 'Morning Kickstart',
    context: REAL_SCRIPT,
    tasks: [{ title: 'A task', start_time: '2026-09-14T13:00:00Z' }],
    timezone: 'America/New_York',
  });
  assert.equal(containsCallScript(out), false,
    `the briefing leaked stage directions: ${JSON.stringify(out)}`);
});

// ---------------------------------------------------------------------------
// AC-M — the owner's meetings/appointments are IN the email (2026-10-15). The live emails read
// "Nothing is scheduled for this window" on days full of meetings, because the body carried tasks
// only and the calendar sync had been failing; these pin the calendar section's three states.
// ---------------------------------------------------------------------------
const MEETINGS = [
  { title: 'Client sync', start_time: '2026-10-16T14:00:00Z', end_time: '2026-10-16T14:30:00Z', location: 'Teams' },
  { title: 'Dentist', start_time: '2026-10-16T19:00:00Z', end_time: '2026-10-16T20:00:00Z', location: null },
  { title: 'Company holiday', start_time: '2026-10-16T04:00:00Z', end_time: '2026-10-17T04:00:00Z', is_all_day: true },
];

test('AC-M1 meetings are listed with local times, end times and location', () => {
  const out = renderBriefingBody({ callName: 'Morning Kickstart', context: REAL_SCRIPT, tasks: [], meetings: MEETINGS, timezone: 'America/New_York' });
  assert.match(out, /Today's meetings \(3\):/);
  assert.match(out, /10:00\sAM–10:30\sAM — Client sync · Teams/);
  assert.match(out, /3:00\sPM–4:00\sPM — Dentist$/m);
  assert.match(out, /All day — Company holiday/);
  assert.equal(containsCallScript(out), false);
});

test('AC-M2 a checked, empty calendar says so; an unchecked one prints no calendar section', () => {
  const empty = renderBriefingBody({ callName: 'Morning Kickstart', tasks: [], meetings: [] });
  assert.match(empty, /No meetings on your calendar today\./);
  const unchecked = renderBriefingBody({ callName: 'Morning Kickstart', tasks: [] });
  assert.ok(!/meeting/i.test(unchecked), 'no calendar claim when the calendar was not read');
});

test('AC-M3 a failed calendar read is SAID, never rendered as a free day', () => {
  const out = renderBriefingBody({ callName: 'Morning Kickstart', tasks: [], meetings: [], meetingsError: 'PGRST204' });
  assert.match(out, /calendar could not be read/);
  assert.ok(!/No meetings on your calendar/.test(out));
  assert.ok(!/work week/i.test(out), 'no week claim on a failed read either');
});

// ---------------------------------------------------------------------------
// AC-W — the next 7 days (owner, 2026-10-15: "show the window, rest of the day, and then the next
// 7 days following (as available)").
// ---------------------------------------------------------------------------
test('AC-W1 nextDays: tomorrow through today+7, across a month edge', () => {
  assert.deepEqual(nextDays('2026-10-15'), { start: '2026-10-16', end: '2026-10-22', label: 'Next 7 days' });
  assert.deepEqual(nextDays('2026-10-29'), { start: '2026-10-30', end: '2026-11-05', label: 'Next 7 days' });
});

test('AC-W2 meetings-only callers still get upcoming meetings grouped by day', () => {
  const week = [
    { title: 'Client sync', start_time: '2026-10-19T14:00:00Z', end_time: '2026-10-19T14:30:00Z', location: 'Teams' },
    { title: 'Board review', start_time: '2026-10-21T15:00:00Z', end_time: '2026-10-21T16:00:00Z' },
  ];
  const out = renderBriefingBody({ callName: 'Morning Kickstart', tasks: [], meetings: [], upcomingMeetings: week, upcomingLabel: 'Next 7 days', timezone: 'America/New_York' });
  assert.match(out, /Next 7 days \(2\):\n  Monday, Oct 19\n    10:00\sAM–10:30\sAM — Client sync · Teams\n  Wednesday, Oct 21\n    11:00\sAM–12:00\sPM — Board review/);
  assert.equal(containsCallScript(out), false);
});

// ---------------------------------------------------------------------------
// AC-T — THIS WINDOW, REST OF TODAY, NEXT 7 DAYS with tasks (owner, 2026-10-15: "Where are the tasks
// scheduled for that day? they are missing from that day forward"). Live: 11 tasks were scheduled
// today and the email said "Nothing is scheduled for this window".
// ---------------------------------------------------------------------------
const TZ = 'America/New_York';
const MORNING = { name: 'morning', start: 6, end: 9 };
test('AC-T1 window first, then the rest of today; tasks then meetings in their own section; DONE excluded', () => {
  const out = renderBriefingBody({
    callName: 'Morning Kickstart', context: REAL_SCRIPT, timezone: TZ, tasks: [], window: MORNING,
    meetings: [{ title: 'Haircut', start_time: '2026-10-15T15:00:00Z', end_time: '2026-10-15T16:00:00Z' }],
    todayTasks: [
      { title: 'Stretch', start_time: '2026-10-15T11:30:00Z', status: 'TODO' },                     // 7:30 AM -> window
      { title: 'Find a low-interest credit card', start_time: '2026-10-15T13:00:00Z', status: 'UP_NEXT' }, // 9:00 AM -> rest
      { title: 'Already finished', start_time: '2026-10-15T14:00:00Z', status: 'DONE' },
      { title: 'Transfer Jotform Resume Tool Suite', start_time: '2026-10-15T19:30:00Z', status: 'TODO' },
    ],
    upcomingMeetings: [], upcomingTasks: [], upcomingLabel: 'Next 7 days',
  });
  assert.match(out, /This window — morning, 6 AM–9 AM \(0 meetings, 1 task\):\n  Tasks \(1\):\n    7:30\sAM — Stretch\n  Meetings: none\./);
  // The 11 AM meeting sits BETWEEN the two tasks in time, but is listed after them under its own heading.
  assert.match(out, /Rest of today \(1 meeting, 2 tasks\):\n  Tasks \(2\):\n    9:00\sAM — Find a low-interest credit card\n    3:30\sPM — Transfer Jotform Resume Tool Suite\n  Meetings \(1\):\n    11:00\sAM–12:00\sPM — Haircut/);
  assert.ok(!/Already finished/.test(out), 'DONE tasks are not listed');
  assert.ok(out.indexOf('This window') < out.indexOf('Rest of today'), 'window comes first');
  assert.equal(containsCallScript(out), false);
});

test('AC-T2 an empty window says so; each of the next 7 days lists tasks, then meetings', () => {
  const out = renderBriefingBody({
    callName: 'Morning Kickstart', timezone: TZ, window: MORNING, meetings: [],
    todayTasks: [{ title: 'Debug autowork', start_time: '2026-10-15T14:30:00Z', status: 'TODO' }],
    upcomingLabel: 'Next 7 days',
    upcomingMeetings: [{ title: 'Board review', start_time: '2026-10-16T12:00:00Z', end_time: '2026-10-16T13:00:00Z' }],
    upcomingTasks: [
      { title: 'Analyze the Trinnex job description', start_time: '2026-10-16T13:00:00Z', status: 'UP_NEXT' },
      { title: 'Go to church', start_time: '2026-10-18T13:00:00Z', status: 'UP_NEXT' },
    ],
  });
  assert.match(out, /This window — morning, 6 AM–9 AM: nothing scheduled\./);
  assert.match(out, /Rest of today \(0 meetings, 1 task\):\n  Tasks \(1\):\n    10:30\sAM — Debug autowork\n  Meetings: none\./);
  // Board review (8 AM) is earlier than the 9 AM task, and still comes after it, under Meetings.
  assert.match(out, /Next 7 days \(1 meeting, 2 tasks\):\n  Friday, Oct 16\n    Tasks \(1\):\n      9:00\sAM — Analyze the Trinnex job description\n    Meetings \(1\):\n      8:00\sAM–9:00\sAM — Board review\n  Sunday, Oct 18\n    Tasks \(1\):\n      9:00\sAM — Go to church$/);
  assert.ok(!/Saturday/.test(out), 'a day with nothing scheduled is skipped');
  assert.ok(!/Sunday, Oct 18\n    Tasks \(1\):\n      9:00\sAM — Go to church\n    Meetings/.test(out), 'an upcoming day with no meetings has no empty Meetings heading');
  assert.ok(!/\((task|meeting)\)/.test(out), 'no per-line kind suffixes; the headings carry it');
});

test('AC-T3 no window (custom call) -> one Today list; a failed calendar read still lists every task', () => {
  const out = renderBriefingBody({
    callName: 'Check-in', timezone: TZ, meetingsError: 'PGRST204', window: null,
    todayTasks: [{ title: 'Pay rent', start_time: '2026-10-15T13:00:00Z', status: 'TODO' }],
    upcomingTasks: [], upcomingLabel: 'Next 7 days',
  });
  assert.match(out, /calendar could not be read/);
  assert.match(out, /Today \(0 meetings, 1 task\):\n  Tasks \(1\):\n    9:00\sAM — Pay rent/);
  assert.ok(!/Meetings: none/.test(out), 'a failed read never claims there are no meetings');
  assert.match(out, /Next 7 days: nothing scheduled\./);
  assert.ok(!/This window/.test(out));
});
