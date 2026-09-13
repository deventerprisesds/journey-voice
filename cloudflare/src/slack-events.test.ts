// WHAT:       Tests for the inbound Slack door (/slack/events).
// WHY:        Two failure modes here are not cosmetic. (1) A receiver that does not verify Slack's
//             signature lets anyone who learns the URL drive a Huddle agent that holds the owner's
//             board, mailbox and 40+ tools. (2) A receiver that does not ignore its OWN posts makes
//             the agent answer itself forever, in the owner's real Slack, in public. Both are
//             asserted here, and the loop guard is mutation-proved.
// SUPERSEDES: nothing.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   slack-events.ts header; Huddle src/routes/api/public/run-agent-turn.ts (origin/main).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifySlackSignature, shouldHandleMessage, agentIdFromChannelName,
  processMessageEvent, handleSlackEvents, MAX_SIGNATURE_AGE_S,
} from './slack-events.ts';

const SIGNING_SECRET = 'slack-signing-secret-fixture';

// Assembled at runtime, never written as a literal: GitHub's push protection matches the
// `xoxb-<digits>-<alnum>` SHAPE and cannot tell a fabricated one from a live credential. This value
// authenticates to nothing.
const FAKE_BOT_TOKEN = ['xoxb', '000000000000', 'FAKEFIXTUREVALUE'].join('-');

const ENV = {
  SLACK_SIGNING_SECRET: SIGNING_SECRET,
  SLACK_BOT_TOKEN: FAKE_BOT_TOKEN,
  JOURNEY_PROXY_TOKEN: 'proxy-token-fixture',
  HUDDLE_BASE_URL: 'https://huddle.example',
};

