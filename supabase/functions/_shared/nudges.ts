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

/**
 * The user's configured working week + business hours. `days` is `Date.getDay()`
 * numbering (0 = Sunday), matching the live `config.timeWindows.business_hours.days`
 * value (`{"end":17,"days":[1,2,3,4,5],"start":9}` for the primary user on 2026-09-03).
 */
export interface BusinessHours {
  start: number;
  end: number;
  /** Working days. Absent => fall back to Mon–Fri. */
  days?: number[];
}

const DEFAULT_BUSINESS_HOURS: BusinessHours = { start: 9, end: 17, days: [1, 2, 3, 4, 5] };

/** Local Y-M-D in the user's timezone (not the runtime's). */
export function localDayOf(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: timezone });
}

// `hourCycle: 'h23'` rather than bare `hour12:false`: on some ICU builds the latter
// formats midnight as "24", which would parse to 24 and push every midnight placement
// into the "after most places close" branch with a nonsense hour.
function localHourOf(iso: string, timezone: string): number {
  const h = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: 'numeric', hourCycle: 'h23',
  }).format(new Date(iso));
  return parseInt(h, 10) % 24;
}

/**
 * The placement time as the user reads it: to the MINUTE, am/pm, lowercase.
 *
 * The old wording floored to the hour and rendered 24-hour — measured by the verifier as
 * `17:45 -> "17:00"`, `20:15 -> "20:00"`. A message whose entire justification is
 * accuracy must not misstate the time by 45 minutes, and every other surface in this
 * repo (e.g. DailyReviewModal) already uses `hour:'numeric', minute:'2-digit',
 * hour12:true`. This is the single renderer for a placement time in a nudge.
 */
export function localTimeLabel(iso: string, timezone: string): string {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));
  // Modern ICU emits U+202F (narrow no-break space) before AM/PM, which `\s` matches —
  // so this one replace normalises the separator AND lowercases the marker.
  return formatted.replace(/\s*(AM|PM)$/i, (_m, p) => ` ${String(p).toLowerCase()}`);
}

function localWeekdayNumber(iso: string, timezone: string): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' })
    .format(new Date(iso));
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
}

/**
 * A day OUTSIDE the user's configured working week — not a hardcoded Sat/Sun.
 * The hours were already config-driven while the days were not, so a user on a Tue–Sat
 * week got the weekday branch on their Saturday and the weekend branch on their Monday.
 */
export function isNonWorkingDayLocal(
  iso: string,
  timezone: string,
  businessHours: BusinessHours = DEFAULT_BUSINESS_HOURS,
): boolean {
  const days = businessHours.days?.length ? businessHours.days : DEFAULT_BUSINESS_HOURS.days!;
  return !days.includes(localWeekdayNumber(iso, timezone));
}

/**
 * BUG FIX (measured 2026-08-28, corrected again 2026-09-03). The old venue-nudge text was
 * a fixed template asserting the task "is scheduled after work" REGARDLESS of where it
 * actually landed — and it was composed BEFORE placement, so it could not have been
 * right. Nonsense advice trains the user to dismiss every nudge.
 *
 * Now the wording is derived from the ACTUAL placement, stated to the minute in the
 * user's timezone, and a placement that is already fine returns null so no nudge is
 * raised at all. THIS FUNCTION IS THE ONLY PLACE VENUE-NUDGE TEXT IS CONSTRUCTED — the
 * builder calls it at the persistence site, and every reader (DailyReviewModal,
 * buildDayContext, the morning digest) renders the string it produced, so all surfaces
 * necessarily agree.
 */
