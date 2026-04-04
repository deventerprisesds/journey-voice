

# Keep Completed Tasks Visible in Focus View (Crossed Out, Not Removed)

## Problem

When a task is marked done, it disappears from the Focus View because three places filter out `status !== 'DONE'`:
1. **Line 281** — `scheduledToday` excludes DONE tasks from rendering
2. **Line 578** — "Clear schedule" DB query excludes DONE (this one is correct — you don't want to clear completed tasks)
3. **Line 632** — Verification query excludes DONE (also correct for clear logic)

The fix is solely in **line 281**: stop filtering out DONE tasks from the displayed timeline. The card already has `line-through` styling for DONE tasks (line 1118), so they'll appear crossed out automatically.

## Changes

**File: `src/components/FocusView.tsx`**

1. **Line 281**: Remove `&& t.status !== 'DONE'` from the `scheduledToday` filter so completed tasks stay visible in the timeline with their original time slot and crossed-out styling.

2. **Dim completed cards**: Add reduced opacity (`opacity-60`) to the card wrapper when `task.status === 'DONE'` so they're visually distinct but still present.

3. **Hide action buttons for done tasks**: The "Go" / play buttons are already hidden for DONE (line 1123). Verify the checkbox remains functional so users can un-complete if needed.

That's it — one line removal + a small styling tweak. The history views (Weekly Agenda, past days) already query `task_schedule_history` which preserves completed task snapshots, so cross-day history is unaffected.

| File | Change |
|------|--------|
| `src/components/FocusView.tsx` line 281 | Remove DONE exclusion from `scheduledToday` filter |
| `src/components/FocusView.tsx` ~line 1095 | Add `opacity-60` class when task is DONE |

