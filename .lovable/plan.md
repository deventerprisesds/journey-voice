
## What you're seeing & the two real problems

### Problem 1 — "Reject instead of shuffle" is the core scheduling bug

The builder treats the AI scheduler's response as final: if `batch-calendar-scheduler` rejects a slot (overlap, window mismatch, AI didn't return one), the candidate is **dropped silently for the day** instead of being re-tried in another valid window or shuffled around busy slots. That's why business hours show empty bands while accepted candidates list more.

The Pass-3 top-up I added only pulls *deferred Tier B/C* into open slots — it doesn't retry rejected non-assignment items. So priority-board work that gets bumped by a calendar event or AI miss is just... gone for the day.

**Root cause:** No reshuffle pass. The pipeline is "select → AI place → commit OR drop." It needs "select → AI place → commit → for rejected, retry in next valid window → commit OR defer with reason."

### Problem 2 — Modal grid breaks at narrow widths (≤411px)

`DailyReviewModal` uses `grid-cols-2 md:grid-cols-4` for the stat tiles. At your 411px viewport, the 4-tile row tries to render 2-up, but the recently-added **Assignments tile** (full-width row added in the prior plan) is being rendered *inside* the same grid as a 5th item, which collapses badly when there's no breakpoint between mobile and `md:`. Assignments tile also doesn't show calendar/external-event status, so when it says "0/32" you can't tell if the scheduler even checked your calendar.

## Plan — 3 surgical fixes

### Fix 1 — Add a reshuffle/retry pass for AI-rejected candidates
**File:** `supabase/functions/nightly-schedule-builder/index.ts`

Per day, after the main `batch-calendar-scheduler` call:
1. Compute `rejected = selected − committed`
2. For each rejected candidate, identify **next valid window** (next allowed window for the task's category that still has capacity for the day)
3. Single retry call to `batch-calendar-scheduler` with rejected set + expanded window list (all category-allowed windows, not just preferred)
4. Commit any successes; remaining failures get logged to `activity_log` as `RESCHEDULE_DEFERRED` with reason (window-full, all-windows-tried, AI-no-slot)

Cap retries at 1 per day to prevent runaway. This is the same retry mechanism already approved in the prior plan but applied to **all rejected candidates**, not just assignments.

### Fix 2 — Daily Review modal layout for narrow viewports
**File:** `src/components/DailyReviewModal.tsx`

- Stat tiles: `grid-cols-2` always (no `md:grid-cols-4`). 4 tiles stack 2×2 cleanly at any width.
- Assignments tile: separate **full-width row below** the 2×2 grid (not inside it). Always rendered.
- Add a **second full-width row**: "Calendar Status" tile showing `N events synced today · M busy slots respected` OR `No external calendar events for today` so users know the scheduler actually checked.
- AI conversation panel: wrap `recentAssistantMessages` in its own scroll container (`max-h-[30vh] overflow-y-auto`) above the chat input. Confirm/Fill Gaps stay visible.

### Fix 3 — Pipeline messaging includes calendar outcome
**File:** `src/utils/dailyReviewPipeline.ts`

Add to the `ASSIGNMENT_QC` / today summary:
- `calendar_status`: `{ events_today: N, busy_slots_used: M, source: ['google', 'outlook'] }` from existing builder logs
- Pipeline message line: `"Checked X calendar events on Y connected calendars — N slots reserved as busy."` (or "No calendar events for today" when zero)
- Reshuffle outcome line: `"Z tasks reshuffled into alternate windows; W deferred — see Fill Gaps."`

## Files

1. `supabase/functions/nightly-schedule-builder/index.ts` — reshuffle pass (Fix 1)
2. `src/components/DailyReviewModal.tsx` — 2×2 grid + Assignments + Calendar tiles + AI panel scroll (Fix 2)
3. `src/utils/dailyReviewPipeline.ts` — calendar status + reshuffle messaging (Fix 3)

## Will NOT touch

- Tier classification, scoring (Email AI professor fix from prior approved plan still applies)
- Pass 1A/1B/1C assignment placement
- External calendar sync logic, busy-slot detection, two-way deletion safeguard
- Window validation, buffer, alignment, dedup, history snapshot

## Acceptance gate

1. Modal renders cleanly at 411px (your current viewport): 2×2 stats, full-width Assignments tile, full-width Calendar tile, scrollable AI panel, visible Confirm button
2. Calendar tile shows event count OR "No external calendar events for today" — never silent
3. Builder log shows `RESCHEDULE_RETRY` step with rejected→retried→committed counts
4. Business hours block fills more completely: rejected candidates from preferred window get a second shot in alternate windows
5. `RESCHEDULE_DEFERRED` log entries explain *why* a task didn't fit (not silent drops)
6. Tier A/B assignments still pre-place; calendar busy slots still respected
