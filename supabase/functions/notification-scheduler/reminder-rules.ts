// WHAT:       The reminder rules for notification-scheduler, as pure functions: the quiet-hours check,
//             the "may overdue reminders run this tick" gate + generator (J10), and the task-backed
//             calendar-event skip (J13).
// WHY:        main fired overdue pushes on `now.getHours() === 9` (server clock = UTC), i.e. 05:00 in
//             New York (04:00 after DST ends), with no quiet-hours check. J10 (74ba671) fixed it on a
//             parked branch; this module restores it and puts it where a test can reach it (index.ts
//             calls `serve` on import, so nothing inside it is testable).
//             The local-hour check is `shouldSendAtLocalHour` from _shared/digest-content.ts -- the
//             SAME helper the daily/weekly digest already uses -- so this file adds no second
//             timezone method (the branch used a `toLocaleString` re-parse; see RESTORE-step4-j10.md).
// SUPERSEDES: the inline `generateOverdueReminders` / `isInQuietHours` / task-backed check in index.ts (moved here).
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   docs/qc-evidence/RESTORE-step4-j10.md; run: node --experimental-strip-types --test
//             supabase/functions/notification-scheduler/reminder-rules.test.ts

import { shouldSendAtLocalHour } from "../_shared/digest-content.ts";

/** Overdue reminders fire in the first tick of this hour, LOCAL to the user. */
export const OVERDUE_REMINDER_LOCAL_HOUR = 9;

export interface OverdueTask {
  id: string;
  title: string;
  due_date?: string;
}

export interface QuietHoursPrefs {
  timezone: string | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
}

/** Moved verbatim from index.ts (main). Relies on the server clock being UTC, as Supabase's is. */
export function isInQuietHours(now: Date, prefs: QuietHoursPrefs): boolean {
  const userTz = prefs.timezone || 'UTC';
  const userTime = new Date(now.toLocaleString("en-US", {timeZone: userTz}));

  const quietStart = prefs.quiet_hours_start;
  const quietEnd = prefs.quiet_hours_end;

  if (!quietStart || !quietEnd) return false;

  const currentHour = userTime.getHours();
  const currentMinute = userTime.getMinutes();
  const currentTime = currentHour * 60 + currentMinute;

  const [startHour, startMinute] = quietStart.split(':').map(Number);
  const [endHour, endMinute] = quietEnd.split(':').map(Number);

  const startTime = startHour * 60 + startMinute;
  const endTime = endHour * 60 + endMinute;

  // Handle overnight quiet hours (e.g., 22:00 to 08:00)
  if (startTime > endTime) {
    return currentTime >= startTime || currentTime < endTime;
  } else {
    return currentTime >= startTime && currentTime < endTime;
  }
}

/** J10: overdue reminders never run during the user's quiet hours (main ran them regardless). */
export function overdueRemindersAllowed(
  prefs: { overdue_reminders_enabled: boolean },
  inQuietHours: boolean,
): boolean {
  return !inQuietHours && !!prefs.overdue_reminders_enabled;
}

export function generateOverdueReminders(
  tasks: OverdueTask[],
  userId: string,
  now: Date,
  timezone: string | null | undefined,
): any[] {
  const notifications: any[] = [];
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  for (const task of tasks) {
    if (!task.due_date) continue;

    const dueDate = new Date(task.due_date);
    dueDate.setHours(0, 0, 0, 0);

    // Task is overdue
    if (dueDate < today) {
      const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

      // Send reminder every 3 days for overdue tasks, once per day (first 15-min tick of the hour).
      // J10: the USER's 9am, not the server's 9am-UTC (which is 5am in New York).
      if (daysOverdue % 3 === 0 && shouldSendAtLocalHour(now, timezone, OVERDUE_REMINDER_LOCAL_HOUR)) {
        notifications.push({
          user_id: userId,
          task_id: task.id,
          notification_type: 'overdue_reminder',
          title: `Task Overdue (${daysOverdue} days)`,
          body: `"${task.title}" was due ${daysOverdue} day${daysOverdue > 1 ? 's' : ''} ago`,
          scheduled_for: new Date(now.getTime() + 5 * 60 * 1000).toISOString() // 5 minutes from now
        });
      }
    }
  }

  return notifications;
}

/**
 * J13 (250c3b1): a calendar event that is only the calendar copy of a journey task gets NO calendar
 * reminder -- the task's own start reminder already alarms with its task id, so this one only
 * produced a SECOND, task-less alarm (no Done/Doing). The link is recorded on either side:
 * external_calendar_events.source_task_id, or tasks.external_event_id (collected by the caller).
 */
export function isTaskBackedEvent(
  event: { source_task_id?: string | null; external_event_id?: string | null },
  taskBackedEventIds: Set<string>,
): boolean {
  return !!event.source_task_id ||
    (!!event.external_event_id && taskBackedEventIds.has(event.external_event_id));
}
