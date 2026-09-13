<!--
WHAT:       The Slack app's Event Subscriptions Request URL before and after the n8n cutover, so a
            rollback or a reuse never depends on anyone remembering it.
WHY:        The owner asked for the original to be saved "in case we forget and need to roll back or
            use elsewhere in the future". The old URL exists in exactly one place once Slack's form is
            overwritten -- nowhere. n8n's webhook id is in docs/n8n-exports/, but the full URL was NOT
            derivable from it: the live value carries a trailing path segment the export does not show
            (see "an inference that was nearly right" below).
SUPERSEDES: nothing.
SUPERSEDED-BY: nothing -- current.
EVIDENCE:   Owner-supplied, 2026-09-13, after making the change in the Slack UI.
-->

# Slack Event Subscriptions — Request URL, before and after

**App:** `Custom n8n to EDS Comms` — App ID **`A093F91755X`**, workspace `T0934TLA8F2` (EDS).
Confirmed from the live API, not only the UI: `bots.info` for `B0931QP844A` returns that app id.

Settings page: `https://api.slack.com/apps/A093F91755X/event-subscriptions`

## BEFORE — n8n (owner-supplied verbatim, 2026-09-13)

```
https://edsdevn8n.app.n8n.cloud/webhook/838957ef-b9c8-43ca-9d4e-f390e366b8c0/webhook
```

## AFTER — journey's Cloudflare Worker (live)

```
https://twilio-openai-bridge.purple-bush-495e.workers.dev/slack/events
```

## To roll back

Paste the BEFORE value into the settings page above and save. Slack re-verifies on save by POSTing a
signed `url_verification` challenge, so the target must be live and answering at that moment — an n8n
workflow that has since been deactivated will make the save FAIL, which is a rollback prerequisite
worth knowing before you need it in a hurry.

## An inference that was nearly right, which is why this file exists

From `docs/n8n-exports/slack-comms-tool-inbound.json` the trigger's `webhookId` is
`838957ef-b9c8-43ca-9d4e-f390e366b8c0`, and I reconstructed the URL as
`https://edsdevn8n.app.n8n.cloud/webhook/838957ef-b9c8-43ca-9d4e-f390e366b8c0` — correct host,
correct id, **missing the trailing `/webhook` segment**. Close enough to look right and wrong enough
to fail. *A reconstructed credential-or-endpoint is a guess wearing the costume of a fact; record the
real string while someone can still read it off the screen.*

## Related

- The URL swap is automatable end to end — `slack-manifest-apply.yml` in `eds-claude-skills`
  (PR #85) applies it through `apps.manifest.update`. It needs one bootstrap: a config token
  generated once in the Slack UI, because `tooling.tokens.rotate` refreshes a token and cannot mint
  the first one.
- The `Verification Token` on that credentials screen was exposed in a screenshot on 2026-09-13 and
  should be regenerated. Our route does not use it (`verifySlackSignature` checks the v0 HMAC signing
  secret only), so `/slack/events` is unaffected.
