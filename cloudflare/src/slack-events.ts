// WHAT:       journey's inbound Slack door. Slack PUSHES a message event here; this verifies it is
//             really from Slack, works out which agent owns the channel, hands the text to Huddle's
//             agent-turn endpoint, and posts the reply back in the same thread.
// WHY:        The owner asked for a near-real-time reply and to move off Supabase. Both rule out the
//             polling design I first proposed. Measured from the live project (`cron.job`, 2026-09-13):
//             the three most frequent jobs are all `* * * * *` AND all are pg_cron -> Supabase edge
//             function, so "reuse the most frequent cron" and "get off Supabase" are the same
//             sentence pointing in opposite directions. A one-minute poll also means 0-60s before an
//             agent has even SEEN the message, before it starts thinking. Slack's own push arrives in
//             about a second and needs no cron and no cursor anywhere.
// SUPERSEDES: the "poll conversations.history on a schedule" design in .claude/actions.md
//             (ACT: inbound Slack). That entry's FINDING stands -- the read token really does expose
//             user/ts/thread_ts/text -- only its TRANSPORT is replaced.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   `select schedule, jobname from cron.job` on wwxgajrtmslzklnyplah; Huddle's
//             src/routes/api/public/run-agent-turn.ts on origin/main.
//
// NO NEW CROSS-APP SECRET. The call into Huddle reuses JOURNEY_PROXY_TOKEN as `x-webhook-secret`,
// which is exactly what run-agent-turn already authenticates against. SLACK_SIGNING_SECRET is not an
// exception to that rule: it is not a credential we mint to bridge two of our own apps, it is issued
// BY Slack for this app and is the only thing that distinguishes a real Slack delivery from anyone
// who has learned this URL.
//
// WHY THERE IS NO DEDUPE TABLE. Slack retries a delivery it thinks failed, so a naive receiver runs
// the same message twice. Rather than hold state, this forwards Slack's `event_id` as Huddle's
// `idempotencyKey`; run-agent-turn derives its durable turn id from it, and a repeat REPLAYS the
// stored replies instead of running and billing the turn again. The dedupe already exists one hop
// downstream -- borrowing it is what keeps this component stateless.

const SLACK_API = 'https://slack.com/api';

/** Slack rejects a delivery it cannot get an answer to within 3 seconds. */
export const SLACK_ACK_BUDGET_MS = 3000;

/** Replay window. Slack's own guidance; a signature older than this is refused even if it verifies. */
export const MAX_SIGNATURE_AGE_S = 60 * 5;

export interface SlackEventsEnv {
  /** Slack app signing secret. Absent -> every request is refused; this never fails open. */
  SLACK_SIGNING_SECRET?: string;
  /** `xoxb-…`, used to resolve the channel name and to post the reply. */
  SLACK_BOT_TOKEN?: string;
  /** Shared secret for Huddle's /api/public/* routes. The SAME one journey already uses. */
  JOURNEY_PROXY_TOKEN?: string;
  /** Base origin of the Huddle app, e.g. https://icy-flower-0f415200f.7.azurestaticapps.net */
  HUDDLE_BASE_URL?: string;
  /**
   * Which agent answers a DIRECT MESSAGE, e.g. `iris-chase`. Set in wrangler.toml `[vars]`, which
   * is where it is changed — never a literal in this file.
   *
   * A DM is the one inbound shape where NOTHING names an agent: a lane channel is called
   * `<agentId>___…`, and a DM has no name at all. Huddle does not fill that gap with a router —
   * `buildTurnInput` (turn-gate.ts) reads `members.length > 0 ? members : defaultMembers()` and
   * `scope === "one-to-one" ? … : "group"`, so OMITTING both does not mean "you choose", it means
   * **a group turn against all 15 roster agents for one DM**. Hence a configured id, and the
   * fail-closed guard in processMessageEvent when it is absent.
   */
  SLACK_DM_AGENT_ID?: string;
}

/**
 * Verify Slack's `v0=` signature over the RAW body.
 *
 * Uses `crypto.subtle.verify` rather than comparing two hex strings. That is not a style choice:
 * `a === b` on a hex digest leaks, through timing, how many leading characters an attacker got
 * right, which is the standard way a forged-signature check is defeated. `subtle.verify` compares
 * inside the implementation.
 *
 * The body must be the EXACT bytes Slack sent. Re-serialising parsed JSON changes key order and
 * spacing and the signature will never match — read the text once, verify it, THEN parse it.
 */
