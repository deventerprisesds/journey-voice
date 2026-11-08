// WHAT:       The one-line text each reminder gets inside a bundled "N Reminders" push.
// WHY:        Overdue nags read "…is due" in the bundle (owner screenshot, 2026-11-08 9:06 AM): the
//             check `type.includes('due_reminder')` ran first and also matches 'overdue_reminder',
//             so the overdue branch below it was unreachable.
// SUPERSEDES: the inline `reminderTexts` mapper in notification-delivery/index.ts.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   scheduled_notifications rows 2026-11-08 14:05 UTC (type overdue_reminder, delivered as "is due").

export interface BatchedNotification {
  notification_type: string;
  title: string;
  body: string;
}

function quotedTitle(body: string): string {
  return body.match(/"([^"]+)"/)?.[1] || 'Task';
}

export function batchLine(n: BatchedNotification): string {
  const t = n.notification_type;
  if (t === 'scheduled_reminder') return `${n.title}: ${n.body}`;
  if (t === 'scheduled_start_now') return `"${quotedTitle(n.body)}" is starting now`;
  // Overdue BEFORE due: 'overdue_reminder' contains 'due_reminder'.
  if (t.includes('overdue_reminder')) return `"${quotedTitle(n.body)}" is overdue`;
  if (t.includes('due_reminder')) return `"${quotedTitle(n.body)}" is due`;
  return n.body;
}
