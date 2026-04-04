

# Combined Plan: 15-Minute Grid + General Scheduling Guardrails

## Part 1: 15-Minute Grid Resolution

**File**: `src/components/FocusView.tsx`

### Changes:
1. **Line 806**: Change `[0, 30]` → `[0, 15, 30, 45]` in `getDropSlotsForWindow`
2. **Lines 971, 990**: Change `m += 30` → `m += 15` in both occupied-slot loops
3. **Line 974**: Fix bucketing from `slotMin % 60 < 30 ? 0 : 30` → `Math.floor((slotMin % 60) / 15) * 15`
4. **Line 992**: Same bucketing fix for external events
5. **Lines 1053, 1061**: Open slot duration references from `30` → `15`
6. **Card height ratio**: Change from 56px/30min → 28px/15min to maintain visual density
7. **Memory update**: Update the focus-view memory to reflect 15-min resolution

## Part 2: General Common-Sense Guardrails

**File**: `supabase/functions/batch-calendar-scheduler/index.ts`

### Changes:
1. **Line 301**: Replace the hardcoded Sunday/church keyword check with a general rule:
   - "Consider whether the activity described makes sense on this day/time. Religious services belong on their traditional day. Business errands belong on weekdays during business hours. Outdoor/social activities should not be at odd hours. If the activity clearly doesn't fit this day, mark as OVERFLOW."

2. **After line 555** (after overlap validation): Add a lightweight sanity-check pass on accepted results. Send accepted task titles + scheduled times to a fast AI call asking it to flag any obviously nonsensical placements. Flagged tasks get moved to `rejectedTasks` with reason `"common-sense: {reason}"`.

3. **Fallback safety**: If the sanity-check AI call fails, all tasks pass through unchanged (no worse than today).

4. **Fix timezone-aware day-of-week** (~line 183): Compute `targetDayOfWeek` using the user's timezone instead of server-local `getDay()`.

## Files changed

| File | Changes |
|------|---------|
| `src/components/FocusView.tsx` | 15-min grid slots, bucketing, card height ratio |
| `supabase/functions/batch-calendar-scheduler/index.ts` | General common-sense prompt rule, post-validation sanity check, timezone day-of-week fix |

