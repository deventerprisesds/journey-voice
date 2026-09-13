// =============================================================================
// WHAT:          The SOURCE half of the meetings digest -- reads the user's calendar rows
//                over the rolling horizon, classifies each one, and returns the
//                `MeetingsDigestPayload` (or null when there is nothing to send).
// WHY:           `digest-content.ts` defines the payload but has no source; `meetings.ts`
//                owns the with-a-person classifier but only ever sees rows it is GIVEN.
//                Nothing joined the two, so the digest had no way to exist. This module is
//                that join and nothing else: every rule it needs already lives somewhere,
//                and it imports each one rather than restating it.
// SUPERSEDES:    nothing.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:      .claude/IMPL-digest-source-meetings.md (column ground truth, decisions,
//                verbatim mutation results); src/utils/digestSourceMeetings.test.ts.
//
// THE TRAP THIS MODULE IS BUILT AROUND (AC-MTG-2): `withPerson` must NEVER be derived from
// the organiser. The owner organises their own solo focus blocks, so organiser-based
// classification marks every hold a meeting. `withPerson` here comes from `isWithPerson`,
// which keys on attendees-excluding-the-owner. Proven by mutation, not by assertion.
// =============================================================================

import {
  MEETING_HORIZON_DAYS,
  groupMeetingsByDay,
  isWithPerson,
  type MeetingRow,
  type NormalizedAttendee,
} from './meetings.ts';
import {
  buildDeepLink,
  buildMeetingsDigestPayload,
  meetingsDigestIsEmpty,
  APP_BASE_URL_ENV,
  DEFAULT_TIMEZONE,
  type DigestMeeting,
  type MeetingAttendee,
  type MeetingsDigestPayload,
} from './digest-content.ts';
import { formatInTimezone, localDateToUtcBounds } from './timezone.ts';

/**
 * Columns this module reads. Verified against the generated types
 * (`src/integrations/supabase/types.ts:1747`) and against the two writers
 * (`calendar-delta-sync/index.ts:327,542`, `calendar-integration-manager/index.ts:275,295`).
 * NOTE the column is `organizer_email` -- there is no `organizer` column. It is selected
 * ONLY so a human debugging a digest can see it; nothing here classifies on it.
 */
export const MEETING_EVENT_COLUMNS =
  'id, title, start_time, end_time, location, attendees, show_as, is_all_day, organizer_email';

export interface LoadMeetingsDigestOptions {
  /** IANA zone. Omitted -> `notification_prefs.timezone` -> DEFAULT_TIMEZONE. */
  timezone?: string | null;
  /** Injectable clock. Omitted -> `new Date()`. */
  now?: Date;
  /** Omitted -> MEETING_HORIZON_DAYS (the ONE horizon declaration). */
  horizonDays?: number;
  /** Injectable "self" addresses. Omitted -> resolved from profiles + calendar_connections. */
  ownerEmails?: string[];
  /** Injectable base URL. Omitted -> the APP_BASE_URL env var. Never defaulted to a string. */
  appBaseUrl?: string | null;
}

/**
 * The APP_BASE_URL read.
 *
 * Written as an optional-chained global lookup rather than a bare `Deno.env.get(...)` for one
 * concrete reason: this repo's tests run under `node --experimental-strip-types`
 * (`package.json` -> `npm test`) and import `_shared/*.ts` directly, where a bare `Deno`
 * identifier is a ReferenceError. Under Deno this is the same call; under node it yields
 * `undefined`, which makes `buildDeepLink` throw `MissingDeepLinkBaseError` -- the correct
 * fail-closed behaviour for an unset base URL, so the guard stays testable instead of
 * being bypassed by a fallback string.
 */
export function readAppBaseUrl(): string | undefined {
  const env = (globalThis as any)?.Deno?.env;
  return typeof env?.get === 'function' ? env.get(APP_BASE_URL_ENV) ?? undefined : undefined;
}

function cleanEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

