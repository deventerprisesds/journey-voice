// WHAT:       Calendar events the owner wants IGNORED everywhere (never stored, never shown, never treated as
//             busy time): title phrases, and tentative GROUP invites. Read by every calendar write path.
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
// as 'work block' items"; NARROWED 2026-11-20: "The ignore tentative should be adjusted to only when it isn't
// a meeting with me alone but is instead a group meeting"). In plain words: tentative GROUP invites (two or
// more other people) are ignored; your own holds and 1:1s stay. "Other people" is meetings.ts otherPeople()
// (drops rooms, the `self` flag and the owner's own addresses). An event with no attendee list is UNKNOWN,
// not a group, so it is kept -- missing a meeting is the harm the owner described. The threshold is the one
// constant TENTATIVE_GROUP_MIN_OTHERS below. Editable switch: config.calendarIgnoreTentative (boolean),
// absent = true. Availability is Graph showAs / Google transparency, normalized to `show_as`.
// SUPERSEDES the 2026-11-19 blanket rule (every tentative event ignored).
//
// CATEGORIES (owner 2026-11-22: "ignore a category with purple being the category to turn on for ignoring now").
// Outlook categories are NAMES ("Purple category" is Outlook's default name for the purple colour). Editable:
// config.calendarIgnoreCategories (a list of names). Absent or malformed = [] -- nothing ignored by category,
// so a bad value can only KEEP meetings. Matching is EXACT name equality after trim + case-fold (never a
// substring, unlike titles), and an event is ignored if ANY of its categories is listed. Independent of the
// tentative switch. Measured source: huddle-extension-app run 44970672964 (feed: 254 records, 132 Purple).

import { otherPeople, type MeetingRow } from './meetings.ts';
import { resolveOwnerEmails } from './digest-source-meetings.ts';

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

/** A tentative event is ignored only when it has at least this many OTHER people (a group). 0 = own hold,
 *  1 = a 1:1 -- both kept. Owner-decided default 2026-11-20; change it here only. */
export const TENTATIVE_GROUP_MIN_OTHERS = 2;

/** Category names to ignore, trimmed + lower-cased. Non-strings and blanks dropped; malformed = []. */
export function resolveIgnoreCategories(userConfig: any): string[] {
  const raw = userConfig?.calendarIgnoreCategories;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((c: unknown) => typeof c === 'string' && c.trim()).map((c: string) => c.trim().toLowerCase()))];
}

/** Does any of the event's category names exactly equal a listed one (trim + case-fold)? Non-array = none. */
export function hasIgnoredCategory(categories: unknown, ignored: readonly string[]): boolean {
  if (!ignored.length || !Array.isArray(categories)) return false;
  return categories.some((c) => typeof c === 'string' && ignored.includes(c.trim().toLowerCase()));
}

/** Pure: a row's categories as stored -- string names only, as sent; anything else becomes []. */
export function normalizeCategories(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((c): c is string => typeof c === 'string' && !!c.trim()) : [];
}

export interface CalendarIgnoreRules {
  phrases: string[];
  tentative: boolean;
  /** Category names, lower-cased. [] = the category rule is off. */
  categories?: string[];
  /** The owner's own addresses, so the owner is never counted as "another person". */
  ownerEmails: string[];
}

export function resolveIgnoreRules(userConfig: any, ownerEmails: Iterable<string> = []): CalendarIgnoreRules {
  return {
    phrases: resolveIgnoreTitles(userConfig),
    tentative: resolveIgnoreTentative(userConfig),
    categories: resolveIgnoreCategories(userConfig),
    ownerEmails: [...new Set([...ownerEmails].map((e) => String(e ?? '').trim().toLowerCase()).filter(Boolean))],
  };
}

/** Tentative AND a group (>= TENTATIVE_GROUP_MIN_OTHERS other people). No attendee list = not a group. */
export function isTentativeGroup(
  row: { show_as?: unknown; attendees?: unknown },
  ownerEmails: Iterable<string>,
): boolean {
  if (String(row?.show_as ?? '').toLowerCase() !== 'tentative') return false;
  return otherPeople(row as unknown as MeetingRow, ownerEmails).length >= TENTATIVE_GROUP_MIN_OTHERS;
}

/** Any rule switched on? A writer may skip the filter entirely only when this is false. */
export function hasAnyIgnoreRule(rules: CalendarIgnoreRules): boolean {
  return rules.phrases.length > 0 || rules.tentative || (rules.categories ?? []).length > 0;
}

