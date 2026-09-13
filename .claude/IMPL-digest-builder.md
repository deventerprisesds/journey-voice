<!--
WHAT:          implementation record for the SHARED DIGEST CONTENT BUILDER in
               journey-voice -- what changed, and the observed evidence per AC.
WHY:           AC-digest-delivery.md sections A/B/D/E were signed off; this file
               is the RESULTS half, written as the work lands so a container
               reclaim costs one chunk rather than the pass.
SUPERSEDES:    nothing
SUPERSEDED-BY: nothing -- current
EVIDENCE:      command output pasted inline below, run 2026-09-13 on
               claude/huddle-workflows-setup-cucecs.
-->

# IMPL — shared digest content builder (journey-voice)

## Architecture decision: EXTENDED, not parallel

**I EXTENDED `supabase/functions/_shared/build-day-context.ts`.** The new module
`supabase/functions/_shared/digest-content.ts` imports `DayContext`,
`DayContextScheduleItem`, `DayContextPriorityItem` and `DayContextCalendarHold`
from it as **types only** and defines **no new `DayContext` shape** (AC-BUILD-1).

### Why the two existing copies were NOT merged into one

The AC doc calls `src/utils/buildDayContext.ts` a "303-line twin" of the shared
copy. Read side by side, they are **not twins — they have diverged**, and the
divergence makes a single file impossible today:

| | `_shared/build-day-context.ts` | `src/utils/buildDayContext.ts` |
|---|---|---|
| imports | **none** (self-contained, Deno-safe) | `@/types/task`, `@/utils/dailyReviewPipeline`, `@/lib/schedulingCandidates`, `@/lib/date` |
| `DayContextScheduleItem.score` | `number \| null` | `number` (non-null) |
| `DayContext` extra fields | — | `backlogOverdueCount`, `windowSummaries`, `explanations`, `missingExplanations`, `builderVersion` |
| scoring | reads `tasks.scheduling_context.score_breakdown` | calls `explainSchedulingScore()` |

Evidence: `diff supabase/functions/_shared/build-day-context.ts src/utils/buildDayContext.ts`
→ 4 Vite-aliased imports the Deno runtime cannot resolve, a widened field type,
and 5 client-only fields.

So merging them is a real refactor of the client's scoring pipeline, not a
delete — **out of scope for this pass and not attempted.** What this pass does
guarantee is the thing the AC actually protects against: **no third copy.**
`src/utils/buildDayContext.ts` was **not touched.**

Verification of the invariant (AC-BUILD-1):

```
$ grep -rln "interface DayContext " --include=*.ts . | grep -v node_modules
supabase/functions/_shared/build-day-context.ts
src/utils/buildDayContext.ts        # 2 -- unchanged, ≤2 required
$ grep -n "build-day-context" supabase/functions/_shared/digest-content.ts
28:} from "./build-day-context.ts";   # the digest imports, does not redefine
```

## Chunk 1 — `_shared/digest-content.ts` (new, 654 lines)

ONE builder, three payloads; one named renderer per channel; the timezone gate.

- **(a) daily brief** — `buildDailyBriefPayload(ctx, {deepLink})` → schedule +
  priorities (re-sorted rank ASC, nulls last) + calendar holds + deep link.
  The re-sort at the payload boundary is deliberate: AC-BUILD-2's stated trap is
  a test that passes because the DB query already ordered rows. Sorting here
  makes ORDER a property of this module, so a shuffled input proves the sort.
- **(b) meetings** — `DigestMeeting` / `MeetingAttendee` are the **INTERFACE the
  attendee-capture agent fills**; the classifier is theirs. `withPerson` is
  their verdict and this module **never infers it from `organizer`** (C8d: the
  user organises their own solo blocks). `withPerson === null` (unclassified) is
  **excluded, not assumed true** — absent evidence is never a pass.
  `meetingsDigestIsEmpty()` supports AC-MTG-4 (suppress rather than empty-state).
- **(c) stand-up** — `StandupDigestPayload` is the **shape only**. Huddle
  assembles it; journey renders and delivers it. Journey never builds one.

## Chunk 2 — timezone gate wired (AC-TZ-1/-3/-4/-5)

`notification-scheduler/index.ts`: both predicates now take the user's timezone.

