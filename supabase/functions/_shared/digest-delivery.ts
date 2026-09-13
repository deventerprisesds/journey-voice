// WHAT:       the pure decision layer for the morning digests -- which digests a user gets, on
//             which channels, at which instant. The edge function `send-digests` is the shell that
//             executes this plan; everything decidable without I/O lives here so it is testable.
// WHY:        the owner receives none of the three digests he asked for. Measured cause, read from
//             source rather than inferred: notification-scheduler's `daily_digest` reads the user's
//             channel preference into `userChannels` at index.ts:523 and then NEVER USES IT -- it
//             invokes `send-push-notification` unconditionally. So "I changed it to email" could
//             not have worked: no code path consulted the setting. That variable is read and
//             discarded in the same function, which is why the symptom looked like a delivery
//             failure rather than a missing branch.
// SUPERSEDES: nothing (notification-scheduler's generateDailyDigest stays -- it is a different,
//             count-only push notification; this is the rich 8am brief the owner described).
// SUPERSEDED-BY: nothing -- current
// EVIDENCE:   src/utils/digestDelivery.test.ts; AC-digest-delivery.md sections C and F.

import {
  type DigestChannel,
  canonicalChannel,
  DAILY_DIGEST_LOCAL_HOUR,
  shouldSendAtLocalHour,
  localClockParts,
  DEFAULT_TIMEZONE,
} from "./digest-content.ts";
import { type DigestName } from "./digest-source.ts";

/** The user's stored notification preferences, as far as the digests care. */
export interface DigestPrefs {
  user_id: string;
  timezone?: string | null;
  /** Multi-select. UPPERCASE canonical transports, e.g. ['EMAIL','SLACK']. */
  channels?: string[] | null;
  daily_digest_enabled?: boolean | null;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
}

/**
 * The channels a digest should actually be RENDERED for.
 *
 * Two filters, and both matter:
 *  - a stored channel that does not map to a render target is dropped (not guessed at);
 *  - `phone` is dropped for digests specifically. A digest is a document -- a schedule, a ranked
 *    list, a link to drag-and-drop -- and reading it down a phone line produces the thing the owner
 *    already has a call for. Phone stays the scheduled-CALL channel; it is not a digest channel.
 *
 * Returns [] when nothing survives, and the caller must then send NOTHING rather than falling back
 * to push: a silent fallback is how "I set it to email" ended up delivering as push for weeks.
 */
export function selectDigestChannels(raw: string[] | null | undefined): DigestChannel[] {
  const out: DigestChannel[] = [];
  for (const r of raw ?? []) {
    const c = canonicalChannel(String(r));
    if (!c) continue;
    if (c === "phone") continue;
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

/** HH:MM -> minutes, or null when unparseable. Shared by the quiet-hours test below. */
function hhmmToMinutes(v: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec((v ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Is `localMinutes` inside the user's quiet hours?
 *
 * Handles the overnight case (22:00 -> 07:00) by testing the UNION of the two spans rather than a
 * single `start <= t < end`, which is false for every minute of an overnight window and would let
 * a 3am digest through on exactly the users who asked for silence.
 */
export function inQuietHours(
  localMinutes: number,
  start: string | null | undefined,
  end: string | null | undefined,
): boolean {
  const s = hhmmToMinutes(start);
  const e = hhmmToMinutes(end);
  if (s === null || e === null) return false;
  if (s === e) return false;
  return s < e ? localMinutes >= s && localMinutes < e : localMinutes >= s || localMinutes < e;
}

export interface DigestPlan {
  userId: string;
  timezone: string;
  /** Local YYYY-MM-DD the digests are ABOUT. */
  date: string;
  channels: DigestChannel[];
  digests: DigestName[];
  /** Set when nothing is to be sent -- carried so a run log can say WHY, not just "0 sent". */
  skipReason?: string;
}

/**
 * Decide what this user gets right now.
 *
 * All three digests share ONE 8am tick deliberately: the owner asked for "an 8am email" and a
 * meetings summary in the same breath, and three independent schedules would deliver three separate
 * emails at three slightly different minutes. Each digest still decides its own emptiness downstream
 * -- `meetingsDigestIsEmpty` and `standupDigestIsEmpty` -- so a quiet day produces fewer sections,
 * never an empty message.
 */
export function planDigestRun(
  prefs: DigestPrefs,
  now: Date,
  opts: { immediate?: boolean } = {},
): DigestPlan {
  const timezone = (prefs.timezone || "").trim() || DEFAULT_TIMEZONE;
  // Derived HERE, from the one instant, rather than accepted as arguments: a caller passing a date
  // and a minute-of-day that disagree with each other (trivially easy across midnight) would place
  // the digest on the wrong day while the hour gate still said yes.
  const parts = localClockParts(now, timezone);
  const localDate = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  const localMinutes = parts.hour * 60 + parts.minute;
  const base: DigestPlan = {
    userId: prefs.user_id,
    timezone,
    date: localDate,
    channels: [],
    digests: [],
  };

  if (prefs.daily_digest_enabled === false) {
    return { ...base, skipReason: "daily_digest_disabled" };
  }

  // `immediate` is the manual/test path and deliberately bypasses BOTH gates -- otherwise the only
  // way to exercise the digest is to wait until 8am in the user's zone.
  if (!opts.immediate) {
    if (!shouldSendAtLocalHour(now, timezone, DAILY_DIGEST_LOCAL_HOUR)) {
      return { ...base, skipReason: "outside_local_hour" };
    }
    if (inQuietHours(localMinutes, prefs.quiet_hours_start, prefs.quiet_hours_end)) {
      return { ...base, skipReason: "quiet_hours" };
    }
  }

  const channels = selectDigestChannels(prefs.channels);
  if (channels.length === 0) {
    // NEVER fall back to push here. That silent fallback is the measured defect this module
    // exists to end -- it made a user's explicit email choice invisible.
    return { ...base, skipReason: "no_deliverable_channel" };
  }

  return { ...base, channels, digests: ["daily_brief", "meetings", "standup"] };
}
