<!--
WHAT:          adversarial acceptance criteria for the three-digest delivery work
               (8am daily brief, meetings digest, Terry's stand-up) across
               journey-voice (Supabase edge) and huddle-extension-app (TanStack Start).
WHY:           the work spans two repos that must each stand alone, and the brief
               handed to this pass carried claims that needed verifying against source
               before any AC could be trusted. Written cold: this agent did not see and
               does not know the implementation plan.
SUPERSEDES:    nothing
SUPERSEDED-BY: nothing -- current
EVIDENCE:      every row below carries the command that produced it, run 2026-09-13
                 against journey-voice @ claude/huddle-workflows-setup-cucecs
                 and huddle-extension-app working tree.
-->

# Acceptance Criteria — three-digest delivery (daily brief / meetings / stand-up)

**Status: COMPLETE — delivered 2026-09-13 within a 25-minute budget. See PART 5 for what was NOT reached.**

Written by an independent AC-writing subagent with no knowledge of the implementation plan.
Stance: *the code will run, every call will return 200, and the digest will arrive — and all
of that can be true while the content is wrong, the channel is wrong, the hour is wrong, or
only one of the selected channels actually fired.* Every AC below is written to catch that.

---

## PART 0 — BRIEF CLAIM AUDIT (verify before trusting)

Each claim handed to this pass, re-checked against source. **Do not proceed on a claim
marked WRONG or INCOMPLETE without re-reading the file.**

| # | Brief claim | Verdict | Evidence |
|---|---|---|---|
| C1 | `notification-delivery/index.ts:239` builds email body as the raw call SCRIPT | **CONFIRMED (wording differs)** | `grep -n "Time for your" supabase/functions/notification-delivery/index.ts` → line 239 exactly: ``body: `Time for your ${(callConfig.call_name \|\| callNotification.title).toLowerCase()}. ${callConfig.context \|\| ''}` ``. Brief wrote `${call_name}`; actual is `(call_name \|\| title).toLowerCase()`. Substance confirmed: **no LLM step, no data fetch, `callConfig.context` is the phone script verbatim.** |
| C2 | `channels: [commsMode]` at `:240`, `commsMode` a single string | **CONFIRMED** | line 240 is `channels: [commsMode]`. `src/services/schedulingService.ts:42` → `export type CommsMode = 'phone' \| 'app_message' \| 'slack' \| 'email';` and `:36` `commsMode?: CommsMode;` — **scalar, optional**. Downstream `channels` is already an array, so the fan-out shape exists; only the *source* is scalar. |
| C3 | `_shared/build-day-context.ts` has **zero importers** | **CONFIRMED — and worse than stated** | `grep -rn "build-day-context\|buildDayContextServer\|summarizeDayContext"` returns only self-references. **BUT the brief missed a duplicate:** `src/utils/buildDayContext.ts` is a **303-line twin** of the 303-line `_shared/build-day-context.ts`, with the identical export surface (`DayContextScheduleItem`, `DayContextGap`, `DayContextPendingAssignment`, `DayContextPriorityItem`, `DayContextCalendarHold`, `DayContext`, `summarizeDayContext`) and is **live** — imported by `src/components/DailyReviewModal.tsx:27`. So there are already **TWO** copies of the day-context builder, one live client-side, one dead server-side. A digest builder that adds a third is the failure mode this AC set exists to prevent. See **AC-BUILD-1**. |
| C4 | `shouldSendDailyDigest` tests `getHours()===8` → 08:00 UTC = 4am ET | **CONFIRMED** | `notification-scheduler/index.ts:387-390`: `return now.getHours() === 8 && now.getMinutes() < 15;`. In Deno, `new Date().getHours()` is the **runtime-local** hour, and an edge runtime is UTC — so this fires 08:00 UTC. Note `shouldSendWeeklyDigest` (`:393`) has the **identical defect** (`getDay()===0 && getHours()===9`) — the brief did not mention it; any timezone fix that touches only the daily path leaves the weekly one broken. |
| C5 | journey has **no `APP_URL` env** | **CONFIRMED** | `grep -rn "APP_URL\|VITE_APP_URL\|SITE_URL" --include=*.ts --include=*.tsx --include=*.toml .` → **zero hits** anywhere in the repo, including `supabase/config.toml`. A deep link cannot be built server-side today. |
| C6 | `attendees` stored nowhere in either repo | **CONFIRMED for journey-voice** | `grep -rn "attendees" --include=*.ts --include=*.sql .` in journey-voice → **zero hits**. (Huddle side checked separately below.) |

**Remaining claims (C7 `nightly-schedule-builder` 7-day horizon, C8 Huddle `sendGraphEmail`/`rankTasks`/`standup.server.ts`, C9 live delivery evidence) — see PART 0b, appended next.**

---

## PART 0b — REMAINING CLAIMS

| # | Brief claim | Verdict | Evidence |
|---|---|---|---|
| C7 | `nightly-schedule-builder` already does a rolling **7-day horizon**, reads `external_calendar_events` as busy blocks | **CONFIRMED** | `:431` `horizonEnd.setDate(getDate()+7)`; `:716` `const totalDays = singleDay ? 1 : 7;` with comment "Rolling 7-day horizon". `grep -n external_calendar_events` → `:66, :747, :786, :922, :1627, :1690` — six read sites, all busy-block queries selecting `start_time, end_time`. |
| C8a | Huddle `sendGraphEmail()` callable server-side, no agent turn | **CONFIRMED — with an unbriefed CONSTRAINT** | `src/features/huddle/lib/email/graph-email.server.ts:233`. **But `:235-241` gates the sender against `emailFromOptions()`** — an allow-list from env `HUDDLE_EMAIL_FROM`, defaulting to `["dev@enterpriseds.io"]`. A digest sent `from` a mailbox not on that list returns `{ok:false, error:"…is not an allowed sender"}` — **a silent non-delivery that is not an exception and not a non-2xx.** See **AC-CH-5**. |
| C8b | `rankTasks()` consumes `priority_rank`, correctly layered | **CONFIRMED** | `scoring.ts:54` `if (task.is_priority) score += 10 + Math.max(5 - (task.priority_rank ?? 0), 0);` and `:139` the tiebreaker `aRank/bRank`. Consumers: only `tools.ts:228/246` (the `prioritize` tool). Nothing to retire. |
| C8c | `standup.server.ts` bypasses `rankTasks`, sorts raw `priority_rank` — rankings can disagree | **CONFIRMED, AND MORE SEVERE THAN BRIEFED** | `standup.server.ts:151-155`: `.sort((a,b) => (a.priority_rank ?? 9999) - (b.priority_rank ?? 9999)).slice(0,5)`. The divergence is **four concrete defects, not one theoretical one**: <br>**(i) PARKING-LOT LEAK.** `rankTasks` filters `.filter(t => !(t.tags ?? []).includes("parking-lot"))` with an in-source comment naming the exact past incident (*"grooming ranked a parked 'Prepare investor pitch' #3 Urgent"*, ACT-13/ACT-17). **The stand-up sort has no such filter — the closed leak is still open in the stand-up.** <br>**(ii)** `rankTasks` sorts `is_priority` FIRST and only compares `priority_rank` *among* is_priority tasks; the stand-up compares `priority_rank` for everything, so a non-priority task carrying a stale rank outranks a genuinely urgent one. <br>**(iii)** `rankTasks` filters `status DONE/BLOCKED`; the stand-up filters `!completed_at && status!=="DONE"` plus its own `blockers` map — **different definitions of blocked**. <br>**(iv)** `rankTasks` dedups by title (`seen` set); the stand-up does not. <br>Treat as **Tier 1** — it decides what the user is told their priorities are. |
| C8d | `attendees` stored nowhere in Huddle either | **CONFIRMED — but `organizer` IS captured** | `grep -rn attendees src/` → zero. `graph-email.server.ts:189` `$select=subject,start,end,location,isAllDay,organizer`, mapped at `:225` to `organizer: e.organizer?.emailAddress?.name \|\| …address`. **`organizer` is NOT a with-a-person signal** — the user is the organizer of their own solo focus block, so classifying on organizer alone marks every solo hold as a meeting. See **AC-MTG-2**. |
| C9 | Email delivery unproven; 200 means accepted by the external proxy, not delivered | **CONFIRMED, AND THE BRIEF UNDERSTATES IT IN BOTH DIRECTIONS** | See the two findings below — this is the most important thing in this document. |

### F1 — ALREADY BUILT (loudly): per-channel partial-failure semantics exist at the `send-unified-notification` layer

The brief says *"today a single non-2xx marks the whole notification failed."* **That is not what the code does.**
`send-unified-notification/index.ts`:
- `:13` `channels: string[]` — already an array end-to-end.
- `:448` `let remainingChannels = [...channels]` — PUSH (`:597`) and OUTLOOK_EVENT (`:450`) are stripped and handled on their own paths; the remainder goes to the external webhook (`:602-611`).
- `:469, :528` per-channel results accumulate into `result.channelResults.<channel>`.
- `:647-649` `const channelSuccesses = Object.values(result.channelResults).filter(r => r?.success); result.success = channelSuccesses.length > 0 || result.errors.length === 0;`
- `:659` **`status: result.success ? 200 : 207` — 207 Multi-Status for partial success is already implemented.**

**So the fan-out substrate is BUILT. The defect is one layer up and it points the OPPOSITE way from the brief.**

### F2 — THE INVERTED DEFECT: a partial failure is currently recorded as a **SUCCESS**

`notification-delivery/index.ts:234-249` calls `supabaseClient.functions.invoke('send-unified-notification', …)` and branches on `if (unifiedError) … else deliverySuccess = true`. **`functions.invoke` populates `error` only on a non-2xx response. `207` is a 2xx.** Therefore:

> A fan-out where the email silently failed and only Slack succeeded returns 207, `unifiedError` is null, and `notification-delivery` writes **`deliverySuccess = true`**. The user gets no email and the system records a clean delivery.

And `:649` carries a second, independent vacuous-pass: `|| result.errors.length === 0` means **zero channels attempted and zero errors ⇒ `success = true`**. A fan-out that did nothing at all reports success with `channelResults` empty.

Both are covered by **AC-CH-3** and **AC-CH-4**. *Absent evidence must be `not_applicable`, never `pass`.*

### F3 — UNBRIEFED LIVE BUG: channel-name CASE MISMATCH between caller and callee

`send-unified-notification` matches channels **UPPERCASE**: `'PUSH'` (`:597`), `'OUTLOOK_EVENT'` (`:450`), `'SLACK'` (`:831`), `'GOOGLE_EVENT'` (`:783`).
`notification-delivery:240` passes **`channels: [commsMode]`**, and `CommsMode` is **lowercase** — `'phone' | 'app_message' | 'slack' | 'email'` (`schedulingService.ts:42`).

So `channels.includes('PUSH')` / `'SLACK'` / `'OUTLOOK_EVENT'` **can never match anything notification-delivery sends.** Every scheduled-call `slack`/`email` string falls through every special-cased branch and is forwarded verbatim, lowercase, to the external `UNIFIED_WEBHOOK_URL` proxy — the stack the brief reports as dead. **Any multi-select work MUST settle the canonical channel vocabulary first or it will build the fan-out on top of a mismatch.** See **AC-CH-1**.

### F4 — ALREADY BUILT (loudly): the timezone fix has every ingredient in the repo already

- `supabase/functions/_shared/timezone.ts` exists and exports **`getTodayInTimezone`, `localDateToUtcBounds`** — imported today by `nightly-schedule-builder/index.ts:14`.
- The per-user timezone is a **stored column**: `nightly-schedule-builder:280` `.select('user_id, config, timezone')`, `:306` `const timezone = userPref.timezone || 'America/New_York'`.

So the brief's "the `scheduled_calls` path IS timezone-correct by contrast" is right, and the correct-by-contrast machinery is *shared code the digest path simply does not call*. Fixing `shouldSendDailyDigest` is **wiring an existing helper, not building one** — and **`shouldSendWeeklyDigest` (`:393`) has the identical defect** and must be fixed in the same pass (see C4).

---

## PART 1 — FEASIBILITY TABLE (publish before any AC is actioned)

| Capability | Producer (writes it) | Consumer today | Proof (command → result) | Verdict |
|---|---|---|---|---|
| Multi-channel fan-out array | `send-unified-notification` `channels: string[]` (`:13`) | itself; per-channel results `:469,:528`; 207 at `:659` | `sed -n '645,660p' …/send-unified-notification/index.ts` → `status: result.success ? 200 : 207` | **ALREADY BUILT** |
| Multi-select channel *choice* | — | `commsMode?: CommsMode` scalar (`schedulingService.ts:36,42`) | `sed -n '30,45p' src/services/schedulingService.ts` → single optional scalar | **ABSENT** (UI/type/storage all scalar) |
| Canonical channel vocabulary | two, disagreeing | UPPERCASE in callee, lowercase in caller | F3 above | **EXISTS-BUT-CONSTRAINED** (mismatched — must be reconciled) |
| Per-user timezone | `user_preferences.timezone` | `nightly-schedule-builder:280,306` | `grep -n "timezone" …/nightly-schedule-builder/index.ts` → 8 hits incl. `_shared/timezone.ts` import | **ALREADY BUILT** |
| Timezone-correct digest hour | — | `shouldSendDailyDigest` uses runtime-local `getHours()` (`:387`) | `sed -n '386,396p' …/notification-scheduler/index.ts` | **ABSENT** (helper exists, digest path does not call it) |
| Day-context builder (schedule + priorityLane + calendarHolds) | `_shared/build-day-context.ts` (dead) **and** `src/utils/buildDayContext.ts` (live) | dead copy: nobody. live copy: `DailyReviewModal.tsx:27` | `wc -l` both → **303 / 303**, identical export surface | **EXISTS-BUT-CONSTRAINED** — two copies already; a third is the defect |
| 7-day rolling horizon | `nightly-schedule-builder` `:431,:716` | itself | `sed -n '714,718p'` → `const totalDays = singleDay ? 1 : 7;` | **ALREADY BUILT** |
| Calendar events as busy blocks | `external_calendar_events` | 6 read sites in nightly builder | `grep -n external_calendar_events …` → `:66,:747,:786,:922,:1627,:1690` | **ALREADY BUILT** |
| **Meeting attendees** | **nobody** | **nobody** | `grep -rn "attendees" --include=*.ts --include=*.sql .` → **0 hits in BOTH repos**; `calendar-delta-sync:188 $select` omits it | **ABSENT — the one true blocker for digest 2** |
| `showAs` (busy/free/oof) | fetched at `calendar-delta-sync:188` | not stored | `grep -n showAs …/calendar-delta-sync/index.ts` → in `$select` only | **EXISTS-BUT-CONSTRAINED** (fetched, discarded) |
| `organizer` | Huddle `graph-email.server.ts:189,225` | `getGraphCalendarEvents` return only | `grep -n '\$select' …/graph-email.server.ts` | **EXISTS-BUT-CONSTRAINED** — present but **not** a with-a-person signal (C8d) |
| Absolute base URL for deep links | **nobody** | **nobody** | `grep -rn "APP_URL\|VITE_APP_URL\|SITE_URL" .` → **0 hits, incl. `supabase/config.toml`** | **ABSENT** (journey side) |
| Server-side mailer (Huddle) | `sendGraphEmail` (`graph-email.server.ts:233`) | agent tools | file read | **ALREADY BUILT — sender allow-listed (C8a)** |
| Single-source task ranking | `rankTasks` (`scoring.ts:123`) | `tools.ts:246` (`prioritize`) **only** | `grep -rn rankTasks src/` → 5 hits, none in standup | **EXISTS-BUT-CONSTRAINED — the stand-up bypasses it (C8c)** |
| Stand-up assembly | `standup.server.ts` | chat/push | file read | **ALREADY BUILT** (needs a delivery channel, not a rebuild) |
| Email delivery, end-to-end proven | external `UNIFIED_WEBHOOK_URL` proxy | unknown/reportedly dead | no record found | **ABSENT/UNPROVEN — treat as unproven until AC-CH-6 passes** |

---

## PART 2 — ACCEPTANCE CRITERIA

Sources read: `notification-delivery/index.ts`, `notification-scheduler/index.ts`,
`send-unified-notification/index.ts`, `nightly-schedule-builder/index.ts`,
`calendar-delta-sync/index.ts`, `_shared/build-day-context.ts`, `_shared/timezone.ts` (exports),
`src/utils/buildDayContext.ts`, `src/services/schedulingService.ts`,
`src/components/DailyReviewModal.tsx` (import site), and in huddle-extension-app
`lib/email/graph-email.server.ts`, `lib/tasks/scoring.ts`, `lib/tasks/standup.server.ts`,
`lib/tasks/tools.ts`.

**Existing system this extends (not duplicates):** `_shared/build-day-context.ts` for content,
`send-unified-notification` for fan-out, `nightly-schedule-builder`'s 7-day horizon for the week
window, `rankTasks` for ranking, `sendGraphEmail` for the Huddle mailer. **Nothing in this work
is net-new except attendee capture and the standalone/integrated switch.**

### A. Shared content builder

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| **AC-BUILD-1** | Given `_shared/build-day-context.ts` and `src/utils/buildDayContext.ts` are already two 303-line copies, when the digest builder ships, then `grep -rln "DayContextPriorityItem" --include=*.ts .` returns **no more than 2** paths and the digest imports one of them — **it does not define a third `DayContext` shape** | regression / extend-don't-duplicate | `grep -rln "interface DayContext " --include=*.ts . \| wc -l` → **≤2**; and `grep -n "build-day-context" <digest file>` → ≥1 import |
| **AC-BUILD-2** | Given a user with 3 scheduled tasks, 2 ranked priorities and 1 calendar hold, when the builder runs for that user/day, then the returned object has `schedule.length===3`, `priorityLane.length===2` **in `priority_rank` ascending order**, and `calendarHolds.length===1` | happy-path | unit test asserting `ctx.priorityLane.map(p=>p.priority_rank)` equals its own sorted copy |
| **AC-BUILD-3** | Given a user with **zero** tasks and zero events, when the builder runs, then it returns a well-formed context with empty arrays and the digest renders an explicit empty state — **it does not send a digest whose body is the word `undefined`, an empty string, or the literal `[object Object]`** | edge | assert rendered body matches `/\S/` and `!/undefined\|\[object Object\]\|NaN/` |
| **AC-BUILD-4** | Given the builder is the single source, when the same user/day is rendered for email and for push, then the priority ORDER is byte-identical across both renderings | cross-surface | render both, assert `emailOrder.join('\|') === pushOrder.join('\|')` |

> **How AC-BUILD-2 could pass while broken:** a builder that sorts correctly but is fed a query
> that already `ORDER BY priority_rank`s — the assertion passes without the builder sorting anything.
> Feed it a **deliberately shuffled** input array in the test, not a DB result.

### B. Per-channel rendering — an email must never contain a call script

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| **AC-REND-1** | Given a `scheduled_call` whose `callConfig.context` contains the phone script text, when it is delivered over the `email` channel, then the email body **does not contain** any of `BRANCH `, `Greet:`, `Hello Sir`, or the raw `callConfig.context` string | error/regression — **the headline defect** | assert `!body.includes(callConfig.context)` AND `!/BRANCH \d\|Greet:/i.test(body)` |
| **AC-REND-2** | Given the same digest content, when rendered for `email` vs `app_message` vs `push`, then each rendering is produced by a **named per-channel renderer** and the three bodies are NOT byte-identical (push is truncated, email carries the deep link) | happy-path | `body_email !== body_push`; `body_push.length <= 300`; `body_email.includes('http')` |
| **AC-REND-3** | Given an email rendering, when the 8am brief is sent, then the body contains at least one schedule item title, at least one priority title, and **exactly one** deep link to the priorities widget | happy-path | count `/https?:\/\/\S*priorit/` occurrences === 1 |
| **AC-REND-4** | Given `body` is assembled from user/task text, when a task title contains `<script>` or `&`, then the email body escapes it (HTML mail) or sends `text/plain` — **the raw tag does not reach the recipient unescaped** | edge/security | assert `!/<script>/.test(htmlBody)` |

> **How AC-REND-1 could pass while broken:** asserting only on a *fixture* context string that
> happens not to contain "BRANCH". Run it against the **real `call_config` row** for the owner's
> configured call, and assert on `!body.includes(actualContext)` — identity, not keyword.

### C. Multi-select channels + PARTIAL-FAILURE semantics

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| **AC-CH-1** | Given F3 (callee matches `'PUSH'/'SLACK'/'OUTLOOK_EVENT'`, caller sends `'email'/'slack'`), when multi-select ships, then **one** canonical channel vocabulary exists and a grep finds no lowercase-vs-uppercase pair for the same channel | regression — **unbriefed live bug** | `grep -rn "'SLACK'\|'slack'" supabase/functions/ src/` → every hit uses the same case; plus a test sending each selected channel and asserting the callee's branch was entered |
| **AC-CH-2** | Given a user selects **email + push + slack**, when one digest fires, then **three** `channelResults` keys are present and three distinct sends were attempted | happy-path | `Object.keys(result.channelResults).sort()` === `['email','push','slack']` (canonical case) |
| **AC-CH-3** | Given email is configured to FAIL and push to SUCCEED, when the digest fires, then **push is still delivered**, `channelResults.push.success===true`, `channelResults.email.success===false`, and the stored notification row records **partial**, not success | error — **the inverted defect (F2)** | force a failing email creds/URL; assert both keys; assert the `notification_deliveries` row is not `status='success'` |
| **AC-CH-4** | Given `send-unified-notification` returns **207**, when `notification-delivery` receives it, then `deliverySuccess` is **NOT** set true — the 207 is inspected and recorded as partial | error — **inverted defect (F2)** | stub the invoke to return 207 with one failed channel; assert the delivery row ≠ success. **Also:** given **zero** channels attempted and zero errors, `result.success` must be **false**, not true (kills the `\|\| result.errors.length === 0` vacuous pass at `:649`) |
| **AC-CH-5** | Given Huddle's `sendGraphEmail` allow-lists the sender against `HUDDLE_EMAIL_FROM` (default `dev@enterpriseds.io`), when the digest sends from the configured address, then the result is `{ok:true}` — and when it sends from an unlisted address the digest is recorded as **FAILED**, never silently dropped | error — unbriefed constraint (C8a) | call with an unlisted `from`; assert `ok===false` AND the digest run is marked failed |
| **AC-CH-6** | Given email delivery is UNPROVEN (the external `UNIFIED_WEBHOOK_URL`/n8n stack is reportedly dead), when the first email digest is sent to the owner's real inbox, then **the owner confirms receipt** and the message id / screenshot is attached to the verification record | happy-path — **live, non-negotiable** | owner confirmation. A **200 is not evidence**: 200 means the proxy accepted it. Status stays `MECHANISM ONLY, NOT USER-CONFIRMED` until the owner replies |

> **How AC-CH-2 could pass while broken:** `channelResults` keys can be pre-seeded by the code
> before any send is attempted. Assert **`success` is a real boolean on each key** and that a
> network/send call was actually made per channel (spy count === 3), not merely that keys exist.

### D. Timezone correctness

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| **AC-TZ-1** | Given a user whose `user_preferences.timezone` is `America/New_York`, when the scheduler tick runs at **12:05 UTC** (08:05 ET), then `shouldSendDailyDigest` returns **true**; and when it runs at **08:05 UTC** (04:05 ET) it returns **false** | happy-path + regression — inverts today's behaviour | unit test with both instants; today (`:387` `getHours()===8`) gives exactly the opposite answers |
| **AC-TZ-2** | Given two users in `America/New_York` and `America/Los_Angeles`, when the scheduler runs across a full UTC day, then **each** receives exactly **one** digest, each at their own local 08:00±15min | edge | simulate 96 ticks; assert per-user send count === 1 and local hour === 8 |
| **AC-TZ-3** | Given the same defect exists in `shouldSendWeeklyDigest` (`:393`, `getDay()===0 && getHours()===9`), when the timezone fix lands, then the **weekly** path is timezone-correct too | regression — **brief omitted this** | `grep -n "getHours()" …/notification-scheduler/index.ts` → **zero** raw `getHours()` remaining in any `shouldSend*` |
| **AC-TZ-4** | Given a US DST transition date (2026-11-01), when the scheduler runs that day, then the digest still fires at local 08:00 (i.e. the UTC offset used is resolved per-date, not a cached fixed offset) | edge | assert using `_shared/timezone.ts` helpers across the transition; a hardcoded `-5`/`-4` fails |
| **AC-TZ-5** | Given a user row with `timezone` NULL, when the digest runs, then it falls back to `America/New_York` (matching `nightly-schedule-builder:306`) and **still sends** — it does not skip the user | edge | set timezone NULL; assert exactly one send |

> **How AC-TZ-1 could pass while broken:** a test that sets the *process* TZ env instead of reading
> the user's stored timezone will pass for one user and break the moment a second timezone exists.
> **AC-TZ-2 is the one that actually proves it** — keep it.

### E. Deep link

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| **AC-LINK-1** | Given journey has **no** `APP_URL`/`SITE_URL` env (C5, verified zero hits), when the digest renders a deep link, then the base URL comes from a **configured value**, and if that config is missing the digest is recorded **FAILED** — it does **not** send a relative path, a `localhost` URL, or `undefined/priorities` | error — the real blocker | unset the var → assert the run is marked failed and no email is sent; `grep -rn "APP_URL" supabase/` → ≥1 hit after the fix |
| **AC-LINK-2** | Given the deep link is delivered, when the owner opens it on a phone from the email, then it lands on the priorities widget **for that user** in a re-rankable state | happy-path — live | owner opens the link; screenshot of the widget attached |
| **AC-LINK-3** | Given the link is embedded in email, push and Slack, when each is rendered, then all three carry the **same absolute URL** | cross-surface | assert the three extracted URLs are string-equal |

> **How AC-LINK-1 could pass while broken:** a default like `?? "https://app.example.com"` makes the
> "missing config" branch unreachable and ships a dead link. **Assert the failure path fires**, not
> just that a URL is present.

### F. Meetings digest — attendee capture + with-a-person classifier + 7-day grouping

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| **AC-MTG-1** | Given `attendees` is stored nowhere in either repo (C6/C8d, zero grep hits), when capture ships, then `calendar-delta-sync:188`'s `$select` includes `attendees`, a column exists, **and a row read back from the DB carries ≥1 attendee for a real multi-person event** | happy-path — **the one true blocker** | `grep -n '\$select' …/calendar-delta-sync/index.ts` → contains `attendees`; then `SELECT attendees FROM external_calendar_events WHERE …` → non-empty for a known meeting |
| **AC-MTG-2** | Given a **solo** focus block the user created (organizer = the user, no other attendees) and a **real 2-person meeting**, when the classifier runs, then the solo block is `withPerson=false` and the meeting is `withPerson=true` | happy-path + **the trap** | run the classifier over both real rows. **`organizer` alone gives the wrong answer for the solo block** (C8d) — the classifier must key on attendees excluding the user |
| **AC-MTG-3** | Given the classifier, when an event has attendees consisting **only of the user's own address**, then `withPerson=false` | edge | assert on a real single-attendee row |
| **AC-MTG-4** | Given a day with **no** person-meetings, when the meetings digest would fire, then **no meetings digest is sent at all** (the owner asked for it only *when there are meetings*) — not an empty-state email | edge | assert send count === 0 for that day |
| **AC-MTG-5** | Given the next 7 days contain meetings on days +0, +2 and +6, when the weekly section renders, then it is grouped **by day** with those three days present and days +1/+3/+4/+5 either absent or explicitly empty — never silently merged into one list | happy-path | assert the grouped keys are dates and `Object.keys(grouped).length===3` |
| **AC-MTG-6** | Given `nightly-schedule-builder` already computes a rolling 7-day horizon (`:431`, `:716`), when the meetings digest picks its window, then it **reuses that horizon computation** rather than declaring a second one | regression / extend-don't-duplicate | `grep -rn "setDate(.*+ 7)\|totalDays = " supabase/functions/` → **no new** 7-day literal introduced by this work |
| **AC-MTG-7** | Given `showAs` is fetched but discarded (`calendar-delta-sync:188`), when an event is marked `free` or `oof`, then the digest's treatment of it is a **stated, tested decision** — not accidental inclusion because the field was thrown away | edge | assert the chosen rule on a real `showAs='free'` row |
| **AC-MTG-8** | Given the digest names attendees, when it is sent, then it names **only** attendees of that user's own events (no cross-user leakage) | error/security | seed two users with meetings; assert user A's digest contains none of user B's attendee addresses |

> **How AC-MTG-1 could pass while broken:** adding `attendees` to the `$select` while the **delta**
> branch (`:183`, `url = connection.sync_token`) reuses a stored delta link that was minted with the
> OLD `$select` — so existing connections keep returning no attendees forever. **Assert on a row
> read back from the DB for an existing (not freshly-connected) connection**, and check whether the
> sync token must be reset.

### G. Stand-up delivery + the ranking-divergence regression guard

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| **AC-SU-1** | Given `standup.server.ts` already assembles the stand-up, when delivery ships, then the **same assembled object** is delivered over the selected channels — a second assembly path is not created | regression / extend-don't-duplicate | `grep -rn "getBoardTasks" src/features/huddle/lib/` → no new caller that re-derives the stand-up |
| **AC-SU-2** | Given a task tagged **`parking-lot`** with a stale `priority_rank` of 1, when the stand-up and `prioritize` both run for that user, then **neither** lists it — today `rankTasks` (`scoring.ts:~133`) filters it and `standup.server.ts:151-155` does **not** | **regression — reinstates a closed leak (ACT-13/ACT-17), Tier 1** | seed the parked task; assert it is absent from `standup.priorities` AND from `prioritize`. **Mutation-prove:** delete the parking-lot filter, confirm a test FAILS |
| **AC-SU-3** | Given the same open task set, when the stand-up's top-5 and `prioritize`'s top-5 are both computed, then the two **title lists are identical and in the same order** | **cross-surface reconciliation — the core guard** | assert `standupTop5.join('\|') === prioritizeTop5.join('\|')`. Today they can differ four ways (C8c i-iv) |
| **AC-SU-4** | Given a non-priority task with `priority_rank=1` and an `is_priority` task with `priority_rank=5`, when both rankings run, then both put the **`is_priority`** task first | edge — divergence (ii) | assert index 0 is the is_priority task in **both** outputs |
| **AC-SU-5** | Given two open tasks with the **same title**, when both rankings run, then both dedup to one entry | edge — divergence (iv) | assert both lists have length 1 |
| **AC-SU-6** | Given the stand-up is delivered by email, when it arrives, then its body contains the produced/blocked/moved-to-review sections and **no** chat markup or agent-turn scaffolding | happy-path | assert `!/@[a-z-]+\b/.test(body)` (no @handles, which are group-chat-only per Huddle's rules) |

> **How AC-SU-3 could pass while broken:** computing both lists from the **same** helper inside the
> test. Call the two **production** entry points — `standup.server.ts`'s assembly and the
> `prioritize` tool in `tools.ts:246` — over one shared DB fixture, and compare their real outputs.

### H. Standalone vs integrated switch

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| **AC-INT-1** | Given integration is **OFF**, when all three digests run in Huddle alone, then all three are delivered by Huddle's own builder + `sendGraphEmail`, and **zero** calls are made to journey | happy-path — the owner's hard constraint | network spy: `journeyCallCount === 0`; assert 3 digests received |
| **AC-INT-2** | Given integration is **OFF**, when the digests run in journey alone, then all three are delivered by journey's builder + fan-out with **zero** calls to Huddle | happy-path | spy: `huddleCallCount === 0`; assert 3 digests received |
| **AC-INT-3** | Given integration is **ON** (the owner's case), when a digest fires, then **journey leads and Huddle defers** — the user receives **exactly ONE** of each digest, not two | error — **the duplicate-digest failure** | assert received count per digest type === 1 over a full simulated day |
| **AC-INT-4** | Given integration is ON and **journey's** digest send fails, when the run completes, then the failure is recorded and Huddle does **not** silently double-send as a "fallback" (or, if fallback is the intended design, it is stated and the total is still exactly 1) | error | force journey failure; assert received count ≤ 1 and the failure is recorded |
| **AC-INT-5** | Given the switch, when its value is read, then it is a **user-changeable setting**, not a code literal — per the org's no-hardcoded-config rule | regression | `grep -rn "<switch name>" src/` → resolves from config/DB, and a UI path exists to change it |

> **How AC-INT-1/2 could pass while broken:** testing only the side you built. **Both must run in
> CI**, and AC-INT-3 is the one that catches integrated double-delivery, which neither standalone
> test can see.

### I. Cross-cutting

| # | Given / When / Then | Category | Observed via |
|---|---|---|---|
| **AC-X-1** | Given the digest scheduler runs, when the same tick is processed twice (retry/overlap), then the user receives the digest **once** | edge — idempotency | fire the tick twice; assert send count === 1 |
| **AC-X-2** | Given live evidence shows `scheduled_call` at **37/67 FAILED** with `Edge Function returned a non-2xx status code` correlating with 500s in `send-chat-message`/`hybrid-assistant-api`/`external-db-query`, when digests ship on the same `app_message` branch, then a digest failure is **retried or recorded**, and the digest failure rate is measured — **it does not silently inherit a 55% failure rate** | regression — live evidence | query delivery rows after a week: assert digest failure rate and that every failure has a recorded reason |
| **AC-X-3** | Given a digest run for a user, when it completes, then exactly one row records the run with per-channel outcomes — so "did the owner get their 8am brief?" is answerable from data, not logs | happy-path — observability | `SELECT … FROM <delivery table> WHERE type='daily_brief' AND day=…` → 1 row with per-channel detail |
| **AC-X-4** | Given the whole pipeline, when a digest is generated, then generation-to-delivery completes **within the 15-minute window** `shouldSendDailyDigest` allows (`minutes < 15`) — otherwise the next tick re-fires it | performance | time the run; assert < 15 min, and that AC-X-1 holds if it overruns |
| **AC-X-5** | Given no explicit performance budget was stated for digest assembly, **proposed default for owner confirmation:** content build ≤ 10s/user, full fan-out ≤ 60s/user | performance — **PROPOSED, needs owner sign-off** | timed run |

---

## PART 3 — GOAL → AC COVERAGE

| Owner goal | ACs |
|---|---|
| 8am daily brief: schedule + current priority ranking + re-rank deep link | AC-BUILD-1..4, AC-REND-2/3, AC-TZ-1..5, AC-LINK-1..3 |
| Meetings digest: today's meetings + by-day over 7 days, **with a person only** | AC-MTG-1..8 |
| Terry's stand-up deliverable like the others | AC-SU-1, AC-SU-6, AC-REND-2 |
| Rankings must not disagree | AC-SU-2..5 |
| Multi-select channels | AC-CH-1, AC-CH-2 |
| One channel failing must not suppress the others | AC-CH-3, AC-CH-4 |
| An email must not contain a call script | **AC-REND-1** |
| Both apps standalone; journey leads when integrated | AC-INT-1..5 |
| Email actually reaches the inbox | AC-CH-5, AC-CH-6 |

**Goals with no AC:** none.
**ACs tracing to no stated goal:** AC-REND-4 (escaping), AC-MTG-8 (cross-user leakage),
AC-X-1/3 (idempotency, observability) — kept: each is a way the digest ships wrong while running fine.

## PART 4 — GAPS / OPEN QUESTIONS FOR THE OWNER (settle before implementation)

1. **Is the email transport alive at all?** No record of the n8n replacement was found, and a 200
   from `UNIFIED_WEBHOOK_URL` proves acceptance, not delivery (F2/C9). **journey has no working,
   proven mailer; Huddle does (`sendGraphEmail`).** If journey's email path is dead, the
   standalone-journey requirement (AC-INT-2) cannot be met for the email channel today. *This is
   the single biggest risk to the plan and is a real fork in intent — it decides whether journey
   needs its own mailer built.*
2. **`attendees` needs a Graph re-consent check and a delta-token reset.** Adding it to `$select`
   may require re-consent, and existing delta links were minted without it (AC-MTG-1 note).
3. **Which app owns the deep-link base URL?** journey has none (C5); Huddle's app URL is known.
4. **Exactly what does "meetings that day OR upcoming that week" mean on a day with none today
   but some later in the week** — send, or suppress (AC-MTG-4)?
5. **Confirm the AC-X-5 performance defaults** (nothing was stated).
6. **`showAs='free'`/`oof` treatment** must be decided, not inherited (AC-MTG-7).

---

## PART 5 — TIER AND NOT-REACHED

**Tier 1 (AC subagent before coding — this document — independent `verifier` after, mutation-prove
every new guard):** AC-SU-2..5 (ranking decides what the user is told their priorities are),
AC-CH-3/4 (delivery success/failure is a stored claim), AC-REND-1 (wrong content reaching a person).
Everything else is Tier 2.

**NOT REACHED within the 25-minute budget — stated rather than guessed:**
- The **live** `notification_deliveries` / delivery-log schema was not read; AC-X-2/X-3 name the
  column shape generically and must be pinned to real column names before use.
- `_shared/timezone.ts` was confirmed to exist and to be imported, but its **function bodies were
  not read** — AC-TZ-4 (DST) assumes it resolves offsets per-date. **Verify before relying on it.**
- The **Huddle-side scheduler/cron** that would fire a standalone Huddle digest was not located.
  AC-INT-1 presumes one exists or will be built; **that presumption is untested.**
- The 37/67 `scheduled_call` failure figure is **carried from the brief, not independently
  re-measured** here.
- No Supabase/DB query was run (connectors require re-auth in this session) — every verdict above
  is from **source on disk**, which is the right ground truth for "does the code do X" but not for
  "what is in the live table."

**Nothing was implemented. This document is for sign-off only.**