export async function verifySlackSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  signingSecret: string | undefined,
  nowMs: number = Date.now(),
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!signingSecret) return { ok: false, reason: 'signing_secret_not_configured' };
  if (!timestamp || !signature) return { ok: false, reason: 'missing_signature_headers' };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'bad_timestamp' };
  // Both directions. A FUTURE-dated timestamp is just as much a replay attempt as an old one, and
  // `now - ts > MAX` alone silently accepts anything dated forward.
  if (Math.abs(Math.floor(nowMs / 1000) - ts) > MAX_SIGNATURE_AGE_S) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  const expectedPrefix = 'v0=';
  if (!signature.startsWith(expectedPrefix)) return { ok: false, reason: 'bad_signature_format' };
  const hex = signature.slice(expectedPrefix.length);
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
    return { ok: false, reason: 'bad_signature_format' };
  }
  const sigBytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < sigBytes.length; i++) sigBytes[i] = parseInt(hex.substr(i * 2, 2), 16);

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(signingSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
  );
  const good = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(`v0:${ts}:${rawBody}`));
  return good ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
}

/**
 * Should this event produce an agent turn?
 *
 * THE LOOP GUARD IS THE WHOLE POINT OF THIS FUNCTION. The reply this Worker posts arrives back as
 * another `message` event on the same channel. Without the bot checks below, the agent answers its
 * own answer, forever, in the owner's Slack — the single most damaging way this feature can fail,
 * and it fails LOUDLY and publicly. Three independent markers are checked because Slack does not
 * set them consistently across message shapes: `bot_id` is present on bot posts, `subtype` is
 * `bot_message` for some, and `app_id` appears on others.
 *
 * Every non-plain `subtype` is also dropped (edits, deletions, joins, channel topic changes). An
 * agent should answer what a person SAID, not narrate the channel's housekeeping.
 */
export function shouldHandleMessage(event: Record<string, unknown> | null | undefined): boolean {
  if (!event || typeof event !== 'object') return false;
  if (event.type !== 'message') return false;
  if (event.bot_id) return false;
  if (event.app_id) return false;
  if (event.subtype) return false;          // bot_message, message_changed, channel_join, …
  if (typeof event.user !== 'string' || !event.user) return false;
  if (typeof event.text !== 'string' || !event.text.trim()) return false;
  return true;
}

/**
 * `iris-chase___itinerary` -> `iris-chase`.
 *
 * The separator is the triple underscore the existing agent channels already use; a channel with no
 * separator yields null rather than guessing, because sending a random channel's chatter to an
 * arbitrary agent is worse than ignoring it.
 */
export function agentIdFromChannelName(name: string | null | undefined): string | null {
  if (!name) return null;
  const idx = name.indexOf('___');
  if (idx <= 0) return null;
  const handle = name.slice(0, idx).trim();
  return handle || null;
}

/**
 * Resolve a conversation to its NAME and whether it is a DM.
 *
 * **`isIm` is not a detail — it is a whole second routing mode.** A Slack DM has no `name` field at
 * all, so the `___` mapper can never derive an agent from one; a null name alone cannot tell
 * "this is a DM" apart from "the lookup failed", and those need opposite responses. Returning the
 * flag is what lets a DM route by a different rule instead of being silently dropped as a non-lane.
 *
 * Needs `channels:read`/`groups:read` (held) and, for DMs, `im:read`.
 */
export async function lookupConversation(
  channelId: string,
  botToken: string,
): Promise<{ name: string | null; isIm: boolean }> {
  const res = await fetch(`${SLACK_API}/conversations.info?channel=${encodeURIComponent(channelId)}`, {
    headers: { Authorization: `Bearer ${botToken}` },
  });
  // Slack answers 200 with `ok:false` in the body for real failures, so the status alone proves
  // nothing. Same trap the outbound side documents.
  const data = (await res.json().catch(() => null)) as
    | { ok?: boolean; channel?: { name?: string; is_im?: boolean } }
    | null;
  if (data?.ok !== true) return { name: null, isIm: false };
  return {
    name: typeof data.channel?.name === 'string' ? data.channel.name : null,
    isIm: data.channel?.is_im === true,
  };
}

