// WHAT:       Calendar events the owner wants IGNORED everywhere (never stored, never shown, never treated as
//             busy time), matched on the title. Pure; read by calendar-delta-sync before it stores events.
// WHY:        Owner 2026-11-18: "Any schedule block from my work calendar that includes 'work block' should
//             be filtered out up front so it doesn't appear in taskos or huddle and doesn't take up slots."
//             113 "Work Block 1/2/3" events were stored; the 11-17 build rejected tasks for overlapping them.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   _shared/calendar-ignore.test.ts. 2026-11-18: the OneDrive work-calendar FEED path
//             (onedrive-feed-sync.ts) re-wrote 107 Work Blocks an hour after #125, which filtered only delta-sync.
//
// Editable: user_scheduling_prefs.config.calendarIgnoreTitles (a list of phrases). Absent = the seed below.
// Matching is case-insensitive "title contains the phrase".
//
// TENTATIVE (owner 2026-11-19: "Items that are tentative on my schedule should be on the same exclusion list
// as 'work block' items"): an event whose availability (Graph showAs / Google transparency, normalized to
// `show_as`) is 'tentative' is ignored the same way. Editable: config.calendarIgnoreTentative (boolean).
// Absent = true. This SUPERSEDES, for the stored calendar, meetings.ts AC-MTG-7's "tentative counts as a
// meeting": a tentative event is no longer stored, so nothing downstream sees it.

export const DEFAULT_CALENDAR_IGNORE_TITLES = ['work block'];

export function resolveIgnoreTitles(userConfig: any): string[] {
  const raw = userConfig?.calendarIgnoreTitles;
  if (!Array.isArray(raw)) return [...DEFAULT_CALENDAR_IGNORE_TITLES];
  return raw.filter((p: unknown) => typeof p === 'string' && p.trim()).map((p: string) => p.trim().toLowerCase());
}

export function isIgnoredEvent(title: unknown, phrases: readonly string[]): boolean {
  const t = String(title ?? '').toLowerCase();
  return phrases.some((p) => p && t.includes(p));
}

export const DEFAULT_CALENDAR_IGNORE_TENTATIVE = true;

/** Ignore tentative events? Only an explicit `false` turns it off. */
export function resolveIgnoreTentative(userConfig: any): boolean {
  return userConfig?.calendarIgnoreTentative !== false;
}

export interface CalendarIgnoreRules {
  phrases: string[];
  tentative: boolean;
}

export function resolveIgnoreRules(userConfig: any): CalendarIgnoreRules {
  return { phrases: resolveIgnoreTitles(userConfig), tentative: resolveIgnoreTentative(userConfig) };
}

/** THE one ignore decision for a stored-calendar row: a title phrase, or a tentative availability. */
export function isIgnoredCalendarEvent(
  row: { title?: unknown; show_as?: unknown },
  rules: CalendarIgnoreRules,
): boolean {
  if (isIgnoredEvent(row?.title, rules.phrases)) return true;
  return rules.tentative && String(row?.show_as ?? '').toLowerCase() === 'tentative';
}

/** The owner's ignore list, read from their scheduling prefs. Every calendar WRITE path calls this. */
// deno-lint-ignore no-explicit-any
export async function loadIgnoreTitles(supabase: any, userId: string): Promise<string[]> {
  return (await loadIgnoreRules(supabase, userId)).phrases;
}

/** Title phrases AND the tentative switch, read from the owner's scheduling prefs. */
// deno-lint-ignore no-explicit-any
export async function loadIgnoreRules(supabase: any, userId: string): Promise<CalendarIgnoreRules> {
  const { data } = await supabase.from('user_scheduling_prefs').select('config').eq('user_id', userId).maybeSingle();
  return resolveIgnoreRules(data?.config);
}
