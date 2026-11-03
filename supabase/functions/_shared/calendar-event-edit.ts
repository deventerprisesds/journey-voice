// WHAT:       pure logic for EDITING (move/retime/rename) and DELETING an existing calendar event:
//             find the event, build the provider patch, gate deletes, and make the provider HTTP call.
// WHY:        journey's calendar tools were create-only (create_calendar_event / create_google_event /
//             create_outlook_event), so "move my 3pm with Dana to 4" or "cancel tomorrow's study block"
//             could not be done by any agent.
// SUPERSEDES: nothing
// SUPERSEDED-BY: nothing -- current
// EVIDENCE:   huddle-extension-app docs/qc-evidence/BUILD-calendar-edit.md (branch claude_calendar-edit)
//
// Everything here is side-effect free except `performCalendarEdit`, which takes `fetchImpl` so tests
// never reach a real calendar. Token acquisition is NOT here: it stays in send-unified-notification,
// the same place the create path gets its tokens (extend, don't duplicate).

export type CalendarProvider = 'outlook' | 'google';

/** calendar_connections.provider spellings -> the two providers we can edit. */
export function normalizeProvider(p: unknown): CalendarProvider | null {
  const s = String(p ?? '').trim().toLowerCase();
  if (s === 'outlook' || s === 'office365' || s === 'microsoft' || s === 'm365') return 'outlook';
  if (s === 'google' || s === 'gcal') return 'google';
  return null;
}

/** One row of public.external_calendar_events, joined to its connection's provider. */
export interface CalendarEventRow {
  external_event_id: string;
  title: string;
  start_time: string;
  end_time: string;
  provider?: string | null;
  connection_id?: string | null;
  is_recurring?: boolean | null;
  is_all_day?: boolean | null;
}

export interface EventQuery {
  /** Provider event id, if the agent already has it (e.g. from a read). */
  event_id?: string;
  /** Words from the event title ("Dana", "study block"). */
  match_title?: string;
  /** The event's CURRENT start time, ISO. */
  match_start?: string;
}

export type MatchResult =
  | { status: 'unique'; event: CalendarEventRow }
  | { status: 'ambiguous'; candidates: CalendarEventRow[] }
  | { status: 'none' }
  | { status: 'invalid'; reason: string };

/** How close (minutes) a row's start must be to `match_start` to count as "that event". */
export const START_TOLERANCE_MIN = 15;

function titleTokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length > 1);
}

/** Every word of the query title appears in the event title (case/punctuation-insensitive). */
export function titleMatches(eventTitle: string, query: string): boolean {
  const want = titleTokens(query);
  if (want.length === 0) return false;
  const have = new Set(titleTokens(eventTitle));
  return want.every((w) => have.has(w) || [...have].some((h) => h.startsWith(w)));
}

/**
 * Pick the event the user means. Never guesses: more than one match is `ambiguous` and the caller
 * must hand the candidates back to the user. An event id is authoritative when present.
 */
export function matchCalendarEvents(rows: CalendarEventRow[], q: EventQuery): MatchResult {
  const id = (q.event_id ?? '').trim();
  if (id) {
    const hits = rows.filter((r) => r.external_event_id === id);
    if (hits.length === 1) return { status: 'unique', event: hits[0] };
    if (hits.length > 1) return { status: 'ambiguous', candidates: hits };
    return { status: 'none' };
  }

  const title = (q.match_title ?? '').trim();
  const startRaw = (q.match_start ?? '').trim();
  if (!title && !startRaw) {
    return { status: 'invalid', reason: 'Give event_id, or match_title and/or match_start, to identify the event.' };
  }

  let pool = rows;
  if (startRaw) {
    const t = Date.parse(startRaw);
    if (Number.isNaN(t)) return { status: 'invalid', reason: `match_start "${startRaw}" is not a valid date/time.` };
    const tol = START_TOLERANCE_MIN * 60 * 1000;
    pool = pool.filter((r) => Math.abs(Date.parse(r.start_time) - t) <= tol);
  }
  if (title) pool = pool.filter((r) => titleMatches(r.title, title));

  if (pool.length === 1) return { status: 'unique', event: pool[0] };
  if (pool.length > 1) return { status: 'ambiguous', candidates: pool };
  return { status: 'none' };
}

export interface EventPatch {
  title?: string;
  startISO?: string;
  endISO?: string;
}

export interface PatchArgs {
  new_title?: string;
  new_start_time?: string;
  new_end_time?: string;
  duration_minutes?: number;
}

/**
 * Turn the agent's update args into a concrete patch. Moving the start without an end keeps the
 * event's current length (a 3pm-4pm meeting moved to 4 becomes 4pm-5pm).
 */
