# WHAT:       Independent verification of the outbound Slack transport in notify.ts
# WHY:        Implementer claims 21/21 tests pass and several security/correctness properties hold
# SUPERSEDES: nothing -- current
# EVIDENCE:   this file
# SUBJECT:    /home/user/journey-voice/cloudflare/src/notify.ts, commits 2350420 / 56381c8
#             branch claude/huddle-journey-integration-xokgv1

Verifier: independent subagent, no shared context with implementer.

## C1 — suite passes 21/21

**Command:**
```
cd /home/user/journey-voice/cloudflare && npx tsx --test src/notify.test.ts
```

**Output (tail):**
```
1..21
# tests 21
# suites 0
# pass 21
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 333.594827
```

**VERDICT: CONFIRMED.** 21/21 pass, 0 fail, 0 cancelled, 0 skipped. Matches the claim exactly.

---

## C2 — sendSlack prefers bot token over ANY webhook (caller webhook + env webhook both present)

**Independent probe** (own fetch mock, not the test file's `captureFetch`):
`/tmp/.../scratchpad/probe-c2c6.mjs` — `env` set `SLACK_BOT_TOKEN`, `SLACK_WEBHOOK_URL` (env
default), AND `slackWebhook` (caller-supplied) simultaneously, with a `slackChannel` set.

**Observed:**
```json
{ "status": "sent", "callCount": 1, "urlHit": "https://slack.com/api/chat.postMessage" }
```

Exactly one outbound fetch, and it went to `chat.postMessage` — never a hooks URL, with both a
caller webhook and an env webhook available to fall back to. Read against the source: `sendSlack`
checks `if (env.SLACK_BOT_TOKEN) return sendSlackViaBot(...)` before any webhook logic runs at all,
so the webhook branch is provably unreachable whenever a bot token is set.

**VERDICT: CONFIRMED.**

---

## C3 — HTTP 200 + `{"ok":false,"error":"not_in_channel"}` reported as failure, error preserved

**Independent probe:** own fetch mock returns `new Response(JSON.stringify({ok:false,error:'not_in_channel'}), {status:200})`.

**Observed:**
```json
{
  "overallHttpStatus": 207,
  "resultOk": false,
  "resultStatus": "failed",
  "detail": "chat.postMessage C0X: not_in_channel",
  "delivered": false
}
```

`res.ok` on the raw fetch Response would have been `true` (HTTP 200) — the code does NOT trust it;
`sendSlackViaBot` parses the JSON body and branches on `data.ok`, which was `false`. `not_in_channel`
survives verbatim into `detail`. Top-level `NotifyResponse.delivered` is `false` and the endpoint's
overall HTTP status is 207 (partial), not 200. If `res.ok` were trusted instead, this would have
reported `status:'sent'` with HTTP 200 and `delivered:true` — a real auth/channel failure disguised
as success. Confirms the claim exactly as stated, for the reason stated.

**VERDICT: CONFIRMED.**

---

## C4 — `channel`/`thread_ts` reach Slack on both transports; GET accepts canonical AND aliased param names

**Code read first** (`handleNotify`, GET branch):
```js
slackChannel: q.get('slackChannel') ?? q.get('channel') ?? undefined,
slackThreadTs: q.get('slackThreadTs') ?? q.get('thread_ts') ?? undefined,
```
So `slackChannel`/`slackThreadTs` are tried first, falling back to bare `channel`/`thread_ts`.

**Independent probe, three separate calls, each with `slackChannel`/`slackThreadTs` set,
GET-canonical, and GET-alias, capturing the actual outgoing `chat.postMessage` body:**
```json
"postBody":      { "channel": "C0POST",  "thread_ts": "111.222" }
"getCanonical":  { "channel": "C0GET1",  "thread_ts": "222.333" }   // slackChannel/slackThreadTs params
"getAlias":      { "channel": "C0GET2",  "thread_ts": "333.444" }   // channel/thread_ts params
```
All three distinct channel/thread values arrived intact in the JSON POST body sent to Slack. Both
GET parameter-name variants (canonical and alias) worked, matching the `??` fallback read from source.

**VERDICT: CONFIRMED.**

---

## C5 — bot token, no channel, no `SLACK_DEFAULT_CHANNEL` → `not_configured`, ZERO HTTP requests

**Independent probe:** fetch mock records every call; `env = {JOURNEY_PROXY_TOKEN, SLACK_BOT_TOKEN}`
only (no `slackChannel` in the request, no `SLACK_DEFAULT_CHANNEL` in env).

**Observed:**
```json
{ "status": "not_configured", "callCount": 0, "delivered": false }
```
`callCount: 0` — the fetch mock's own call-recording array stayed empty, proving no HTTP request
of any kind was attempted (not just that the *result* looked right). Matches source: the channel
check happens before the `fetch()` call in `sendSlackViaBot`.

**VERDICT: CONFIRMED.**

---

## C6 — webhook path with channel/threadTs supplied → success detail states they were ignored

**Independent probe:** `env` has `SLACK_WEBHOOK_URL` only (no bot token); request carries both
`slackChannel` and `slackThreadTs`.

**Observed:**
```json
{
  "status": "sent",
  "detail": "webhook 200 — channel and thread_ts IGNORED: a webhook cannot target a channel or thread",
  "urlHit": "https://hooks.slack.com/services/DEFAULT",
  "bodySent": { "text": "" }
}
```
The outgoing webhook body carries only `text` — no channel/thread field exists on the Slack
Incoming Webhook payload shape, confirming a webhook is structurally incapable of honoring them.
The success detail names both dropped fields explicitly (`channel and thread_ts IGNORED`), so a
caller reading the result cannot mistake this for a correctly targeted, threaded send.

**VERDICT: CONFIRMED.**

---
