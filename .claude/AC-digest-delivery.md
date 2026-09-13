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