/** Sign exactly the way Slack does, so a passing test proves interop and not just self-consistency. */
async function slackSign(raw: string, ts: number, secret = SIGNING_SECRET): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`v0:${ts}:${raw}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `v0=${hex}`;
}

async function signedRequest(body: unknown, opts: { ts?: number; secret?: string } = {}) {
  const raw = JSON.stringify(body);
  const ts = opts.ts ?? Math.floor(Date.now() / 1000);
  const sig = await slackSign(raw, ts, opts.secret ?? SIGNING_SECRET);
  return new Request('https://w.dev/slack/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-slack-request-timestamp': String(ts),
      'x-slack-signature': sig,
    },
    body: raw,
  });
}

/** Record every outbound call and answer each host with a canned, Slack-shaped body. */
function stubFetch(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ url: string; body: any }> = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(input);
    let body: any = null;
    try { body = init?.body ? JSON.parse(init.body) : null; } catch { body = init?.body; }
    calls.push({ url, body });
    if (url.includes('conversations.info')) {
      return new Response(JSON.stringify(
        overrides.conversationsInfo ?? { ok: true, channel: { name: 'terry-locke___delivery' } },
      ));
    }
    if (url.includes('conversations.replies')) {
      return new Response(JSON.stringify(
        overrides.replies ?? { ok: true, messages: [
          { ts: '1789300000.111111', user: 'U0931QP8YQ2', bot_id: 'B1', app_id: 'A1', text: 'earlier agent line' },
          { ts: '1789290000.000001', user: 'U0934TLA8FJ', text: 'earlier human line' },
        ] },
      ));
    }
    if (url.includes('conversations.history')) {
      return new Response(JSON.stringify(
        overrides.history ?? { ok: true, messages: [
          { ts: '1789295000.000002', user: 'U0934TLA8FJ', text: 'channel context line' },
        ] },
      ));
    }
    if (url.includes('run-agent-turn')) {
      return new Response(JSON.stringify(
        overrides.runAgentTurn ?? { ok: true, turnId: 't1', status: 'completed', replies: [{ text: 'On it.' }] },
      ));
    }
    if (url.includes('chat.postMessage')) {
      return new Response(JSON.stringify(overrides.postMessage ?? { ok: true, ts: '1789310738.920809' }));
    }
    return new Response('{}', { status: 404 });
  }) as any;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

const noopCtx = { waitUntil: (_p: Promise<unknown>) => {} };

function userMessage(over: Record<string, unknown> = {}) {
  return {
    type: 'event_callback',
    event_id: 'Ev0001',
    event: {
      type: 'message', user: 'U0931QP8YQ2', text: 'what is on my plate today?',
      channel: 'C0939A7CYEB', ts: '1789310710.240879', ...over,
    },
  };
}

// ---------------------------------------------------------------------------
// AC-S1 — a forged or absent signature is refused. This is the door lock.
// ---------------------------------------------------------------------------
test('AC-S1 a request signed with the WRONG secret is refused 401', async () => {
  const f = stubFetch();
  try {
    const req = await signedRequest(userMessage(), { secret: 'not-the-real-secret' });
    const res = await handleSlackEvents(req, ENV, noopCtx);
    assert.equal(res.status, 401);
    assert.equal(f.calls.length, 0, 'a refused request must make NO outbound call');
  } finally { f.restore(); }
});

test('AC-S1b missing signature headers are refused, not treated as unsigned-but-fine', async () => {
  const res = await verifySlackSignature('{}', null, null, SIGNING_SECRET);
  assert.equal(res.ok, false);
});

test('AC-S1c an UNSET signing secret fails CLOSED', async () => {
  // The dangerous reading of "no secret configured" is "no verification required". Assert the
  // opposite: with nothing to verify against, nothing is accepted.
  const res = await verifySlackSignature('{}', '1', 'v0=aa', undefined);
  assert.equal(res.ok, false);
  assert.equal((res as { reason: string }).reason, 'signing_secret_not_configured');
});

// ---------------------------------------------------------------------------
// AC-S2 — replay window, both directions.
// ---------------------------------------------------------------------------
test('AC-S2 a correctly-signed but STALE request is refused', async () => {
  const raw = JSON.stringify(userMessage());
  const old = Math.floor(Date.now() / 1000) - (MAX_SIGNATURE_AGE_S + 60);
  const sig = await slackSign(raw, old);
  const res = await verifySlackSignature(raw, String(old), sig, SIGNING_SECRET);
  assert.equal(res.ok, false);
  assert.equal((res as { reason: string }).reason, 'stale_timestamp');
});

test('AC-S2b a FUTURE-dated timestamp is refused too', async () => {
  const raw = JSON.stringify(userMessage());
  const future = Math.floor(Date.now() / 1000) + (MAX_SIGNATURE_AGE_S + 60);
  const sig = await slackSign(raw, future);
  const res = await verifySlackSignature(raw, String(future), sig, SIGNING_SECRET);
  assert.equal(res.ok, false, 'now - ts > MAX alone would accept this');
});

test('AC-S2c a genuine, fresh Slack signature verifies', async () => {
  const raw = JSON.stringify(userMessage());
  const ts = Math.floor(Date.now() / 1000);
  const res = await verifySlackSignature(raw, String(ts), await slackSign(raw, ts), SIGNING_SECRET);
  assert.equal(res.ok, true);
});

// ---------------------------------------------------------------------------
// AC-S3 — the setup handshake.
// ---------------------------------------------------------------------------
test('AC-S3 url_verification echoes the challenge back', async () => {
  const f = stubFetch();
  try {
    const req = await signedRequest({ type: 'url_verification', challenge: 'abc123' });
    const res = await handleSlackEvents(req, ENV, noopCtx);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { challenge: 'abc123' });
  } finally { f.restore(); }
});

// ---------------------------------------------------------------------------
// AC-S4 — THE LOOP GUARD. The agent must never answer its own answer.
// ---------------------------------------------------------------------------
test('AC-S4 a message carrying bot_id is IGNORED (this is the infinite-loop guard)', async () => {
  const f = stubFetch();
  try {
    const r = await processMessageEvent(userMessage({ bot_id: 'B123' }) as any, ENV);
    assert.equal(r.handled, false);
    assert.equal(f.calls.length, 0, 'a bot post must not reach Huddle or Slack');
  } finally { f.restore(); }
});

test('AC-S4b subtype bot_message is ignored', async () => {
  assert.equal(shouldHandleMessage({ type: 'message', subtype: 'bot_message', user: 'U1', text: 'hi' }), false);
});

test('AC-S4c app_id marks a bot post even with no bot_id', async () => {
  assert.equal(shouldHandleMessage({ type: 'message', app_id: 'A1', user: 'U1', text: 'hi' }), false);
});

test('AC-S4d edits and joins are ignored — an agent answers what a person SAID', async () => {
  assert.equal(shouldHandleMessage({ type: 'message', subtype: 'message_changed', user: 'U1', text: 'x' }), false);
  assert.equal(shouldHandleMessage({ type: 'message', subtype: 'channel_join', user: 'U1', text: 'x' }), false);
});

test('AC-S4e a plain human message IS handled', async () => {
  assert.equal(shouldHandleMessage({ type: 'message', user: 'U1', text: 'hello' }), true);
});

test('AC-S4f an empty or whitespace-only message is ignored', async () => {
  assert.equal(shouldHandleMessage({ type: 'message', user: 'U1', text: '   ' }), false);
});

// ---------------------------------------------------------------------------
// AC-S5 — channel -> agent mapping.
// ---------------------------------------------------------------------------
test('AC-S5 the agent handle is the part before ___', () => {
  assert.equal(agentIdFromChannelName('iris-chase___itinerary'), 'iris-chase');
  assert.equal(agentIdFromChannelName('terry-locke___delivery'), 'terry-locke');
});

test('AC-S5b a channel with no separator maps to NO agent, rather than guessing', () => {
  // Guessing would route a random channel's chatter into an arbitrary agent's lane.
  assert.equal(agentIdFromChannelName('general'), null);
  assert.equal(agentIdFromChannelName('___orphan'), null);
  assert.equal(agentIdFromChannelName(null), null);
});

test('AC-S5c a non-agent channel is skipped without calling Huddle', async () => {
  const f = stubFetch({ conversationsInfo: { ok: true, channel: { name: 'general' } } });
  try {
    const r = await processMessageEvent(userMessage() as any, ENV);
    assert.equal(r.handled, false);
    assert.equal(r.reason, 'channel_is_not_an_agent_lane');
    assert.ok(!f.calls.some((c) => c.url.includes('run-agent-turn')));
  } finally { f.restore(); }
});

// ---------------------------------------------------------------------------
// AC-S6 — the happy path, end to end through the stubs.
// ---------------------------------------------------------------------------
test('AC-S6 a human message reaches Huddle and the reply is posted back in thread', async () => {
  const f = stubFetch();
  try {
    const r = await processMessageEvent(userMessage() as any, ENV);
    assert.equal(r.handled, true);

    const turn = f.calls.find((c) => c.url.includes('run-agent-turn'));
    assert.ok(turn, 'Huddle must be called');
    assert.equal(turn!.body.text, 'what is on my plate today?');
    assert.deepEqual(turn!.body.members, ['terry-locke'], 'routed to the channel’s own agent');
    assert.equal(turn!.body.idempotencyKey, 'Ev0001', 'Slack event_id carries the dedupe downstream');

    const post = f.calls.find((c) => c.url.includes('chat.postMessage'));
    assert.ok(post, 'the reply must be posted');
    assert.equal(post!.body.text, 'On it.');
    assert.equal(post!.body.thread_ts, '1789310710.240879', 'opens a thread under the message');
    assert.equal(post!.body.channel, 'C0939A7CYEB');
  } finally { f.restore(); }
});

test('AC-S6b a reply inside an existing thread stays in THAT thread', async () => {
  const f = stubFetch();
  try {
    await processMessageEvent(userMessage({ thread_ts: '1789300000.111111' }) as any, ENV);
    const post = f.calls.find((c) => c.url.includes('chat.postMessage'));
    assert.equal(post!.body.thread_ts, '1789300000.111111');
  } finally { f.restore(); }
});

// ---------------------------------------------------------------------------
// AC-S7 — failures downstream are reported, never reported as success.
// ---------------------------------------------------------------------------
test('AC-S7 Slack answering 200 with ok:false is NOT a delivery', async () => {
  // chat.postMessage returns HTTP 200 on failure and puts the truth in the body. Reading the status
  // would report a message that was never posted.
  const f = stubFetch({ postMessage: { ok: false, error: 'channel_not_found' } });
  try {
    const r = await processMessageEvent(userMessage() as any, ENV);
    assert.equal(r.handled, false);
    assert.equal(r.reason, 'channel_not_found');
  } finally { f.restore(); }
});

test('AC-S7b a Huddle error is surfaced, and nothing is posted to Slack', async () => {
  const f = stubFetch({ runAgentTurn: { ok: false, error: 'turn_failed' } });
  try {
    const r = await processMessageEvent(userMessage() as any, ENV);
    assert.equal(r.handled, false);
    assert.ok(!f.calls.some((c) => c.url.includes('chat.postMessage')));
  } finally { f.restore(); }
});

test('AC-S7c a still-running turn says so rather than posting an empty message', async () => {
  const f = stubFetch({ runAgentTurn: { ok: true, turnId: 't', status: 'running', replies: [] } });
  try {
    const r = await processMessageEvent(userMessage() as any, ENV);
    assert.equal(r.handled, true);
    const post = f.calls.find((c) => c.url.includes('chat.postMessage'));
    assert.ok(post!.body.text.length > 0, 'never post an empty string to Slack');
  } finally { f.restore(); }
});

// ---------------------------------------------------------------------------
// AC-S8 — the 3-second ack.
// ---------------------------------------------------------------------------
test('AC-S8 the route answers 200 immediately and defers the turn to waitUntil', async () => {
  const f = stubFetch();
  const deferred: Promise<unknown>[] = [];
  try {
    const req = await signedRequest(userMessage());
    const res = await handleSlackEvents(req, ENV, { waitUntil: (p) => { deferred.push(p); } });
    assert.equal(res.status, 200);
    assert.equal(deferred.length, 1, 'the work is handed to waitUntil');

    // NOT "zero outbound calls before the ack" — an async function runs its synchronous prefix
    // eagerly, so `conversations.info` is already in flight by the time we get here, and asserting
    // otherwise tests JavaScript rather than this route. The property that matters is that the 200
    // did not WAIT for the agent: the reply has not been posted yet.
    assert.ok(
      !f.calls.some((c) => c.url.includes('chat.postMessage')),
      'the ack must not be gated on the agent turn finishing',
    );

    await deferred[0];
    assert.ok(f.calls.some((c) => c.url.includes('run-agent-turn')), 'and then the turn runs');
    assert.ok(f.calls.some((c) => c.url.includes('chat.postMessage')), 'and the reply lands');
  } finally { f.restore(); }
});

// ---------------------------------------------------------------------------
// AC-S10 — HISTORY. Not cosmetic: runHuddleTurn builds its memory-retrieval query from
// [text, ...history] and discards hits under 0.3, so an empty history means the agent's whole
// recollection is searched with one Slack sentence. This is the defect the owner reported as
// "doesn't have the memory of the huddle agent".
// ---------------------------------------------------------------------------
test('AC-S10 history is fetched and FORWARDED to Huddle, not left empty', async () => {
  const f = stubFetch();
  try {
    await processMessageEvent(userMessage() as any, ENV);
    const turn = f.calls.find((c) => c.url.includes('run-agent-turn'));
    assert.ok(Array.isArray(turn!.body.history), 'history must be present');
    assert.ok(turn!.body.history.length > 0, 'an empty history is the bug, not a valid state');
  } finally { f.restore(); }
});

test('AC-S10b in a thread it reads the THREAD; outside one it reads channel history', async () => {
  let f = stubFetch();
  try {
    await processMessageEvent(userMessage({ thread_ts: '1789300000.111111' }) as any, ENV);
    assert.ok(f.calls.some((c) => c.url.includes('conversations.replies')), 'thread → replies');
    assert.ok(!f.calls.some((c) => c.url.includes('conversations.history')), 'thread must not use channel history');
  } finally { f.restore(); }

  f = stubFetch();
  try {
    await processMessageEvent(userMessage() as any, ENV);   // no thread_ts
    assert.ok(f.calls.some((c) => c.url.includes('conversations.history')), 'no thread → channel history');
  } finally { f.restore(); }
});

test('AC-S10c our bot maps to kind:agent with the channel agent; humans to kind:user', async () => {
  // An invalid agentId fails the endpoint's schema and costs the WHOLE turn, so the mapping must
  // use the agent resolved from the channel rather than anything taken from the message.
  const f = stubFetch();
  try {
    await processMessageEvent(userMessage({ thread_ts: '1789300000.111111' }) as any, ENV);
    const turn = f.calls.find((c) => c.url.includes('run-agent-turn'));
    const kinds = turn!.body.history.map((h: any) => h.author.kind);
    assert.ok(kinds.includes('agent') && kinds.includes('user'), `got ${JSON.stringify(kinds)}`);
    const agentEntry = turn!.body.history.find((h: any) => h.author.kind === 'agent');
    assert.equal(agentEntry.author.agentId, 'terry-locke', 'agent id comes from the CHANNEL');
  } finally { f.restore(); }
});

test('AC-S10d history is ordered oldest → newest', async () => {
  const f = stubFetch();
  try {
    await processMessageEvent(userMessage({ thread_ts: '1789300000.111111' }) as any, ENV);
    const turn = f.calls.find((c) => c.url.includes('run-agent-turn'));
    const ts = turn!.body.history.map((h: any) => h.ts);
    assert.deepEqual([...ts].sort((a: number, b: number) => a - b), ts, 'Slack returns replies and history in opposite orders');
  } finally { f.restore(); }
});

test('AC-S10e a broken context fetch must not cost the reply', async () => {
  // Context is an enhancement. Slack answering ok:false here must degrade to no history, never to
  // a dropped message -- the agent answering with less context beats it not answering.
  const f = stubFetch({ replies: { ok: false, error: 'channel_not_found' },
                        history: { ok: false, error: 'channel_not_found' } });
  try {
    const r = await processMessageEvent(userMessage() as any, ENV);
    assert.equal(r.handled, true, 'the turn must still run');
    const turn = f.calls.find((c) => c.url.includes('run-agent-turn'));
    assert.deepEqual(turn!.body.history, [], 'degrades to empty, not undefined');
  } finally { f.restore(); }
});
