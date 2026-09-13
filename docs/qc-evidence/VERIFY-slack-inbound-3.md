# VERIFY-slack-inbound-3

Independent verifier, loop 3. Budget: 18 min from 2026-09-13T16:49:39Z (hard stop 17:07:39Z).
Prior loops 1/2: all-CONFIRMED. This loop re-checks everything against the changed code
(commits 4479276, 38e75e6) and adds N1-N5.

(in progress -- committed incrementally per claim)

## Cheap suite (floor under everything else)

**C3** — `node scripts/undef-check.mjs --all`:
```
undef-check: 82 file(s) checked, 0 NEW undefined symbol(s), 0 known, 0 not analysable
```
Exit 0. CONFIRMED.

**C4** — `cd cloudflare && npx tsx --test src/slack-events.test.ts`:
```
1..31
# tests 31
# pass 31
# fail 0
```
Matches expected 31. CONFIRMED.

## C7 — typecheck

`cd cloudflare && npx tsc --noEmit -p .` produces errors, but filtering for the two files this claim
covers (`grep -E '^src/(slack-events\.ts|index\.ts)'`) returns **zero lines**. All errors are in
`TwilioCallSession.ts` (pre-existing, unrelated) and in `*.test.ts` files (missing `@types/node`
declarations for `node:test`/`node:assert` — a tsc config gap, not a code defect; the tests
themselves run and pass fine under `tsx --test`, confirmed by C4). CONFIRMED for the claimed scope
(slack-events.ts, index.ts): 0 errors.

## C1 — undef-check.mjs untouched by this work

`git log --oneline -- scripts/undef-check.mjs` last touched at `8fc7f73` (unrelated, pre-Slack).
`git log --oneline 2479926..HEAD -- scripts/undef-check.mjs` returns **empty** — the guard script
itself was not modified anywhere in the Slack commit range. CONFIRMED, checked against the file's own
git log as instructed (not a diff against origin/main).

## Blast radius challenge

`git diff --stat 2479926..HEAD`:
```
 .claude/accuracy-log.md                    |  68 ++++
 .claude/actions.md                         | 481 +++++++++++++++++++++++++++++
 .claude/memory.md                          |  90 ++++++
 cloudflare/src/slack-events.test.ts        | 136 ++++++++
 cloudflare/src/slack-events.ts             | 140 ++++++++-
 docs/qc-evidence/VERIFY-slack-inbound-3.md |  24 ++
 docs/slack/ROLLBACK-event-subscriptions.md |  57 ++++
```
Matches the stated radius exactly: only `slack-events.ts`/`slack-events.test.ts` changed in
`cloudflare/`, nothing in `scripts/`, `index.ts` untouched (consistent with C1). I do not challenge
the radius — it is accurate. No hidden change outside it.

## N1 — three-way split is not a catch-all (MUTATION-PROVED)

Guard at slack-events.ts:318: `if (!agentId && !conv.isIm) return { handled: false, reason:
'channel_is_not_an_agent_lane' };`. Mutated to `if (false) return {...}` (never refuses) via
`mutate.sh`, git tree clean before/after:
```
FIRED: 'AC-S11c' failed with the defect reinstated. The guard is real.
restored: cloudflare/src/slack-events.ts matches HEAD
tree clean: 'AC-S11c' passes again on the restored tree
```
A channel that is neither a named lane nor a DM (`general`, `is_im:false`) is provably still
rejected — turning the guard permissive breaks AC-S11c. CONFIRMED by mutation, not by reading.

## C5 — bot-loop guard, re-run at FULL DEPTH (MUTATION-PROVED)

`if (event.bot_id) return false;` mutated to `if (false && event.bot_id) return false;`:
```
FIRED: 'infinite-loop guard' failed with the defect reinstated. The guard is real.
restored: cloudflare/src/slack-events.ts matches HEAD
tree clean: 'infinite-loop guard' passes again on the restored tree
```
CONFIRMED at full depth as instructed (this claim never drops depth).

## C2 — symbols guard catches a genuinely undefined symbol (MUTATION, FULL DEPTH)

Inserted a real call to an undefined identifier (`totallyUndefinedSymbolXYZ();`) into
`processMessageEvent`, ran `node scripts/undef-check.mjs --all`:
```
undef-check: 82 file(s) checked, 1 NEW undefined symbol(s), 0 known, 0 not analysable
UNDEFINED SYMBOLS — ...
  cloudflare/src/slack-events.ts:310  totallyUndefinedSymbolXYZ
exit=1
```
Restored via `git checkout --`, confirmed `git diff --quiet` clean, re-ran: `0 NEW undefined
symbol(s)`, exit=0. CONFIRMED at full depth (this claim never drops depth, per instructions).

## C6 — signature verification fails closed (direct execution, not just the test suite)

Called `verifySlackSignature` directly via `tsx`, bypassing the test file entirely:
```
verifySlackSignature('{}', '1', 'v0=aa', undefined)  -> {"ok":false,"reason":"signing_secret_not_configured"}
verifySlackSignature('{}', '1', 'v0=aa', '')          -> {"ok":false,"reason":"signing_secret_not_configured"}
```
CONFIRMED for both undefined and falsy-empty-string secret — no accidental fail-open on either shape.

## N2 — a DM sends neither `members` nor `scope` (verified from the actual request body)

