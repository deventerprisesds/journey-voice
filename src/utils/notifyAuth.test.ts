// WHAT:       Pins that send-unified-notification AUTHENTICATES its call to the /notify relay.
// WHY:        The relay (cloudflare/notify.ts handleNotify) answers 401 without `x-webhook-secret`.
//             The header lived only on an unmerged branch (a0c87e7); a redeploy from main shipped
//             the header-less sender and every email failed `Webhook failed: 401` — measured live
//             2026-10-15 17:44 (activity_log notification_webhook_response). Source-text guard, the
//             same shape as notificationChannels.test.ts, because the fetch needs a live relay.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   .claude/actions.md ACT:kickstart-email-dupes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SENDER = 'supabase/functions/send-unified-notification/index.ts';

test('AC-AUTH-1 the relay call sends x-webhook-secret from JOURNEY_PROXY_TOKEN', () => {
  const src = readFileSync(SENDER, 'utf8');
  assert.match(src, /Deno\.env\.get\('JOURNEY_PROXY_TOKEN'\)/, 'must read the shared secret');
  assert.match(src, /'x-webhook-secret':\s*proxyToken/, 'must send it as the x-webhook-secret header');
});

test('AC-AUTH-2 the secret never goes into the logged query string', () => {
  const src = readFileSync(SENDER, 'utf8');
  assert.doesNotMatch(src, /queryParams\.(append|set)\(['"](token|secret|x-webhook-secret)/i);
});

test('AC-HTML-RELAY a message carrying html goes to /notify as an authenticated JSON POST that includes it', () => {
  const src = readFileSync(SENDER, 'utf8');
  const post = src.slice(src.indexOf('payload.html\n      ? await fetch(webhookUrl'), src.indexOf(': await fetch(fullUrl'));
  assert.ok(post.length > 0, 'the html branch exists');
  assert.match(post, /method: 'POST'/);
  assert.match(post, /'x-webhook-secret': proxyToken/, 'the POST branch is authenticated like the GET one');
  assert.match(post, /html: payload\.html,/, 'the html is actually forwarded');
  assert.match(src, /^\s+html,$/m, 'the request handler destructures html and passes it on');
});
