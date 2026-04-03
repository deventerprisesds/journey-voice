# Scheduling System Map

> This is the **system map** — what code exists, where it lives, what it does, and how the pieces connect.
> For rules and constraints, see `docs/SCHEDULING_RULES.md`.

Last Updated: 2026-04-03

---

## A. Scheduling Code Paths

### Nightly Builder
**File**: `supabase/functions/nightly-schedule-builder/index.ts`

| Step | Description |
|------|-------------|
| Pass 1 (rollover) | Queries past scheduled non-DONE tasks, writes history to `task_schedule_history`, clears `start_time/end_time/is_scheduled`, increments `pushed_count` |
| Pass 1.1 (future clear) | Clears future-scheduled non-DONE tasks within 7-day horizon. Does NOT increment `pushed_count` or write history — these are rebuilds, not rollovers |
| Stale archival | 5+ pushed with 30+ day overdue → auto-archived. Education tasks 30+ days overdue → auto-archived |
| Candidate scoring | Priority board +10, due-soon +3, due-within-7-days +5, financial/comms keyword +5, pushed_count diminishing returns, staleness penalty |
| Week loop | For each of 7 days: `getActiveWindows` → `computeWindowCapacity` → `selectCandidates` → dispatch to batch-calendar-scheduler |
| Busy slot accumulation | Accepted placements from each day feed into the next day's capacity math |

### Batch Calendar Scheduler
**File**: `supabase/functions/batch-calendar-scheduler/index.ts`

| Step | Description |
|------|-------------|
| Busy-slot query | Fetches DB-persisted scheduled tasks + external calendar events for the target day |
| AI prompt construction | Builds prompt with window definitions, busy slots, activity context hints |
| Activity context hints | gym→morning, bank→business hours, dinner→evening, etc. |
| Window validation | Calls `validateTaskWindow` from `scheduling-defaults.ts` for each AI placement |
| Overlap rejection | Maintains `acceptedSlots` array; rejects any slot that overlaps a previously accepted slot in the same batch |
| DB write | Persists accepted placements to `tasks` table |

### Client Fill-Gaps
**File**: `src/components/CalendarModule.tsx`

Uses `selectSchedulingCandidates` from `src/lib/schedulingCandidates.ts` (same scoring logic, dedup, timezone-aware date filtering), then calls `batch-calendar-scheduler` for placement.

### Smart Scheduler
**File**: `supabase/functions/smart-calendar-scheduler/index.ts`

Single-task manual scheduling. Used when a user manually schedules one task from the UI.

### Execute-Tool
**File**: `supabase/functions/execute-tool/index.ts`

Voice/chat triggered scheduling via Iris. Delegates to scheduling functions.

---

## B. Shared Modules (Source of Truth)

| Concern | File | Notes |
|---------|------|-------|
| Window definitions + validator | `supabase/functions/_shared/scheduling-defaults.ts` | `DEFAULT_TIME_WINDOWS`, `DEFAULT_CATEGORY_MAPPINGS`, `validateTaskWindow`, `resolveConfig` |
| Timezone helpers (server) | `supabase/functions/_shared/timezone.ts` | `getTodayInTimezone`, `normalizeDateTime`, `getDateInTimezone` |
| Timezone helpers (client) | `src/lib/date.ts` | `getDateInTimezone`, `getTimePartsInTimezone`, `localTimeToUtcISO` |
| Candidate scoring (server) | `supabase/functions/nightly-schedule-builder/index.ts` | Scoring function within nightly builder |
| Candidate scoring (client) | `src/lib/schedulingCandidates.ts` | `selectSchedulingCandidates` — must match server scoring |
| Iris context / call context | `supabase/functions/_shared/call-context-builder.ts` | Derives `CATEGORY_WINDOW_MAPPING` from `scheduling-defaults.ts` — never hardcode |
| Frontend scheduling config | `src/config/schedulingRules.ts` | Client-side scheduling preferences |

---

## C. Data Flow

```text
Nightly cron → nightly-schedule-builder
  → Pass 1: rollover past tasks (increment pushed_count, write history)
  → Pass 1.1: clear future-scheduled tasks (no pushed_count, no history)
  → Stale archival (auto-archive old stuck tasks)
  → For each of 7 days (rolling horizon from timezone-correct "today"):
      → getActiveWindows (day-of-week filter from scheduling-defaults)
      → computeWindowCapacity (existing busy slots from DB + accumulated)
      → selectCandidates (scoring + dedup)
      → batch-calendar-scheduler (AI placement + validation + overlap rejection)
      → accumulate busy slots for next day

Client fill-gaps → selectSchedulingCandidates → batch-calendar-scheduler
  (same validation pipeline, same overlap rejection)

Manual schedule → smart-calendar-scheduler
  (single task, uses validateTaskWindow)

Voice/chat → execute-tool → scheduling functions
  (delegates to existing paths)
```

---

## D. Bugs Fixed (Historical Record)

