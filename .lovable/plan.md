
## Why I missed the rules and how to enforce reading them

### Honest answer
I didn't fail because the rules are hidden — they're in `.lovable/rules.md`, the memory index Core section, and `mem://infrastructure/timezone-normalization-architecture`, all of which load into my context every turn. I failed because I treated them as background reference instead of a pre-flight gate. When you asked about scheduling/calendar bugs, I jumped to symptom analysis (calendar query, modal layout) instead of first auditing the changed files against the forbidden-pattern list. That's a process failure, not a missing-doc failure.

### What will actually fix this (durable, not just "I'll try harder")

**1. Add a hard pre-flight gate to Core memory**
Update `mem://index.md` Core section with a one-line non-negotiable rule that forces a checklist before any scheduling/calendar/timezone plan:

```
PRE-FLIGHT (scheduling/calendar/timezone/modal): Before planning, grep changed files for forbidden patterns: Date.UTC, new Date().getDay/getHours, toISOString().split, isToday, format(date,'yyyy-MM-dd'). List violations in plan. Confirm shared helpers (localDateToUtcBounds, getTimePartsInTimezone, dateToKeyInTimezone, get_calendar_connections_safe RPC) are used. No plan ships without this audit section.
```

Core rules are always in context and apply to every action — this turns the audit into a required plan section, not an optional reference.

**2. Add a dedicated pre-flight memory**
Create `mem://constraints/scheduling-preflight-audit` with the explicit grep list, the helper inventory, and the "audit must appear in plan" requirement. Indexed so it surfaces on any scheduling/calendar topic match.

**3. Restructure plan template for these topics**
Every scheduling/calendar/modal plan must open with a "Pre-flight audit" section listing:
- Files inspected
- Forbidden patterns found (with line numbers) or "none"
- Shared helpers that should replace them
- Existing memory rules invoked

If that section is missing or empty, the plan is incomplete.

### Plan for this turn (carry forward the previously approved fixes)

Apply the 5 fixes from the prior approved plan, plus the memory/process changes above:

1. **`supabase/functions/nightly-schedule-builder/index.ts`** — singleDay clear uses `localDateToUtcBounds(todayISO, timezone)`; calendar_status uses `get_calendar_connections_safe` RPC with tri-state output (`connected_with_events`, `connected_no_events`, `not_connected`, `query_failed`); stale-cutoff uses `dateToKeyInTimezone`.

2. **`src/utils/dailyReviewPipeline.ts`** — greeting hour from `getTimePartsInTimezone`; surface tri-state calendar status in pipeline message.

3. **`src/components/DailyReviewModal.tsx`** — weekend detection from timezone helper (new `getDayOfWeekInTimezone` if needed); tri-state Calendar tile copy; collapse "eligible but not placed" details behind `<Collapsible>` (default closed); trim window summary to top 3 with "Show all".

4. **`src/lib/date.ts`** — add `getDayOfWeekInTimezone(timezone)` if not already present.

5. **`mem://index.md`** — add PRE-FLIGHT Core rule.

6. **`mem://constraints/scheduling-preflight-audit`** — new memory file with grep list + helper inventory + plan-section requirement.

### Files touched
- `supabase/functions/nightly-schedule-builder/index.ts`
- `src/utils/dailyReviewPipeline.ts`
- `src/components/DailyReviewModal.tsx`
- `src/lib/date.ts`
- `mem://index.md`
- `mem://constraints/scheduling-preflight-audit`

### Will NOT touch
Tier classification, scoring, Pass 1A/1B/1C, reshuffle pass, window validation, buffer/alignment, two-way sync deletion safeguard, calendar OAuth/sync internals.

### Acceptance
1. No `Date.UTC`, `new Date().getDay/getHours`, `toISOString().split('T')[0]` remain in scheduling/modal paths
2. Modal Calendar tile matches Focus View via shared RPC
3. Single-day reschedule scoped to local day only
4. Modal at 411px shows top stats by default; details opt-in
5. New Core rule + preflight memory in place — next scheduling plan must open with audit section