export function buildEventPatch(
  args: PatchArgs,
  current: { start_time: string; end_time: string },
): { ok: true; patch: EventPatch } | { ok: false; error: string } {
  const patch: EventPatch = {};
  const title = typeof args.new_title === 'string' ? args.new_title.trim() : '';
  if (title) patch.title = title;

  const curStart = Date.parse(current.start_time);
  const curEnd = Date.parse(current.end_time);
  const curLen = !Number.isNaN(curStart) && !Number.isNaN(curEnd) && curEnd > curStart ? curEnd - curStart : 60 * 60 * 1000;

  let start: number | null = null;
  let end: number | null = null;
  if (args.new_start_time) {
    start = Date.parse(args.new_start_time);
    if (Number.isNaN(start)) return { ok: false, error: `new_start_time "${args.new_start_time}" is not a valid date/time.` };
  }
  if (args.new_end_time) {
    end = Date.parse(args.new_end_time);
    if (Number.isNaN(end)) return { ok: false, error: `new_end_time "${args.new_end_time}" is not a valid date/time.` };
  }
  const dur = Number(args.duration_minutes);
  const hasDur = Number.isFinite(dur) && dur > 0;

  if (start !== null || end !== null || hasDur) {
    const s = start ?? curStart;
    const e = end ?? s + (hasDur ? dur * 60 * 1000 : curLen);
    if (Number.isNaN(s) || Number.isNaN(e)) return { ok: false, error: 'The event has no valid current time to adjust from.' };
    if (e <= s) return { ok: false, error: 'The new end time must be after the new start time.' };
    patch.startISO = new Date(s).toISOString();
    patch.endISO = new Date(e).toISOString();
  }

  if (!patch.title && !patch.startISO) {
    return { ok: false, error: 'Nothing to change: give new_start_time, new_end_time, duration_minutes and/or new_title.' };
  }
  return { ok: true, patch };
}

/** Graph wants dateTime without an offset plus a timeZone; mirror the create path (UTC). */
function utcDateTime(iso: string): { dateTime: string; timeZone: 'UTC' } {
  return { dateTime: new Date(iso).toISOString().replace(/Z$/, ''), timeZone: 'UTC' };
}

export function toProviderBody(provider: CalendarProvider, patch: EventPatch): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (patch.title) body[provider === 'outlook' ? 'subject' : 'summary'] = patch.title;
  if (patch.startISO && patch.endISO) {
    if (provider === 'outlook') {
      body.start = utcDateTime(patch.startISO);
      body.end = utcDateTime(patch.endISO);
    } else {
      body.start = { dateTime: new Date(patch.startISO).toISOString(), timeZone: 'UTC' };
      body.end = { dateTime: new Date(patch.endISO).toISOString(), timeZone: 'UTC' };
    }
  }
  return body;
}

/**
 * DELETE GUARD. A delete runs only when (a) exactly one event matched and (b) the agent asserts the
 * user's own words asked for it (`user_requested === true`, a literal boolean -- "true" the string
 * or 1 do not count). Anything else returns a preview so the agent asks the user first.
 */
export function deleteGate(
  args: { user_requested?: unknown },
  match: MatchResult,
): { allowed: true } | { allowed: false; reason: 'not_unique' | 'confirmation_required' } {
  if (match.status !== 'unique') return { allowed: false, reason: 'not_unique' };
  if (args.user_requested !== true) return { allowed: false, reason: 'confirmation_required' };
  return { allowed: true };
}

export function eventUrl(provider: CalendarProvider, eventId: string): string {
  const id = encodeURIComponent(eventId);
  return provider === 'outlook'
    ? `https://graph.microsoft.com/v1.0/me/events/${id}`
    : `https://www.googleapis.com/calendar/v3/calendars/primary/events/${id}`;
}

export interface EditCallResult {
  success: boolean;
  status?: number;
  error?: string;
  details?: Record<string, unknown>;
}

/**
 * The one provider HTTP call. `op:'update'` PATCHes, `op:'delete'` DELETEs. A delete of an event the
 * provider already reports gone (Google 410) is success -- the user's intent is satisfied.
 */
export async function performCalendarEdit(input: {
  provider: CalendarProvider;
  op: 'update' | 'delete';
  eventId: string;
  accessToken: string;
  patch?: EventPatch;
  fetchImpl?: typeof fetch;
}): Promise<EditCallResult> {
  const f = input.fetchImpl ?? fetch;
  const url = eventUrl(input.provider, input.eventId);
  const headers: Record<string, string> = { Authorization: `Bearer ${input.accessToken}` };
  let res: Response;
  try {
    if (input.op === 'update') {
      const body = toProviderBody(input.provider, input.patch ?? {});
      if (Object.keys(body).length === 0) return { success: false, error: 'Nothing to change.' };
      headers['Content-Type'] = 'application/json';
      res = await f(url, { method: 'PATCH', headers, body: JSON.stringify(body) });
    } else {
      res = await f(url, { method: 'DELETE', headers });
    }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Network error calling the calendar API' };
  }

  const text = await res.text().catch(() => '');
  if (input.op === 'delete' && (res.status === 204 || res.status === 200 || (input.provider === 'google' && res.status === 410))) {
    return { success: true, status: res.status, details: { deleted: true, alreadyGone: res.status === 410 } };
  }
  if (!res.ok) {
    const label = input.provider === 'outlook' ? 'Microsoft Graph' : 'Google Calendar';
    return { success: false, status: res.status, error: `${label} API error: ${res.status} - ${text.slice(0, 200)}` };
  }
  let parsed: any = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = {}; }
  return {
    success: true,
    status: res.status,
    details: {
      eventId: parsed.id ?? input.eventId,
      webLink: parsed.webLink ?? parsed.htmlLink,
      title: parsed.subject ?? parsed.summary,
    },
  };
}
