// WHAT:       Pure half of TaskOS's work-calendar feed: config, snapshot validation and mapping of the
//             owner's work-calendar snapshot (published to his EDS OneDrive by his own Power Automate
//             flow) into external_calendar_events rows.
// WHY:        The work mailbox (another company's tenant) refused the app; the owner's flow publishes
//             /automation/appointments/appointments.json into his EDS OneDrive. Owner, 2026-11-08: TaskOS
//             must read OneDrive itself (A: calendar/planning; B: daily messages). Every TaskOS feature that
//             knows about meetings reads external_calendar_events, so writing the work meetings there
//             reaches the planner, reminders, digests and the agent with no per-feature code.
//             Mirrors huddle-extension-app src/features/huddle/lib/external-feeds/onedrive-feed.ts (same
//             envelope contract, same rejections) -- the two apps deploy separately, so the rules live in both.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   supabase/functions/_shared/onedrive-feed.test.ts.
//
// THIS REPO IS PUBLIC: no tenant, drive, flow or calendar identifiers in code. The binding to a person
// comes from the server-only TASKOS_ONEDRIVE_FEED edge secret.

export interface TaskosFeedConfig {
  enabled: boolean;
  /** The EDS Outlook account (calendar_connections.provider_account_email) whose sign-in reads the
   *  OneDrive file AND owns the work-meeting rows. */
  driveAccount: string;
  /** The source (work) mailbox the snapshot must declare. */
  mailbox: string;
  /** true while the flow publishes synthetic data only. */
  synthetic: boolean;
  appointmentsPath: string;
  emailPath: string;
  maxBytes: number;
}

/** external_calendar_events.calendar_id of every work-feed row -- never a real Outlook calendar id. */
export const FEED_CALENDAR_ID = "onedrive-feed";
export const FEED_ID_PREFIX = "feed:";
export const isFeedEventId = (id: string | null | undefined): boolean => String(id ?? "").startsWith(FEED_ID_PREFIX);
export const FEED_SOURCE_EXPECTED = "power-automate-outlook";
const FEED_MAX_RECORDS = 1000;
const FUTURE_SKEW_MS = 10 * 60_000;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const isIso = (v: unknown): boolean => typeof v === "string" && !Number.isNaN(Date.parse(v));

/** Pure: TASKOS_ONEDRIVE_FEED JSON -> config, or null (feature OFF). Fails closed. */
export function parseTaskosFeedConfig(raw: string | undefined | null): TaskosFeedConfig | null {
  if (!raw || !raw.trim()) return null;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!j || typeof j !== "object" || j.enabled !== true) return null;
  const driveAccount = str(j.driveAccount).toLowerCase();
  const mailbox = str(j.mailbox).toLowerCase();
  if (!driveAccount.includes("@") || !mailbox.includes("@")) return null;
  const path = (v: unknown, fallback: string) => {
    const p = str(v) || fallback;
    return p.startsWith("/") && !p.includes("..") ? p : fallback;
  };
  const maxBytes = Number(j.maxBytes);
  return {
    enabled: true,
    driveAccount,
    mailbox,
    synthetic: j.synthetic !== false,
    appointmentsPath: path(j.appointmentsPath, "/automation/appointments/appointments.json"),
    emailPath: path(j.emailPath, "/automation/email/emails.json"),
    maxBytes: Number.isFinite(maxBytes) && maxBytes > 0 ? Math.min(maxBytes, 10_000_000) : 8_000_000,
  };
}

export type SnapshotCheck =
  | { ok: true; records: Record<string, unknown>[]; publishedUtc: string; windowStartUtc: string; windowEndUtc?: string; skipped: number }
  | { ok: false; reason: string };

/** Pure: the shared envelope rules (same as Huddle's validator). */
export function validateSnapshot(
  j: unknown,
  cfg: TaskosFeedConfig,
  feedType: "email_snapshot" | "appointments_snapshot",
  nowMs: number = Date.now(),
): SnapshotCheck {
  if (!j || typeof j !== "object" || Array.isArray(j)) return { ok: false, reason: "not_json" };
  const e = j as Record<string, unknown>;
  if (str(e.schema_version).split(".")[0] !== "1") return { ok: false, reason: "wrong_schema" };
  if (e.feed_type !== feedType) return { ok: false, reason: "wrong_feed_type" };
  if (e.source !== FEED_SOURCE_EXPECTED) return { ok: false, reason: "wrong_source" };
  if (str(e.mailbox).toLowerCase() !== cfg.mailbox) return { ok: false, reason: "wrong_mailbox" };
  if (cfg.synthetic ? e.synthetic !== true : e.synthetic !== false) return { ok: false, reason: "synthetic_mismatch" };
  if (e.complete !== true) return { ok: false, reason: "incomplete" };
  if (!isIso(e.published_utc) || !isIso(e.window_start_utc)) return { ok: false, reason: "bad_timestamps" };
  if (Date.parse(str(e.published_utc)) > nowMs + FUTURE_SKEW_MS) return { ok: false, reason: "bad_timestamps" };
  if (feedType === "appointments_snapshot") {
    if (!isIso(e.window_end_utc) || Date.parse(str(e.window_end_utc)) <= Date.parse(str(e.window_start_utc))) {
      return { ok: false, reason: "bad_timestamps" };
    }
  }
  const snap = e.snapshot as Record<string, unknown> | undefined;
  const value = snap && Array.isArray(snap.value) ? (snap.value as unknown[]) : null;
  if (!value) return { ok: false, reason: "bad_records" };
  if (value.length >= FEED_MAX_RECORDS) return { ok: false, reason: "too_many_records" };
  const records = value.filter(
    (r) => r && typeof r === "object" && !Array.isArray(r) && str((r as Record<string, unknown>).id),
  ) as Record<string, unknown>[];
  return {
    ok: true,
    records,
    publishedUtc: str(e.published_utc),
    windowStartUtc: str(e.window_start_utc),
    windowEndUtc: str(e.window_end_utc) || undefined,
    skipped: value.length - records.length,
  };
}

