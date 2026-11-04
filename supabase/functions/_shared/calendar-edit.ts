// WHAT:       update_calendar_event / delete_calendar_event for execute-tool: find ONE of the
//             caller's own calendar events (by provider event id, or by a time+title match against
//             public.external_calendar_events), then PATCH or DELETE it on Outlook (Graph) or Google.
// WHY:        journey had create-only calendar tools (create_calendar_event / create_google_event /
//             create_outlook_event), so "move my 3pm to 4" or "cancel tomorrow's study block" could
//             not be done by any agent.
// SUPERSEDES: nothing.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   huddle-extension-app docs/qc-evidence/BUILD-calendar-edit.md; calendar-edit.test.ts.
//
// TOKEN PATH: the same one create uses (send-unified-notification getCalendarConnectionForUser +
// refreshOutlookToken/refreshGoogleToken): calendar_connections filtered by user_id + provider +
// is_active, prefer a non-expired row, decrypt_token RPC, refresh with a 5-minute buffer. It is
// re-expressed here (not imported) because those functions are private to that edge function's
// index.ts, whose import would run its serve(). Folding create onto THIS copy is an owner decision
// (it changes create's code path) and is listed as NEEDS OWNER in the build log.
//
// Everything that talks to the network or the DB is injected (CalendarEditDeps), so the logic is
// unit-tested with no real calendar call. Nothing here runs at import time.

export type CalendarProvider = 'outlook' | 'google';

export interface CalendarEventRow {
  external_event_id: string;
  title: string | null;
  start_time: string; // ISO
  end_time: string | null; // ISO
  provider: CalendarProvider;
}

export interface FetchLike {
  (url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
  }>;
}

export interface CalendarEditDeps {
  /** The caller's own synced events in [fromISO, toISO]. MUST be scoped to userId. */
  loadEventRows(userId: string, fromISO: string, toISO: string): Promise<CalendarEventRow[]>;
  /** The caller's own synced event with this provider id, or null. MUST be scoped to userId. */
  loadEventById(userId: string, eventId: string): Promise<CalendarEventRow | null>;
  /** A usable access token for the caller's connection of that provider, or an error string. */
  getAccessToken(userId: string, provider: CalendarProvider): Promise<{ token: string } | { error: string }>;
  fetch: FetchLike;
}

export interface FindArgs {
  event_id?: string;
  provider?: string;
  match_title?: string;
  match_start_time?: string;
}

export interface UpdateArgs extends FindArgs {
  new_title?: string;
  new_start_time?: string;
  new_end_time?: string;
  new_location?: string;
}

export interface DeleteArgs extends FindArgs {
  user_explicitly_requested?: boolean;
}

export type ToolResult = Record<string, unknown> & { success: boolean };

/** How far either side of match_start_time an event may start and still count as a match. */
export const MATCH_WINDOW_MINUTES = 90;

function normProvider(p: unknown): CalendarProvider | null {
  const s = String(p ?? '').trim().toLowerCase();
  if (s === 'outlook' || s === 'office365' || s === 'microsoft' || s === 'm365') return 'outlook';
  if (s === 'google' || s === 'gcal') return 'google';
  return null;
}

