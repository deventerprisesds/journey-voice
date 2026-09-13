<!--
WHAT:          implementation log for section C (AC-CH-*) of the digest work --
               channel fan-out: canonical vocabulary (F3), honest partial-failure
               recording (F2), and multi-select channels.
WHY:           .claude/AC-digest-delivery.md F2/F3 document two live defects; this
               file records what was changed to close them and the evidence for each.
SUPERSEDES:    nothing
SUPERSEDED-BY: nothing -- current
EVIDENCE:      every row cites the file:line read or the test that observes it.
-->

# IMPL — channel fan-out (AC-CH-1..4, F2, F3)

Branch `claude/huddle-workflows-setup-cucecs`. **Not merged, not deployed** — edge functions
auto-deploy on push to `main`, so this stays on the feature branch.

## Ground truth established before writing anything

**The canonical vocabulary is UPPERCASE, settled by reading every call site — not by
picking the cheaper edit.**

| Caller | channels sent | case |
|---|---|---|
| `NotificationSettings.tsx:543,558,571,587,611` | `['EMAIL']`,`['OUTLOOK_EVENT']`,`['GOOGLE_EVENT']`,`['SLACK']` | UPPER |
| `NotificationStatusDashboard.tsx:183` | `[channel.toUpperCase()]` | UPPER (explicitly) |
| `useNotifications.tsx:382` | `['EMAIL']` | UPPER |
| `execute-tool:1539,1753,1785,1828,1883` | `['OUTLOOK_EVENT']`,`['EMAIL']`,`['SLACK']`,`['GOOGLE_EVENT']` | UPPER |
| `create-test-task:254` | `user_preferences.channels` or `['EMAIL','SLACK','PUSH']` | UPPER |
| `assistant-actions-webhook:74,85,98` | `['SLACK']`,`['EMAIL']`,`['GOOGLE_EVENT','OUTLOOK_EVENT']` | UPPER |
| `notification-delivery:673,733` (batch path) | `['PUSH','OUTLOOK_EVENT','GOOGLE_EVENT']`, `['SLACK','EMAIL',…]` | UPPER |
| **`notification-delivery:240` (scheduled call)** | **`[commsMode]` = `'slack'`/`'email'`** | **lower — the F3 bug** |
| **`twilio-voice-handler:1757`** | **`fallbackMode === 'email' ? 'email' : 'SLACK'`** | **lower — a SECOND, unbriefed instance** |

So `notification-delivery`'s own two paths disagreed with each other, and the AC's F3 was
under-counted: the missed-call fallback in `twilio-voice-handler` has the same defect.
`user_preferences.channels` stores UPPERCASE, so lowercasing would have required a data
migration. UPPERCASE wins on evidence.

### Correction to F2 (observation, from reading `:659`)

The AC says *"`:659` returns **207 Multi-Status** on partial success"*. **It does not.**
`status: result.success ? 200 : 207` with
`result.success = channelSuccesses.length > 0 || result.errors.length === 0` means a
**partial fan-out returned HTTP 200**, and 207 was returned only when *nothing* succeeded.
The consequence the AC describes is right and is worse than stated: partial success was
indistinguishable from full success at the HTTP layer, so no caller could have detected it
even by checking the status code. The fix therefore cannot rely on the status code alone —
it reads the per-channel results from the body.

## Chunk 1 — the one canonical module + the sender

**New:** `supabase/functions/_shared/notification-channels.ts` (the only new file).
`CANONICAL_CHANNELS`, `toCanonicalChannel`, `normalizeChannels`, `channelResultKey`,
`summarizeDelivery`, `isFullDelivery`. `channelResultKey` matches the keys the sender
*already writes* (`channel.toLowerCase()` at `:880/:908/:918/:926`, `outlook`/`google` at
`:469/:523`) rather than inventing a second result shape.

**Changed:** `send-unified-notification/index.ts`
- destructures `channels: rawChannels`, then `const channels = normalizeChannels(rawChannels)`
  — one normalisation point fixes **every** caller's case, including the two lowercase ones
  above, instead of each call site having to agree by hand.
- `result.success` now = every requested channel delivered (`isFullDelivery`). Partial and
  zero-channel fan-outs are no longer success. Body gains `outcome`/`perChannel`/`deliveryReason`.
- **Backwards compatible:** partial now returns 207 instead of 200, and 207 is still 2xx, so
  no existing caller's `functions.invoke` error-handling changes behaviour.

Verified importable by the repo's node test runner (`--experimental-strip-types`):
`normalizeChannels(['email','SLACK','bogus','email'])` → `["EMAIL","SLACK"]`;
partial → `"partial"`; zero channels → `"failed"`.
