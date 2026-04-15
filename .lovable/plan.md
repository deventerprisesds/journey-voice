

# Diagnosis: Stale Deployed Code

## What's happening

The screenshot shows text like **"candidates may have been lower priority"** and **146 Rolled Over** — both of which were already fixed in the codebase (lines 104-110 scope stats to `scheduledToday`, and hedging language was replaced with deterministic explanations).

**The published site is running old code.** The "Up to date" badge can be misleading if there was a build error or caching issue. The fixes are already in `src/components/DailyReviewModal.tsx`.

## Plan

1. **Force a fresh build** — trigger a republish to ensure the latest `DailyReviewModal.tsx` code (scoped stats, deterministic reasoning, category breakdowns) actually deploys.

2. **Verify on published URL** — after deploy, confirm:
   - "Rolled Over" count matches only tasks within the 10 scheduled today that have `pushed_count > 0`
   - "Overdue" count matches only tasks within the 10 scheduled today that are past due
   - No hedging language ("may have been") appears
   - Category breakdowns and missing-category warnings render per window
   - Assignment QC note appears if applicable

3. **If the build confirms the code is already deployed but still shows old data** — add a cache-busting query param or version string to the build output to rule out CDN/browser caching.

No code changes needed — the logic is already correct in the repo. This is a deployment/cache issue.

