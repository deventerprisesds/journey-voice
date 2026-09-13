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

**Status: IN PROGRESS — sections append as they land.**

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
