// WHAT:       The single with-a-person classifier + 7-day day-grouping for the meetings digest,
//             plus the provider-agnostic attendee/showAs normalizers used by BOTH sync paths.
// WHY:        `attendees` was stored nowhere (verified 2026-09-13, zero grep hits) and
//             `organizer` is a FALSE with-a-person signal -- the owner organizes their own solo
//             holds, so organizer-based classification marks every focus block as a meeting
//             (AC-MTG-2; AC doc C8d). Live proof of the trap in this very DB: "Haircut"
//             (solo) and "Call with Travis Wagner" (2-person) are BOTH calendar_id='primary'
//             and indistinguishable without attendees.
// SUPERSEDES: nothing.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   .claude/IMPL-meetings.md; AC-MTG-1..8 in .claude/AC-digest-delivery.md section F.

import { isDateInTimezone } from './timezone.ts';

/**
 * Rolling horizon for the meetings digest, in days (today + the next 6).
 *
 * EXTEND-DON'T-DUPLICATE (AC-MTG-6): this is the ONE horizon declaration this work
 * introduces. `nightly-schedule-builder` currently inlines the same 7 twice
 * (`:432` `horizonEnd.setDate(getDate() + 7)` and `:717` `const totalDays = singleDay ? 1 : 7`).
 * Those two literals should be replaced by an import of this constant -- a one-line change in
 * a file this work does not own. Until then the value is identical by construction and this
 * comment is the link between them. No NEW `setDate(... + 7)` or `totalDays =` literal is
 * introduced anywhere by this work.
 */
export const MEETING_HORIZON_DAYS = 7;

/** Provider-agnostic attendee. This shape is what lands in external_calendar_events.attendees. */
export interface NormalizedAttendee {
  email: string;
  name?: string;
  /** Provider said this attendee IS the calendar owner (Google sets `self`). */
  self?: boolean;
  optional?: boolean;
  /** A room / equipment / resource mailbox -- present, but NOT a person. */
  resource?: boolean;
  responseStatus?: string;
}

/** Graph's showAs vocabulary is canonical; Google's transparency is mapped onto it. */
export type ShowAs =
  | 'free' | 'tentative' | 'busy' | 'oof' | 'workingElsewhere' | 'unknown';

/**
 * Owner's settled decision: `busy` and `tentative` count as a meeting;
 * `free` and `oof` do not. (AC-MTG-7 -- a stated, tested rule, not an accident of the field
 * having been discarded.)
 *
 * `workingElsewhere` counts: the owner is working, just not at their desk.
 * `unknown` and NULL count: legacy rows predate capture, and silently dropping them would
 * make the digest go quiet rather than show a meeting the owner has. Erring toward surfacing
 * is the correct direction for a digest.
 */
export function showAsCountsAsMeeting(showAs: string | null | undefined): boolean {
  if (showAs === null || showAs === undefined || showAs === '') return true;
  const v = String(showAs).toLowerCase();
  if (v === 'free' || v === 'oof') return false;
  return true;
}

/** Google `transparency` / Graph `showAs` -> one vocabulary. */
export function normalizeShowAs(
  event: any,
  provider: 'google' | 'outlook',
): ShowAs | null {
  if (provider === 'outlook') {
    const raw = event?.showAs;
    return raw ? (String(raw) as ShowAs) : null;
  }
  // Google: `transparency: 'transparent'` means "free"; absent/'opaque' means busy.
  // `eventType: 'outOfOffice'` is Google's OOF equivalent.
  if (event?.eventType === 'outOfOffice') return 'oof';
  if (event?.transparency === 'transparent') return 'free';
  if (event?.status === 'tentative') return 'tentative';
  return 'busy';
}

function cleanEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

/**
 * Map a raw provider event's attendees into the ONE stored shape.
 * Returns [] when the provider sent none -- which means "no attendee data", not "solo".
 */
