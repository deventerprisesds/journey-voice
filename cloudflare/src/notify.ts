// WHAT:       journey's own notification endpoint. Takes a channel list and delivers each one
//             DETERMINISTICALLY, returning a per-channel result that says what actually happened.
// WHY:        Delivery went through an n8n webhook whose only live path was an LLM choosing to call
//             a tool. Measured 2026-09-08: journey sends channels=["email"], the n8n assistant prompt
//             tests for "EMAIL", the thread-manager node that supplies its threadId is disabled, and
//             every deterministic send node in that workflow is disabled too. n8n answers
//             {"message":"Workflow was started"} either way, so journey logged success for mail that
//             never left. Four independent sends produced zero email.
// SUPERSEDES: the UNIFIED_WEBHOOK_URL hop to edsdevn8n.app.n8n.cloud for the EMAIL channel.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   .claude/actions.md "none of my emails are working"; pg_net probes 693932/693933 both
//             returned 200 "Workflow was started" with no mail delivered.
//
// OWNERSHIP LANE: journey is the comms module. This endpoint is journey's, and huddle/boost call it
// rather than each building their own sender. The Graph client-credentials approach is COPIED from
// huddle's `email/graph-email.server.ts`, which is already carrying production traffic -- the pattern
// is proven, the host is journey.
//
// NO NEW SECRETS: reuses AZURE_CLIENT_ID / AZURE_CLIENT_SECRET / AZURE_TENANT_ID (the org service
// principal that already doubles as the Graph app) and JOURNEY_PROXY_TOKEN for auth, per the standing
// rule against minting org secrets for cross-app calls.

const GRAPH = 'https://graph.microsoft.com/v1.0';
const SLACK_API = 'https://slack.com/api';

/**
 * Scrub credential-shaped text out of anything that reaches a caller or a log.
 *
 * `catch (e) { detail: e.message }` hands an underlying client's thrown message straight back in
 * the response. No observed throw carries the bearer token today, but "no observed throw" is a
 * statement about the fetch implementations seen so far, not a property of the code — and a token
 * echoed into a `detail` would be a security defect, not a cosmetic one. Cheaper to scrub than to
 * keep re-deriving that it is safe. Flagged by an independent verifier, 2026-09-13.
 */
export function scrubSecrets(text: string): string {
  // ORDER IS LOAD-BEARING. `Bearer` must be consumed FIRST, whole. Scrubbing the token shape
  // first leaves `Bearer xox*-REDACTED` — safe, but the stub `xox` is then too short for the
  // Bearer rule's {8,} so the header survives half-rewritten. Caught by AC-N10b.
  return String(text)
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, 'Bearer REDACTED')
    .replace(/xox[baprs]-[A-Za-z0-9-]{8,}/g, 'xox*-REDACTED')
    .replace(/xapp-[A-Za-z0-9-]{8,}/g, 'xapp-REDACTED')
    .replace(/https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/+_-]+/g,
             'https://hooks.slack.com/services/REDACTED');
}

const LOGIN = 'https://login.microsoftonline.com';

export interface NotifyEnv {
  JOURNEY_PROXY_TOKEN?: string;
  AZURE_CLIENT_ID?: string;
  AZURE_CLIENT_SECRET?: string;
  AZURE_TENANT_ID?: string;
  /** Comma-separated allow-list of send-as mailboxes; the first is the default. */
  NOTIFY_EMAIL_FROM?: string;
  /** Optional Slack incoming-webhook URL. Absent -> the slack channel reports not_configured. */
  SLACK_WEBHOOK_URL?: string;
  /**
   * Slack BOT token (`xoxb-…`) for `chat.postMessage`. This is the PREFERRED Slack transport and
   * the one the n8n workflow it replaces actually used (`slackOAuth2Api`), because it is the only
   * one that can pick a channel per message and reply inside a thread.
   *
   * ONE app, ONE bot, MANY channels — never one app per agent. Slack's free plan caps a workspace
   * at 10 apps/integrations and **each bot user counts as one**, so 16 agents cannot be 16 bots.
   * Agent identity therefore comes from the CHANNEL, exactly as n8n derived it
   * (`flex-grimes___fitness_trainer` -> `flex`).
   */
  SLACK_BOT_TOKEN?: string;
  /** Channel used when a caller names none. Id (`C0123…`) or `#name`. */
  SLACK_DEFAULT_CHANNEL?: string;
}

