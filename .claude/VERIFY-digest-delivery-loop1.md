# VERIFY-digest-delivery-loop1

# WHAT:       Independent verification of the digest-delivery work (journey + Huddle), loop 1.
# WHY:        Implementing session made 10 claims; none are evidence until re-run from scratch.
# SUPERSEDES: nothing
# SUPERSEDED-BY: nothing -- current
# EVIDENCE:   this file; commands + raw output inline

Verifier has NO shared context with the implementer. Branch `claude/huddle-workflows-setup-cucecs`
in both repos. journey HEAD affcb24, huddle HEAD 100e849.

STATUS: IN PROGRESS

## CLAIM 2 — `userChannels` read-and-never-used at notification-scheduler:523

**VERDICT: CONFIRMED (the line is exactly as claimed; one wording nuance).**

```
$ grep -n "userChannels" supabase/functions/notification-scheduler/index.ts
523:      const userChannels = prefs?.channels || ['WEB_PUSH', 'IN_APP'];
```
ONE occurrence in the whole file: assigned, never read. `sed -n '525,537p'` shows the very next
statement invokes `send-push-notification` with a body of `{userId,title,body,data}` and **no
`channels` field at all**. So the user's stored channel preference is discarded in the same
function that reads it, and push is unconditional.

NUANCE the implementer's header comment gets loose: line 523 is inside
`processPendingNotifications` (defined :491), **not** inside `generateDailyDigest` (:353). The
attribution is still substantively right — `generateDailyDigest` (:353) only BUILDS a row that
:171-176 inserts into `scheduled_notifications`, and :491+ is the function that later delivers
those rows — so the daily digest does travel through :523. But "notification-scheduler's
`daily_digest` reads the user's channel preference at :523" describes a delivery loop shared by
every scheduled notification, not a digest-specific line. Not a defect; a precision note.

## CLAIM 3 — no `callConfig.context` interpolated into read-channel bodies

**VERDICT: CONFIRMED for the email path.**

`supabase/functions/notification-delivery/index.ts:279-295`: the unified (slack+email) invoke's
`body:` is `renderScheduledCall({callName, context, channel:'email'}).body`.
`_shared/digest-content.ts:576-604` `renderScheduledCall`: for `phone` it returns
`` `${subject}. ${input.context}` ``; for every other channel it returns **`` `${subject}.` ``** —
`input.context` is not referenced on that branch at all. Email body is therefore
`"Time for your <call name>."` and structurally cannot carry the script.
`grep -n "Time for your \${" notification-delivery/index.ts` → no hits (old :239 line is gone).

CAVEAT the claim does not cover — the `app_message` read channel still forwards the raw script:
`notification-delivery/index.ts:247-256` invokes `send-chat-message` with
`generateFromContext: { callType, context: callConfig.context || '' }`. That is a different
mechanism (an LLM generates the message from the script rather than the script being the body),
but `callConfig.context` does still leave this function toward a channel a human reads.
`renderScheduledCall` is not applied there. Non-blocking for the email claim as stated.

## CLAIM 1 — all three digests wired and reachable from `send-digests/index.ts`

**VERDICT: REFUTED on both halves ("all three" and "reachable").**

### 1a. Wired? Only when INTEGRATED. Standalone journey sends TWO of three.

`send-digests/index.ts:161` `const standupSource = resolveDigestSource("standup", integrated);`
`send-digests/index.ts:212` `if (standupSource === "huddle") {`
`_shared/digest-source.ts:61`  `if (!integrated) return "journey";`

So when `integrated === false`, `standupSource === "journey"`, the `=== "huddle"` test is false,
and the **entire stand-up block is skipped**. There is no `else`. No stand-up is produced, and —
unlike every other skip in this file — **no outcome row is pushed either**, so the run report shows
the user got two digests with no record that a third was silently dropped.

There is no journey-side stand-up producer to fall into:
```
$ grep -n "^export" supabase/functions/_shared/digest-source-standup.ts
21: HuddleStandupContent   29: HuddleStandupResponse   46: fetchHuddleStandup
92: toStandupPayload       109: standupDigestIsEmpty   125: loadStandupDigestPayload
```
Every one of those is a Huddle fetch or a shape over a Huddle response. `grep -rn "standup"
supabase/functions/_shared/*.ts` finds no other loader.

