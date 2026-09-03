/**
 * NUDGE DELIVERY — turning computed nudges into an actual conversation.
 *
 * THE DEFECT THIS FIXES. journey already computes two kinds of nudge correctly and
 * delivers neither. Measured 2026-08-28: 4 `scheduling_context.venue_nudge` markers and 3
 * `task_overflow_queue` rows existed on the live board, and EVERY consumer of both was a
 * passive reader — `_shared/build-day-context.ts`, `src/utils/buildDayContext.ts` and
 * `DailyReviewModal.tsx` all just `.filter(...)` them into a view. There was not one
 * notification, push or chat writer anywhere in the nudge path. So a "nudge" only existed
 * if the user happened to open the briefing or the review modal, on the exact day the task
 * was scheduled. That is an annotation, not a nudge — and it contradicts the repo's own
 * rule that "Iris NUDGES the user ... so Iris ASKS whether to fill it".
 *
 * WHY `scheduled_chat` AND NOT A NEW SENDER. That channel already does exactly this:
 * notification-delivery posts `metadata.message` as an Iris chat message AND sends a push
 * that opens the chat on tap. The dedup notice (_shared/task-dedup.ts) proved it end to
 * end. Reusing it means no new sender, no new secret, no new deep-link plumbing.
 *
 * WHY THIS LIVES IN JOURNEY, NOT HUDDLE. Owner requirement 2026-09-03: a journey-only user
 * must get the same benefit ("my friend doesn't have huddle but if I give them journey to
 * install they should have the same benefit"). journey computes and delivers; Huddle reads
 * the same rows through the existing proxy, the way chat history is shared rather than
 * Huddle-owned. Nothing here depends on Huddle being installed.
 *
 * ONE DIGEST, NOT ONE PER NUDGE. Seven nudges existed on the measured day; seven pushes
 * would train the user to ignore them. A single message carries them all, and the payload
 * stays machine-readable so the client can render actionable rows rather than prose.
 */

export type NudgeKind = 'venue' | 'overflow' | 'empty_window';

export interface NudgeAction {
  /** Stable verb the client maps to a control. */
  id: 'move' | 'keep' | 'snooze' | 'bump' | 'add_work';
  label: string;
  /** Everything the action needs to execute, so the client needs no extra lookup. */
  payload: Record<string, unknown>;
}

export interface Nudge {
  kind: NudgeKind;
  /** Stable across runs so re-delivering the same nudge can be suppressed. */
  key: string;
  taskId?: string;
  title: string;
  /** Human sentence. MUST describe the real placement — see buildVenueNudgeMessage. */
  message: string;
  localDate: string;
  actions: NudgeAction[];
  meta?: Record<string, unknown>;
}

const DAY_MS = 86400000;

/** Local Y-M-D in the user's timezone (not the runtime's). */
export function localDayOf(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: timezone });
}

function localHourOf(iso: string, timezone: string): number {
  const h = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: 'numeric', hour12: false,
  }).format(new Date(iso));
  return parseInt(h, 10);
}

function isWeekendLocal(iso: string, timezone: string): boolean {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' })
    .format(new Date(iso));
  return wd === 'Sat' || wd === 'Sun';
}

/**
 * BUG FIX (measured 2026-08-28). The old venue-nudge text was a fixed template asserting
 * the task "is scheduled after work" REGARDLESS of where it actually landed. Two of the
 * four live nudges were weekend placements, so "Go to church" at Sunday 10:00 — a
 * perfectly sensible slot — was told it needed moving into business hours. Nonsense advice
 * trains the user to dismiss every nudge.
 *
 * Now the wording is derived from the ACTUAL placement, and a placement that is already
 * fine returns null so no nudge is raised at all.
 */
export function buildVenueNudgeMessage(
  title: string,
  startISO: string,
  timezone: string,
  businessHours: { start: number; end: number } = { start: 9, end: 17 },
): string | null {
  const hour = localHourOf(startISO, timezone);
  const weekend = isWeekendLocal(startISO, timezone);

  // Already inside weekday business hours — the venue is open, nothing to say.
  if (!weekend && hour >= businessHours.start && hour < businessHours.end) return null;

  // Weekend DAYTIME is fine for most errands; only flag genuinely awkward weekend hours.
  if (weekend) {
    if (hour >= 10 && hour < 17) return null;
    return `"${title}" is on the weekend at ${hour}:00. Most places that need a counter are shut then — want it moved into the day?`;
  }

  if (hour < businessHours.start) {
    return `"${title}" is scheduled at ${hour}:00, before most places open. Move it into business hours?`;
  }
  return `"${title}" is scheduled at ${hour}:00, after most places close. Move it into business hours?`;
}