export interface ChannelResult {
  ok: boolean;
  /**
   * Machine-readable outcome. ONLY `sent` is a success — `not_configured`, `unsupported` and
   * `not_implemented` all mean nothing was delivered.
   *
   * `not_implemented` was added with the google_event fix and NOT added here, so the union was
   * wrong for several commits. Nothing caught it: the tests run under `tsx`, which strips types
   * without checking them, and `wrangler deploy` shipped it too. Worth remembering that a green
   * suite here is not a type check.
   */
  status: 'sent' | 'failed' | 'not_configured' | 'unsupported' | 'not_implemented';
  detail?: string;
}

export interface NotifyRequest {
  userId?: string;
  title?: string;
  body?: string;
  channels?: unknown;
  userProfile?: { email?: string; phone?: string } | string | null;
  taskData?: unknown;
  /**
   * Per-user Slack Incoming Webhook URL, set in journey's Notification Settings and appended to
   * the query string by `send-unified-notification` (index.ts:814). Overrides the Worker's own
   * `SLACK_WEBHOOK_URL` for this one call.
   *
   * This field was MISSING from both parse paths, so a user who configured their own webhook had
   * it silently discarded and every Slack notification went to the Worker's default (or, with no
   * default set, reported `not_configured` while the caller had supplied a perfectly good URL).
   */
  slackWebhook?: string;
  /**
   * Slack channel for this message — id (`C0123…`) or `#name`. Only the bot-token transport can
   * honour it; an incoming webhook is welded to one channel at creation time.
   */
  slackChannel?: string;
  /**
   * Slack `ts` of a parent message. Present -> the reply lands INSIDE that thread, which is how
   * the n8n workflow kept each agent's conversation coherent. Webhooks cannot thread at all.
   */
  slackThreadTs?: string;
}

export interface NotifyResponse {
  ok: boolean;
  /** True only if EVERY requested channel reported `sent`. */
  delivered: boolean;
  results: Record<string, ChannelResult>;
  errors: string[];
}

/**
 * CASE-INSENSITIVE BY CONSTRUCTION, and this is the whole point of the function existing.
 *
 * journey has TWO callers that disagree: the nightly path sends `["email"]` (lowercase, from
 * `commsMode`) and the Settings test button sends `["EMAIL"]` (uppercase, NotificationSettings.tsx).
 * The n8n prompt matched one literal, so which caller you were was part of whether mail sent. A
 * transport must not care about the caller's capitalisation.
 *
 * Accepts a real array or a JSON-encoded string, because the old GET contract passed
 * `channels='["email"]'` as a query param and callers still send that shape.
 */
export function parseChannels(raw: unknown): string[] {
  let arr: unknown = raw;
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch {
      arr = raw.split(',');
    }
  }
  if (!Array.isArray(arr)) return [];
  const seen = new Set<string>();
  for (const c of arr) {
    const norm = String(c ?? '').trim().toLowerCase();
    if (norm) seen.add(norm);
  }
  return [...seen];
}

/** `userProfile` arrives as an object from JSON callers and a string from the legacy GET contract. */
export function parseProfile(raw: unknown): { email?: string; phone?: string } {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return p && typeof p === 'object' ? p : {};
    } catch {
      return {};
    }
  }
  return typeof raw === 'object' ? (raw as any) : {};
}

export function emailFromOptions(env: NotifyEnv): string[] {
  const raw = (env.NOTIFY_EMAIL_FROM ?? 'dev@enterpriseds.io').trim();
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : ['dev@enterpriseds.io'];
}

export function graphConfigured(env: NotifyEnv): boolean {
  return !!(env.AZURE_CLIENT_ID && env.AZURE_CLIENT_SECRET && env.AZURE_TENANT_ID);
}

