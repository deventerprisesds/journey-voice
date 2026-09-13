# n8n Slack workflow exports — reference only, NOT running code

## WHAT
The two n8n workflows that carried journey/Huddle Slack traffic before the migration off n8n,
exported 2026-09-13 and kept here so the contract they implement survives n8n itself.

| File | n8n name | Direction | Nodes |
|---|---|---|---|
| `slack-comms-tool-inbound.json` | Working Slack Comms Tool copy | **Inbound** — Slack → agents | 50 |
| `slack-outgoing-message-huddle.json` | Slack Outgoing Message Huddle | **Outbound** — agents → Slack | 86 |

## ⚠️ CREDENTIALS ARE REDACTED — these will not run as-is
The outbound export contained a **live `xoxp-` Slack user token**, hardcoded as an inline header
parameter on the (disabled) `HTTP Request` node rather than stored as an n8n credential, so it
travelled with the file. It is replaced here by `REDACTED-SLACK-TOKEN-SEE-README`.

**That token must be treated as compromised and revoked** — it existed in plaintext in a file that
was uploaded and copied. Revoke at api.slack.com/apps → OAuth & Permissions.

Redaction covered every Slack credential shape (`xoxb/xoxp/xoxa/xoxr/xapp`) and
`hooks.slack.com/services/...` webhook URLs, not only the one shape observed — a second export
could carry a different one, and redacting only what you happened to see is the single-grep
mistake. Both files still parse as JSON after redaction; that is asserted, not assumed.

## WHY these are worth keeping
They are the only written record of how Slack actually worked. Three facts that are not obvious
from anywhere else in this repo:

**1. Two different mechanisms, one per direction.** Not one "Slack integration".

```
INBOUND    Slack Events API ──POST every event──> n8n slackTrigger (creds: slackApi)
           trigger: any_event, watchWorkspace: true, resolveIds: true
           carries channel, thread_ts, user, text

OUTBOUND   n8n ──chat.postMessage (creds: slackOAuth2Api)──> Slack Web API
           channelId per message + thread_ts   -- NOT an incoming webhook
```

An Incoming Webhook posts to ONE fixed channel and cannot thread. The outbound half was never a
webhook, so "swap the URL" is not a migration path for it.

**2. Agent identity comes from the CHANNEL NAME, not the message.** `Extract handle from channel`
splits `flex-grimes___fitness_trainer` on `___` then `-` to get `flex`, falling back to a substring
scan over 16 handles: `cole compass eli elle ezra faith finn iris liam sam tess troy terry flex
charleston cam` — the same roster Huddle carries in `agents.ts`.

**This shape is forced by the Slack free plan, not a stylistic choice.** Free workspaces allow 10
apps/integrations and **each bot user counts as one**. Sixteen agents as sixteen bots is impossible;
one app + one bot + per-agent channels is what fits. Any replacement must keep it.

**3. The sub-workflow input contract** (`executeWorkflowTrigger`) — what any replacement must
produce: `output, channel, thread_ts, thread_id, sender, channel_resolved, target_recipient,
bot_id, sessionId, messageComplexity`.

## A live bug preserved in the export, for the record
`To Charleston (Chef)` and `To Charleston (Cole)` **both** test `handle.includes("flex")` —
copy-pasted from `To Flex` and never edited. Charleston and Cole can therefore never be selected on
their own, and both fire whenever Flex is targeted. Left as-is: this is a faithful export, not a
corrected one.
