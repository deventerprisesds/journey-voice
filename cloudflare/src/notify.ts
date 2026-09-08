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
}

export interface ChannelResult {
  ok: boolean;
  /** Machine-readable outcome. `skipped` and `not_configured` are NOT successes. */
  status: 'sent' | 'failed' | 'not_configured' | 'unsupported';
  detail?: string;
}

export interface NotifyRequest {
  userId?: string;
  title?: string;
  body?: string;
  channels?: unknown;
  userProfile?: { email?: string; phone?: string } | string | null;
  taskData?: unknown;
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
    return { ok: false, status: 'failed', detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function sendSlack(env: NotifyEnv, title: string, body: string): Promise<ChannelResult> {
  if (!env.SLACK_WEBHOOK_URL) {
    return { ok: false, status: 'not_configured', detail: 'SLACK_WEBHOOK_URL is not set' };
  }
  try {
    const res = await fetch(env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: title ? `*${title}*\n${body ?? ''}` : (body ?? '') }),
    });
    return res.ok
      ? { ok: true, status: 'sent', detail: `slack ${res.status}` }
      : { ok: false, status: 'failed', detail: `slack ${res.status}: ${(await res.text()).slice(0, 200)}` };
  } catch (e) {
    return { ok: false, status: 'failed', detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Channels journey handles ITSELF and must never be forwarded here. Reporting them `unsupported`
 * is deliberate: silently accepting one would let a caller believe journey's edge function had been
 * relieved of work it is still doing, and the calendar event would simply never be created.
 */
const HANDLED_BY_JOURNEY_EDGE = new Set(['outlook_event', 'google_event', 'push']);

export async function handleNotify(request: Request, env: NotifyEnv): Promise<Response> {
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

  if (request.method !== 'POST') {
    return json({ ok: false, error: 'POST only' }, 405);
  }
  // Same shared-secret scheme huddle's public routes use. Reuses JOURNEY_PROXY_TOKEN.
  const expected = env.JOURNEY_PROXY_TOKEN;
  if (!expected) {
    return json({ ok: false, error: 'JOURNEY_PROXY_TOKEN not configured on the Worker' }, 503);
  }
  if (request.headers.get('x-webhook-secret') !== expected) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  let payload: NotifyRequest;
  try {
    payload = (await request.json()) as NotifyRequest;
  } catch {
    return json({ ok: false, error: 'body must be JSON' }, 400);
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
    } else if (ch === 'email') {
      results[ch] = await sendEmail(env, profile.email ?? '', title, body);
    } else if (ch === 'slack') {
      results[ch] = await sendSlack(env, title, body);
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
