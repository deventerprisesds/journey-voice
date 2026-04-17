

## Summary of all fixes queued up across the conversation

Three independent problem areas, all approved or in-flight. Listed by area with the concrete change and the file.

### A. Calendar conflict enforcement (approved earlier)
The scheduler still allows tasks to overlap real calendar events.

1. **Hard-reject overlaps in `batch-calendar-scheduler`** — build normalized busy intervals from `external_calendar_events` + already-scheduled tasks; reject AI slots that overlap, with explicit reasons (`overlaps_external_event`, `overlaps_scheduled_task`).
2. **Fix busy-slot loading window** — replace `now → range end` with `localDateToUtcBounds(targetDateISO, timezone)` so in-progress events still block.
3. **Reschedule completion UX** — `FocusView` + `DailyReviewModal` wait for the matching `nightly_schedule_built` row before clearing the pending state; show explicit success/failure.
4. **Refresh Daily Review from the completed run** — re-fetch builder log + live events after completion, not from pre-run snapshot.

Files: `supabase/functions/batch-calendar-scheduler/index.ts`, `supabase/functions/nightly-schedule-builder/index.ts`, `src/components/FocusView.tsx`, `src/components/DailyReviewModal.tsx`, `src/utils/dailyReviewPipeline.ts`.

### B. "How we built today" blank / stale modal output (current focus)
Pipeline produces strings, but modal binds to stale state and one string is malformed.

5. **Realtime refresh of `builderLog` in `DailyReviewModal`** — subscribe to `activity_log` inserts where `activity_type = 'nightly_schedule_built'` for the current user; on insert, refresh `builderLog` so the section updates without remount.
6. **Sentinel bullet** — when both `explanations` and `missingExplanations` are empty, render `"Schedule built — no notable adjustments to report"` so the section never appears blank under its header.
7. **Fix double-space empty-window string** — when `eligibleCats` is empty, render `"${w.label} is empty — no categories mapped to this window in your config"` instead of `"… no  tasks in your backlog"`.
8. **Surface reshuffle failure explicitly** — when `committed === 0 && deferred > 0`, push amber bullet: `"Reshuffle attempted N but committed 0 — likely overlap-blocked. Tap Confirm & Fill Gaps."`

Files: `src/components/DailyReviewModal.tsx`, `src/utils/dailyReviewPipeline.ts`.

### C. Explicitly NOT changing (per your corrections)
- **"Overdue Today" tile semantics** — stays as subset of scheduled-today that is past-due.
- **QC keyword substring matcher** — stays as substring; your people/finance early-day rules depend on it.
- **Assignment tier classification** — no change to scoring/policy.

### Verification (per `mem://preferences/validation-and-testing-workflow`)
Tested only on **published Dev account** (`journey-voice.lovable.app`, user `a3378f93-d655-4913-b2fa-ca5b1d8020f1`):
1. Open Daily Review modal, trigger Reschedule from Focus View, confirm "How we built today" updates within seconds without closing modal.
2. Confirm no scheduled task overlaps any external event for today.
3. Confirm reshuffle-zero-committed produces the amber bullet when applicable.
4. Confirm modal header always has at least one bullet under "How we built today."

### Pre-flight audit
- Forbidden patterns: `nightly-schedule-builder/index.ts:345` has `toISOString().split('T')[0]` in a log line — leave as-is (log-only, non-functional).
- Helpers used: `getTodayInTimezone`, `localDateToUtcBounds`, `formatDateOnly`, `getTimePartsInTimezone`.
- Memory rules invoked: scheduling-preflight-audit, timezone-normalization, scheduling-overlap-prevention, calendar-reschedule-sync-integrity, validation-and-testing-workflow, mandatory-debugging-protocols.

### Suggested execution order
Group B first (smallest, unblocks the modal you're staring at), then Group A (deeper scheduler work).