/**
 * The addresses that count as "self", as a UNION of two real sources:
 *  - `profiles.email`, keyed on `user_id` (the pattern in `huddle-task-sync/index.ts:49`);
 *  - every `calendar_connections.provider_account_email` for the user -- the actual connected
 *    mailboxes. A user can connect more than one, and Graph attendees carry no `self` flag,
 *    so a single address is not enough to recognise the owner in their own attendee list.
 * Each read is independently best-effort: one failing lookup narrows the self set, it never
 * aborts the digest.
 */
export async function resolveOwnerEmails(
  supabaseClient: any,
  userId: string,
): Promise<string[]> {
  const out = new Set<string>();

  try {
    const { data } = await supabaseClient
      .from('profiles')
      .select('email')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();
    const e = cleanEmail(data?.email);
    if (e) out.add(e);
  } catch (_) {
    // best-effort
  }

  try {
    const { data } = await supabaseClient
      .from('calendar_connections')
      .select('provider_account_email')
      .eq('user_id', userId);
    for (const row of Array.isArray(data) ? data : []) {
      const e = cleanEmail(row?.provider_account_email);
      if (e) out.add(e);
    }
  } catch (_) {
    // best-effort
  }

  return [...out];
}

/** `notification_prefs.timezone` -- the table `notification-scheduler` already sends from. */
export async function resolveTimezone(
  supabaseClient: any,
  userId: string,
): Promise<string> {
  try {
    const { data } = await supabaseClient
      .from('notification_prefs')
      .select('timezone')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();
    const tz = typeof data?.timezone === 'string' ? data.timezone.trim() : '';
    if (tz) return tz;
  } catch (_) {
    // fall through -- a user is never skipped for missing config (AC-TZ-5)
  }
  return DEFAULT_TIMEZONE;
}

/** The stored `attendees` JSON, as an array -- or null when the row carries no attendee data. */
export function attendeeEvidence(row: any): NormalizedAttendee[] | null {
  let raw = row?.attendees;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return Array.isArray(raw) ? (raw as NormalizedAttendee[]) : null;
}

/**
 * THE CLASSIFICATION CALL. Delegates to `meetings.ts#isWithPerson`, which keys on
 * attendees-excluding-the-owner -- never on `organizer_email`.
 *
 * Returns `null` when the row carries NO attendee data at all (column NULL, or not an array:
 * a legacy row written before attendee capture shipped). Null is "unclassifiable", and
 * `buildMeetingsDigestPayload` excludes it -- absent evidence is never a pass.
 *
 * An attendee array that is EMPTY is not absent evidence: it is the provider saying "nobody
 * else", i.e. a solo hold, and `isWithPerson` already rules on it (the live "Haircut" fixture
 * in `meetings.test.ts` is `attendees: []` and asserts false). Re-reading `[]` as null here
 * would contradict the module that owns the classifier.
 */
export function classifyWithPerson(
  row: MeetingRow,
  ownerEmails: Iterable<string>,
): boolean | null {
  if (attendeeEvidence(row) === null) return null;
  return isWithPerson(row, ownerEmails);
}

/**
 * Local YYYY-MM-DD for an instant.
 *
 * `getTodayInTimezone(tz)` cannot be used: it takes ONE argument and always formats
 * `new Date()` (timezone.ts:184), so it cannot express an injected clock or a future offset.
 * The formatter here is the same construction `groupMeetingsByDay` buckets with
 * (`Intl.DateTimeFormat('en-CA', { timeZone: tz })`, meetings.ts:195), so the payload's date
 * strings and the grouper's bucket keys cannot drift apart.
 */
function localDayString(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(instant);
}

function selfFlagged(a: NormalizedAttendee, owners: Set<string>): boolean {
  if (a?.self === true) return true;
  return owners.has(cleanEmail(a?.email));
}

