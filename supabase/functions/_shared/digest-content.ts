// =============================================================================
// WHAT:          The ONE shared digest content builder + per-channel renderers.
//                Turns a DayContext into three payloads (daily brief, meetings,
//                stand-up) and renders each payload per delivery channel.
// WHY:           notification-delivery/index.ts:239 builds an EMAIL body as
//                `Time for your ${call_name}. ${context}` -- the raw phone-call
//                SCRIPT. An email therefore literally reads "BRANCH 1... Greet:
//                Hello Sir". A phone script and an email body are different
//                artifacts rendered from the same payload (AC-REND-1, Tier 1).
//                Also: the digest hour fires at 08:00 UTC = 4am ET (AC-TZ-1).
// SUPERSEDES:    nothing. This EXTENDS `_shared/build-day-context.ts` -- it
//                imports that module's DayContext types and defines NO new
//                DayContext shape (AC-BUILD-1, extend-don't-duplicate).
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:      .claude/AC-digest-delivery.md sections A/B/D/E;
//                .claude/IMPL-digest-builder.md for per-AC observed results.
//
// ARCHITECTURE RULING (owner): both apps must work standalone; when integrated,
// journey is the source and the switch. This module therefore lives in journey,
// has ZERO dependency on Huddle, and is the builder an integrated deployment
// uses. The stand-up payload type is defined here as the SHAPE journey accepts
// from Huddle -- journey never assembles a stand-up itself.
// =============================================================================

import type {
  DayContext,
  DayContextScheduleItem,
  DayContextPriorityItem,
  DayContextCalendarHold,
} from "./build-day-context.ts";
import { getTzOffsetMinutesAt } from "./timezone.ts";

// ---------------------------------------------------------------------------
// Channel + kind vocabulary
// ---------------------------------------------------------------------------

/**
 * Canonical channel vocabulary for RENDERING.
 *
 * NOTE (AC-CH-1, unbriefed live bug F3): `send-unified-notification` matches
 * channels UPPERCASE ('PUSH' :597, 'SLACK' :831, 'OUTLOOK_EVENT' :450) while
 * `notification-delivery:240` sends lowercase `CommsMode`. That mismatch is a
 * DELIVERY-layer defect owned by another agent. This module deliberately uses
 * the lowercase `CommsMode` spelling (the caller's spelling) and exports
 * `canonicalChannel()` so whichever vocabulary wins, rendering keys off one.
 */
export type DigestChannel = "email" | "app_message" | "push" | "slack" | "phone";

export type DigestKind = "daily_brief" | "meetings" | "standup";

const KNOWN_CHANNELS: readonly DigestChannel[] = [
  "email",
  "app_message",
  "push",
  "slack",
  "phone",
];

/** Normalise any casing/alias to the one rendering vocabulary. */
export function canonicalChannel(raw: string): DigestChannel | null {
  const c = (raw || "").trim().toLowerCase();
  if (c === "app" || c === "in_app" || c === "message") return "app_message";
  if (c === "sms" || c === "call" || c === "voice") return "phone";
  return (KNOWN_CHANNELS as readonly string[]).includes(c)
    ? (c as DigestChannel)
    : null;
}

// ---------------------------------------------------------------------------
// Payload 1 -- daily brief (journey builds this today)
// ---------------------------------------------------------------------------

export interface DailyBriefPayload {
  kind: "daily_brief";
  date: string;
  timezone: string;
  /** Straight from DayContext.schedule -- not re-derived. */
  schedule: DayContextScheduleItem[];
  /** DayContext.priorityLane, defensively re-sorted by rank ASC. */
  priorities: DayContextPriorityItem[];
  calendarHolds: DayContextCalendarHold[];
  /** Absolute URL to the drag-to-rank priorities widget. */
  deepLink: string;
}

// ---------------------------------------------------------------------------
// Payload 2 -- meetings digest
//
// INTERFACE ONLY. Attendee capture + the with-a-person classifier are owned by
// another agent (AC-MTG-1..3). This module defines the contract that agent
// fills and renders whatever it produces. `withPerson` is THEIR verdict --
// this module never infers it from `organizer` (AC/C8d: the user organises
// their own solo focus blocks, so organizer alone marks every hold a meeting).
// ---------------------------------------------------------------------------

export interface MeetingAttendee {
  name: string | null;
  email: string | null;
  /** True when this attendee IS the digest's own user (self-excluded). */
  isSelf: boolean;
}

export interface DigestMeeting {
  id: string;
  title: string;
  start: string;
  end: string | null;
  startLocal: string;
  /** Local YYYY-MM-DD -- the key the weekly section groups by. */
  localDate: string;
  location: string | null;
  attendees: MeetingAttendee[];
  /** Set by the classifier agent. Null = not yet classified. */
  withPerson: boolean | null;
  /** Graph `showAs`: busy | free | tentative | oof | workingElsewhere. */
  showAs: string | null;
}

export interface MeetingsDigestPayload {
  kind: "meetings";
  date: string;
  timezone: string;
  today: DigestMeeting[];
  /** Ascending by date. Days with no person-meetings are omitted (AC-MTG-5). */
  byDay: Array<{ localDate: string; meetings: DigestMeeting[] }>;
  deepLink: string;
}

// ---------------------------------------------------------------------------
// Payload 3 -- stand-up. Huddle ASSEMBLES it; journey only needs the shape.
// ---------------------------------------------------------------------------