```
- function shouldSendDailyDigest(now: Date): boolean {
-   return now.getHours() === 8 && now.getMinutes() < 15;      // 08:00 UTC = 4am ET
+ function shouldSendDailyDigest(now, timezone) {
+   return shouldSendAtLocalHour(now, timezone, DAILY_DIGEST_LOCAL_HOUR);
```

`shouldSendWeeklyDigest` fixed in the **same pass** (AC-TZ-3 — the brief omitted
it). Call sites `:171` / `:177` now pass `prefs.timezone`, a column already on
`NotificationPrefs`. DST is per-instant because `shouldSendAtLocalHour` reuses
`_shared/timezone.ts`'s `getTzOffsetMinutesAt` — **no second Intl path added.**

AC-TZ-3 observed:
```
$ grep -n "getHours()" supabase/functions/notification-scheduler/index.ts
202,280,337   # none inside a shouldSend* predicate -- see FINDING 1
399,403       # the two shouldSend* fns: now timezone-aware, no getHours()
```

## Chunk 3 — deep link (AC-LINK-1)

ONE new env var: **`APP_BASE_URL`**. **Must be set at deploy:**
`supabase secrets set APP_BASE_URL=https://<app-host>`.
`buildDeepLink()` **throws `MissingDeepLinkBaseError`** on empty, non-http, or
localhost bases — there is deliberately **no `?? "https://app.example.com"`
default**, which is the exact trap AC-LINK-1 names (it would make the failure
branch unreachable and ship a dead link). Callers record the run FAILED and send
nothing. Path `/priorities` verified at `src/App.tsx:102`.

---

## RESULTS (appended in the commit that acted on the outcome)

### Test suite — `src/utils/digestContent.test.ts` (new)

`npm test` → **83 tests, 83 pass, 0 fail** (30 of them this file's; the other 53
are the three pre-existing suites, still green).

| AC | Covered by | Observed |
|---|---|---|
| AC-BUILD-1 | grep invariant | `interface DayContext ` still in exactly **2** files; digest imports, defines none |
| AC-BUILD-2 | 3 tests | 3 schedule / 2 priorities rank-ASC / 1 hold, from a **deliberately shuffled** lane; null ranks last; caller's array not mutated |
| AC-BUILD-3 | 5 tests | all 4 read channels render `/\S/` and match no `undefined\|[object Object]\|NaN\|null`; empty state names its sections |
| AC-BUILD-4 | 1 test | email and push derive from ONE payload; order identical |
| **AC-REND-1 (Tier 1)** | 6 tests | email/app_message/push/slack exclude the real script by **identity** (`!body.includes(REAL_SCRIPT)`), not keyword; phone keeps it; a smuggled script **throws** |
| AC-REND-2 | 3 tests | 4 channel bodies pairwise distinct; push ≤ 300 chars incl. a 900-char title; email carries `http` |
| AC-REND-3 | 1 test | exactly **1** match of `/https?:\/\/\S*priorit/` |
| AC-REND-4 | 1 test | `<script>` and `&` escaped in `html`; body sent `text/plain` |
| AC-TZ-1 | 3 tests | 12:05 UTC → **true**, 08:05 UTC → **false** (the exact inverse of today); 15-min window boundary held |
| AC-TZ-2 | 2 tests | 96 ticks × 4 zones → **exactly 1** fire each, all at local hour 8; weekly → 1 fire at Sunday 09 across 672 ticks |
| AC-TZ-4 | 2 tests | fires at local 08 on both sides of 2026-11-01; a hardcoded −4 **or** −5 fails; exactly 1 fire on the transition day |
| AC-TZ-5 | 3 tests | `null` / `undefined` / `''` timezone → falls back to America/New_York and **still sends once** |
| AC-LINK-1 | 10 tests | throws on empty, whitespace, relative, scheme-less, `localhost`, `127.0.0.1`; never yields `undefined/priorities` |
| AC-LINK-3 | 1 test | email / slack / app_message URLs byte-identical |
| AC-MTG-4/5 (partial) | 3 tests | empty → suppressed; `withPerson=null` **excluded, not assumed true**; grouped by day ascending, empty days omitted |

### Mutation proofs — `scripts/mutate.sh`, 4 of 4 **FIRED**

Every new guard was mutation-proved. Anchors came from **files**, not shell
arguments. All four restored cleanly (`matches HEAD`) and pass again.

