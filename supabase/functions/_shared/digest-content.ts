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
import { toCanonicalChannel, type CanonicalChannel } from "./notification-channels.ts";

// ---------------------------------------------------------------------------
// Channel + kind vocabulary
// ---------------------------------------------------------------------------

/**
 * Canonical channel vocabulary for RENDERING.
 *
 * RECONCILED with the transport vocabulary (2026-09-13). Two lanes independently
 * built an alias table: `toCanonicalChannel` in `notification-channels.ts` returns
 * UPPERCASE TRANSPORT identifiers (EMAIL, OUTLOOK_EVENT, ...), this one returns
 * lowercase RENDER targets. They are genuinely different concerns -- you deliver to
 * OUTLOOK_EVENT but you never RENDER one -- so neither was deleted. What WAS deleted
 * is the second alias list: `canonicalChannel` now DELEGATES to `toCanonicalChannel`
 * and maps its result down to a render target. One table, two views, so a new spelling
 * learned by the transport layer cannot go unknown to the renderer.
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
/**
 * Transport identifier -> render target. Calendar-event channels deliberately map to
 * null: a calendar hold is written, never rendered as a message body, so asking this
 * for a renderer is a caller error rather than a missing case.
 */
const RENDER_TARGET: Partial<Record<CanonicalChannel, DigestChannel>> = {
  EMAIL: "email",
  SLACK: "slack",
  PUSH: "push",
  APP_MESSAGE: "app_message",
  PHONE: "phone",
};

