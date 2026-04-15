

# Fix: Definitive Scheduling Reasoning (No Hedging)

## Problem

The Daily Review Modal uses vague language like "candidates **may have been** lower priority" when explaining empty windows. Since the scheduling system is rule-based and deterministic, every explanation should state the **exact reason** a window is empty — there is no ambiguity.

## Solution

Replace the fallback catch-all on line 172 with logic that actually inspects the task pool against the category-to-window mappings from `schedulingRules.ts`. For each empty window, determine which of these definitive reasons applies:

1. **No eligible category tasks exist** — e.g., "Business Hours is empty — no CAREER tasks in your backlog"
2. **Eligible tasks exist but are all completed** — e.g., "After Work is empty — all VENTURES/PROF_EDUCATION tasks are already done"
3. **Eligible tasks exist but are scheduled on other days** — e.g., "After Work is empty — 3 VENTURES tasks scheduled later this week"
4. **Eligible tasks exist but scored below the scheduling threshold** — e.g., "Morning is empty — 2 eligible tasks scored below minimum (highest: 4)"
5. **Window fully blocked by calendar events** — e.g., "Business Hours is empty — blocked by 3 calendar events (4h total)"

## Changes

**`src/components/DailyReviewModal.tsx`** — Replace lines 161-175 (the `missingExplanations` block):

- Import `DEFAULT_SCHEDULING_CONFIG` from `@/config/schedulingRules`
- Build a reverse map: window → eligible categories (from `categoryMappings`)
- For each empty window, check the task pool deterministically:
  - Are there zero incomplete tasks in any mapped category? → "no [CATEGORIES] tasks in your backlog"
  - Are there incomplete tasks but none unscheduled? → "all [CATEGORIES] tasks already scheduled on other days"  
  - Are there unscheduled tasks but they scored below threshold? → report the count and top score
  - Is the window blocked by external events? → report the blocking event count and minutes
- Each explanation is a definitive statement with no hedging language

One file changed, ~30 lines replaced. No new files, no migrations.