const parseAddress = (v: unknown): { address: string; name: string } => {
  if (v && typeof v === "object") {
    const ea = ((v as Record<string, unknown>).emailAddress ?? v) as Record<string, unknown>;
    return { address: str(ea.address).toLowerCase(), name: str(ea.name) };
  }
  const s = str(v);
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(s);
  if (m) return { address: m[2].trim().toLowerCase(), name: m[1].trim() };
  return { address: s.includes("@") ? s.toLowerCase() : "", name: s.includes("@") ? "" : s };
};

/** An instant from the offset-bearing field when present, else the plain field read as UTC. */
const instantIso = (rec: Record<string, unknown>, withTz: string, plain: string): string | null => {
  const a = str(rec[withTz]);
  if (a && !Number.isNaN(Date.parse(a))) return new Date(Date.parse(a)).toISOString();
  const b = rec[plain];
  const s = typeof b === "string" ? b : b && typeof b === "object" ? str((b as Record<string, unknown>).dateTime) : "";
  if (!s) return null;
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

/** Graph's showAs vocabulary (the connector may send any letter case). */
const SHOW_AS: Record<string, string> = {
  free: "free",
  tentative: "tentative",
  busy: "busy",
  oof: "oof",
  workingelsewhere: "workingElsewhere",
  unknown: "unknown",
};

/** Pure: the connector's "a@x; b@y" attendee strings -> the NormalizedAttendee shape _shared/meetings.ts
 *  stores, so the meetings digest's "with a person" rule sees work meetings exactly like Outlook ones. */
export function feedAttendees(rec: Record<string, unknown>): { email: string; optional?: boolean; resource?: boolean }[] {
  const out: { email: string; optional?: boolean; resource?: boolean }[] = [];
  const seen = new Set<string>();
  const add = (v: unknown, flags: { optional?: boolean; resource?: boolean }) => {
    for (const part of str(v).split(/[;,]/)) {
      const email = parseAddress(part).address;
      if (!email || seen.has(email)) continue;
      seen.add(email);
      out.push({ email, ...flags });
    }
  };
  add(rec.requiredAttendees, {});
  add(rec.optionalAttendees, { optional: true });
  add(rec.resourceAttendees, { resource: true });
  return out;
}

export interface FeedEventRow {
  user_id: string;
  connection_id: string;
  external_event_id: string;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  is_all_day: boolean;
  location: string | null;
  calendar_id: string;
  is_recurring: boolean;
  attendees: unknown[];
  show_as: string | null;
  organizer_email: string | null;
  last_synced_at: string;
}

/**
 * Pure: snapshot records -> external_calendar_events rows owned by the EDS connection, under the
 * feed calendar id and feed-prefixed external ids (stable across reschedules: the original id).
 */
export function mapFeedEventRows(
  records: Record<string, unknown>[],
  cfg: TaskosFeedConfig,
  connection: { id: string; user_id: string },
  nowIso: string,
): FeedEventRow[] {
  const rows: FeedEventRow[] = [];
  for (const r of records) {
    const start = instantIso(r, "startWithTimeZone", "start");
    const end = instantIso(r, "endWithTimeZone", "end");
    if (!start || !end) continue;
    const loc = r.location;
    const showAs = SHOW_AS[str(r.showAs).toLowerCase()] ?? null;
    rows.push({
      user_id: connection.user_id,
      connection_id: connection.id,
      external_event_id: `${FEED_ID_PREFIX}${cfg.mailbox}:${str(r.id)}`,
      title: str(r.subject) || "Untitled Event",
      description: null, // bodies stay out of TaskOS's calendar rows
      start_time: start,
      end_time: end,
      is_all_day: r.isAllDay === true,
      location:
        (typeof loc === "string" ? str(loc) : loc && typeof loc === "object" ? str((loc as Record<string, unknown>).displayName) : "") ||
        null,
      calendar_id: FEED_CALENDAR_ID,
      is_recurring: !!str(r.recurrence) && str(r.recurrence).toLowerCase() !== "none",
      attendees: feedAttendees(r),
      show_as: showAs,
      organizer_email: parseAddress(r.organizer).address || null,
      last_synced_at: nowIso,
    });
  }
  return rows;
}