| Bug | Root Cause | Fix | Date |
|-----|-----------|-----|------|
| UTC "today" drift | `now.toISOString().split('T')[0]` in nightly builder | Replaced with `getTodayInTimezone(timezone)` | 2026-04-03 |
| Sunday-capped horizon | `daysUntilSunday + 1` limited scheduling to current week | Changed to rolling 7-day (`totalDays = 7`) | 2026-04-03 |
| Append-not-rebuild | Future tasks never cleared before rebuild, causing overlaps | Added Pass 1.1: clear future-scheduled non-DONE tasks without incrementing `pushed_count` | 2026-04-03 |
| Batch overlaps | AI could return two tasks at same time, no check | Added `acceptedSlots` array with overlap rejection in batch-calendar-scheduler | 2026-04-03 |
| Iris mapping drift | `call-context-builder` hardcoded different category-window mappings | Derive `CATEGORY_WINDOW_MAPPING` from `scheduling-defaults.ts` | 2026-04-03 |
| `flexible` free pass | `validateTaskWindow` returned `valid: true` unconditionally for flexible categories | Enforce flexible window's `start`/`end` hours (9-22) | 2026-04-02 |
| UTC busy-slot queries | Nightly builder used `${targetISO}T00:00:00` (UTC midnight) for capacity queries | Added `localDateToUtcBounds()` to `_shared/timezone.ts`; nightly builder now uses timezone-offset UTC bounds | 2026-04-03 |
| Client `toLocaleDateString('en-CA')` without timezone | `useUnifiedTasks` history cutoff used browser-local date | Replaced with `getTodayInTimezone(getDefaultTimezone())` from `src/lib/date.ts` | 2026-04-03 |
| Client `format(date, 'yyyy-MM-dd')` for scheduling | TimeSlotGrid compared timezone-aware task dates against browser-local date keys | Added `dateToKeyInTimezone()` to `src/lib/date.ts`; TimeSlotGrid uses it exclusively | 2026-04-03 |
| Assignment fetching UTC date | `assignmentFetching.ts` used `toISOString().split('T')[0]` for today | Replaced with `toLocaleDateString('en-CA', { timeZone })` | 2026-04-03 |

---

## E. Anti-Patterns (Things That Broke the System)

| Anti-Pattern | Why It's Dangerous | What To Do Instead |
|-------------|-------------------|-------------------|
| `now.toISOString().split('T')[0]` for "today" | At 8 PM EDT (midnight UTC), "today" becomes tomorrow | **Server**: `getTodayInTimezone(tz)` from `_shared/timezone.ts`. **Client**: `getTodayInTimezone(tz)` from `src/lib/date.ts` |
| `new Date().toLocaleDateString('en-CA')` without `{ timeZone }` | Uses browser locale, not user's configured timezone | `getTodayInTimezone(timezone)` from `src/lib/date.ts` |
| `format(date, 'yyyy-MM-dd')` from date-fns for schedule filtering | date-fns `format` uses browser-local timezone, not user timezone | `dateToKeyInTimezone(date, timezone)` from `src/lib/date.ts` |
| `${targetISO}T00:00:00` / `T23:59:59` for DB day-range queries | These are UTC midnight, not local midnight — misses 8PM-midnight local tasks | `localDateToUtcBounds(dateStr, timezone)` from `_shared/timezone.ts` |
| `accumulatedBusySlots.filter(s => s.start_time.startsWith(targetISO))` | String prefix match on UTC ISO strings doesn't respect timezone day boundaries | Use `isDateInTimezone()` or filter against `localDateToUtcBounds()` range |
| Hardcoding category-window mappings outside `scheduling-defaults.ts` | Causes Iris, scheduler, and validator to disagree | Import/derive from `scheduling-defaults.ts` |
| Adding new scheduling code paths instead of using existing ones | Fragments logic, creates paths that skip validation | Use batch-calendar-scheduler or smart-calendar-scheduler |
| Skipping `pushed_count` distinction between past rollover and future rebuild | Future tasks get unfairly penalized as "pushed" | Pass 1 = past (increment), Pass 1.1 = future (no increment) |
| Browser-local `isToday()` for agenda filtering | Doesn't account for user timezone | Use `getDateInTimezone` from shared helpers |
| Creating MD docs without enforcement in `.lovable/rules.md` | Docs get written but never read | Always add mandatory-read entry in rules.md |

---

## F. Mandatory Timezone API

### Server-side (`supabase/functions/_shared/timezone.ts`)
| Function | Use For |
|----------|---------|
| `getTodayInTimezone(tz)` | Getting "today" as YYYY-MM-DD |
| `localDateToUtcBounds(dateStr, tz)` | DB queries for a local day's tasks/events |
| `zonedTimeToUtc(date, time, tz)` | Converting user-input times to UTC |
| `normalizeDateTime(input, tz)` | Normalizing naive datetimes to UTC |
| `isDateInTimezone(iso, dateStr, tz)` | Checking if a UTC timestamp falls on a local date |

### Client-side (`src/lib/date.ts`)
| Function | Use For |
|----------|---------|
| `getTodayInTimezone(tz)` | Getting "today" as YYYY-MM-DD |
| `dateToKeyInTimezone(date, tz)` | Converting Date objects to YYYY-MM-DD day keys |
| `getDateInTimezone(iso, tz)` | Extracting date from ISO timestamp in user timezone |
| `getTimePartsInTimezone(iso, tz)` | Extracting hour/minute for grid positioning |
| `localTimeToUtcISO(date, time, tz)` | Converting user time inputs to UTC |
| `isSameDateInTimezone(iso, dateStr, tz)` | Filtering tasks by date |