/**
 * Slack thread/channel context, shaped as Huddle `HistoryMessage`s.
 *
 * THIS IS NOT A NICETY — IT IS HOW MEMORY GETS FOUND. `runHuddleTurn` builds its memory-retrieval
 * QUERY from `[data.text, ...data.history.slice(-14).map(m => m.text)]` and then drops every hit
 * scoring under 0.3. Sending `history: []`, as this route did at first, means the agent's entire
 * recollection is searched using one Slack sentence. Ask "what did I ask you yesterday" with no
 * history and the embedding is about ASKING, not about the things asked — so it matches the stored
 * chunks about those things poorly, scores under the floor, and the agent answers with nothing.
 * **The memory was never missing; the query was too thin to reach it.**
 *
 * `author.kind: 'agent'` REQUIRES a valid agent id, so only OUR bot's posts are mapped to the
 * channel's agent. Anything else that is not a plain human message is dropped rather than guessed
 * at: an invalid `agentId` fails the endpoint's schema and would cost the whole turn, which is a
 * far worse outcome than one missing line of context.
 */
export async function fetchSlackContext(args: {
  channel: string;
  threadTs?: string;
  botToken: string;
  /** null in a DM: there is no channel-derived agent, so a bot line cannot claim one. */
  agentId: string | null;
  huddleId: string;
  limit?: number;
}): Promise<Array<Record<string, unknown>>> {
  const limit = args.limit ?? 12;
  // In a thread, the thread IS the conversation. Outside one, recent channel traffic is the best
  // available stand-in for "what we were just talking about".
  const url = args.threadTs
    ? `${SLACK_API}/conversations.replies?channel=${encodeURIComponent(args.channel)}&ts=${encodeURIComponent(args.threadTs)}&limit=${limit}`
    : `${SLACK_API}/conversations.history?channel=${encodeURIComponent(args.channel)}&limit=${limit}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${args.botToken}` } });
  const data = (await res.json().catch(() => null)) as
    | { ok?: boolean; messages?: Array<Record<string, unknown>> }
    | null;
  // `ok !== true` is not fatal. Context is an enhancement; losing it must never cost the reply.
  if (data?.ok !== true || !Array.isArray(data.messages)) return [];

  const out: Array<Record<string, unknown>> = [];
  // Slack returns newest-first for history and oldest-first for replies. Normalise by ts so the
  // model reads the conversation forwards either way.
  const ordered = [...data.messages].sort(
    (a, b) => Number(a.ts ?? 0) - Number(b.ts ?? 0),
  );
  for (const m of ordered) {
    const text = typeof m.text === 'string' ? m.text.trim() : '';
    if (!text) continue;
    const isOurBot = Boolean(m.bot_id) || Boolean(m.app_id);
    if (!isOurBot && typeof m.user !== 'string') continue;
    out.push({
      id: `slack-${String(m.ts)}`,
      huddleId: args.huddleId,
      // With no channel-derived agent (a DM), a bot line is recorded as 'system' rather than
      // asserting an agentId we do not have: an invalid one fails the endpoint's schema and costs
      // the entire turn, which is far worse than a slightly flatter transcript.
      author: isOurBot
        ? (args.agentId ? { kind: 'agent', agentId: args.agentId } : { kind: 'system' })
        : { kind: 'user' },
      text,
      ts: Math.round(Number(m.ts ?? 0) * 1000),
    });
  }
  // The endpoint caps history at 40; stay well under and keep the most recent.
  return out.slice(-limit);
}

