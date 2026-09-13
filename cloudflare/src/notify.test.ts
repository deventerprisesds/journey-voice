// WHAT:       Tests for journey's /notify endpoint — the deterministic replacement for the n8n hop.
// WHY:        The predecessor's failure mode was reporting success it had not earned. These assert
//             the OPPOSITE property: a channel is "sent" only when a provider actually accepted it.
// EVIDENCE:   Both case variants are asserted because journey's two callers disagree — the nightly
//             path sends ["email"], NotificationSettings.tsx sends ["EMAIL"], and both produced no
//             mail through n8n on 2026-09-08.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChannels, parseProfile, emailFromOptions, graphConfigured, handleNotify } from './notify.ts';

const SECRET = 'test-token';
const baseEnv = { JOURNEY_PROXY_TOKEN: SECRET };

function req(body: unknown, secret: string | null = SECRET, method = 'POST') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret !== null) headers['x-webhook-secret'] = secret;
  // A GET/HEAD Request may not carry a body — the method-rejection case must build one without.
  const init: RequestInit = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') init.body = JSON.stringify(body);
  return new Request('https://w.dev/notify', init);
}

// ---------------------------------------------------------------------------
// AC-N1 — case-insensitive channels. THE defect that split journey's two callers.
// ---------------------------------------------------------------------------
test('AC-N1 channel names are case-insensitive and de-duplicated', () => {
  assert.deepEqual(parseChannels(['email']), ['email']);
  assert.deepEqual(parseChannels(['EMAIL']), ['email']);          // Settings test button
  assert.deepEqual(parseChannels(['Email', 'EMAIL', 'email']), ['email']);
  assert.deepEqual(parseChannels('["email"]'), ['email']);        // legacy GET query-param shape
  assert.deepEqual(parseChannels('["EMAIL"]'), ['email']);
  assert.deepEqual(parseChannels([' email ']), ['email']);
  assert.deepEqual(parseChannels(null), []);
  assert.deepEqual(parseChannels('nonsense'), ['nonsense']);      // comma fallback, not a crash
});

test('AC-N1b userProfile parses from both an object and the legacy JSON string', () => {
  assert.equal(parseProfile({ email: 'a@b.c' }).email, 'a@b.c');
  assert.equal(parseProfile('{"email":"a@b.c"}').email, 'a@b.c');
  assert.deepEqual(parseProfile('not json'), {});
  assert.deepEqual(parseProfile(null), {});
});

// ---------------------------------------------------------------------------
// AC-N2 — auth
// ---------------------------------------------------------------------------
test('AC-N2 a wrong or missing secret is rejected, and an unset secret fails closed', async () => {
  assert.equal((await handleNotify(req({ channels: ['email'] }, 'wrong'), baseEnv)).status, 401);
  assert.equal((await handleNotify(req({ channels: ['email'] }, null), baseEnv)).status, 401);
  // No token configured -> 503, never "open". A misconfigured Worker must not accept traffic.
  assert.equal((await handleNotify(req({ channels: ['email'] }), {})).status, 503);
  // Was `GET -> 405`. GET is now a SUPPORTED method (AC-N8: it is the contract journey's own
  // caller uses), so that expectation is obsolete BY DESIGN, not loosened — the coverage it
  // provided, "an unsupported method is refused", moved to AC-N8d and widened to PUT/DELETE/PATCH.
  assert.equal((await handleNotify(req({ channels: ['email'] }, SECRET, 'PUT'), baseEnv)).status, 405);
});

// ---------------------------------------------------------------------------
// AC-N3 — THE HEADLINE: missing config is NEVER reported as delivered.
// ---------------------------------------------------------------------------
test('AC-N3 unconfigured Graph reports not_configured and delivered=false', async () => {
  const res = await handleNotify(req({ channels: ['email'], userProfile: { email: 'a@b.c' } }), baseEnv);
  const j: any = await res.json();
  assert.equal(res.status, 207, 'partial delivery must not return 200');
  assert.equal(j.delivered, false, 'THE regression this endpoint exists to prevent');
  assert.equal(j.results.email.status, 'not_configured');
  assert.equal(j.results.email.ok, false);
  assert.ok(j.errors.length > 0, 'a failure must surface in errors[]');
});

