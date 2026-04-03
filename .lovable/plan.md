

# Complete System Audit: What Exists, What's Broken, What to Fix

## What the system already has (and does correctly)

1. **Shared timezone utilities** (`_shared/timezone.ts` + `src/lib/date.ts`): `getTodayInTimezone`, `normalizeDateTime`, `getDateInTimezone`, `localTimeToUtcISO` — all correct and well-tested.

2. **Shared scheduling defaults** (`_shared/scheduling-defaults.ts`): `validateTaskWindow` with the fixed `flexible` enforcement (9-22 range), blanket guard for tasks outside all windows. Already deployed.

3. **Candidate scoring** (nightly builder lines 544-603 + `src/lib/schedulingCandidates.ts`): Priority board +10, due-soon +3, due-within-7-days +5, financial/comms keyword +5, pushed_count diminishing returns, staleness penalty. Both server and client versions match.

4. **Client-side fill-gaps** (`CalendarModule.tsx` lines 329-334): Uses `selectSchedulingCandidates` from `src/lib/schedulingCandidates.ts` — same scoring logic, dedup, timezone-aware date filtering. Then calls `batch-calendar-scheduler` for placement.

5. **Activity context hints**: Already in `batch-calendar-scheduler` prompt (lines 314-323) — gym→morning, bank→business hours, dinner→evening.

6. **Window capacity math** (nightly builder lines 80-121): Computes used minutes per window, tracks remaining capacity.

7. **Day-of-week filtering**: Both nightly builder (`getActiveWindows`) and batch-scheduler (lines 183-204) correctly exclude weekend windows on weekdays and vice versa.

8. **Rollover** (nightly builder lines 214-273): Writes history to `task_schedule_history`, clears `start_time/end_time/is_scheduled`, increments `pushed_count`. Handles past tasks only.

9. **Stale task archival** (lines 317-392): 5+ pushed with 30+ day overdue due_date → auto-archived. Education tasks 30+ days overdue → auto-archived.

10. **Call context builder** (`_shared/call-context-builder.ts`): V2 scripts with per-window prompts, topic group jogging, window-appropriate task filtering. Uses `getTasksForWindow` which filters by `CATEGORY_WINDOW_MAPPING` and hour ranges.

## What is actually broken (5 issues)

### Bug 1: Nightly builder uses UTC for "today", not user timezone
Line 212: `const todayISO = now.toISOString().split('T')[0]`
This means at 8 PM EDT (midnight UTC), the builder thinks "today" is tomorrow. The batch-scheduler already uses `getTodayInTimezone(timezone)` correctly — the nightly builder does not.

### Bug 2: Nightly builder only schedules through Sunday, not a rolling week
Lines 420-421: `daysUntilSunday + 1`. If it runs on Friday, it only fills Sat/Sun. Monday tasks wait until Monday's run. A CAREER task incomplete on Friday sits unscheduled for 2 days.

### Bug 3: Future-day tasks are never cleared before rebuild
The rollover at line 221 filters `.lt('start_time', now.toISOString())` — only past tasks. If the builder ran yesterday and placed tasks on Thursday, running again today appends MORE tasks on Thursday without clearing yesterday's placements. This causes the overlaps and capacity miscounts seen in the screenshots.

The fix is to **widen the existing rollover filter** (not add a new step). Add a second pass that clears future-scheduled non-DONE tasks within the scheduling horizon, using the same update pattern (lines 253-264) but WITHOUT incrementing `pushed_count` or writing rollover history.

### Bug 4: No overlap detection in batch-calendar-scheduler
The AI can return two tasks at the same time. The batch-scheduler validates window constraints (line 512-529) but never checks if a newly accepted slot overlaps a previously accepted slot in the same batch. The nightly builder tracks `accumulatedBusySlots` and passes them to the capacity math, but the batch-scheduler's busy-slots query (lines 136-150) only fetches DB-persisted tasks — it doesn't know about other tasks accepted earlier in the same AI response.

