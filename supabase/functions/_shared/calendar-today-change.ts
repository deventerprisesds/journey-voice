// WHAT:       Decides whether a calendar sync changed TODAY's calendar in a way the day plan must react to: a
//             kept event starting today that is NEW, or whose availability moved OFF 'tentative' (accepted).
//             Used by calendar-delta-sync (Outlook, Google, the OneDrive work feed) to rebuild today's plan.
// WHY:        Owner 2026-11-20: "when I update it from tentative to accepted it has to immediately update on my
//             schedule otherwise meetings I planned to attend after accepting mid day are being missed because
//             they were already filtered out at the start of the day". The day plan was built once (03:00 UTC)
//             and nothing rebuilt it when calendar rows changed.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   _shared/calendar-today-change.test.ts; docs/qc-evidence/BUILD-tentative-group-only.md.
//
// "Today" is resolved exactly as nightly-schedule-builder does: user_scheduling_prefs.timezone, default
// 'America/New_York', and the local calendar date of now in that zone.

import { localDateOf } from './timezone.ts';

export const BUILDER_DEFAULT_TIMEZONE = 'America/New_York';

export interface TodayRow {
  external_event_id: string;
  start_time: string;
  show_as?: string | null;
}

/** Pure. `before` maps external_event_id -> the show_as stored BEFORE this sync's upsert. */
export function todayCalendarChanged(
  kept: readonly TodayRow[],
  before: ReadonlyMap<string, string | null>,
  tz: string,
  nowMs: number = Date.now(),
): boolean {
  const today = localDateOf(new Date(nowMs).toISOString(), tz);
  if (!today) return false;
  return kept.some((r) => {
    if (localDateOf(String(r.start_time ?? ''), tz) !== today) return false;
    if (!before.has(r.external_event_id)) return true; // new today
    const was = String(before.get(r.external_event_id) ?? '').toLowerCase();
    const now = String(r.show_as ?? '').toLowerCase();
    return was === 'tentative' && now !== 'tentative'; // accepted (tentative -> busy/free/...)
  });
}

/** The builder's timezone for this user (same source and default as nightly-schedule-builder). */
// deno-lint-ignore no-explicit-any
export async function resolveBuilderTimezone(supabase: any, userId: string): Promise<string> {
  try {
    const { data } = await supabase.from('user_scheduling_prefs').select('timezone').eq('user_id', userId).maybeSingle();
    return (typeof data?.timezone === 'string' && data.timezone) || BUILDER_DEFAULT_TIMEZONE;
  } catch (_) {
    return BUILDER_DEFAULT_TIMEZONE;
  }
}

/**
 * Call BEFORE the upsert. Reads the stored show_as of the kept rows that start today and returns whether the
 * sync changes today. Best-effort: any read failure returns false (no rebuild), never fails the sync.
 */
// deno-lint-ignore no-explicit-any
export async function detectTodayChange(supabase: any, connection: { id: string; user_id: string }, kept: readonly TodayRow[], nowMs: number = Date.now()): Promise<boolean> {
  try {
    const tz = await resolveBuilderTimezone(supabase, connection.user_id);
    const today = localDateOf(new Date(nowMs).toISOString(), tz);
    const todayRows = kept.filter((r) => localDateOf(String(r.start_time ?? ''), tz) === today);
    if (!todayRows.length) return false;
    const { data, error } = await supabase.from('external_calendar_events')
      .select('external_event_id, show_as')
      .eq('connection_id', connection.id)
      .in('external_event_id', todayRows.map((r) => r.external_event_id).slice(0, 500));
    if (error) return false;
    const before = new Map<string, string | null>();
    for (const row of data ?? []) before.set(row.external_event_id, row.show_as ?? null);
    return todayCalendarChanged(todayRows, before, tz, nowMs);
  } catch (_) {
    return false;
  }
}
