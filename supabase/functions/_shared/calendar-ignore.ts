// WHAT:       Calendar events the owner wants IGNORED everywhere (never stored, never shown, never treated as
//             busy time), matched on the title. Pure; read by calendar-delta-sync before it stores events.
// WHY:        Owner 2026-11-18: "Any schedule block from my work calendar that includes 'work block' should
//             be filtered out up front so it doesn't appear in taskos or huddle and doesn't take up slots."
//             113 "Work Block 1/2/3" events were stored; the 11-17 build rejected tasks for overlapping them.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   _shared/calendar-ignore.test.ts
//
// Editable: user_scheduling_prefs.config.calendarIgnoreTitles (a list of phrases). Absent = the seed below.
// Matching is case-insensitive "title contains the phrase".

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