### Bug 5: `call-context-builder` has its own hardcoded window mappings
Lines 25-31 define `CATEGORY_WINDOW_MAPPING` that differs from `scheduling-defaults.ts`:
- LIFE maps to `['morning', 'after_work', 'evening', 'weekends']` in call-context-builder
- LIFE maps to `['flexible']` in scheduling-defaults

This means Iris shows different tasks than the scheduler places. It should import from `scheduling-defaults.ts` or at minimum stay in sync.

## Implementation plan

### 1. Fix nightly builder "today" to use timezone helper
**File**: `supabase/functions/nightly-schedule-builder/index.ts`
- Import `getTodayInTimezone` from `_shared/timezone.ts`
- Line 212: Replace `now.toISOString().split('T')[0]` with `getTodayInTimezone(timezone)`
- This also fixes the day-boundary queries at lines 456-465 that use `targetISO` (which derives from this same date)

### 2. Change scheduling horizon to rolling 7 days
**File**: `supabase/functions/nightly-schedule-builder/index.ts`
- Lines 420-421: Replace `daysUntilSunday + 1` with `const totalDays = 7`
- This ensures Friday runs can place weekday tasks on Monday

### 3. Add future-task clearing pass using existing rollover pattern
**File**: `supabase/functions/nightly-schedule-builder/index.ts`
- After the existing rollover (line 273), add a second pass:
  - Query tasks where `is_scheduled=true`, `status != DONE`, and `start_time` is within the scheduling horizon (today + 7 days)
  - Clear `start_time`, `end_time`, `is_scheduled` using the same update pattern
  - Do NOT increment `pushed_count` (these aren't "pushed", they're being rebuilt)
  - Do NOT write history (they haven't happened yet)
- This uses the exact same update logic already proven at lines 253-264

### 4. Add overlap rejection in batch-calendar-scheduler
**File**: `supabase/functions/batch-calendar-scheduler/index.ts`
- After parsing AI results and before the validation loop (line 490), maintain an `acceptedSlots` array
- For each AI result that passes window validation, check if `[start, end)` overlaps any entry in `acceptedSlots`
- If overlap: reject with reason "overlaps previously accepted task"
- If no overlap: add to `acceptedSlots` and accept

### 5. Align call-context-builder with scheduling-defaults
**File**: `supabase/functions/_shared/call-context-builder.ts`
- Import `DEFAULT_CATEGORY_MAPPINGS` from `scheduling-defaults.ts`
- Derive `CATEGORY_WINDOW_MAPPING` from it instead of hardcoding
- This ensures Iris shows the same task-to-window mapping as the scheduler

## Files changed summary

| File | Change |
|------|--------|
| `nightly-schedule-builder/index.ts` | Fix "today" to use `getTodayInTimezone`; change horizon to 7 days; add future-task clearing pass |
| `batch-calendar-scheduler/index.ts` | Add overlap rejection after AI response parsing |
| `_shared/call-context-builder.ts` | Derive window mappings from `scheduling-defaults.ts` |

## What is NOT changed (already working)

- Candidate scoring logic (both server and client)
- `validateTaskWindow` flexible fix (already deployed)
- Activity context hints in AI prompt (already deployed)
- Client-side `selectSchedulingCandidates` (already uses shared scoring)
- Timezone utilities in `_shared/timezone.ts` and `src/lib/date.ts`
- Schedule history preservation
- Stale task archival
- Rollover history writing

## Checklist (per SCHEDULING_RULES.md)

1. **Authoritative path**: nightly-schedule-builder + batch-calendar-scheduler + call-context-builder
2. **Affected views**: All views consuming scheduled tasks from `tasks` table
3. **Coverage**: nightly builder ✓, fill-gaps (inherits from batch-scheduler fix) ✓, manual scheduling ✓, Iris context ✓
4. **Assignments**: Unaffected — clearing returns them to candidate pool, scoring re-prioritizes
5. **Timezone**: Fixed — nightly builder now uses `getTodayInTimezone` like batch-scheduler already does
6. **Verification**: After deploy, trigger nightly builder and query today's tasks to confirm no overlaps, correct windows, matching Iris context