/** Client-credentials token. Same grant huddle uses; a Worker can do this with plain fetch. */
async function getAppToken(env: NotifyEnv): Promise<string> {
  const res = await fetch(`${LOGIN}/${env.AZURE_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.AZURE_CLIENT_ID!,
      client_secret: env.AZURE_CLIENT_SECRET!,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`token ${res.status}: ${text.slice(0, 300)}`);
  const tok = JSON.parse(text)?.access_token;
  if (!tok) throw new Error('token response carried no access_token');
  return tok;
}

export async function sendEmail(
  env: NotifyEnv,
  to: string,
  subject: string,
  body: string,
): Promise<ChannelResult> {
  if (!graphConfigured(env)) {
    return { ok: false, status: 'not_configured', detail: 'Graph app credentials are not set on the Worker' };
  }
  if (!to) {
    return { ok: false, status: 'failed', detail: 'no recipient address on the request' };
  }
  const from = emailFromOptions(env)[0];
  try {
    const token = await getAppToken(env);
    const res = await fetch(`${GRAPH}/users/${encodeURIComponent(from)}/sendMail`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject: subject || '(no subject)',
          body: { contentType: 'Text', content: body || '' },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: true,
      }),
    });
    // Graph sendMail returns 202 Accepted with an EMPTY body on success.
    if (res.status === 202 || res.ok) return { ok: true, status: 'sent', detail: `graph ${res.status}` };
    const detail = (await res.text()).slice(0, 300);
    // 403 here means Mail.Send application permission is not consented -- an admin grant, not a bug.
    return { ok: false, status: 'failed', detail: `graph ${res.status}: ${detail}` };
  } catch (e) {
    return { ok: false, status: 'failed', detail: scrubSecrets(e instanceof Error ? e.message : String(e)) };
  }
}

export interface SlackOptions {
  /** Caller's own incoming-webhook URL (journey's per-user Settings value). */
  webhook?: string;
  /** Channel id or `#name`. Bot transport only. */
  channel?: string;
  /** Parent message `ts`, to reply in-thread. Bot transport only. */
  threadTs?: string;
}

/** Plain-text rendering shared by both transports, so the two never drift apart. */
function slackText(title: string, body: string): string {
  return title ? `*${title}*\n${body ?? ''}` : (body ?? '');
}

/**
 * Post via `chat.postMessage` with a bot token — the PREFERRED transport.
 *
 * `chat.postMessage` ALWAYS RETURNS HTTP 200, including for `invalid_auth`,
 * `channel_not_found` and `not_in_channel`. The real verdict is the `ok` field in the JSON body.
 * Reading `res.ok` here would report every one of those failures as a successful send — precisely
 * the silent-success defect this whole endpoint exists to eliminate, so the body is what decides.
 */
async function sendSlackViaBot(
  env: NotifyEnv,
  title: string,
  body: string,
  opts: SlackOptions,
): Promise<ChannelResult> {
  const channel = (opts.channel || '').trim() || env.SLACK_DEFAULT_CHANNEL;
  if (!channel) {
    return {
      ok: false,
      status: 'not_configured',
      detail: 'a bot token is set but no channel was given and SLACK_DEFAULT_CHANNEL is unset',
    };
  }
  try {
    const res = await fetch(`${SLACK_API}/chat.postMessage`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        channel,
        text: slackText(title, body),
        ...(opts.threadTs ? { thread_ts: opts.threadTs } : {}),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; ts?: string };
    // `=== true`, NOT truthiness. A malformed reply carrying `ok: "false"` — the STRING —
    // is truthy in JS and would be reported as `sent` with nothing delivered. That is the
    // exact silent-success class this endpoint exists to eliminate, so the check is exact
    // even though no Slack reply is known to take that shape. Found by an independent
    // verifier, 2026-09-13, as a hardening gap rather than a live defect.
    if (data?.ok === true) {
      return {
        ok: true,
        status: 'sent',
        detail: `chat.postMessage ${channel}${opts.threadTs ? ' (in thread)' : ''} ts=${data.ts ?? '?'}`,
      };
    }
    // Slack's error strings are the actionable part and name the fix directly:
    // `not_in_channel` -> invite the bot; `invalid_auth` -> the token; `channel_not_found` -> the id.
    return {
      ok: false,
      status: 'failed',
      detail: `chat.postMessage ${channel}: ${data?.error ?? `http ${res.status}`}`,
    };
  } catch (e) {
    return { ok: false, status: 'failed', detail: scrubSecrets(e instanceof Error ? e.message : String(e)) };
  }
}

/**
 * Post to Slack, preferring the bot token and falling back to an Incoming Webhook.
 *
 * The order is deliberate. A webhook is welded to ONE channel at creation time and cannot thread,
 * so honouring a caller's `channel`/`threadTs` through it is impossible — if a bot token exists it
 * must win, or those fields silently do nothing. The webhook stays as the degraded path for a
 * workspace where no bot is installed yet.
 *
 * Within the webhook path, the CALLER's URL beats the Worker's env default: a user configuring a
 * destination has to outrank a deployment default, or the setting is theatre.
 */
export async function sendSlack(
  env: NotifyEnv,
  title: string,
  body: string,
  opts: SlackOptions = {},
): Promise<ChannelResult> {
  if (env.SLACK_BOT_TOKEN) return sendSlackViaBot(env, title, body, opts);

  const url = (opts.webhook || '').trim() || env.SLACK_WEBHOOK_URL;
  if (!url) {
    return {
      ok: false,
      status: 'not_configured',
      detail: 'no Slack transport: SLACK_BOT_TOKEN unset, no webhook supplied, SLACK_WEBHOOK_URL unset',
    };
  }
  // Say so rather than dropping them on the floor: a caller that asked for a thread and got a
  // top-level post needs to know the request was downgraded, not assume it worked.
  const dropped = [opts.channel ? 'channel' : null, opts.threadTs ? 'thread_ts' : null]
    .filter(Boolean)
    .join(' and ');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: slackText(title, body) }),
    });
    return res.ok
      ? {
          ok: true,
          status: 'sent',
          detail: `webhook ${res.status}${dropped ? ` — ${dropped} IGNORED: a webhook cannot target a channel or thread` : ''}`,
        }
      : { ok: false, status: 'failed', detail: `webhook ${res.status}: ${(await res.text()).slice(0, 200)}` };
  } catch (e) {
    return { ok: false, status: 'failed', detail: scrubSecrets(e instanceof Error ? e.message : String(e)) };
  }
}

