

# Add Assignment Count to Stats + Create Pipeline

## Current State
- `dailyReviewPipeline.ts` does **not exist** — the approved pipeline plan was never implemented
- The stats grid shows `scheduledCount` and `externalEventCount` but no assignment count
- Assignment QC logic exists (lines 250-266) but only as a text explanation, not a stat card
- Calendar event count is in the stats object (line 277) and rendered (line 382)

## Plan

### 1. Add assignment stats to `ScheduleReasoning.stats`
Add two fields:
- `pendingAssignmentCount` — total incomplete assignments across backlog
- `assignmentsScheduledToday` — assignments in today's schedule

### 2. Add assignment stat card to the stats grid
Render a stat card showing assignments scheduled today vs pending, similar to the calendar events card. Show conditionally when `pendingAssignmentCount > 0`.

### 3. Create `src/utils/dailyReviewPipeline.ts` (from approved plan)
The structured pipeline with 8 named steps, each logging inputs/outputs to `activity_log`. The pipeline output includes:
- `externalEventCount` and `externalBlockedMinutes`
- `pendingAssignmentCount` and `assignmentsScheduledToday`
- All window category breakdowns
- Build version proof

### 4. Update `activityLogger.ts`
Remove the `DEV_USER_ID` guard for `daily_review_reasoning` activity type so all users get pipeline logging.

### 5. Refactor `DailyReviewModal.tsx`
- Replace inline `useMemo` reasoning (lines 100-286) with pipeline call
- Add assignment stat card to the grid
- Bump SW cache version in `public/sw.js` to `'v9'`

## Files Changed
| File | Change |
|------|--------|
| `src/utils/dailyReviewPipeline.ts` | New — structured pipeline |
| `src/components/DailyReviewModal.tsx` | Use pipeline, add assignment stat card |
| `src/utils/activityLogger.ts` | Remove dev-only guard for pipeline logs |
| `public/sw.js` | Bump cache version to v9 |
| `index.html` | Update build-version meta tag |