export function buildVenueNudgeMessage(
  title: string,
  startISO: string,
  timezone: string,
  businessHours: BusinessHours = DEFAULT_BUSINESS_HOURS,
): string | null {
  // An unparseable start_time makes every Intl call below THROW ("Invalid time value").
  // The only caller in the digest path sits inside a try/catch that downgrades a throw to
  // a console.warn, so this would have silently switched the whole nudge feature off for
  // that user. No placement we can describe => no nudge. (Caught by this file's own test,
  // not by review.)
  const startMs = Date.parse(String(startISO ?? ''));
  if (!Number.isFinite(startMs)) return null;

  const hour = localHourOf(startISO, timezone);
  const nonWorkingDay = isNonWorkingDayLocal(startISO, timezone, businessHours);
  const at = localTimeLabel(startISO, timezone);

  // Already inside a working day's business hours — the venue is open, nothing to say.
  if (!nonWorkingDay && hour >= businessHours.start && hour < businessHours.end) return null;

  // A non-working DAYTIME is fine for most errands; only flag genuinely awkward hours.
  if (nonWorkingDay) {
    if (hour >= 10 && hour < 17) return null;
    return `"${title}" is on a day off at ${at}. Most places that need a counter are shut then — want it moved into the day?`;
  }

  if (hour < businessHours.start) {
    return `"${title}" is scheduled at ${at}, before most places open. Move it into business hours?`;
  }
  return `"${title}" is scheduled at ${at}, after most places close. Move it into business hours?`;
}

/**
 * The overflow message. Moved here from nightly-schedule-builder/index.ts so that no
 * user-facing nudge sentence is constructed outside this module — the builder was
 * composing this one inline while the venue one lived here, which is how the two drifted.
 */
export function buildOverflowNudgeMessage(args: {
  title: string;
  overflowDate: string;
  reason: string;
  impactFactors?: string[];
  bumpTitle?: string | null;
}): string {
  const factorText = args.impactFactors?.length ? ` (${args.impactFactors.join(', ')})` : '';
  const why = args.reason === 'daily_hours_cap' ? 'daily hours budget reached' : 'no window capacity';
  const bumpText = args.bumpTitle
    ? ` You could bump "${args.bumpTitle}" (lower value) to make room today.`
    : '';
  return `"${args.title}" is high-impact${factorText} but couldn't fit ${args.overflowDate} (${why}).${bumpText}`;
}