export function venueNudge(
  task: { id: string; title: string; start_time: string; scheduling_context?: any },
  timezone: string,
  businessHours?: { start: number; end: number },
): Nudge | null {
  const message = buildVenueNudgeMessage(task.title, task.start_time, timezone, businessHours);
  if (!message) return null;
  const localDate = localDayOf(task.start_time, timezone);
  return {
    kind: 'venue',
    key: `venue:${task.id}:${localDate}`,
    taskId: task.id,
    title: task.title,
    message,
    localDate,
    actions: [
      { id: 'move', label: 'Move it', payload: { taskId: task.id, toWindow: task.scheduling_context?.venue_nudge?.toWindow || 'business_hours' } },
      { id: 'keep', label: 'Leave it', payload: { taskId: task.id } },
      { id: 'snooze', label: 'Not now', payload: { taskId: task.id, days: 7 } },
    ],
  };
}

export function overflowNudge(
  row: { task_id: string; overflow_date: string; message?: string | null;
         suggested_bump_task_id?: string | null; suggested_bump_title?: string | null },
  title: string,
): Nudge {
  const bump = row.suggested_bump_task_id
    ? [{ id: 'bump' as const, label: `Bump "${row.suggested_bump_title}"`,
         payload: { taskId: row.task_id, bumpTaskId: row.suggested_bump_task_id, date: row.overflow_date } }]
    : [];
  return {
    kind: 'overflow',
    key: `overflow:${row.task_id}:${row.overflow_date}`,
    taskId: row.task_id,
    title,
    message: row.message || `"${title}" couldn't fit ${row.overflow_date}.`,
    localDate: row.overflow_date,
    actions: [
      ...bump,
      { id: 'keep', label: 'Leave it', payload: { taskId: row.task_id } },
      { id: 'snooze', label: 'Not now', payload: { taskId: row.task_id, days: 7 } },
    ],
  };
}

/**
 * Compose the digest text. Deliberately plain and specific — it is read aloud by a voice
 * assistant as often as it is seen, so it leads with the count and then one line per item.
 */
export function composeDigest(nudges: Nudge[]): { title: string; message: string } {
  const n = nudges.length;
  const title = n === 1 ? 'One thing worth a look' : `${n} things worth a look`;
  const lines = nudges.map((x) => `• ${x.message}`);
  return {
    title,
    message: `${n === 1 ? 'One item' : `${n} items`} on your schedule I'd flag:\n${lines.join('\n')}`,
  };
}

/**
 * Queue the digest as a `scheduled_chat` notification.
 *
 * `scheduledFor` is honoured rather than "now" so the caller can hold it to morning — the
 * nightly build runs at 01:00 and a 1am push about shoe shopping is worse than useless.
 * Returns the number of nudges delivered (0 when there is nothing to say — silence is the
 * correct behaviour, not an empty "no nudges today" message).
 */
export async function deliverNudgeDigest(
  supabase: any,
  userId: string,
  nudges: Nudge[],
  opts: { scheduledFor?: string } = {},
): Promise<number> {
  if (!nudges.length) return 0;
  const { title, message } = composeDigest(nudges);
  await supabase.from('scheduled_notifications').insert({
    user_id: userId,
    notification_type: 'scheduled_chat',
    scheduled_for: opts.scheduledFor ?? new Date().toISOString(),
    title,
    body: message,
    metadata: {
      message,
      source: 'nudges',
      // Machine-readable so the client renders actionable rows instead of parsing prose.
      nudges: nudges.map((x) => ({
        kind: x.kind, key: x.key, taskId: x.taskId, title: x.title,
        message: x.message, localDate: x.localDate, actions: x.actions,
      })),
    },
  });
  return nudges.length;
}

/** Next occurrence of `hour` local time, at or after `from`. Used to hold the 01:00
 *  build's nudges until the morning. */
export function nextLocalHour(from: Date, hour: number, timezone: string): string {
  for (let d = 0; d <= 1; d++) {
    const day = new Date(from.getTime() + d * DAY_MS);
    const ymd = day.toLocaleDateString('en-CA', { timeZone: timezone });
    // Resolve the true UTC instant for `hour` local on that date by probing the offset.
    const probe = new Date(`${ymd}T${String(hour).padStart(2, '0')}:00:00Z`);
    const offsetMin =
      (probe.getTime() -
        new Date(probe.toLocaleString('en-US', { timeZone: timezone })).getTime()) / 60000;
    const candidate = new Date(probe.getTime() + offsetMin * 60000);
    if (candidate.getTime() >= from.getTime()) return candidate.toISOString();
  }
  return from.toISOString();
}
