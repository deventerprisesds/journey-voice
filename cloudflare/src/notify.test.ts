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
  assert.equal((await handleNotify(req({ channels: ['email'] }, SECRET, 'GET'), baseEnv)).status, 405);
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
    req({ channels: ['OUTLOOK_EVENT', 'google_event', 'PUSH'], userProfile: { email: 'a@b.c' } }),
    baseEnv,
  );
  const j: any = await res.json();
  for (const c of ['outlook_event', 'google_event', 'push']) {
    assert.equal(j.results[c].status, 'unsupported', `${c} must not be claimed by this endpoint`);
  }
  assert.equal(j.delivered, false);
});

test('AC-N5 slack without a webhook reports not_configured rather than pretending', async () => {
  const res = await handleNotify(req({ channels: ['slack'] }), baseEnv);
  const j: any = await res.json();
  assert.equal(j.results.slack.status, 'not_configured');
  assert.equal(j.delivered, false);
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