/** THE one ignore decision for a stored-calendar row: a title phrase, a listed category, or a tentative GROUP invite. */
export function isIgnoredCalendarEvent(
  row: { title?: unknown; show_as?: unknown; attendees?: unknown; categories?: unknown },
  rules: CalendarIgnoreRules,
): boolean {
  if (isIgnoredEvent(row?.title, rules.phrases)) return true;
  if (hasIgnoredCategory(row?.categories, rules.categories ?? [])) return true;
  return rules.tentative && isTentativeGroup(row, rules.ownerEmails ?? []);
}

/** The owner's ignore list, read from their scheduling prefs. Every calendar WRITE path calls this. */
// deno-lint-ignore no-explicit-any
export async function loadIgnoreTitles(supabase: any, userId: string): Promise<string[]> {
  const { data } = await supabase.from('user_scheduling_prefs').select('config').eq('user_id', userId).maybeSingle();
  return resolveIgnoreTitles(data?.config);
}

/** Title phrases, the tentative switch, and the owner's addresses (profile + connected mailboxes + any
 *  `extraOwnerEmails`, e.g. the OneDrive feed's work mailbox). */
// deno-lint-ignore no-explicit-any
export async function loadIgnoreRules(supabase: any, userId: string, extraOwnerEmails: string[] = []): Promise<CalendarIgnoreRules> {
  const { data } = await supabase.from('user_scheduling_prefs').select('config').eq('user_id', userId).maybeSingle();
  const owners = await resolveOwnerEmails(supabase, userId);
  return resolveIgnoreRules(data?.config, [...owners, ...extraOwnerEmails]);
}

/** Delete already-stored tentative rows on this connection that are GROUP invites -- by id, never by a
 *  blanket `show_as` match, so a tentative hold or 1:1 is never removed. */
// deno-lint-ignore no-explicit-any
export async function purgeTentativeGroups(supabaseClient: any, connection: { id: string }, rules: CalendarIgnoreRules): Promise<number> {
  const { data: tentativeRows, error: selErr } = await supabaseClient.from('external_calendar_events')
    .select('id, show_as, attendees')
    .eq('connection_id', connection.id).is('source_task_id', null).eq('show_as', 'tentative');
  if (selErr) { console.warn('[calendar-ignore] tentative select failed:', selErr.message); return 0; }
  const groupIds = (tentativeRows ?? []).filter((r: any) => isTentativeGroup(r, rules.ownerEmails)).map((r: any) => r.id);
  if (!groupIds.length) return 0;
  const { error } = await supabaseClient.from('external_calendar_events').delete().in('id', groupIds);
  if (error) { console.warn('[calendar-ignore] tentative purge failed:', error.message); return 0; }
  return groupIds.length;
}

/** Delete already-stored rows on this connection that the CURRENT rules ignore, by id. Covers an event that was
 *  stored, then tagged with an ignored category (its new copy is dropped before the upsert, so the stored copy
 *  must be removed by its external id), and rows stored before the rule existed (matched on the stored
 *  `categories`). TaskOS-created rows (source_task_id set) are never touched. Non-fatal: returns the count. */
// deno-lint-ignore no-explicit-any
export async function purgeIgnoredCategoryRows(supabaseClient: any, connection: { id: string }, rules: CalendarIgnoreRules, droppedExternalIds: string[] = []): Promise<number> {
  const cats = rules.categories ?? [];
  if (!cats.length) return 0;
  const ids = new Set<string>();
  if (droppedExternalIds.length) {
    const { data, error } = await supabaseClient.from('external_calendar_events').select('id')
      .eq('connection_id', connection.id).is('source_task_id', null).in('external_event_id', droppedExternalIds);
    if (error) console.warn('[calendar-ignore] dropped-row select failed:', error.message);
    for (const r of data ?? []) ids.add(r.id);
  }
  const { data: tagged, error: tagErr } = await supabaseClient.from('external_calendar_events').select('id, categories')
    .eq('connection_id', connection.id).is('source_task_id', null).not('categories', 'is', null);
  if (tagErr) console.warn('[calendar-ignore] category select failed:', tagErr.message);
  for (const r of tagged ?? []) if (hasIgnoredCategory(r.categories, cats)) ids.add(r.id);
  if (!ids.size) return 0;
  const { error } = await supabaseClient.from('external_calendar_events').delete().in('id', [...ids]);
  if (error) { console.warn('[calendar-ignore] category purge failed:', error.message); return 0; }
  return ids.size;
}