export function normalizeAttendees(
  event: any,
  provider: 'google' | 'outlook',
): NormalizedAttendee[] {
  const raw = Array.isArray(event?.attendees) ? event.attendees : [];
  const out: NormalizedAttendee[] = [];

  for (const a of raw) {
    if (!a) continue;
    if (provider === 'outlook') {
      // Graph: { emailAddress: {address, name}, type: required|optional|resource,
      //          status: { response } }
      const email = cleanEmail(a?.emailAddress?.address);
      if (!email) continue;
      const type = String(a?.type ?? '').toLowerCase();
      out.push({
        email,
        name: a?.emailAddress?.name || undefined,
        optional: type === 'optional' || undefined,
        resource: type === 'resource' || undefined,
        responseStatus: a?.status?.response || undefined,
      });
    } else {
      // Google: { email, displayName, self, optional, resource, responseStatus }
      const email = cleanEmail(a?.email);
      if (!email) continue;
      out.push({
        email,
        name: a?.displayName || undefined,
        self: a?.self === true || undefined,
        optional: a?.optional === true || undefined,
        resource: a?.resource === true || undefined,
        responseStatus: a?.responseStatus || undefined,
      });
    }
  }
  return out;
}

/** A stored event row, in the shape the classifier needs. */
export interface MeetingRow {
  attendees?: NormalizedAttendee[] | null;
  show_as?: string | null;
  start_time: string;
  title?: string | null;
  [k: string]: unknown;
}

/**
 * Attendees who are OTHER PEOPLE: excludes the owner (by `self` flag or by address match)
 * and excludes resource/room mailboxes.
 */
export function otherPeople(
  row: MeetingRow,
  ownerEmails: Iterable<string>,
): NormalizedAttendee[] {
  const owners = new Set<string>();
  for (const e of ownerEmails) {
    const c = cleanEmail(e);
    if (c) owners.add(c);
  }
  const list = Array.isArray(row?.attendees) ? row.attendees : [];
  return list.filter((a) => {
    if (!a || !a.email) return false;
    if (a.resource === true) return false;
    if (a.self === true) return false;
    return !owners.has(cleanEmail(a.email));
  });
}

/**
 * THE CLASSIFIER (AC-MTG-2, AC-MTG-3).
 * With-a-person == at least one attendee other than the owner, AND an availability status
 * that counts. Deliberately does NOT consult `organizer` -- see the WHY header.
 */
export function isWithPerson(row: MeetingRow, ownerEmails: Iterable<string>): boolean {
  if (!showAsCountsAsMeeting(row?.show_as)) return false;
  return otherPeople(row, ownerEmails).length >= 1;
}

export interface MeetingDay {
  /** Local calendar date, YYYY-MM-DD in the owner's timezone. */
  date: string;
  /** 0 == today. */
  offset: number;
  meetings: MeetingRow[];
}

/**
 * Group with-a-person meetings BY DAY across the rolling horizon (AC-MTG-5).
 * Only days that actually have meetings are returned, so the caller cannot silently merge
 * them into one flat list. Day bucketing uses the owner's timezone via the existing
 * _shared/timezone.ts helpers -- no second date implementation.
 */
export function groupMeetingsByDay(
  rows: MeetingRow[],
  ownerEmails: Iterable<string>,
  tz: string,
  now: Date = new Date(),
  horizonDays: number = MEETING_HORIZON_DAYS,
): MeetingDay[] {
  const owners = Array.from(ownerEmails);
  const qualifying = (rows ?? []).filter((r) => isWithPerson(r, owners));

  // Local YYYY-MM-DD for each day in the horizon. 'en-CA' yields YYYY-MM-DD, matching the
  // format isDateInTimezone() compares against -- same formatter, so the two cannot drift.
  // NOTE: getTodayInTimezone(tz) takes ONE argument and always formats `new Date()`, so it
  // cannot be used for a future offset (it would return today 7 times and collapse the
  // grouping into a single day). Verified by reading _shared/timezone.ts:184.
  const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz });
  const days: MeetingDay[] = [];
  for (let offset = 0; offset < horizonDays; offset++) {
    const d = new Date(now.getTime() + offset * 86400000);
    days.push({ date: dayFormatter.format(d), offset, meetings: [] });
  }

  for (const row of qualifying) {
    for (const day of days) {
      if (isDateInTimezone(row.start_time, day.date, tz)) {
        day.meetings.push(row);
        break;
      }
    }
  }

  for (const day of days) {
    day.meetings.sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
  }
  return days.filter((d) => d.meetings.length > 0);
}

/**
 * The digest's send/suppress gate (AC-MTG-4): send when there is at least one qualifying
 * meeting ANYWHERE in the horizon (today or later in the week); suppress only when the whole
 * window is empty. Never produces an empty-state email.
 */
export function shouldSendMeetingsDigest(days: MeetingDay[]): boolean {
  return days.some((d) => d.meetings.length > 0);
}