Called `runHuddleAgentTurn({agentId: null, ...})` directly with a stubbed `fetch`, inspected the
REAL serialized JSON body sent to Huddle:
```
has members key: false
has scope key: false
raw: {"text":"dm text","huddleId":"slack-dm-U1","history":[{"id":"x"}],"idempotencyKey":"Ev1"}
```
Keys are genuinely absent (not merely `undefined`), confirming Huddle's own router picks the agent.
CONFIRMED, from the wire body, not from reading the source.

## N3 — no fabricated agentId can reach Huddle from a DM

Called `fetchSlackContext({agentId: null, ...})` directly against a stubbed Slack response
containing a bot-authored line, inspected the real output:
```
{ "author": { "kind": "system" }, "text": "a bot line with no channel agent", ... }
any fabricated agent kind: false
```
With no channel-derived agent, the bot's own line is recorded as `kind:'system'`, never
`kind:'agent'` with an invented id. Also traced: `agentIdFromChannelName` returns `null` for any
input without a `___` separator, and a Slack DM has no `name` field at all (confirmed by reading
`lookupConversation`: `name: typeof data.channel?.name === 'string' ? ... : null`), so there is no
path in a DM by which a real-but-wrong agentId is derived either — the value is structurally null,
not merely unset. CONFIRMED.

## N4 — a failed context fetch never costs the reply (stronger than the shipped test)

The shipped AC-S10e only exercises Slack answering `ok:false`. I additionally made `fetch` THROW a
real exception for `conversations.history`/`conversations.replies` (simulating a genuine network
failure, not just a Slack-side error body) and ran `processMessageEvent` directly:
```
{"handled":true}
turn still called Huddle: true
reply still posted: true
```
The `.catch(() => [])` around `fetchSlackContext` in `processMessageEvent` (line ~333) absorbs a
thrown exception, not only an `ok:false` response. CONFIRMED, and this is a wider test than the one
already in the suite.

## C8 — no unauthenticated path reaches a Huddle agent turn (RE-TRACED, branch gained)

Traced the full call graph by grep, not assumption:
```
processMessageEvent callers (excl. test):  only slack-events.ts:410, inside ctx.waitUntil(...)
runHuddleAgentTurn callers (excl. test):   only slack-events.ts:335, inside processMessageEvent
handleSlackEvents callers (excl. test):    only index.ts:46, the '/slack/events' route
index.ts routes:                           /health, /notify, /slack/events, /call  -- no other
                                            route touches processMessageEvent/runHuddleAgentTurn
```
And re-read `handleSlackEvents` line order: `request.text()` → `verifySlackSignature(...)` → if
`!verdict.ok` return 401 **before any JSON.parse, before `url_verification` handling, before
`event_callback` dispatch**. The gained branch (DM vs lane vs neither) lives entirely inside
`processMessageEvent`, which is only ever reached after the signature gate passes. There is exactly
one entry point (`/slack/events`), exactly one authentication gate, and it runs before any body
parsing. CONFIRMED — the DM branch did not open a second, ungated path.

## N5 — adversarial + reviewer read of `processMessageEvent` and `fetchSlackContext`

Read both functions in full as an attacker and as a reviewer. Findings:

1. **No secret or raw body is ever logged.** `grep -n "console\." src/slack-events.ts` shows exactly
   three log lines, and all three log either a fixed reason-enum string (`verdict.reason`,
   `r.reason`) or a caught exception's `.message` — never `env.JOURNEY_PROXY_TOKEN`,
   `env.SLACK_SIGNING_SECRET`, `env.SLACK_BOT_TOKEN`, or the raw request body. No credential-leak
   path found.
2. **No loop risk beyond the already-mutation-proved guard** (C5/N1 above) — one `postSlackReply`
   call per handled event, no recursive dispatch.
3. **Unbounded `text` forwarded to Huddle: PRE-EXISTING, not introduced by this loop's blast radius.**
   `text: String(event!.text)` has no length cap. Checked whether this is new:
   `git show 2479926:cloudflare/src/slack-events.ts | grep "text: String(event"` shows the identical
   line already present at the commit this loop's diff starts from. Not a new defect from commits
   4479276/38e75e6 — reporting it as an existing observation, not a loop-3 regression to block on.
4. **Coverage gap, not a security hole: multi-person DMs (`is_mpim`) are not distinguished from
   `is_im`.** `lookupConversation` only reads `channel?.is_im`; a Slack group-DM channel has no
   `name` and (per Slack's API) is NOT `is_im`, so it would fall through to
   `channel_is_not_an_agent_lane` and be silently ignored rather than routed as a DM. This is the
   SAFE direction (fails closed / under-covers rather than over-grants) and matches the file's own
   stated philosophy ("sending a random channel's chatter to an arbitrary agent is worse than
   ignoring it") — noting it as a functional gap for the owner to decide on, not a defect.
5. **No unbounded fan-out to Slack itself.** `conversations.history`/`conversations.replies` both
   pass `limit` (default 12) as a real Slack API query param, and the output is additionally sliced
   to `-limit` client-side — double-bounded.
6. **Nothing found that lets a channel the bot merely sits in (not a lane, not a DM) drive an agent
   turn** — this is exactly what N1's mutation test above disproves for the guard, and I traced no
   second path around it.

No new exploitable defect found. Two observations recorded above (3: pre-existing unbounded text,
4: mpim gap) are informational, not blocking.
