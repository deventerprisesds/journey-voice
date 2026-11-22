// WHAT:       Pure helpers for the Settings "ignore these Outlook categories" list (tick, untick, add a name).
// WHY:        Owner 2026-11-22: "ignore a category with purple being the category to turn on for ignoring now".
//             The list is config.calendarIgnoreCategories; the backend rule is
//             supabase/functions/_shared/calendar-ignore.ts (exact name match, trim + case-fold).
//             Unticking must save an EXPLICIT [] -- mergeStoredConfig skips `undefined` keys, so an undefined
//             list would leave the old value stored and the untick would silently do nothing (AC-32).
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   .claude/ac-calendar-ignore-categories.md AC-31..AC-33; src/utils/calendarIgnoreCategories.test.ts.

/** Outlook's default colour category names, in Outlook's own order. Shown as checkboxes in Settings. */
export const OUTLOOK_DEFAULT_CATEGORIES = [
  'Red category',
  'Orange category',
  'Yellow category',
  'Green category',
  'Blue category',
  'Purple category',
] as const;

const key = (name: string) => name.trim().toLowerCase();

/** The stored list as clean names: strings only, trimmed, no blanks, no case-only duplicates. */
export function cleanCategoryList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of raw) {
    if (typeof c !== 'string' || !c.trim() || seen.has(key(c))) continue;
    seen.add(key(c));
    out.push(c.trim());
  }
  return out;
}

export function isCategoryListed(list: unknown, name: string): boolean {
  return cleanCategoryList(list).some((c) => key(c) === key(name));
}

/** Tick (on) or untick (off) one name. Always returns an array -- [] when the last one is unticked. */
export function setCategory(list: unknown, name: string, on: boolean): string[] {
  const clean = cleanCategoryList(list).filter((c) => key(c) !== key(name));
  return on && name.trim() ? [...clean, name.trim()] : clean;
}

/** Custom names typed by the owner, comma-separated; blanks and duplicates (any case) skipped. */
export function addCategories(list: unknown, typed: string): string[] {
  return cleanCategoryList([...cleanCategoryList(list), ...String(typed ?? '').split(',')]);
}