/** Ask Huddle for one agent turn. Returns the replies, already flattened to text. */
export async function runHuddleAgentTurn(args: {
  text: string;
  /** Absent for a DM: see below — Huddle's own router picks, rather than this file guessing. */
  agentId: string | null;
  eventId: string;
  env: SlackEventsEnv;
  history?: Array<Record<string, unknown>>;
  huddleId?: string;
}): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const { text, agentId, eventId, env, history } = args;
  if (!env.HUDDLE_BASE_URL) return { ok: false, reason: 'huddle_base_url_not_configured' };
  if (!env.JOURNEY_PROXY_TOKEN) return { ok: false, reason: 'proxy_token_not_configured' };

  const res = await fetch(`${env.HUDDLE_BASE_URL.replace(/\/+$/, '')}/api/public/run-agent-turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-secret': env.JOURNEY_PROXY_TOKEN },
    body: JSON.stringify({
      text,
      // CORRECTED 2026-09-13. This previously read "a DM omits them so Huddle's OWN router
      // chooses". It does not. `buildTurnInput` (huddle turn-gate.ts, read on origin/main) is
      // `members.length > 0 ? members : defaultMembers()` and `scope === "one-to-one" ? … :
      // "group"` -- there is NO router on this path, so omitting both buys a GROUP turn against
      // all 15 roster agents, not a routed one. Callers must therefore always pass an agentId;
      // `processMessageEvent` resolves a DM's from SLACK_DM_AGENT_ID and refuses without it.
      // The `null` branch is kept only so this function cannot silently send a malformed body.
      ...(agentId ? { scope: 'one-to-one', members: [agentId] } : {}),
      huddleId: args.huddleId ?? (agentId ? `dm-${agentId}` : 'slack-dm'),
      // Feeds BOTH the conversation and the memory-retrieval query -- see fetchSlackContext.
      history: history ?? [],
      // Slack's own event id. run-agent-turn derives its durable turn id from this, so a Slack
      // retry replays the stored reply instead of running the turn a second time.
      idempotencyKey: eventId,
    }),
  });

  const data = (await res.json().catch(() => null)) as
    | { ok?: boolean; replies?: Array<{ text?: string }>; error?: string }
    | null;
  if (!res.ok || data?.ok !== true) {
    return { ok: false, reason: `huddle_${res.status}${data?.error ? `_${data.error}` : ''}` };
  }
  const joined = (data.replies ?? [])
    .map((r) => (typeof r?.text === 'string' ? r.text.trim() : ''))
    .filter(Boolean)
    .join('\n\n');
  // A turn that is still running comes back `ok:true` with an EMPTY replies array. Saying nothing
  // in Slack would look like the agent ignored the message, so that case is named rather than blank.
  return { ok: true, text: joined || '_(working on it — no reply text yet)_' };
}

/** Post the agent's answer back, always in the originating thread. */
export async function postSlackReply(args: {
  channel: string;
  threadTs: string;
  text: string;
  botToken: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const res = await fetch(`${SLACK_API}/chat.postMessage`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${args.botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: args.channel, text: args.text, thread_ts: args.threadTs }),
  });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  // `=== true`, never truthiness: a malformed body carrying the STRING "false" is truthy in JS and
  // would report a delivery that never happened. Same rule as the outbound sender.
  if (data?.ok === true) return { ok: true };
  return { ok: false, reason: data?.error ?? `http_${res.status}` };
}

/**
 * The work that happens AFTER Slack has been told 200. Exported so a test can drive it directly
 * without racing `waitUntil`.
 */