test('AC-N3b a missing recipient is a failure, not a silent success', async () => {
  const env = { ...baseEnv, AZURE_CLIENT_ID: 'x', AZURE_CLIENT_SECRET: 'y', AZURE_TENANT_ID: 'z' };
  const res = await handleNotify(req({ channels: ['email'], userProfile: {} }), env);
  const j: any = await res.json();
  assert.equal(j.results.email.status, 'failed');
  assert.match(j.results.email.detail, /no recipient/);
  assert.equal(j.delivered, false);
});

// ---------------------------------------------------------------------------
// AC-N4 — ownership lanes: journey's edge functions keep their channels.
// ---------------------------------------------------------------------------
test('AC-N4 channels journey handles itself are refused, not silently accepted', async () => {
  const res = await handleNotify(
    req({ channels: ['OUTLOOK_EVENT', 'PUSH'], userProfile: { email: 'a@b.c' } }),
    baseEnv,
  );
  const j: any = await res.json();
  for (const c of ['outlook_event', 'push']) {
    assert.equal(j.results[c].status, 'unsupported', `${c} must not be claimed by this endpoint`);
  }
  assert.equal(j.delivered, false);
});

// ---------------------------------------------------------------------------
// AC-N4b — GOOGLE_EVENT is a GAP, and must not be described as someone else's job.
//
// Ground truth, read rather than recalled: send-unified-notification/index.ts:783 builds
// `dynamicGoogleEvent` and forwards GOOGLE_EVENT in `remainingChannels` (line 602). Nothing in
// journey creates that event on this path — n8n did. An earlier version of notify.ts answered
// "handled by journey edge functions, not here", which would have let a reader conclude the event
// existed somewhere. This asserts the answer tells the truth about who, if anyone, did the work.
// ---------------------------------------------------------------------------
test('AC-N4b google_event reports not_implemented, NOT "handled elsewhere"', async () => {
  const res = await handleNotify(
    req({ channels: ['GOOGLE_EVENT'], userProfile: { email: 'a@b.c' } }),
    baseEnv,
  );
  const j: any = await res.json();
  assert.equal(j.results.google_event.status, 'not_implemented',
    'a forwarded channel nobody fulfils must say so, not borrow another lane as an excuse');
  assert.ok(!/handled by journey edge/i.test(j.results.google_event.detail ?? ''),
    'google_event is NOT handled by journey edge functions — that claim is false');
  assert.equal(j.delivered, false);
});

test('AC-N5 slack without a webhook reports not_configured rather than pretending', async () => {
  const res = await handleNotify(req({ channels: ['slack'] }), baseEnv);
  const j: any = await res.json();
  assert.equal(j.results.slack.status, 'not_configured');
  assert.equal(j.delivered, false);
});

