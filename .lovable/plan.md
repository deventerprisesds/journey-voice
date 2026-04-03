

# Create Scheduling System Map and Enforce It via Rules

## What and why

The system audit knowledge keeps getting lost across threads. The fix is two things:
1. Create `docs/SCHEDULING_SYSTEM_MAP.md` — a concrete reference of what exists, where it lives, and how it connects
2. Update `.lovable/rules.md` to make reading AND updating this map mandatory for every scheduling-related plan

## 1. Create `docs/SCHEDULING_SYSTEM_MAP.md`

This is NOT a rules doc (that's `SCHEDULING_RULES.md`). This is the **system map** — what code exists, where it lives, what it does, and how the pieces connect. Content:

### Section A: Scheduling Code Paths (with file + line references)
- **Nightly builder** (`supabase/functions/nightly-schedule-builder/index.ts`): rollover (pass 1 past, pass 1.1 future), stale archival, candidate scoring, week loop, batch dispatch
- **Batch scheduler** (`supabase/functions/batch-calendar-scheduler/index.ts`): AI prompt construction, busy-slot query, activity hints, window validation, overlap rejection, DB write
- **Client fill-gaps** (`src/components/CalendarModule.tsx`): uses `selectSchedulingCandidates` from `src/lib/schedulingCandidates.ts`, then calls batch-calendar-scheduler
- **Smart scheduler** (`supabase/functions/smart-calendar-scheduler/index.ts`): single-task manual scheduling
- **Execute-tool** (`supabase/functions/execute-tool/index.ts`): voice/chat triggered scheduling

### Section B: Shared Modules (source of truth for each concern)
- **Window definitions + validator**: `_shared/scheduling-defaults.ts`
- **Timezone helpers**: `_shared/timezone.ts` (server), `src/lib/date.ts` (client)
- **Candidate scoring**: nightly builder lines 544-603 (server), `src/lib/schedulingCandidates.ts` (client) — must match
- **Iris context**: `_shared/call-context-builder.ts` — derives mappings from `scheduling-defaults.ts`
- **Frontend scheduling rules**: `src/config/schedulingRules.ts`

### Section C: Data Flow
```text
Nightly cron → nightly-schedule-builder
  → Pass 1: rollover past tasks (increment pushed_count)
  → Pass 1.1: clear future-scheduled tasks (no pushed_count)
  → Stale archival
  → For each of 7 days:
      → getActiveWindows (day-of-week filter)
      → computeWindowCapacity (existing busy slots)
      → selectCandidates (scoring + dedup)
      → batch-calendar-scheduler (AI placement + validation)
      → accumulate busy slots for next day
```

### Section D: Bugs Fixed (historical record)
- UTC "today" drift → fixed with `getTodayInTimezone`
- Sunday-capped horizon → fixed with rolling 7-day
- Append-not-rebuild → fixed with future-task clearing pass
- Batch overlaps → fixed with `acceptedSlots` rejection
- Iris mapping drift → fixed by deriving from `scheduling-defaults.ts`
- `flexible` free pass → fixed in `validateTaskWindow`

### Section E: Anti-Patterns (things that broke the system before)
- Using `now.toISOString().split('T')[0]` instead of `getTodayInTimezone`
- Hardcoding category-window mappings outside `scheduling-defaults.ts`
- Adding new scheduling code paths instead of using existing ones
- Skipping `pushed_count` distinction between past rollover and future rebuild
- Browser-local `isToday()` for agenda filtering

## 2. Update `.lovable/rules.md`

Add a new top-level section **before** the Documentation Catalog:

```
## SCHEDULING SYSTEM MAP — MANDATORY

Before ANY scheduling, agenda, calendar, or timezone plan:
1. Read `docs/SCHEDULING_SYSTEM_MAP.md` (system map — what exists and where)
2. Read `docs/SCHEDULING_RULES.md` (rules — what must be true)
3. Answer the Required Planning Checklist in SCHEDULING_RULES.md

After ANY scheduling-related code changes:
1. Update `docs/SCHEDULING_SYSTEM_MAP.md` if any code paths, shared modules, or data flows changed
2. Add to Section D (Bugs Fixed) if a bug was resolved
3. Add to Section E (Anti-Patterns) if a new failure mode was discovered

NEVER add a new scheduling code path without documenting it in the system map.
NEVER hardcode window/category mappings outside scheduling-defaults.ts.
```

Also update the Documentation Catalog table to add the new doc:

| `docs/SCHEDULING_SYSTEM_MAP.md` | **MANDATORY** — ANY scheduling, agenda, timezone, or calendar change |

And update the existing Key Constraints to add:
- **Scheduling system map sync**: After any scheduling code change, update `docs/SCHEDULING_SYSTEM_MAP.md` with new/changed code paths, modules, or data flows.

## Files changed

| File | Change |
|------|--------|
| `docs/SCHEDULING_SYSTEM_MAP.md` | New file — complete system map with code paths, shared modules, data flow, bugs fixed, anti-patterns |
| `.lovable/rules.md` | Add mandatory scheduling system map section; add to documentation catalog; add key constraint |

