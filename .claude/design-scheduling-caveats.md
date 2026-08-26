# Temporary scheduling caveats — design note (journey-owned)

Status: DESIGN, not implemented. Investigated 2026-08-26.

## Correct terminology (I got this wrong first pass)

The unit is a **named time window**, defined in
`supabase/functions/_shared/scheduling-defaults.ts` (`DEFAULT_TIME_WINDOWS`):

| window | hours | days |
|---|---|---|
| `morning` | 06–09 | Mon–Fri |
| `business_hours` | 09–17 | Mon–Fri |
| `after_work` | 17–22 | Mon–Fri |
| `evening` | **19–22** | all 7 |
| `flexible` | 09–22 | all 7 |
| `weekends` | 10–20 | Sat/Sun |

So "push research to the evening" = the existing `evening` window, 19–22. There was
nothing to ask about. (The 18–22 vs 20–22 question I asked was about Huddle's
*confirm-ask fan-out windows* — a different, Huddle-local concept that governs when the
agent pings you, not when work is placed on the calendar.)

## Where scheduling actually lives — journey, not Huddle

ONE core module, four consumers:

- **`supabase/functions/_shared/scheduling-defaults.ts`** → `resolveConfig(userConfig)`
  returns `{ timeWindows, categoryMappings }`. This is the funnel.
- Consumers: `nightly-schedule-builder`, `batch-calendar-scheduler`, `execute-tool`
  (`find_open_slots`, two call sites), `smart-calendar-scheduler`.
- Frontend mirror: `src/config/schedulingRules.ts` (comment says "must stay in sync").
- Store: `public.user_scheduling_prefs` — JSONB `config` + dedicated columns; loaded by
  `src/services/schedulingService.ts::loadUserSchedulingConfig` (cached per user).

Per-task window resolution inside `nightly-schedule-builder`:

1. `getKeywordWindowOverride(title, contextRules.keywords, activeWindowNames)` — a keyword
   match BEATS the category default.
2. else `getPreferredWindows(category, categoryMappings, activeWindowNames)`.
3. Both bounded by `getActiveWindows(timeWindows, dayOfWeek)`.

## ALREADY BUILT — say this first

Settings → Scheduling already ships an editable **"Keyword Detection Rules"** section
(`src/components/SchedulingSettings.tsx:575`, "Configure keywords that trigger specific
time windows and board lanes") with add / edit / delete over
`contextRules.keywords[kw] = [timeWindow, status]`.

A rule `research → evening` can be added **today**, through the UI, with no code change.
The only thing genuinely missing is the *temporary* part: no expiry, no "until cleared",
and no separation between standing rules and a caveat you intend to drop.

## Two real gaps found while sweeping

1. **Keyword rules bind on the nightly path only.** Full sweep of `contextRules` across
   `supabase/functions/` and `src/`: consumers are `nightly-schedule-builder`,
   `schedulingService.extractSchedulingContext` (client), `dailyReviewPipeline` QC_VIOLATIONS,
   and the settings editor. `execute-tool` / `batch-calendar-scheduler` /
   `smart-calendar-scheduler` only call `resolveConfig`, which returns timeWindows +
   categoryMappings and **not** contextRules. So a keyword rule does not apply on the
   ad-hoc / agent-driven scheduling paths.
2. **Frontend↔backend window drift.** `after_work.days` is `[1,2,3,4,5]` in
   `_shared/scheduling-defaults.ts` but `[1,2,3,4,5,6]` (includes Saturday) in
   `src/config/schedulingRules.ts`, despite the "must stay in sync" contract.

## The model

A **temporary overlay resolved at read time, never written into the config.** Clearing a
caveat restores prior behaviour with zero migration — that is the property being asked for.

Storage: a `caveats` JSONB array on the existing `public.user_scheduling_prefs` row (same
row, same RLS, same load path, one read). Not a new table, not a new config system.

Shape reuses the existing vocabulary rather than inventing one:

```ts
interface SchedulingCaveat {
  id: string;
  text: string;                       // verbatim user words — for the UI and the agent prompt
  match: { categories?: string[]; keywords?: string[]; priorities?: string[] };
  effect:
    | { preferWindows: string[] }     // NAMED windows only — same vocabulary as everything else
    | { avoidWindows: string[] }
    | { maxPerDay: number }
    | { defer: true };
  expiresAt: string | null;           // null = until explicitly cleared
  createdAt: string;
  source: 'chat' | 'settings';
}
```

Resolution: widen the shared funnel —
`resolveConfig(userConfig)` → `resolveConfig(userConfig, now)`, returning the same
`{ timeWindows, categoryMappings }` plus `caveats` (active ones only, expired filtered by
`now` — no cron needed). Add `applyCaveats(preferredWindows, task, caveats)` at the same
point the keyword override is applied.

**Precedence: caveat > keyword > category default**, all still bounded by the day's active
windows. Putting it in the shared module is what makes it bind on the ad-hoc paths too, and
is the natural moment to close gap 1 by moving the keyword override into the shared module
as well.

## Independent vs integrated

- **journey (standalone or integrated):** journey owns this. Caveats live in
  `user_scheduling_prefs`, applied in `_shared/scheduling-defaults.ts`. Identical either way.
- **Huddle, integrated:** must NOT hold a second copy. Reads/writes caveats through the
  journey proxy (`invokeJourneyTool`), so an agent can set one conversationally while journey
  stays the single scheduler. Matches the OPEN item in huddle `.claude/actions.md`:
  *"exactly one driver when integrated … journey = natural driver today."*
- **Huddle, standalone:** keeps the equivalent overlay over its OWN layer
  (`resolveConfirmFanWindows` / `resolveJobCadence` in
  `src/features/huddle/lib/identity/scheduling-config.server.ts`) — same caveat shape, same
  expiry semantics, different substrate. That is the *"retains the equivalent engine for
  journey-off"* half of the same open item.

The caveat record is the portable contract between the two sides — same JSON on either.

## Open fork for the owner

Does a caveat **re-place already-scheduled tasks** (the nightly rebuild moves research off
10am), or apply only to newly-scheduled ones? "Push research to the evening" most likely
means the former, which is a re-placement pass and materially more work than the overlay.