/**
 * Channels journey handles ITSELF and never forwards. Verified by reading the producer rather than
 * assuming it: `send-unified-notification/index.ts` strips OUTLOOK_EVENT at line 470 (after calling
 * Microsoft Graph directly at 450) and PUSH at line 599 (handing it to `send-push-notification`), so
 * neither can arrive here at all. Seeing one means the caller changed and something is now
 * double-sending — `unsupported` is the honest answer, not silent acceptance.
 */
const HANDLED_BY_JOURNEY_EDGE = new Set(['outlook_event', 'push']);

/**
 * Channels journey DOES forward, which this endpoint cannot yet fulfil.
 *
 * `google_event` was n8n's job and remains unbuilt here. This is a REAL GAP, not a routing note:
 * `send-unified-notification` builds `dynamicGoogleEvent` (index.ts:783) and forwards GOOGLE_EVENT
 * in `remainingChannels`, and journey has no Google Calendar code on this path — the only Google
 * Calendar functions in the repo (`calendar-integration-manager`, `calendar-delta-sync`,
 * `test-google-calendar`) are never called from it.
 *
 * This set exists SEPARATELY from the one above because an earlier version of this file lumped
 * `google_event` in with them and answered "handled by journey edge functions, not here". That was
 * false, and it is the most dangerous shape of wrong answer available: a caller reading it would
 * conclude the event was created elsewhere when in fact nothing created it anywhere. Creating the
 * event needs the user's Google OAuth token, which lives in journey's database, so it is a
 * deliberate follow-on — but until it is built the answer must say so plainly.
 */
const NOT_IMPLEMENTED_HERE = new Set(['google_event']);