// ---------------------------------------------------------------------------
// AC-N5b — the CALLER'S webhook must be used, on BOTH transports.
//
// journey's Notification Settings lets a user paste their own Slack Incoming Webhook
// (NotificationSettings.tsx:1026), and `send-unified-notification` appends it to the query string
// (index.ts:814). The GET parser here read six fields and `slackWebhook` was not among them, so
// that setting was silently discarded — a configured user still got `not_configured`. A setting
// the UI collects and the transport drops is worse than an absent feature, because the user has
// every reason to believe it took effect.
//
// Asserted by OBSERVING THE REQUEST, not the response: a 200 could come from the env default just
// as easily, so only the URL actually fetched proves whose webhook won.
// ---------------------------------------------------------------------------
test('AC-N5b a caller-supplied slackWebhook is used, and BEATS the env default', async () => {
  const realFetch = globalThis.fetch;
  const hits: string[] = [];
  globalThis.fetch = (async (input: any) => {
    hits.push(typeof input === 'string' ? input : input.url);
    return new Response('ok', { status: 200 });
  }) as typeof fetch;
  try {
    const envWithDefault = { ...baseEnv, SLACK_WEBHOOK_URL: 'https://hooks.slack.com/DEFAULT' };
    const mine = 'https://hooks.slack.com/services/MINE';

    // POST transport
    const post: any = await (await handleNotify(
      req({ channels: ['SLACK'], slackWebhook: mine }), envWithDefault)).json();
    assert.equal(post.results.slack.status, 'sent');

    // GET transport — the one journey actually uses.
    const qs = new URLSearchParams({ channels: '["SLACK"]', slackWebhook: mine });
    const get: any = await (await handleNotify(
      new Request(`https://w.dev/notify?${qs}`, {
        method: 'GET', headers: { 'x-webhook-secret': SECRET },
      }), envWithDefault)).json();
    assert.equal(get.results.slack.status, 'sent');

    assert.deepEqual(hits, [mine, mine],
      `both transports must post to the CALLER's webhook, not the env default. Got: ${hits.join(', ')}`);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('AC-N6 an empty channel list is rejected outright', async () => {
  assert.equal((await handleNotify(req({ channels: [] }), baseEnv)).status, 400);
  assert.equal((await handleNotify(req({}), baseEnv)).status, 400);
});

// ---------------------------------------------------------------------------
// AC-N7 — config helpers
// ---------------------------------------------------------------------------
test('AC-N7 send-as allow-list and Graph config gate behave', () => {
  assert.deepEqual(emailFromOptions({}), ['dev@enterpriseds.io']);
  assert.deepEqual(emailFromOptions({ NOTIFY_EMAIL_FROM: ' a@x.io , b@x.io ' }), ['a@x.io', 'b@x.io']);
  assert.equal(graphConfigured({}), false);
  assert.equal(graphConfigured({ AZURE_CLIENT_ID: 'a', AZURE_CLIENT_SECRET: 'b' }), false); // partial
  assert.equal(graphConfigured({ AZURE_CLIENT_ID: 'a', AZURE_CLIENT_SECRET: 'b', AZURE_TENANT_ID: 'c' }), true);
});

// ---------------------------------------------------------------------------
// AC-N8 — THE GET CONTRACT. Regression guard for a defect a LIVE test caught, not a unit
// test: the endpoint shipped POST-only and journey's own send-unified-notification builds a
// query string and fetches with method GET (index.ts:839), so production answered
// `405 POST only`. These assert the caller's real shape, taken from that file.
// ---------------------------------------------------------------------------
function getReq(params: Record<string, string>, secret: string | null = SECRET) {
  const u = new URL('https://w.dev/notify');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (secret !== null) headers['x-webhook-secret'] = secret;
  return new Request(u, { method: 'GET', headers });
}

test('AC-N8 a GET carrying the legacy query contract is accepted, not 405', async () => {
  // Exactly the shape send-unified-notification sends: JSON-ENCODED STRINGS in query params.
  const res = await handleNotify(
    getReq({
      userId: 'u1',
      title: 'Morning Kickstart',
      body: 'test body',
      channels: '["email"]',
      userProfile: '{"email":"a@b.c","phone":"+1"}',
      taskData: '{}',
    }),
    baseEnv,
  );
  assert.notEqual(res.status, 405, 'the 2026-09-13 production defect: GET was rejected outright');
  const j: any = await res.json();
  // Graph is unconfigured in baseEnv, so the honest answer is not_configured — NOT a 405 and
  // NOT a false success. That it reached the channel switch at all is the point.
  assert.equal(j.results.email.status, 'not_configured');
  assert.equal(j.delivered, false);
});

test('AC-N8b GET and POST produce IDENTICAL results for the same notification', async () => {
  const params = {
    userId: 'u1', title: 'T', body: 'B',
    channels: '["EMAIL"]', userProfile: '{"email":"a@b.c"}', taskData: '{}',
  };
  const g: any = await (await handleNotify(getReq(params), baseEnv)).json();
  const p: any = await (await handleNotify(
    req({ userId: 'u1', title: 'T', body: 'B', channels: ['EMAIL'], userProfile: { email: 'a@b.c' } }),
    baseEnv,
  )).json();
  // Transport must not change the verdict. Uppercase on both sides also re-proves AC-N1
  // across the query path, where the value arrives as a JSON string rather than an array.
  assert.deepEqual(g.results, p.results);
  assert.equal(g.delivered, p.delivered);
});

test('AC-N8c a GET is still AUTHENTICATED — the query path is not a bypass', async () => {
  const res = await handleNotify(getReq({ channels: '["email"]' }, null), baseEnv);
  assert.equal(res.status, 401, 'no secret on a GET must 401, exactly as on a POST');
  const wrong = await handleNotify(getReq({ channels: '["email"]' }, 'nope'), baseEnv);
  assert.equal(wrong.status, 401);
});

test('AC-N8d genuinely unsupported methods are still refused', async () => {
  for (const m of ['PUT', 'DELETE', 'PATCH']) {
    const r = new Request('https://w.dev/notify', { method: m, headers: { 'x-webhook-secret': SECRET } });
    assert.equal((await handleNotify(r, baseEnv)).status, 405, `${m} must be refused`);
  }
});
