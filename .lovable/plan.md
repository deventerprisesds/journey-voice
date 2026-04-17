
## Pre-flight audit
- Files inspected: `src/components/DailyReviewModal.tsx`, `src/hooks/useChatAssistant.ts`, `src/utils/dailyReviewPipeline.ts`, `src/lib/date.ts`, `src/components/FocusView.tsx`, `src/utils/activityLogger.ts`, `mem://constraints/scheduling-preflight-audit.md`, `mem://infrastructure/timezone-normalization-architecture`
- Forbidden patterns found:
  - `src/lib/date.ts:170` uses `new Date(dateString)` in `formatDateOnly` for `YYYY-MM-DD` input
  - `src/utils/dailyReviewPipeline.ts:172` uses `new Date(\`${todayStr}T00:00:00\`)` for recency clamp, but this is not the cause of the missing modal sections
- Shared helpers to use/keep: `getTodayInTimezone`, `isSameDateInTimezone`, `getTimePartsInTimezone`, `formatTimeInTimezone`
- Memory rules invoked: `mem://constraints/scheduling-preflight-audit`, `mem://infrastructure/timezone-normalization-architecture`, `mem://preferences/validation-and-testing-workflow`

## What the code and data actually show
- On the published Dev account, the latest `daily_review_reasoning` rows already contain populated output: `explanationCount=4`, `missingExplanationCount=3`, `externalEventCount=2`, `scheduledCount=4`.
- So the pipeline is producing “How we built today”, Time Windows, and Calendar Events data.
- The visible regression is in the modal UI:
  - stale assistant thread history is leaking into the modal’s `AI Response` panel
  - that panel lives outside the main `ScrollArea` and takes a large chunk of vertical space on mobile
  - this makes the lower sections appear “missing” even though the data exists
- Root cause of the stale chat leak: `messageFloorIndexRef` is captured before `useChatAssistant` finishes hydrating old thread messages, so historical assistant messages get treated as current-session modal messages.
- Separate real bug: `formatDateOnly(todayStr)` is UTC-naive for `YYYY-MM-DD`, which explains the Apr 16 / Apr 17 header mismatch.

## Implementation plan
1. Fix modal-session chat isolation in `src/components/DailyReviewModal.tsx`
   - track modal-open time
   - only show `AI Response` after the user sends a message from this modal session
   - filter assistant messages to current-session messages only, excluding old thread history that hydrates after open

2. Restore the missing visible content in `src/components/DailyReviewModal.tsx`
   - keep the review content as the primary visible area on mobile
   - prevent the leaked AI panel from consuming the modal height before the user has interacted
   - keep Time Windows and Calendar Events visible again in the normal layout

3. Fix the header date bug in `src/lib/date.ts`
   - replace UTC-naive `new Date('YYYY-MM-DD')` parsing in `formatDateOnly`
   - format date-only strings using explicit year/month/day parsing

4. Verify against published Dev data only
   - test on `journey-voice.lovable.app` with user `a3378f93-d655-4913-b2fa-ca5b1d8020f1`
   - confirm the modal opens with no stale AI thread history
   - confirm “How we built today” shows the existing reasoning bullets
   - confirm Time Windows and Calendar Events are visible again
   - confirm the header date matches the user timezone
   - confirm that after sending one modal chat message, only that session’s reply appears in `AI Response`

## Files to change
- `src/components/DailyReviewModal.tsx`
- `src/lib/date.ts`

## Not changing in this pass
- `src/utils/dailyReviewPipeline.ts` reasoning generation for these missing sections
- assignment tiering / overdue semantics
- QC keyword matching
- scheduler overlap logic

## Acceptance criteria
- No stale assistant history appears when the Daily Review modal opens
- “How we built today”, Time Windows, and Calendar Events render from the already-produced published Dev data
- The AI panel only appears after the user actually chats in that modal session
- The modal header shows the correct local date