export async function processMessageEvent(
  body: Record<string, unknown>,
  env: SlackEventsEnv,
): Promise<{ handled: boolean; reason?: string }> {
  const event = body.event as Record<string, unknown> | undefined;
  if (!shouldHandleMessage(event)) return { handled: false, reason: 'not_a_user_message' };
  if (!env.SLACK_BOT_TOKEN) return { handled: false, reason: 'bot_token_not_configured' };

  const channel = String(event!.channel ?? '');
  if (!channel) return { handled: false, reason: 'no_channel' };

  const conv = await lookupConversation(channel, env.SLACK_BOT_TOKEN);
  const agentId = agentIdFromChannelName(conv.name);
  // THREE outcomes, not two. A named lane pins an agent; a DM has no name and takes the CONFIGURED
  // agent below; anything else is a channel we were never meant to answer in. Collapsing the middle
  // case into the last is the bug the owner hit -- "I'm only receiving replies from iris using the
  // channel not direct message".
  if (!agentId && !conv.isIm) return { handled: false, reason: 'channel_is_not_an_agent_lane' };

  // A DM names no agent, so the configured one answers it. FAILS CLOSED when unset: the fallback
  // is not "no reply", it is a GROUP turn against every roster agent (see SLACK_DM_AGENT_ID), so
  // answering anyway would fan one DM out to 15 agents. Refusing is the cheaper wrong answer.
  const effectiveAgentId = agentId ?? ((env.SLACK_DM_AGENT_ID ?? '').trim() || null);
  if (!effectiveAgentId) return { handled: false, reason: 'dm_agent_not_configured' };

  // `dm-<agentId>` DELIBERATELY, not a Slack-specific id: it is the same huddle the in-app 1:1 with
  // that agent uses, so a DM continues that conversation instead of starting a parallel one the
  // agent has no history for. This is the "same agent, same memory, different surface" the whole
  // proxy exists for.
  const huddleId = `dm-${effectiveAgentId}`;

  // Gather context BEFORE the turn: the history is what makes the agent's memory search find
  // anything (runHuddleTurn embeds text + history to query memory, then drops hits under 0.3).
  // `parentTs`, not `threadTs`: the reply below computes its own `threadTs` with a different
  // meaning (thread_ts ?? ts, i.e. always a value). This one is deliberately undefined when the
  // message is NOT in a thread, which is what selects channel history over thread replies.
  const parentTs = event!.thread_ts ? String(event!.thread_ts) : undefined;
  const history = await fetchSlackContext({
    channel,
    threadTs: parentTs,
    botToken: env.SLACK_BOT_TOKEN,
    agentId: effectiveAgentId,
    huddleId,
  }).catch(() => []);

  const turn = await runHuddleAgentTurn({
    text: String(event!.text),
    agentId: effectiveAgentId,
    eventId: String(body.event_id ?? `${channel}-${String(event!.ts)}`),
    env,
    history,
    huddleId,
  });
  if (!turn.ok) return { handled: false, reason: turn.reason };

  // Reply in the thread the person started. `thread_ts` when they were already in a thread, else
  // the message's own `ts`, which OPENS a thread under it — so an agent answer never fills the
  // channel's main timeline.
  const threadTs = String(event!.thread_ts ?? event!.ts);
  const posted = await postSlackReply({
    channel, threadTs, text: turn.text, botToken: env.SLACK_BOT_TOKEN,
  });
  return posted.ok ? { handled: true } : { handled: false, reason: posted.reason };
}

/**
 * The route handler.
 *
 * ACK FIRST, WORK AFTER. Slack retries anything it cannot get an answer to inside 3 seconds, and an
 * agent turn takes far longer than that, so the reply is produced in `waitUntil` after the 200 has
 * already gone back. The trade-off is deliberate and worth stating: a failure AFTER the ack is not
 * retried by Slack. That is the right side of the trade, because the alternative — holding the
 * connection open — guarantees a retry storm on every single message, each one a duplicate turn.
 */
export async function handleSlackEvents(
  request: Request,
  env: SlackEventsEnv,
  // `Pick<ExecutionContext,…>` rather than a hand-written `{ waitUntil(p): void }`. Two reasons,
  // and the second is the one worth recording: it is the REAL Cloudflare type narrowed to the one
  // member this function uses, so it cannot drift from the runtime's actual signature; and a method
  // signature written inline (`waitUntil(p: Promise<unknown>): void`) is indistinguishable from a
  // CALL to `waitUntil` under scripts/undef-check.mjs's call regex, which flagged it as an undefined
  // symbol and failed CI. That is a blind spot in the checker (a type position is not a call site) —
  // tracked in .claude/actions.md — but the real type is the better spelling regardless, so this is
  // a correction rather than a workaround.
  ctx: Pick<ExecutionContext, 'waitUntil'>,
): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const raw = await request.text();
  const verdict = await verifySlackSignature(
    raw,
    request.headers.get('x-slack-request-timestamp'),
    request.headers.get('x-slack-signature'),
    env.SLACK_SIGNING_SECRET,
  );
  if (!verdict.ok) {
    // Deliberately terse on the wire. Naming which check failed tells someone probing this URL how
    // to get closer; the reason is useful in `wrangler tail`, not in the response.
    console.log(`[slack-events] refused: ${verdict.reason}`);
    return new Response('unauthorized', { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return new Response('bad request', { status: 400 });
  }

  // One-time handshake when the URL is first pasted into Slack. Signed like everything else, so it
  // is verified above rather than special-cased ahead of the signature check.
  if (body.type === 'url_verification') {
    return new Response(JSON.stringify({ challenge: body.challenge }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (body.type === 'event_callback') {
    ctx.waitUntil(
      processMessageEvent(body, env)
        .then((r) => { if (!r.handled) console.log(`[slack-events] skipped: ${r.reason}`); })
        .catch((e) => console.log(`[slack-events] failed: ${e instanceof Error ? e.message : e}`)),
    );
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
