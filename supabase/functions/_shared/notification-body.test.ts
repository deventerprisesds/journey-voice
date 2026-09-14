// WHAT:       Tests for the email/Slack briefing renderer.
// WHY:        The fixture below is the REAL body journey emailed, copied verbatim from the live
//             payload logged 2026-09-08 — not an invented example. The headline assertion is that
//             none of its stage directions survive into what a person receives.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stripVoiceScript, renderBriefingBody } from './notification-body.ts';
import { containsCallScript } from './digest-content.ts';

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