This directly contradicts `digest-source.ts:52-53`, which asserts in prose:
> "Standalone journey answers every digest from itself -- **including the stand-up**, whose content
> is then whatever journey can say about the day, because there are no agents to report on."

Nothing implements that sentence. **AC-INT-2 ("integration OFF, journey alone delivers all three")
is UNMET.** Merge-blocking if standalone journey is in scope; if the owner's deployment is always
integrated it is a documentation lie rather than a live defect — but the prose claims otherwise.

### 1b. Reachable? NO — the function has no trigger and would 401 if given one.

```
$ grep -rn "send-digests" --include=*.toml --include=*.sql --include=*.yml . | grep -v send-digests/index.ts
(no hits)
$ grep -n "send-digests" supabase/config.toml ; echo "exit=$?"
exit=1
$ grep -c "^\[functions\." supabase/config.toml
44
```
- **No `cron.schedule` migration exists.** `send-digests/index.ts:16` states "TRIGGER: cron every 15
  minutes (TICK_WINDOW_MINUTES)". There is no such cron anywhere in `supabase/migrations/`. Twelve
  other migrations do contain `cron.schedule`; none names this function.
- **No `[functions.send-digests]` block in `supabase/config.toml`**, so it deploys with Supabase's
  default `verify_jwt = true`. Every cron-pinged function in this repo explicitly opts out —
  e.g. `[functions.drain-huddle-turns] verify_jwt = false` — and the matching cron
  (`20260714120000_drain_huddle_turns_cron.sql`) posts with only `Content-Type`, no Authorization.
  A cron added in that same shape against `send-digests` would be rejected 401.

So as committed, the digest run fires only if a human invokes it by hand with a JWT.
**Merge-blocking.**

## CLAIM 4 — the source switch implements the owner's ruling

**VERDICT: CONFIRMED as a pure function; see CLAIM 1a for the consumer that ignores half of it.**

`_shared/digest-source.ts:60-66`:
```
export function resolveDigestSource(digest: DigestName, integrated: boolean): DigestSource {
  if (!integrated) return "journey";
  return digest === "standup" ? "huddle" : "journey";
}
```
Standalone → journey for all three. Integrated → journey for daily_brief and meetings, huddle for
standup. Exactly the ruling. Tested in `src/utils/digestSourceStandup.test.ts:66,73,74,78`
(loops all three names for standalone; asserts each of the three for integrated), and
`isHuddleIntegrated` is tested for url-only, token-only, whitespace and empty at :55-61.

TWO defects around it, neither claimed:
- The EVIDENCE header at `digest-source.ts:12` cites `src/utils/digestSource.test.ts`.
  `ls src/utils/digestSource.test.ts` → **No such file or directory.** The tests are really in
  `digestSourceStandup.test.ts`. A provenance literal that does not match the thing it names.
- `send-digests/index.ts:166` and `:190` read `resolveDigestSource("daily_brief"|"meetings",
  integrated) === "journey"` — a condition that is **true for every possible input**, since the
  function can only return "huddle" for "standup". Two always-true branches.

## CLAIM 9 — full journey suite passes, nothing skipped

**VERDICT: CONFIRMED.**
```
$ npm test   # node --experimental-strip-types --test src/utils/*.test.ts
# tests 150
# suites 39
# pass 150
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 727.353651
```

## CLAIM 10 — `npx tsc --noEmit`

**VERDICT: CONFIRMED clean — but it does not cover the code this work is made of.**
```
$ npx tsc --noEmit ; echo exit=$?
exit=0     (zero lines of output)
```
Scope caveat, from the configs themselves:
- `tsconfig.json` is `"files": []` + project references only.
- `tsconfig.app.json` → `"include": ["src"]`, `"strict": false`, and root `strictNullChecks: false`.
- `tsconfig.node.json` → `"include": ["vite.config.ts"]`.

**`supabase/functions/` is in NO include list, so not one line of the edge-function code — where
`send-digests`, `digest-delivery`, `digest-source*`, `digest-content` and the meetings classifier
all live — is typechecked by this command.** `deno` is not installed (`which deno` → nothing), so
no Deno type check was run either. The `_shared/*` modules are at least *executed* by the node
tests (they are imported directly, e.g. `digestDelivery.test.ts:16`), but
`send-digests/index.ts` is imported by nothing and is neither typechecked nor executed anywhere.