export function venueNudge(
  task: { id: string; title: string; start_time: string; scheduling_context?: any },
  timezone: string,
  businessHours?: BusinessHours,
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

/** The `metadata->>'source'` marker every digest row carries. Also the query key. */
export const NUDGE_DIGEST_SOURCE = 'nudges';

/** Sorted, joined nudge keys — the identity of a digest, used to decide re-delivery. */
export function digestFingerprint(nudges: Array<{ key: string }>): string {
  return nudges.map((n) => n.key).sort().join('|');
}

/**
 * Given the digests already queued and undelivered, decide what to do with a freshly
 * computed nudge set. Pure, so the decision is testable without a database.
 *
 * THE RULE, stated once: **a queued undelivered digest must EXACTLY match the current
 * nudge set; otherwise it is replaced.** That single rule closes two separate defects
 * the verifier found (§F4):
 *
 *  - Re-running the builder with nothing changed re-queued a COMPLETE second digest,
 *    because the `key` each nudge carefully computes (`venue:<taskId>:<localDate>`) was
 *    written into the payload and never read. Identical set => `skip`, so three taps of
 *    "Reschedule today" can no longer produce three 08:00 pushes.
 *  - Nothing checked `delivered_at is null`, so a digest that was queued and never
 *    delivered simply accumulated alongside the new one. A changed set => `supersede`:
 *    the stale rows are deleted and exactly one row is inserted, so the count of
 *    undelivered digests is never 2.
 *
 * Superseding carries the CURRENT set rather than a union with the old one: the caller
 * has just recomputed it from live rows, so an item missing from it is an item that is
 * no longer nudge-worthy and must not be resurrected.
 */
export function planDigestDelivery(
  nudges: Nudge[],
  queued: Array<{ id: string; metadata?: any }>,
): { action: 'skip' | 'insert' | 'supersede'; supersedeIds: string[] } {
  if (!nudges.length) return { action: 'skip', supersedeIds: [] };
  const mine = queued.filter((r) => r?.metadata?.source === NUDGE_DIGEST_SOURCE);
  if (!mine.length) return { action: 'insert', supersedeIds: [] };
  const want = digestFingerprint(nudges);
  const have = digestFingerprint(
    mine.flatMap((r) => (Array.isArray(r?.metadata?.nudges) ? r.metadata.nudges : []))
      .filter((n: any) => typeof n?.key === 'string'),
  );
  if (mine.length === 1 && want === have) return { action: 'skip', supersedeIds: [] };
  return { action: 'supersede', supersedeIds: mine.map((r) => r.id) };
}

/**
 * Queue the digest as a `scheduled_chat` notification.
 *
 * `scheduledFor` is honoured rather than "now" so the caller can hold it to morning — the
 * nightly build runs at 01:00 and a 1am push about shoe shopping is worse than useless.
 * Returns the number of nudges delivered (0 when there is nothing to say, or when an
 * identical digest is already queued — silence is the correct behaviour, not an empty
 * "no nudges today" message and not a duplicate).
 *
 * COLUMN NAMES ARE LOAD-BEARING HERE. `scheduled_notifications` has NO `status` and NO
 * `send_at` column (verified 2026-09-03 against information_schema on project
 * wwxgajrtmslzklnyplah); undelivered means `delivered_at is null`. A filter on a column
 * that does not exist is rejected by PostgREST and, inside a `try`, looks exactly like
 * success — which is how the builder's purge silently did nothing for months.
 */
export async function deliverNudgeDigest(
  supabase: any,
  userId: string,
  nudges: Nudge[],
  opts: { scheduledFor?: string } = {},
): Promise<number> {
  if (!nudges.length) return 0;

  // What is already queued and not yet delivered for this user?
  let queued: Array<{ id: string; metadata?: any }> = [];
  const { data: queuedRows, error: queryErr } = await supabase
    .from('scheduled_notifications')
    .select('id, scheduled_for, metadata')
    .eq('user_id', userId)
    .eq('notification_type', 'scheduled_chat')
    .is('delivered_at', null);
  if (queryErr) {
    // LOUD: a failed read here means suppression is not running, and the visible symptom
    // would be duplicate morning pushes with no other trace.
    console.error('[nudges] could not read queued digests — suppression skipped:', queryErr.message ?? queryErr);
  } else {
    queued = queuedRows ?? [];
  }

  const plan = planDigestDelivery(nudges, queued);
  if (plan.action === 'skip') {
    console.log(`[nudges] identical digest already queued (${nudges.length} item(s)) — not re-sending`);
    return 0;
  }
  if (plan.action === 'supersede' && plan.supersedeIds.length) {
    const { error: delErr } = await supabase
      .from('scheduled_notifications')
      .delete()
      .in('id', plan.supersedeIds);
    if (delErr) console.error('[nudges] superseding stale digest failed:', delErr.message ?? delErr);
    else console.log(`[nudges] superseded ${plan.supersedeIds.length} stale undelivered digest(s)`);
  }

  const { title, message } = composeDigest(nudges);
  const { error: insErr } = await supabase.from('scheduled_notifications').insert({
    user_id: userId,
    notification_type: 'scheduled_chat',
    scheduled_for: opts.scheduledFor ?? new Date().toISOString(),
    title,
    body: message,
    metadata: {
      message,
      source: NUDGE_DIGEST_SOURCE,
      // Machine-readable so the client renders actionable rows instead of parsing prose.
      nudges: nudges.map((x) => ({
        kind: x.kind, key: x.key, taskId: x.taskId, title: x.title,
        message: x.message, localDate: x.localDate, actions: x.actions,
      })),
    },
  });
  if (insErr) {
    console.error('[nudges] digest insert failed:', insErr.message ?? insErr);
    return 0;
  }
  return nudges.length;
}

/**
 * Validate the user's configured delivery hour.
 *
 * Measured by the verifier: `25`, `-1` and `NaN` all fell through `nextLocalHour` to its
 * `return from.toISOString()` escape — i.e. SEND NOW, which at the 01:00 cron is exactly
 * the 1am push the hold-to-morning design exists to prevent. A user typing "8am" (=> NaN)
 * got it. Anything not an integer in 0..23 falls back to the default and says so.
 */
export function resolveDeliverHour(raw: unknown, fallback = 8): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (raw === null || raw === undefined || raw === '' || !Number.isInteger(n) || n < 0 || n > 23) {
    if (raw !== null && raw !== undefined && raw !== '') {
      console.warn(`[nudges] invalid nudges.deliverAtLocalHour ${JSON.stringify(raw)} — using ${fallback}`);
    }
    return fallback;
  }
  return n;
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