/** One stored row -> the payload's meeting shape. Pure; no lookups. */
export function toDigestMeeting(
  row: any,
  opts: { localDate: string; withPerson: boolean | null; timezone: string; ownerEmails: Iterable<string> },
): DigestMeeting {
  const owners = new Set<string>();
  for (const e of opts.ownerEmails) {
    const c = cleanEmail(e);
    if (c) owners.add(c);
  }
  const attendees: MeetingAttendee[] = (attendeeEvidence(row) ?? []).map((a) => ({
    name: a?.name ?? null,
    email: a?.email ?? null,
    isSelf: selfFlagged(a, owners),
  }));

  return {
    id: String(row?.id ?? ''),
    title: row?.title ?? 'Untitled Event',
    start: String(row?.start_time ?? ''),
    end: row?.end_time ?? null,
    startLocal: formatInTimezone(String(row?.start_time ?? ''), opts.timezone),
    localDate: opts.localDate,
    location: row?.location ?? null,
    attendees,
    withPerson: opts.withPerson,
    showAs: row?.show_as ?? null,
  };
}

/**
 * Read + classify the user's meetings over the rolling horizon and build the digest payload.
 *
 * Returns `null` when there is nothing to send (AC-MTG-4: the owner asked for this digest only
 * when there ARE meetings -- never as an empty-state email). The emptiness rule is
 * `meetingsDigestIsEmpty`, not a second count check here.
 *
 * THROWS `MissingDeepLinkBaseError` when APP_BASE_URL is unset. That is deliberate and must
 * propagate: the caller records the run FAILED and sends nothing, rather than mailing a dead
 * relative link.
 */
export async function loadMeetingsDigestPayload(
  supabaseClient: any,
  userId: string,
  opts: LoadMeetingsDigestOptions = {},
): Promise<MeetingsDigestPayload | null> {
  const now = opts.now ?? new Date();
  const horizonDays = opts.horizonDays ?? MEETING_HORIZON_DAYS;
  const tz =
    (typeof opts.timezone === 'string' && opts.timezone.trim()) ||
    (await resolveTimezone(supabaseClient, userId));
  const ownerEmails = opts.ownerEmails ?? (await resolveOwnerEmails(supabaseClient, userId));

  // Deep link FIRST: fail closed before any work, so an unset base URL can never produce a
  // half-built payload that a caller might send anyway.
  const deepLink = buildDeepLink(
    opts.appBaseUrl !== undefined && opts.appBaseUrl !== null
      ? opts.appBaseUrl
      : readAppBaseUrl(),
  );

  const todayLocal = localDayString(now, tz);
  const lastLocal = localDayString(
    new Date(now.getTime() + (horizonDays - 1) * 86400000),
    tz,
  );
  // Local-midnight bounds, same helper the rest of the repo queries days with. The window is
  // today 00:00 local through the END of the horizon's last local day.
  const windowStart = localDateToUtcBounds(todayLocal, tz).start;
  const windowEnd = localDateToUtcBounds(lastLocal, tz).end;

  const { data, error } = await supabaseClient
    .from('external_calendar_events')
    .select(MEETING_EVENT_COLUMNS)
    .eq('user_id', userId)
    .gte('start_time', windowStart)
    .lt('start_time', windowEnd);

  if (error) throw new Error(`[digest-source-meetings] event query failed: ${error.message ?? error}`);
  const rows: MeetingRow[] = Array.isArray(data) ? (data as MeetingRow[]) : [];

  // Day keys for QUALIFYING rows come from the shared grouper, so the payload's day strings
  // are literally the ones meetings.ts produced -- no second bucketing implementation. Rows the
  // grouper drops (solo, unclassified, outside the horizon) still need a date for the
  // DigestMeeting shape; they are excluded downstream, so that key is informational.
  const localDateByRow = new Map<MeetingRow, string>();
  for (const day of groupMeetingsByDay(rows, ownerEmails, tz, now, horizonDays)) {
    for (const r of day.meetings) localDateByRow.set(r, day.date);
  }

  const meetings: DigestMeeting[] = rows.map((row) =>
    toDigestMeeting(row, {
      localDate:
        localDateByRow.get(row) ?? localDayString(new Date(String(row.start_time)), tz),
      withPerson: classifyWithPerson(row, ownerEmails),
      timezone: tz,
      ownerEmails,
    }),
  );

  const payload = buildMeetingsDigestPayload(meetings, {
    date: todayLocal,
    timezone: tz,
    deepLink,
  });

  return meetingsDigestIsEmpty(payload) ? null : payload;
}