| # | Guard | Defect reinstated | Outcome |
|---|---|---|---|
| M1 | AC-REND-1 (Tier 1) | `const body = \`${subject}. ${input.context}\`` — the literal `notification-delivery:239` defect | **FIRED** |
| M2 | AC-TZ | `now.getUTCHours() === hour` — the runtime-local hour | **FIRED** |
| M3 | AC-LINK-1 | `baseUrl \|\| "https://app.example.com"` — the "harmless default" | **FIRED** |
| M4 | AC-BUILD-2 | `return [...items]` — trust the query's order | **FIRED** |

No INERT, no NOT-APPLIED.

### Typecheck

`npx tsc -b` → **30 errors, ALL pre-existing in class**: 12 × TS2591
(`node:test` / `node:assert` — every one of the 4 test files including the 3
that predate this work; `@types/node` is not in the `types` field) and 18 ×
TS2307/TS2339 from `node_modules` not being installed in this container
(`@tanstack/react-query`, `@supabase/supabase-js`, `@lovable.dev/mcp-js`).

**Zero errors name `digest-content.ts` or `notification-scheduler/index.ts`.**
The 5 genuine type errors this work introduced in the test file (un-narrowed
channel strings, one property assert) were **found and fixed** before push;
re-run confirms none remain. Standalone `tsc --strict` over the new edge module
also passes.

---

## FINDINGS for the wiring agent / the owner

**FINDING 1 — three MORE raw-`getHours()` sites in the same file, outside the
ACs' scope.** `notification-scheduler/index.ts:202, :280, :337` (quiet-hours
check, due-today reminder at "9 AM", overdue nudge at "9 AM") have the
**identical** UTC-vs-user-timezone defect the ACs named for the digest. They are
**NOT fixed here** — they are reminder paths, not digest paths, and are outside
the files/ACs this pass owns. `shouldSendAtLocalHour` is exported and ready;
this is a one-line swap each. *Flagged, not silently inherited.*

**FINDING 2 — the one-line call site for AC-REND-1.** In
`notification-delivery/index.ts:239` (**owned by another agent — not edited**):

```ts
body: renderScheduledCall({
  callName: callConfig.call_name || callNotification.title,
  context:  callConfig.context || '',
  channel:  canonicalChannel(commsMode) ?? 'app_message',
}).body,
```

`canonicalChannel()` is exported for exactly this; it maps the caller's
lowercase `CommsMode` and any alias onto one rendering vocabulary, and returns
**`null` for an unknown channel rather than guessing** (`'OUTLOOK_EVENT'` → null).

**FINDING 3 — `APP_BASE_URL` must be set at deploy or every digest fails
closed.** That is the intended behaviour (AC-LINK-1), but it means the digest
ships dark until someone runs
`supabase secrets set APP_BASE_URL=https://<app-host>`. It also needs adding to
`deploy-supabase-functions.yml`'s secret sync.

**FINDING 4 — the meetings classifier is NOT implemented here, by design.**
`DigestMeeting.withPerson` is `boolean | null` and journey **excludes `null`**.
If the attendee-capture agent ships capture without setting `withPerson`, the
meetings digest will correctly send **nothing** rather than send everything.

## NOT REACHED (stated, not guessed)

- **AC-CH-1..6** (multi-select channels, partial-failure semantics, the 207
  inverted defect, `sendGraphEmail` allow-list) — the delivery layer is owned by
  another agent; this pass only exports `canonicalChannel()` to support AC-CH-1.
- **AC-MTG-1/2/3/6/7/8** — attendee capture, the classifier, the 7-day horizon
  reuse and cross-user leakage. Interface defined; implementation is the other
  agent's.
- **AC-SU-1..6** — stand-up ranking divergence lives in huddle-extension-app.
  Only the payload SHAPE is defined here.
- **AC-INT-1..5**, **AC-X-1..5** — the standalone/integrated switch and
  observability were not in sections A/B/D/E.
- **AC-CH-6 / AC-LINK-2 remain `MECHANISM ONLY, NOT USER-CONFIRMED`.** Nothing
  was deployed and no digest was sent to a real inbox. Every result above is
  from code executed in this container, not from a delivered message.
- **`src/utils/buildDayContext.ts` consolidation** — deliberately not attempted
  (see the divergence table at the top). The ≤2-copies invariant holds.
