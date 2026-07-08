/**
 * Constructs the deep-link URL for a calendar_events alarm notification.
 *
 * Single-task alarms include the task ID as a query param so tapping the
 * notification shade or HUN opens the exact task in the app.
 * Multi-task batches fall back to the calendar root.
 *
 * The web app reads `?task=<id>` on Calendar, Tasks, and Dashboard pages
 * and opens the matching task detail panel automatically.
 */
export function alarmDeepLink(taskId: string | null | undefined): string {
  return taskId ? `/calendar?task=${taskId}` : '/calendar';
}