export interface StandupDigestPayload {
  kind: "standup";
  date: string;
  timezone: string;
  produced: Array<{ title: string; agent?: string | null }>;
  blocked: Array<{ title: string; reason?: string | null }>;
  inReview: Array<{ title: string; agent?: string | null }>;
  /** Huddle's ranked top-N. Must come from `rankTasks`, not a second sort. */
  priorities: Array<{ title: string; rank: number | null }>;
  deepLink: string;
}

export type DigestPayload =
  | DailyBriefPayload
  | MeetingsDigestPayload
  | StandupDigestPayload;

// ---------------------------------------------------------------------------
// Deep link -- fail CLOSED (AC-LINK-1)
// ---------------------------------------------------------------------------

/**
 * The ONE env var this work adds.
 *
 * journey has no absolute base URL anywhere (verified: zero repo-wide hits for
 * APP_URL / PUBLIC_URL / VITE_APP_URL / SITE_URL, including supabase/config.toml).
 * A relative `/priorities` is useless in an email, so one is required.
 *
 * MUST BE SET AT DEPLOY:  supabase secrets set APP_BASE_URL=https://<app-host>
 *
 * There is deliberately NO fallback default. A default such as
 * `?? "https://app.example.com"` would make the missing-config branch
 * unreachable and ship a dead link to a human (AC-LINK-1's stated trap).
 */
export const APP_BASE_URL_ENV = "APP_BASE_URL";

export class MissingDeepLinkBaseError extends Error {
  constructor() {
    super(
      `${APP_BASE_URL_ENV} is not set. A digest cannot be rendered without an ` +
        `absolute base URL -- a relative path is dead in an email. Set it with: ` +
        `supabase secrets set ${APP_BASE_URL_ENV}=https://<app-host>`,
    );
    this.name = "MissingDeepLinkBaseError";
  }
}

/** The drag-to-rank widget. Route verified at src/App.tsx:102. */
export const PRIORITIES_PATH = "/priorities";

/**
 * Build an absolute deep link, or THROW. Callers must record the digest run as
 * FAILED on throw and send nothing -- never a relative path, a localhost URL,
 * or the string "undefined/priorities".
 */
export function buildDeepLink(
  baseUrl: string | null | undefined,
  path: string = PRIORITIES_PATH,
): string {
  const base = (baseUrl || "").trim();
  if (!base) throw new MissingDeepLinkBaseError();
  if (!/^https?:\/\//i.test(base)) throw new MissingDeepLinkBaseError();
  if (/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(base)) {
    throw new MissingDeepLinkBaseError();
  }
  return base.replace(/\/+$/, "") + (path.startsWith("/") ? path : "/" + path);
}

// ---------------------------------------------------------------------------
// Builders -- ONE content builder, three payloads
// ---------------------------------------------------------------------------

/**
 * Daily brief from a DayContext produced by `buildDayContextServer`.
 *
 * The priority lane is re-sorted here by rank ASC even though the builder
 * already sorts it. That is deliberate: AC-BUILD-2's stated trap is a test that
 * passes because the DB query already ordered the rows. Sorting at the payload
 * boundary makes the ORDER a property of this module, so a shuffled input
 * proves the sort rather than proving the query.
 * Null ranks sort LAST (an unranked item is not rank 0).
 */
export function buildDailyBriefPayload(
  ctx: DayContext,
  opts: { deepLink: string },
): DailyBriefPayload {
  return {
    kind: "daily_brief",
    date: ctx.date,
    timezone: ctx.timezone,
    schedule: [...(ctx.schedule ?? [])],
    priorities: sortByRankAsc(ctx.priorityLane ?? []),
    calendarHolds: [...(ctx.calendarHolds ?? [])],
    deepLink: opts.deepLink,
  };
}

function sortByRankAsc(items: DayContextPriorityItem[]): DayContextPriorityItem[] {
  return [...items].sort((a, b) => {
    const ar = a.rank ?? Number.MAX_SAFE_INTEGER;
    const br = b.rank ?? Number.MAX_SAFE_INTEGER;
    return ar - br;
  });
}

/**
 * Meetings digest from meetings the classifier agent has already labelled.
 *
 * Only `withPerson === true` survives. `null` (unclassified) is EXCLUDED, not
 * assumed true -- absent evidence is never a pass.
 */
export function buildMeetingsDigestPayload(
  meetings: DigestMeeting[],
  opts: { date: string; timezone: string; deepLink: string },
): MeetingsDigestPayload {
  const withPeople = (meetings ?? []).filter((m) => m.withPerson === true);
  const today = withPeople
    .filter((m) => m.localDate === opts.date)
    .sort((a, b) => a.start.localeCompare(b.start));

  const grouped = new Map<string, DigestMeeting[]>();
  for (const m of withPeople) {
    const bucket = grouped.get(m.localDate);
    if (bucket) bucket.push(m);
    else grouped.set(m.localDate, [m]);
  }
  const byDay = [...grouped.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([localDate, ms]) => ({
      localDate,
      meetings: [...ms].sort((a, b) => a.start.localeCompare(b.start)),
    }));

  return {
    kind: "meetings",
    date: opts.date,
    timezone: opts.timezone,
    today,
    byDay,
    deepLink: opts.deepLink,
  };
}

/**
 * True when a meetings digest should be suppressed entirely (AC-MTG-4: the
 * owner asked for it only when there ARE meetings -- not an empty-state email).
 */
export function meetingsDigestIsEmpty(p: MeetingsDigestPayload): boolean {
  return p.today.length === 0 && p.byDay.length === 0;
}
