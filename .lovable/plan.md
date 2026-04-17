
Final tweak locked in: Tier C sorts by **due date descending** (most recent overdue first), not earliest. Rationale: ancient overdue assignments are lowest-value to reschedule — recent misses still have recoverable rhythm/context.

## Tier sort order (final)

```text
Tier A (due ≤48h):
  sort: due date ASC (most urgent deadline first)

Tier B (due 3–7d OR overdue ≤7d):
  sort: due date ASC (earliest upcoming or most-recent overdue)

Tier C (due >7d OR overdue >7d):
  sort: due date DESC (most recent first; ancient overdue last)
```

## Everything else (unchanged from prior approvals)

**Constants** in `_shared/scheduling-defaults.ts`:
- `MAX_ASSIGNMENTS_PER_DAY = 2`
- `ASSIGNMENT_URGENT_HOURS = 48`
- `ASSIGNMENT_PRIORITY_DAYS = 7`

**Per-day pass order:**
```text
1. Mark calendar events busy
2. Pass 1A: Tier A — category windows in mini-horizon, distributed
3. Pass 1A-overflow: Tier A — flexible-window override for unplaced
4. Pass 1B: Tier B (capped 2/day, category windows, due ASC)
5. Pass 1C: Tier C (capped 2/day, category windows, due DESC)
6. Pass 2: flexible-pass for non-assignment tasks (existing scoring)
7. Pass 3: top-up — pull deferred Tier B then Tier C into open slots
   (still respect category windows and tier sort order)
```

**Files:**
- `src/lib/schedulingCandidates.ts` — `selectAssignmentCandidates` returns `{ tierA, tierB, tierC }` with tier-specific sort
- `supabase/functions/nightly-schedule-builder/index.ts` — three-tier Pass 1 + Pass 3 top-up
- `supabase/functions/_shared/scheduling-defaults.ts` — add 3 constants
- `src/utils/dailyReviewPipeline.ts` — diagnostic split: "X urgent (Y category + Z overflow) + N distributed + M deferred"

**Guardrails preserved:**
- 6 AM–10 PM hard bound for all tiers
- Window validation per category mapping
- 5-min buffer, 30-min alignment, dedup, history snapshot
- Calendar reschedule sync (`create_event` post-placement)
- Single-day mode honors same tiered logic
- Cross-day exclusion set prevents double-placement in horizon

**Investigation step before code (read-only SQL):**
Confirm tier sizes for dev user (a3378f93-...):
- counts by tier (≤48h, 3–7d, overdue ≤7d, overdue >7d, >7d)
- category distribution among assignment tasks
- estimate_minutes distribution + null count
- assignments already placed in horizon

**Acceptance gate:**
- Tier A distributed across hours-until-due, category-first, flexible-override only when needed
- Tier B/C ≤2/day distributed across 7-day horizon; Tier C surfaces recent overdue before ancient
- Pass 3 fills leftover capacity before reporting empty days
- LIFE/PERSONAL flexible work fills only what assignments don't claim
- Daily review modal shows non-zero `Assignments today` when eligible assignments exist
- No window/buffer violations introduced
