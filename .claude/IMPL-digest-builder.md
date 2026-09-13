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
