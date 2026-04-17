
The user is reporting the Daily Review modal layout is unusable on mobile (411px). The right column of stat cards is clipped off-screen with no horizontal scroll. They want whatever layout changes I made during/after the pipeline fix reverted.

## What I need to verify first

I changed `dailyReviewPipeline.ts` (logic only) and bumped `sw.js` + `index.html` cache version. I do NOT recall changing `DailyReviewModal.tsx` layout. But the prior screenshot (Apr 16) showed a clean 2×2 grid and current (Apr 17) shows clipped cards — so something in the modal's render changed.

Possibilities:
1. I (or a prior change in this thread) added new stat tiles (e.g. Assignments, backlog overflow line) that broke the grid
2. The grid was always `grid-cols-2` but new content widened cells beyond viewport
3. New diagnostic bullets / "Live: dev@" badge pushed layout

I need to read `DailyReviewModal.tsx` and check git/edit history references in this thread to identify exactly what layout changes happened alongside the pipeline fix.

## Plan

### Step 1 — Read current DailyReviewModal.tsx
Identify the stat-card grid markup and any tiles/lines added recently (Assignments tile, backlog overflow subtitle, Live badge, new diagnostic bullets).

### Step 2 — Identify what to revert
Compare against the Apr 16 screenshot (2×2 grid: Scheduled / Calendar Events / Overdue / Rolled Over, no Live badge, no Assignments tile, no backlog overflow line). Anything beyond that is a candidate for revert.

### Step 3 — Recommend revert path
Two options:
- **(A) Surgical revert**: keep the pipeline logic fix (4/1 counts) but remove the new tiles/badges/bullets that broke layout, restoring the Apr 16 2×2 grid.
- **(B) Full revert via History**: roll back to the message before any of these changes shipped. User loses pipeline fix and re-sees 171/39, but UI is usable.

### Step 4 — Present recommendation
Default to (A): preserve the data correctness work, restore the working layout. Offer (B) via History tab as the clean rollback if user prefers.

### Files I'd touch in option A
- `src/components/DailyReviewModal.tsx` — restore 2×2 grid, remove Assignments tile, remove backlog overflow line, remove Live badge, remove new diagnostic bullets
- No pipeline file changes
- No sw.js / index.html changes (keep v11)

I'll need to read the modal first to confirm what's actually there before presenting a precise revert.
