
## Why timezone issues keep reappearing

The short answer: the shared utilities are real, but the system still does not use them consistently at every boundary.

What I confirmed from the codebase:

- The intended architecture is correct:
  - `docs/SCHEDULING_RULES.md` requires “store UTC, display local”
  - `docs/SCHEDULING_SYSTEM_MAP.md` says shared helpers are the source of truth
  - `src/lib/date.ts` has the right client helpers
  - `supabase/functions/_shared/timezone.ts` has the right server helpers

- But the actual implementation is still mixed:
  - Some places use the shared helpers correctly
  - Other places still use browser-local or UTC-naive logic
  - That means each new bug investigation keeps uncovering another “leak” where code bypassed the shared path

## What’s actually causing the repeated timezone bugs

### 1. The utilities exist, but not every caller uses them
Examples I found:
- `useUnifiedTasks.ts` uses `new Date().toLocaleDateString('en-CA')` without the user timezone for history cutoff
- `assignmentFetching.ts` uses `new Date().toISOString().split('T')[0]`
- `TimeSlotGrid.tsx` compares timezone-aware event/task dates against `format(date, 'yyyy-MM-dd')`, which is browser-local
- several places still derive date strings from raw `Date` objects instead of a shared “day key in timezone” helper

So the problem is not “the utilities are wrong.”
The problem is “the utilities are not enforced end-to-end.”

### 2. The system has multiple date boundaries, and each one can drift
Timezone bugs keep recurring because there are several separate layers that all need to agree:

```text
DB UTC timestamps
→ edge-function day selection
→ candidate filtering
→ busy-slot loading
→ client loaders
→ view filtering
→ grid positioning
→ labels/history grouping
```

If even one layer uses:
- UTC midnight,
- browser-local date formatting,
- `toISOString().split('T')[0]`,
- or `format(date, 'yyyy-MM-dd')`

then the whole chain becomes inconsistent again.

### 3. “Shared helpers” are currently helpers, not enforced contracts
Right now the architecture depends on humans remembering:
- use `getTodayInTimezone`
- use `getDateInTimezone`
- use `localTimeToUtcISO`

But the codebase still allows direct ad hoc date math. That is why I keep finding timezone issues: the system is only partially centralized.

## Why I keep surfacing timezone issues after saying the shared approach was fixed

Because some timezone fixes were real, but they fixed only one path at a time.

For example:
- the nightly builder’s definition of “today” was corrected
- but other paths still use raw ISO splitting or browser-local formatting
- so a later investigation finds a different timezone bug in a different layer

So the honest answer is:
- the architecture is mostly right
- the implementation is still incomplete
- and I should be treating timezone work as a full audit/enforcement problem, not a one-line fix problem

## What to build now so this stops happening

### 1. Define a small mandatory timezone API for the app
Use one shared set of functions for all day-key work, such as:
- `getTodayInTimezone(timezone)`
- `getDateInTimezone(iso, timezone)`
- `getTimePartsInTimezone(iso, timezone)`
- client/server helpers for `localDateToUtcBounds(date, timezone)`

Then make those the only allowed path for:
- “today”
- “selected day”
- “is on this date?”
- day-range query bounds
- time-slot positioning

### 2. Replace all remaining ad hoc date logic in scheduling/calendar views
Specifically audit and normalize:
- `src/hooks/useUnifiedTasks.ts`
- `src/utils/assignmentFetching.ts`
- `src/components/TimeSlotGrid.tsx`
- any schedule/calendar components still using:
  - `toISOString().split('T')[0]`
  - `format(date, 'yyyy-MM-dd')` for schedule day matching
  - `toLocaleDateString('en-CA')` without explicit timezone

### 3. Centralize server-side local-day query bounds
The builder still shows raw day queries like:
- `start_time >= ${targetISO}T00:00:00`
- `start_time < ${targetISO}T23:59:59`

That is not timezone-safe for UTC-stored timestamps.
A shared server helper should produce UTC bounds for a local calendar day, and all busy-slot/capacity queries should use it.

### 4. Centralize client-side “day key” creation
Views should not create date keys with browser-local formatting.
They should all use either:
- the selected date already expressed as a timezone-aware day key, or
- a shared helper that converts a `Date` plus timezone into the canonical `YYYY-MM-DD`

### 5. Add documentation enforcement plus code review checks
The docs already say what should happen, but the code still drifts.
The next fix should include:
- adding the newly discovered timezone leak points to `docs/SCHEDULING_SYSTEM_MAP.md`
- documenting forbidden patterns explicitly:
  - `toISOString().split('T')[0]` for scheduling day logic
  - `format(date, 'yyyy-MM-dd')` for timezone-sensitive schedule views
  - `toLocaleDateString('en-CA')` without `timeZone`

## Implementation plan

1. Audit all scheduling/calendar/day-filter code for direct date derivation
2. Replace ad hoc date math with shared timezone helpers
3. Add a shared local-day-to-UTC-bounds helper for edge functions
4. Update nightly builder and any scheduler query paths to use those bounds
5. Update client views/loaders so the same day key logic is used everywhere
6. Update `docs/SCHEDULING_SYSTEM_MAP.md` with the actual leak points and anti-patterns found

## Required planning checklist

1. **Authoritative path** — shared timezone helpers plus nightly builder/client scheduling loaders
2. **Affected views** — Focus, Daily, Weekly, Calendar/TimeSlotGrid, assignment-derived task visibility
3. **Coverage** — nightly builder: yes; fill gaps: yes; manual scheduling: yes; display filtering: yes
4. **Assignments** — keep assignment-linked tasks on the same shared day-key logic so they do not disappear due to browser/UTC drift
5. **Timezone** — compute “today” and all target-day comparisons from explicit timezone helpers only
6. **Verification** — confirm both DB query ranges and UI day grouping match the same local day before calling it fixed

## Bottom line

You are right to call this out.

The repeated timezone issues do not mean the shared utilities were a bad idea.
They mean the system still has too many places that bypass them.

The real fix is not “another timezone patch.”
It is enforcing one end-to-end timezone contract across loaders, schedulers, day-range queries, and views.
