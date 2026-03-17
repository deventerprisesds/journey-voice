

## Problem

The nightly scheduler uses arbitrary limits (30 candidates fetched, top 25 sent) without considering how much actual time is available. This leads to either too many tasks (AI marks excess as OVERFLOW) or too few (empty slots). The scheduler should calculate available capacity per time window from user settings, then select exactly enough candidates (by duration) to fill each window.

## Plan

### Modify `supabase/functions/nightly-schedule-builder/index.ts`

**Replace the hardcoded limit(30) and slice(0, 25) with capacity-aware selection:**

#### A. Calculate available minutes per window

After loading `userPref.config`, compute each window's capacity for today:

1. Read `timeWindows` from user config (morning, business_hours, after_work, evening, etc.)
2. Filter windows by day-of-week (remove weekday-only windows on weekends and vice versa)
3. For each valid window: `capacity_minutes = (end - start) * 60`
4. Subtract already-scheduled tasks and calendar events that overlap each window
5. Result: a map like `{ morning: 120, business_hours: 360, after_work: 180 }`

#### B. Match candidates to windows using category mappings

After scoring candidates (keep existing scoring + priority board boost):

1. For each candidate, determine its target window(s) from `categoryMappings[task.category].defaultTimeWindow`
2. Get duration from `estimate_minutes` (default 60)
3. Walk through scored candidates (highest score first), assign each to its preferred window if capacity remains
4. Decrement that window's remaining capacity by the task's duration
5. Stop adding to a window when it's full
6. Skip candidates whose windows are all full

#### C. Remove hardcoded limits

- Remove `.limit(30)` from the candidate query (fetch all eligible candidates)
- Remove `.slice(0, 25)` — capacity math determines the cutoff
- The total candidates sent to `batch-calendar-scheduler` equals exactly what fits

#### D. Pass window capacity context to batch-calendar-scheduler

Add a `windowCapacity` field to the scheduler payload so the AI knows exactly how many minutes remain per window, improving its placement accuracy.

### Files Modified
- `supabase/functions/nightly-schedule-builder/index.ts` — capacity-aware candidate selection
- Redeploy `nightly-schedule-builder`

### Technical Detail: Capacity Calculation

```text
For each window (e.g., business_hours 9am-5pm = 480 min):
  1. Get already-scheduled tasks overlapping [9:00, 17:00] today
  2. Sum their durations
  3. remaining = 480 - sumDurations - breakMinutes
  4. Fill candidates until remaining <= 0
```

Priority board members still get the +10 score boost so they fill slots before general READY/UP_NEXT tasks.