export function canonicalChannel(raw: string): DigestChannel | null {
  const transport = toCanonicalChannel(raw);
  return transport ? RENDER_TARGET[transport] ?? null : null;
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
 * Optional override for the app's public base URL. NO DEPLOY ACTION IS REQUIRED.
 *
 * CORRECTED 2026-09-13. An earlier version of this comment claimed "journey has no absolute base
 * URL anywhere (verified: zero repo-wide hits for APP_URL / PUBLIC_URL / VITE_APP_URL / SITE_URL)"
 * and therefore made `APP_BASE_URL` a REQUIRED new secret with no default. That grep searched for
 * variable NAMES and never for the VALUE, which was in the repo the whole time --
 * `public/bridge.config.json:4` `"baseUrl": "https://journey-voice.lovable.app"`, plus
 * `src/utils/bootTrace.ts:50` and `src/utils/dailyReviewPipeline.ts:609`. The owner caught it:
 * a new Supabase secret was invented on the back of a bad search, against a standing instruction
 * to add no new Supabase infrastructure during the Azure migration.
 *
 * So the default below is the REAL published host, and the env var is an override for a different
 * deployment -- exactly the shape `huddle-task-sync/index.ts:18` (`HUDDLE_SYNC_URL`) and
 * `drain-huddle-turns/index.ts:17` already use in this repo.
 */
export const APP_BASE_URL_ENV = "APP_BASE_URL";

/** `public/bridge.config.json:4` -- the app's published host, read from the repo, not invented. */
export const APP_BASE_URL_DEFAULT = "https://journey-voice.lovable.app";

/**
 * Still thrown, but now only for a base URL that is present and UNUSABLE -- a non-http value, or
 * localhost, which would ship a dead link to a human. The "unset" case can no longer occur, since
 * `buildDeepLink` falls back to the published host above.
 */
export class MissingDeepLinkBaseError extends Error {
  constructor(detail = "") {
    super(
      `Cannot build an absolute deep link${detail ? `: ${detail}` : ""}. A relative or localhost ` +
        `path is dead in an email. Override the default with ${APP_BASE_URL_ENV} if this ` +
        `deployment is not ${APP_BASE_URL_DEFAULT}.`,
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
  // Unset falls back to the published host. An explicitly BAD value still throws -- a wrong
  // override is a misconfiguration worth failing on, where an absent one is simply the default.
  const base = ((baseUrl || "").trim() || APP_BASE_URL_DEFAULT).trim();
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

// ---------------------------------------------------------------------------
// AC-REND-1 (Tier 1) -- a phone script must never reach an email
// ---------------------------------------------------------------------------

/**
 * Structural markers of a phone-call SCRIPT, as authored in
 * `call_configs.context` (branch labels + stage directions).
 *
 * These are a BACKSTOP, not the mechanism. The mechanism is that the renderers
 * below take a typed payload that has no field capable of carrying a script --
 * the only way a script reaches an email is if a caller concatenates it in.
 * This detector catches exactly that.
 */
const CALL_SCRIPT_MARKERS: readonly RegExp[] = [
  /\bBRANCH\s*\d/i,
  /^\s*Greet\s*:/im,
  /\bHello Sir\b/i,
  /^\s*(Stage|Step)\s*\d+\s*:/im,
  /\bIF (?:THEY|USER|HE|SHE)\b/i,
];

export function containsCallScript(text: string): boolean {
  const t = text || "";
  return CALL_SCRIPT_MARKERS.some((re) => re.test(t));
}

export class CallScriptLeakError extends Error {
  constructor(channel: DigestChannel) {
    super(
      `Refusing to deliver a phone-call SCRIPT over the "${channel}" channel. ` +
        `A script is a phone artifact; render the payload for this channel instead.`,
    );
    this.name = "CallScriptLeakError";
  }
}

/** Channels a human READS. A script rendered to any of these is the defect. */
export function isReadChannel(channel: DigestChannel): boolean {
  return channel !== "phone";
}

// ---------------------------------------------------------------------------
// Rendering -- one named renderer per channel
// ---------------------------------------------------------------------------

export interface RenderedDigest {
  channel: DigestChannel;
  subject: string;
  /** Plain-text body. Always safe to send as text/plain. */
  body: string;
  /** HTML body, fully escaped. Only produced for `email`. */
  html: string | null;
  contentType: "text/plain" | "text/html";
}

/** AC-REND-4: escape before any HTML body is produced. */
export function escapeHtml(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** AC-REND-2: push is truncated. Word-safe, single trailing ellipsis. */
export const PUSH_MAX_CHARS = 300;

export function truncateForPush(s: string, max: number = PUSH_MAX_CHARS): string {
  const t = (s || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + "…";
}

function titlesOf(p: DigestPayload): { schedule: string[]; priorities: string[] } {
  if (p.kind === "daily_brief") {
    return {
      schedule: p.schedule.map((s) => s.title),
      priorities: p.priorities.map((x) => x.title),
    };
  }
  if (p.kind === "standup") {
    return { schedule: [], priorities: p.priorities.map((x) => x.title) };
  }
  return { schedule: p.today.map((m) => m.title), priorities: [] };
}

function subjectFor(p: DigestPayload): string {
  if (p.kind === "daily_brief") return `Your day — ${p.date}`;
  if (p.kind === "meetings") return `Meetings — ${p.date}`;
  return `Stand-up — ${p.date}`;
}

function line(label: string, items: string[], emptyText: string): string[] {
  if (items.length === 0) return [`${label}: ${emptyText}`];
  return [`${label}:`, ...items.map((t) => `  • ${t}`)];
}

function plainBodyFor(p: DigestPayload): string {
  const out: string[] = [];
  if (p.kind === "daily_brief") {
    out.push(
      ...line(
        "Today's schedule",
        p.schedule.map((s) =>
          s.startLocal ? `${s.startLocal} — ${s.title}` : s.title
        ),
        "nothing scheduled",
      ),
    );
    out.push("");
    out.push(
      ...line(
        "Your priorities, in order",
        p.priorities.map((x, i) => `${i + 1}. ${x.title}`),
        "no priorities ranked",
      ),
    );
    if (p.calendarHolds.length > 0) {
      out.push("");
      out.push(
        ...line(
          "Calendar holds",
          p.calendarHolds.map((h) => `${h.startLocal}–${h.endLocal} ${h.title}`),
          "none",
        ),
      );
    }
  } else if (p.kind === "meetings") {
    out.push(
      ...line(
        "Meetings today",
        p.today.map((m) => `${m.startLocal} — ${m.title}`),
        "none",
      ),
    );
    const later = p.byDay.filter((d) => d.localDate !== p.date);
    if (later.length > 0) {
      out.push("");
      out.push("Later this week:");
      for (const d of later) {
        out.push(`  ${d.localDate}`);
        for (const m of d.meetings) out.push(`    • ${m.startLocal} — ${m.title}`);
      }
    }
  } else {
    out.push(...line("Produced", p.produced.map((x) => x.title), "nothing yet"));
    out.push("");
    out.push(...line("In review", p.inReview.map((x) => x.title), "nothing"));
    out.push("");
    out.push(
      ...line(
        "Blocked",
        p.blocked.map((x) => (x.reason ? `${x.title} (${x.reason})` : x.title)),
        "nothing blocked",
      ),
    );
    out.push("");
    out.push(
      ...line(
        "Priorities",
        p.priorities.map((x, i) => `${i + 1}. ${x.title}`),
        "none ranked",
      ),
    );
  }
  return out.join("\n");
}

/**
 * Render a payload for ONE channel.
 *
 * AC-REND-2: email / app_message / push / slack are produced by distinct named
 * branches and are NOT byte-identical -- push is truncated and carries no link,
 * email carries the deep link exactly once (AC-REND-3).
 */
export function renderDigest(
  payload: DigestPayload,
  channel: DigestChannel,
): RenderedDigest {
  const subject = subjectFor(payload);
  const core = plainBodyFor(payload);

  // Backstop: a script must never have been concatenated into a read channel.
  if (isReadChannel(channel) && containsCallScript(core)) {
    throw new CallScriptLeakError(channel);
  }

  if (channel === "email") return renderEmail(subject, core, payload);
  if (channel === "push") return renderPush(subject, core, payload);
  if (channel === "slack") return renderSlack(subject, core, payload);
  if (channel === "app_message") return renderAppMessage(subject, core, payload);
  return renderPhone(subject, core, payload);
}

function renderEmail(
  subject: string,
  core: string,
  p: DigestPayload,
): RenderedDigest {
  const body = `${core}\n\nRe-rank your priorities: ${p.deepLink}`;
  const html =
    `<p>${escapeHtml(core).replace(/\n/g, "<br>")}</p>` +
    `<p><a href="${escapeHtml(p.deepLink)}">Re-rank your priorities</a></p>`;
  return { channel: "email", subject, body, html, contentType: "text/plain" };
}

function renderPush(subject: string, core: string, _p: DigestPayload): RenderedDigest {
  const t = titlesOf(_p);
  const head =
    t.priorities.length > 0
      ? `First up: ${t.priorities[0]}`
      : t.schedule.length > 0
        ? `First up: ${t.schedule[0]}`
        : core;
  return {
    channel: "push",
    subject,
    // No link: push taps open the app, and a URL eats the character budget.
    body: truncateForPush(head),
    html: null,
    contentType: "text/plain",
  };
}

function renderSlack(subject: string, core: string, p: DigestPayload): RenderedDigest {
  return {
    channel: "slack",
    subject,
    body: `*${subject}*\n${core}\n\n<${p.deepLink}|Re-rank your priorities>`,
    html: null,
    contentType: "text/plain",
  };
}

function renderAppMessage(
  subject: string,
  core: string,
  p: DigestPayload,
): RenderedDigest {
  return {
    channel: "app_message",
    subject,
    body: `${core}\n\nRe-rank: ${p.deepLink}`,
    html: null,
    contentType: "text/plain",
  };
}

function renderPhone(subject: string, core: string, _p: DigestPayload): RenderedDigest {
  // Spoken: no bullets, no URL (a human cannot hear a link).
  const spoken = core
    .replace(/•/g, "")
    .replace(/^\s+/gm, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, ", ");
  return { channel: "phone", subject, body: spoken, html: null, contentType: "text/plain" };
}

// ---------------------------------------------------------------------------
// AC-REND-1 call site -- the replacement for notification-delivery/index.ts:239
// ---------------------------------------------------------------------------

/**
 * Render a SCHEDULED CALL for one channel.
 *
 * `notification-delivery/index.ts:239` currently builds every channel's body as
 *   body: `Time for your ${(call_name || title).toLowerCase()}. ${context}`
 * where `context` is the phone script verbatim. That is correct for `phone` and
 * wrong for every other channel.
 *
 * WIRING (one line, in a file this module does NOT own):
 *   body: renderScheduledCall({
 *     callName: callConfig.call_name || callNotification.title,
 *     context: callConfig.context || '',
 *     channel: canonicalChannel(commsMode) ?? 'app_message',
 *   }).body
 */
export function renderScheduledCall(input: {
  callName: string;
  context: string;
  channel: DigestChannel;
}): RenderedDigest {
  const name = (input.callName || "your call").trim();
  const subject = `Time for your ${name.toLowerCase()}`;

  if (input.channel === "phone") {
    // The script IS the artifact here. Pass it through unchanged.
    return {
      channel: "phone",
      subject,
      body: `${subject}. ${input.context || ""}`.trim(),
      html: null,
      contentType: "text/plain",
    };
  }

  // Every read channel gets a human sentence. The script is never included.
  const body = `${subject}.`;
  if (containsCallScript(body)) throw new CallScriptLeakError(input.channel);
  return {
    channel: input.channel,
    subject,
    body,
    html: input.channel === "email" ? `<p>${escapeHtml(body)}</p>` : null,
    contentType: "text/plain",
  };
}

// ---------------------------------------------------------------------------
// AC-TZ -- "8am" must mean the USER'S 8am, across DST
// ---------------------------------------------------------------------------

export const DEFAULT_TIMEZONE = "America/New_York";

export interface LocalClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday. */
  weekday: number;
}

/**
 * Wall-clock parts for `now` in `tz`.
 *
 * Reuses `_shared/timezone.ts`'s `getTzOffsetMinutesAt`, which resolves the
 * offset AT THE GIVEN INSTANT via Intl -- so DST is handled per-date and no
 * fixed -5/-4 is ever assumed (AC-TZ-4). This module adds no second Intl path.
 */
export function localClockParts(now: Date, tz: string): LocalClockParts {
  const zone = tz || DEFAULT_TIMEZONE;
  const shifted = new Date(now.getTime() + getTzOffsetMinutesAt(now, zone) * 60000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

/** The scheduler's tick width. `notification-scheduler` fires every 15 min. */
export const TICK_WINDOW_MINUTES = 15;

/**
 * True when `now` falls in the first `TICK_WINDOW_MINUTES` of `hour` LOCAL to
 * the user. Pass `weekday` to additionally pin a day (0 = Sunday).
 *
 * A NULL/empty timezone falls back to America/New_York and still sends -- the
 * user is never skipped for missing config (AC-TZ-5).
 */
export function shouldSendAtLocalHour(
  now: Date,
  tz: string | null | undefined,
  hour: number,
  weekday?: number,
): boolean {
  const parts = localClockParts(now, tz || DEFAULT_TIMEZONE);
  if (weekday !== undefined && parts.weekday !== weekday) return false;
  return parts.hour === hour && parts.minute < TICK_WINDOW_MINUTES;
}

export const DAILY_DIGEST_LOCAL_HOUR = 8;
export const WEEKLY_DIGEST_LOCAL_HOUR = 9;
export const WEEKLY_DIGEST_LOCAL_WEEKDAY = 0; // Sunday
