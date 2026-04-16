

Yes — fixing semantics first is the right call. Everything else (data source split, build-version badges, structured IDs) is downstream of getting the definitions right. If "rolled over" and "overdue" are defined wrong, no amount of scoping will make the numbers make sense.

## Minimal semantic fix

Two definitions need to change in `src/utils/dailyReviewPipeline.ts`. Nothing else this round.

### 1. "Rolled over today" — currently wrong

**Now:** `todayTasks.filter(t => (t.pushed_count ?? 0) > 0)`
This counts every task scheduled today that has *ever* been pushed in its lifetime. A task pushed 170 times last month but legitimately scheduled today still counts.

**Should be:** a task scheduled today whose *previous* scheduled date was a past day that has now passed without completion.

Practical signal available without new infra:
- task is in today's live schedule (`start_time` falls on `todayStr` in user TZ)
- AND task has a `task_schedule_history` row with `scheduled_date < todayStr` and action indicating it was moved/rolled (not completed)

If history lookup is too heavy for the modal, fall back to: `is_scheduled = true AND start_time on today AND pushed_count > 0 AND updated_at >= today_start`. The `updated_at` clamp removes the lifetime-pushed contamination.

### 2. "Overdue" — currently wrong

**Now:** `new Date(t.due_date) < new Date()` — timezone-naive, marks same-day tasks overdue based on time of day.

**Should be:** `due_date < todayStr` compared as YYYY-MM-DD strings in the user's timezone. A task due today is never overdue.

Then for the Daily Review card, intersect with today's scheduled set so the count can never exceed `scheduledCount`.

### 3. Hard invariant

Add a single assertion in the pipeline output:
```
rolledOverCount <= scheduledCount
overdueCount <= scheduledCount
```
If violated, log a `daily_review_invariant_violation` and clamp the displayed number. This prevents the "171 of 9" UI from ever shipping again even if a future regression slips in.

## What we explicitly defer

- Splitting Daily Review off `useUnifiedTasks` (data source change)
- New `scheduled_reason` field in `scheduling_context`
- Build-version badge / SW cache bump
- Backend `nightly-schedule-builder` changes

If after this fix the numbers are still wrong on the live account, the cause is data-source contamination (history rows leaking in), and we tackle that next as a separate, smaller change.

## Files

| File | Change |
|------|--------|
| `src/utils/dailyReviewPipeline.ts` | Redefine `rolledOverIds` and `overdueIds`; add invariant clamp + log |

One file, two definitions, one guardrail. Ship, verify on `journey-voice.lovable.app` with the dev account, then decide if step 2 (data source split) is still needed.