function normTitle(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function validISO(s: unknown): number | null {
  if (typeof s !== 'string' || !s.trim()) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export function summarize(r: CalendarEventRow) {
  return {
    event_id: r.external_event_id,
    provider: r.provider,
    title: r.title,
    start_time: r.start_time,
    end_time: r.end_time,
  };
}

/**
 * Pure: rows already scoped to the caller -> the ones matching title and/or time.
 * A title matches when either normalized string contains the other.
 */
export function matchEventRows(rows: CalendarEventRow[], args: FindArgs): CalendarEventRow[] {
  const wantTitle = normTitle(args.match_title);
  const at = validISO(args.match_start_time);
  const windowMs = MATCH_WINDOW_MINUTES * 60 * 1000;
  const prov = normProvider(args.provider);
  return rows.filter((r) => {
    if (prov && r.provider !== prov) return false;
    if (wantTitle) {
      const t = normTitle(r.title);
      if (!t || !(t.includes(wantTitle) || wantTitle.includes(t))) return false;
    }
    if (at !== null) {
      const s = Date.parse(r.start_time);
      if (!Number.isFinite(s) || Math.abs(s - at) > windowMs) return false;
    }
    return true;
  });
}

type Resolved =
  | { kind: 'one'; row: CalendarEventRow }
  | { kind: 'by_id_unsynced'; eventId: string; provider: CalendarProvider }
  | { kind: 'result'; result: ToolResult };

/** Find exactly one event the caller owns, or return a result explaining why not. */
export async function resolveEvent(deps: CalendarEditDeps, userId: string, args: FindArgs): Promise<Resolved> {
  if (!userId) return { kind: 'result', result: { success: false, error: 'No user context.' } };

  const eventId = typeof args.event_id === 'string' ? args.event_id.trim() : '';
  if (eventId) {
    const row = await deps.loadEventById(userId, eventId);
    if (row) return { kind: 'one', row };
    // Not in the caller's synced mirror yet (e.g. created minutes ago). Still scoped to the
    // caller: the request is made with the CALLER's own token, so it can only reach their calendar.
    const prov = normProvider(args.provider);
    if (prov) return { kind: 'by_id_unsynced', eventId, provider: prov };
    return {
      kind: 'result',
      result: { success: false, error: `No event with id ${eventId} on your synced calendar. Pass provider ("outlook" or "google") to act on it anyway, or find it by match_title + match_start_time.` },
    };
  }

  const at = validISO(args.match_start_time);
  const hasTitle = !!normTitle(args.match_title);
  if (at === null && !hasTitle) {
    return { kind: 'result', result: { success: false, error: 'Say which event: pass event_id, or match_title and/or match_start_time (ISO).' } };
  }
  if (args.match_start_time && at === null) {
    return { kind: 'result', result: { success: false, error: `match_start_time "${args.match_start_time}" is not a valid ISO date-time.` } };
  }

  // Search window: around the given time, or the next 14 days (and last 1) when only a title is given.
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const from = at !== null ? at - MATCH_WINDOW_MINUTES * 60 * 1000 : now - day;
  const to = at !== null ? at + MATCH_WINDOW_MINUTES * 60 * 1000 : now + 14 * day;
  const rows = await deps.loadEventRows(userId, new Date(from).toISOString(), new Date(to).toISOString());
  const hits = matchEventRows(rows, args);

  if (hits.length === 1) return { kind: 'one', row: hits[0] };
  if (hits.length === 0) {
    return {
      kind: 'result',
      result: {
        success: false,
        not_found: true,
        error: 'No matching event on your calendar.',
        nearby: rows.slice(0, 5).map(summarize),
      },
    };
  }
  return {
    kind: 'result',
    result: {
      success: false,
      ambiguous: true,
      error: `${hits.length} events match. Ask the user which one, then call again with its event_id.`,
      candidates: hits.slice(0, 10).map(summarize),
    },
  };
}

/** Pure: the provider PATCH body. Keeps the original duration when only a new start is given. */
export function buildPatch(
  provider: CalendarProvider,
  args: UpdateArgs,
  original: CalendarEventRow | null,
): { body: Record<string, unknown> } | { error: string } {
  const newStart = args.new_start_time ? validISO(args.new_start_time) : null;
  if (args.new_start_time && newStart === null) return { error: `new_start_time "${args.new_start_time}" is not a valid ISO date-time.` };
  let newEnd = args.new_end_time ? validISO(args.new_end_time) : null;
  if (args.new_end_time && newEnd === null) return { error: `new_end_time "${args.new_end_time}" is not a valid ISO date-time.` };

  if (newStart !== null && newEnd === null) {
    const oS = original ? Date.parse(original.start_time) : NaN;
    const oE = original?.end_time ? Date.parse(original.end_time) : NaN;
    if (!Number.isFinite(oS) || !Number.isFinite(oE)) {
      return { error: 'new_end_time is required: the original duration is not known for this event.' };
    }
    newEnd = newStart + (oE - oS);
  }
  if (newEnd !== null && newStart === null) {
    const oS = original ? Date.parse(original.start_time) : NaN;
    if (Number.isFinite(oS) && newEnd <= oS) return { error: 'new_end_time must be after the event start.' };
  }
  if (newStart !== null && newEnd !== null && newEnd <= newStart) return { error: 'new_end_time must be after new_start_time.' };

  const title = typeof args.new_title === 'string' && args.new_title.trim() ? args.new_title.trim() : null;
  const location = typeof args.new_location === 'string' ? args.new_location : null;
  const startIso = newStart !== null ? new Date(newStart).toISOString() : null;
  const endIso = newEnd !== null ? new Date(newEnd).toISOString() : null;

  const body: Record<string, unknown> = {};
  if (provider === 'outlook') {
    if (title) body.subject = title;
    if (startIso) body.start = { dateTime: startIso.replace(/Z$/, ''), timeZone: 'UTC' };
    if (endIso) body.end = { dateTime: endIso.replace(/Z$/, ''), timeZone: 'UTC' };
    if (location !== null) body.location = { displayName: location };
  } else {
    if (title) body.summary = title;
    if (startIso) body.start = { dateTime: startIso, timeZone: 'UTC' };
    if (endIso) body.end = { dateTime: endIso, timeZone: 'UTC' };
    if (location !== null) body.location = location;
  }
  if (Object.keys(body).length === 0) return { error: 'Nothing to change: pass new_start_time, new_end_time, new_title or new_location.' };
  return { body };
}

export function eventUrl(provider: CalendarProvider, eventId: string): string {
  const id = encodeURIComponent(eventId);
  return provider === 'outlook'
    ? `https://graph.microsoft.com/v1.0/me/events/${id}`
    : `https://www.googleapis.com/calendar/v3/calendars/primary/events/${id}`;
}

export async function updateCalendarEvent(deps: CalendarEditDeps, userId: string, args: UpdateArgs): Promise<ToolResult> {
  const r = await resolveEvent(deps, userId, args);
  if (r.kind === 'result') return r.result;
  const provider = r.kind === 'one' ? r.row.provider : r.provider;
  const eventId = r.kind === 'one' ? r.row.external_event_id : r.eventId;
  const original = r.kind === 'one' ? r.row : null;

  const patch = buildPatch(provider, args, original);
  if ('error' in patch) return { success: false, error: patch.error };

  const tok = await deps.getAccessToken(userId, provider);
  if ('error' in tok) return { success: false, error: tok.error };

  const res = await deps.fetch(eventUrl(provider, eventId), {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${tok.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch.body),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    return { success: false, error: `${provider} update failed (${res.status}).`, detail };
  }
  return {
    success: true,
    provider,
    event_id: eventId,
    previous: original ? summarize(original) : null,
    changed: patch.body,
    message: 'Event updated.',
  };
}

export async function deleteCalendarEvent(deps: CalendarEditDeps, userId: string, args: DeleteArgs): Promise<ToolResult> {
  // GUARD: a delete only runs when the model asserts the USER asked for it in this conversation.
  if (args.user_explicitly_requested !== true) {
    return {
      success: false,
      needs_user_request: true,
      error: 'Deleting a calendar event needs the user\'s explicit request. Ask the user to confirm, then call again with user_explicitly_requested: true.',
    };
  }
  const r = await resolveEvent(deps, userId, args);
  if (r.kind === 'result') return r.result;
  const provider = r.kind === 'one' ? r.row.provider : r.provider;
  const eventId = r.kind === 'one' ? r.row.external_event_id : r.eventId;

  const tok = await deps.getAccessToken(userId, provider);
  if ('error' in tok) return { success: false, error: tok.error };

  const res = await deps.fetch(eventUrl(provider, eventId), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tok.token}` },
  });
  // 404/410 = already gone on the provider; report it rather than pretend a delete happened.
  if (res.status === 404 || res.status === 410) {
    return { success: false, already_gone: true, error: 'That event no longer exists on the calendar.', event_id: eventId, provider };
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    return { success: false, error: `${provider} delete failed (${res.status}).`, detail };
  }
  return {
    success: true,
    provider,
    event_id: eventId,
    deleted: r.kind === 'one' ? summarize(r.row) : { event_id: eventId, provider },
    message: 'Event deleted.',
  };
}

// ---------------------------------------------------------------------------------------------
// Real deps (Supabase + provider HTTP). Not unit-tested: it needs a live DB. Mirrors create's
// token path in send-unified-notification exactly (queries, decrypt RPC, refresh endpoints).
// ---------------------------------------------------------------------------------------------

const PROVIDER_ROWS: Record<CalendarProvider, string[]> = {
  outlook: ['office365', 'outlook'],
  google: ['google'],
};

function rowProvider(p: unknown): CalendarProvider | null {
  const s = String(p ?? '').toLowerCase();
  if (s === 'office365' || s === 'outlook') return 'outlook';
  if (s === 'google') return 'google';
  return null;
}

export function makeSupabaseCalendarEditDeps(supabase: any, env: (k: string) => string | undefined, fetchImpl: FetchLike): CalendarEditDeps {
  const http: FetchLike = fetchImpl;
  const toRows = (data: any[] | null): CalendarEventRow[] =>
    (data ?? [])
      .map((d) => ({
        external_event_id: d.external_event_id,
        title: d.title ?? null,
        start_time: d.start_time,
        end_time: d.end_time ?? null,
        provider: rowProvider(d.connection?.provider) as CalendarProvider,
      }))
      .filter((r) => r.provider && r.external_event_id);
  const SELECT = 'external_event_id, title, start_time, end_time, connection:calendar_connections(provider)';

  async function refresh(provider: CalendarProvider, connectionId: string, refreshToken: string, userId: string) {
    const isOutlook = provider === 'outlook';
    const clientId = isOutlook ? (env('MICROSOFT_CLIENT_ID') || env('AZURE_AD_CLIENT_ID')) : env('GOOGLE_CLIENT_ID');
    const clientSecret = isOutlook ? (env('MICROSOFT_CLIENT_SECRET') || env('AZURE_AD_CLIENT_SECRET')) : env('GOOGLE_CLIENT_SECRET');
    if (!clientId || !clientSecret) return null;
    const params: Record<string, string> = {
      client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token',
    };
    if (isOutlook) params.scope = 'https://graph.microsoft.com/Calendars.ReadWrite offline_access';
    const res = await http(
      isOutlook ? 'https://login.microsoftonline.com/common/oauth2/v2.0/token' : 'https://oauth2.googleapis.com/token',
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() },
    );
    if (!res.ok) return null;
    const tokens = JSON.parse(await res.text());
    const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();
    const { data: encAccess } = await supabase.rpc('encrypt_token', { token_value: tokens.access_token, p_user_id: userId });
    const update: Record<string, unknown> = { access_token: encAccess, expires_at: expiresAt, updated_at: new Date().toISOString() };
    if (tokens.refresh_token) {
      const { data: encRefresh } = await supabase.rpc('encrypt_token', { token_value: tokens.refresh_token, p_user_id: userId });
      update.refresh_token = encRefresh;
    }
    await supabase.from('calendar_connections').update(update).eq('id', connectionId).eq('user_id', userId);
    return tokens.access_token as string;
  }

  return {
    async loadEventRows(userId, fromISO, toISO) {
      const { data, error } = await supabase
        .from('external_calendar_events')
        .select(SELECT)
        .eq('user_id', userId)
        .gte('start_time', fromISO)
        .lte('start_time', toISO)
        .order('start_time', { ascending: true })
        .limit(200);
      if (error) throw new Error(`calendar read failed: ${error.message}`);
      return toRows(data);
    },
    async loadEventById(userId, eventId) {
      const { data, error } = await supabase
        .from('external_calendar_events')
        .select(SELECT)
        .eq('user_id', userId)
        .eq('external_event_id', eventId)
        .limit(1);
      if (error) throw new Error(`calendar read failed: ${error.message}`);
      return toRows(data)[0] ?? null;
    },
    async getAccessToken(userId, provider) {
      const label = provider === 'outlook' ? 'Outlook' : 'Google';
      const base = () => supabase
        .from('calendar_connections')
        .select('id, access_token, refresh_token, expires_at, updated_at')
        .eq('user_id', userId)
        .in('provider', PROVIDER_ROWS[provider])
        .eq('is_active', true);
      const nowISO = new Date().toISOString();
      let { data: conn } = await base().or(`expires_at.is.null,expires_at.gt.${nowISO}`)
        .order('updated_at', { ascending: false }).limit(1).maybeSingle();
      if (!conn) ({ data: conn } = await base().order('updated_at', { ascending: false }).limit(1).maybeSingle());
      if (!conn) return { error: `No ${label} calendar connected. Connect it in Calendar settings.` };

      const { data: access, error: decErr } = await supabase.rpc('decrypt_token', { encrypted_token: conn.access_token, p_user_id: userId });
      if (decErr || !access) return { error: `Could not read your ${label} token. Please reconnect ${label}.` };

      const exp = conn.expires_at ? Date.parse(conn.expires_at) : NaN;
      if (Number.isFinite(exp) && exp - 5 * 60 * 1000 < Date.now()) {
        if (!conn.refresh_token) return { error: `${label} token expired and no refresh token is available. Please reconnect ${label}.` };
        const { data: refreshTok } = await supabase.rpc('decrypt_token', { encrypted_token: conn.refresh_token, p_user_id: userId });
        const fresh = refreshTok ? await refresh(provider, conn.id, refreshTok, userId) : null;
        if (!fresh) return { error: `Failed to refresh the ${label} token. Please reconnect ${label}.` };
        return { token: fresh };
      }
      return { token: access };
    },
    fetch: fetchImpl,
  };
}
