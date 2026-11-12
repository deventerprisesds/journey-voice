// WHAT:       Decides whether a nightly-schedule-builder request runs in the BACKGROUND (answer 202 at once,
//             keep working under EdgeRuntime.waitUntil) or in the foreground (answer when done).
// WHY:        2026-11-11 and 2026-11-12 the owner's 7-day run was cut off at the HTTP gateway's 150s limit
//             (function_edge_logs: POST 504 at 05:02:33, 150s after the 05:00:03 start) with days 5-7
//             unbuilt, the top-up pass never run and no nightly_schedule_built row written. The worker
//             itself may run longer (the 2026-11-10 run wrote its row 188s in); only the WAITING request
//             is capped. Week runs take 66-196s, so they must not hold a request open.
// SUPERSEDES: nothing. Same pattern as drain-huddle-turns, run-scheduled-ceremonies and
//             _shared/rebuild-schedule.ts. SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   _shared/builder-background.test.ts
//
// Every caller already learns the outcome from the activity_log row 'nightly_schedule_built' (FocusView,
// DailyReviewModal, rebuild_schedule status), never from the response body, so a 202 loses nothing.
// Single-day runs stay in the foreground: they are short, and keeping them unchanged keeps the app's
// "Reschedule today" error path exactly as it is.

export function runsInBackground(body: unknown): boolean {
  return !(body && typeof body === 'object' && (body as { singleDay?: unknown }).singleDay === true);
}