export async function handleNotify(request: Request, env: NotifyEnv): Promise<Response> {
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

  // GET **and** POST, because the CALLER'S CONTRACT IS GET and the endpoint must speak it.
  // Measured 2026-09-13: a POST-only endpoint returned `405 POST only` to journey's own
  // `send-unified-notification`, which builds `?userId=…&channels=…` and fetches with
  // `method: 'GET'` (index.ts:839). Forcing the caller to change instead would also have
  // broken rollback, since the n8n webhook this replaces is GET-only too.
  //
  // POST stays the PREFERRED shape for new callers: the GET contract puts the entire
  // notification body in the query string, and a long digest can exceed URL limits. Both are
  // accepted; neither is privileged at the auth layer.
  if (request.method !== 'POST' && request.method !== 'GET') {
    return json({ ok: false, error: 'GET or POST only' }, 405);
  }
  // Same shared-secret scheme huddle's public routes use. Reuses JOURNEY_PROXY_TOKEN.
  const expected = env.JOURNEY_PROXY_TOKEN;
  if (!expected) {
    return json({ ok: false, error: 'JOURNEY_PROXY_TOKEN not configured on the Worker' }, 503);
  }
  if (request.headers.get('x-webhook-secret') !== expected) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  // Both shapes land in the SAME NotifyRequest, so everything below this point is
  // transport-agnostic. `parseChannels`/`parseProfile` already accept the JSON-ENCODED-STRING
  // forms the query contract produces (`channels='["email"]'`), which is why the GET path
  // needs no separate parsing rules — that was designed in, not discovered here.
  let payload: NotifyRequest;
  if (request.method === 'GET') {
    const q = new URL(request.url).searchParams;
    payload = {
      userId: q.get('userId') ?? undefined,
      title: q.get('title') ?? undefined,
      body: q.get('body') ?? undefined,
      channels: q.get('channels') ?? undefined,
      userProfile: q.get('userProfile') ?? undefined,
      taskData: q.get('taskData') ?? undefined,
      slackWebhook: q.get('slackWebhook') ?? undefined,
      slackChannel: q.get('slackChannel') ?? q.get('channel') ?? undefined,
      slackThreadTs: q.get('slackThreadTs') ?? q.get('thread_ts') ?? undefined,
    };
  } else {
    try {
      payload = (await request.json()) as NotifyRequest;
    } catch {
      return json({ ok: false, error: 'body must be JSON' }, 400);
    }
  }

  const channels = parseChannels(payload.channels);
  if (channels.length === 0) {
    return json({ ok: false, error: 'no channels requested' }, 400);
  }

  const profile = parseProfile(payload.userProfile);
  const title = String(payload.title ?? '');
  const body = String(payload.body ?? '');

  const results: Record<string, ChannelResult> = {};
  for (const ch of channels) {
    if (HANDLED_BY_JOURNEY_EDGE.has(ch)) {
      results[ch] = { ok: false, status: 'unsupported', detail: 'handled by journey edge functions, not here' };
    } else if (NOT_IMPLEMENTED_HERE.has(ch)) {
      results[ch] = {
        ok: false,
        status: 'not_implemented',
        detail: `"${ch}" was delivered by the n8n webhook and is NOT built here yet — nothing created it`,
      };
    } else if (ch === 'email') {
      results[ch] = await sendEmail(env, profile.email ?? '', title, body);
    } else if (ch === 'slack') {
      results[ch] = await sendSlack(env, title, body, {
        webhook: payload.slackWebhook,
        channel: payload.slackChannel,
        threadTs: payload.slackThreadTs,
      });
    } else {
      results[ch] = { ok: false, status: 'unsupported', detail: `unknown channel "${ch}"` };
    }
  }

  const errors = Object.entries(results)
    .filter(([, r]) => !r.ok)
    .map(([c, r]) => `${c}: ${r.status}${r.detail ? ` — ${r.detail}` : ''}`);

  // `delivered` requires EVERY channel to have actually sent. The predecessor reported success on a
  // bare "Workflow was started" ack, which is why nobody noticed the outage for days.
  const delivered = channels.length > 0 && Object.values(results).every((r) => r.ok);

  const res: NotifyResponse = { ok: true, delivered, results, errors };
  return json(res, delivered ? 200 : 207); // 207 = accepted the request, not everything delivered
}
