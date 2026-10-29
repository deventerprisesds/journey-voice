/**
 * Shared scheduling defaults for all Edge Functions.
 * Must stay in sync with src/config/schedulingRules.ts (frontend).
 * This is the authoritative backend source of truth when user config is null.
 */

export interface TimeWindow {
  start: number; // hour (0-23)
  end: number;   // hour (0-23)
  days: number[]; // 0=Sun, 1=Mon, ...6=Sat
}

/**
 * Assignment scheduling tier constants.
 * Used by nightly-schedule-builder to split assignment candidates into
 * Tier A (deadline-critical), Tier B (urgent), Tier C (long-horizon).
 */
// LAST-RESORT fallback only — read it through resolveCategoryDailyCap(), never directly.
// This used to be applied as a flat hardcoded cap on every day of the week in
// nightly-schedule-builder, which (a) the user could not change anywhere in the UI,
// violating the standing "no behaviour-affecting value may be code-only" rule, and
// (b) duplicated `categoryMappings[cat].maxPerDay`, which the batch/smart schedulers
// were already enforcing from the user's own config. Two independent caps that both
// happened to be 2, so editing Settings silently did nothing to the builder.
export const MAX_ASSIGNMENTS_PER_DAY = 2;
export const ASSIGNMENT_URGENT_HOURS = 48;
export const ASSIGNMENT_PRIORITY_DAYS = 7;

export interface CategoryMapping {
  defaultTimeWindow: string[];
  estimatedDuration: number;
  defaultStatus: string;
  maxPerDay?: number;
  // Separate WEEKEND allowance. `maxPerDay` was written for weekdays — a weekday
  // evening fits ~2 study blocks — but it was being applied to Saturday and Sunday
  // too, where the `weekends` window is 10:00–20:00 (ten hours, room for six
  // 90-minute blocks). That capped a whole weekend at the same two items as a
  // Tuesday. Absent → falls back to maxPerDay, so existing configs are unchanged.
  maxPerDayWeekend?: number;
}

/**
 * THE single source of truth for "how many tasks of this category may land on this day".
 *
 * Every enforcement point must call this — the nightly builder's assignment cap, the
 * batch scheduler's post-AI validation, and the smart scheduler — so that one number in
 * Settings governs all of them. Before this existed the builder used a hardcoded
 * constant while the other two read `categoryMappings[cat].maxPerDay`, so the caps could
 * (and did) disagree and the UI value was partly inert.
 *
 * Resolution order, most specific first:
 *   weekend day → maxPerDayWeekend ?? maxPerDay ?? MAX_ASSIGNMENTS_PER_DAY
 *   weekday     →                     maxPerDay ?? MAX_ASSIGNMENTS_PER_DAY
 *
 * A configured 0 is honoured as "none allowed" (only null/undefined fall through), and a
 * negative or non-finite value is treated as unset rather than silently blocking the day.
 * Returns Infinity for a category with no cap anywhere, so callers can compare freely.
 */
export function resolveCategoryDailyCap(
  userConfig: any,
  category: string | null | undefined,
  isWeekend: boolean,
  opts?: { fallback?: number },
): number {
  const usable = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;

  const mapping =
    (category && userConfig?.categoryMappings?.[category]) ||
    (category && DEFAULT_CATEGORY_MAPPINGS[category]) ||
    null;

  if (!mapping) return opts?.fallback ?? Infinity;

  const weekday = usable(mapping.maxPerDay);
  const weekend = usable(mapping.maxPerDayWeekend);

  const resolved = isWeekend ? (weekend ?? weekday) : weekday;
  if (resolved !== null) return resolved;

  return opts?.fallback ?? Infinity;
}

/** Sunday(0) / Saturday(6) in the given IANA timezone — not the runtime's local zone. */
export function isWeekendInTimezone(date: Date, timezone: string): boolean {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' })
    .format(date);
  return wd === 'Sat' || wd === 'Sun';
}

export const DEFAULT_TIME_WINDOWS: Record<string, TimeWindow> = {
  morning:        { start: 6,  end: 9,  days: [1, 2, 3, 4, 5] },
  business_hours: { start: 9,  end: 17, days: [1, 2, 3, 4, 5] },
  after_work:     { start: 17, end: 22, days: [1, 2, 3, 4, 5] },
  evening:        { start: 19, end: 22, days: [0, 1, 2, 3, 4, 5, 6] },
  flexible:       { start: 9,  end: 22, days: [0, 1, 2, 3, 4, 5, 6] },
  weekends:       { start: 10, end: 20, days: [0, 6] },
};

export const DEFAULT_CATEGORY_MAPPINGS: Record<string, CategoryMapping> = {
  CAREER:         { defaultTimeWindow: ['business_hours'],            estimatedDuration: 120, defaultStatus: 'CAREER' },
  // maxPerDayWeekend 6: owner 2026-10-28 (weekday 2, weekend 6). Seed only — changeable in Settings.
  PROF_EDUCATION: { defaultTimeWindow: ['after_work', 'weekends'],    estimatedDuration: 90,  defaultStatus: 'PROF_EDUCATION', maxPerDay: 2, maxPerDayWeekend: 6 },
  EDUCATION:      { defaultTimeWindow: ['flexible'],                  estimatedDuration: 90,  defaultStatus: 'EDUCATION' },
  VENTURES:       { defaultTimeWindow: ['after_work', 'weekends'],    estimatedDuration: 120, defaultStatus: 'VENTURES' },
  LIFE:           { defaultTimeWindow: ['flexible'],                  estimatedDuration: 60,  defaultStatus: 'LIFE' },
  PERSONAL:       { defaultTimeWindow: ['flexible'],                  estimatedDuration: 60,  defaultStatus: 'LIFE' },
};

/**
 * A TEMPORARY scheduling caveat — the owner's "push research to the evening, for now" case.
 *
 * Deliberately an OVERLAY, resolved at read time and NEVER written into `config`. Clearing a caveat
 * therefore restores prior behaviour exactly, with no migration and no risk of a temporary
 * preference silently becoming permanent (AC-5).
 *
 * A caveat is a PREFERENCE, never a constraint. Its windows are PREPENDED to the task's ordered
 * preferred-window list; the existing placement loop already falls through to the next window when
 * one is out of capacity, so anything that does not fit relaxes to the rules it would have had with
 * no caveat at all (AC-2, the owner's ruling). This is the crucial difference from a keyword
 * override, which REPLACES the list (`preferredWindows = [win]`) and therefore drops a task entirely
 * when its single window is full.
 */
export interface SchedulingCaveat {
  id: string;
  text: string;                    // the owner's own words — for the UI and for agent prompts
  match: {
    categories?: string[];         // task.category
    tags?: string[];               // task.tags
    keywords?: string[];           // substring match on the task title
  };
  preferWindows: string[];         // NAMED windows only — same vocabulary as timeWindows
  expiresAt?: string | null;       // ISO; null/omitted = active until explicitly cleared
  createdAt?: string;
}

/** Caveats still in force at `now` — expired ones are filtered here, so no cron is needed (AC-4). */
export function activeCaveats(userConfig: any, now: Date = new Date()): SchedulingCaveat[] {
  const raw = userConfig?.caveats;
  if (!Array.isArray(raw)) return [];
  return raw.filter((c: any) => {
    if (!c || typeof c !== 'object') return false;
    if (!Array.isArray(c.preferWindows) || c.preferWindows.length === 0) return false;
    if (c.expiresAt === null || c.expiresAt === undefined) return true;
    const t = Date.parse(c.expiresAt);
    return Number.isNaN(t) ? false : t > now.getTime();
  });
}

/** Does this caveat apply to this task? An empty `match` matches everything. */
export function caveatMatches(
  c: SchedulingCaveat,
  task: { title?: string | null; category?: string | null; tags?: string[] | null },
): boolean {
  const m = c.match || {};
  const hasRule = !!(m.categories?.length || m.tags?.length || m.keywords?.length);
  if (!hasRule) return true;
  const cat = (task.category ?? '').toUpperCase();
  if (m.categories?.some((x) => x.toUpperCase() === cat)) return true;
  const tags = (task.tags ?? []).map((t) => String(t).toLowerCase());
  if (m.tags?.some((x) => tags.includes(x.toLowerCase()))) return true;
  const title = (task.title ?? '').toLowerCase();
  if (m.keywords?.some((k) => k && title.includes(k.toLowerCase()))) return true;
  return false;
}

/**
 * PREPEND every matching caveat's windows to the ordered preference list, keeping the base list
 * intact behind them. Never removes an entry — that invariant is what makes overflow relax (AC-2)
 * and guarantees a caveat can never reduce how many tasks get placed.
 *
 * A caveat window not active on the target day contributes nothing (AC-8), mirroring the existing
 * `getKeywordWindowOverride` guard.
 */
export function applyCaveats(
  basePreferred: string[],
  task: { title?: string | null; category?: string | null; tags?: string[] | null },
  caveats: SchedulingCaveat[],
  activeWindowNames: string[],
): string[] {
  if (!caveats.length) return basePreferred;
  const lead: string[] = [];
  for (const c of caveats) {
    if (!caveatMatches(c, task)) continue;
    for (const w of c.preferWindows) {
      if (w !== 'flexible' && activeWindowNames.includes(w) && !lead.includes(w)) lead.push(w);
    }
  }
  if (!lead.length) return basePreferred;
  return [...lead, ...basePreferred.filter((w) => !lead.includes(w))];
}

/**
 * Merge user config with defaults. User config takes precedence.
 */
export function resolveConfig(userConfig: any): {
  timeWindows: Record<string, TimeWindow>;
  categoryMappings: Record<string, CategoryMapping>;
} {
  const timeWindows = (userConfig?.timeWindows && Object.keys(userConfig.timeWindows).length > 0)
    ? userConfig.timeWindows
    : DEFAULT_TIME_WINDOWS;

  const categoryMappings = (userConfig?.categoryMappings && Object.keys(userConfig.categoryMappings).length > 0)
    ? userConfig.categoryMappings
    : DEFAULT_CATEGORY_MAPPINGS;

  return { timeWindows, categoryMappings };
}

/**
 * Given a task's start_time ISO string, check if it falls within one of the
 * allowed windows for that task's category on the target day.
 * Returns { valid, actualWindow, allowedWindows }.
 */
export function validateTaskWindow(
  startTimeISO: string,
  category: string,
  timeWindows: Record<string, any>,
  categoryMappings: Record<string, any>,
  timezone: string
): { valid: boolean; actualWindow: string | null; allowedWindows: string[] } {
  const dt = new Date(startTimeISO);
  const taskHour = parseInt(
    dt.toLocaleString('en-US', { timeZone: timezone, hour: 'numeric', hour12: false })
  );
  const dayOfWeek = new Date(dt.toLocaleString('en-US', { timeZone: timezone })).getDay();

  // Find actual window the task falls into
  let actualWindow: string | null = null;
  for (const [name, win] of Object.entries(timeWindows) as [string, any][]) {
    if (name === 'flexible') continue;
    if (win.days && !win.days.includes(dayOfWeek)) continue;
    if (taskHour >= win.start && taskHour < win.end) {
      actualWindow = name;
      break;
    }
  }

  // Get allowed windows for this category
  const mapping = categoryMappings[category];
  const allowedWindows: string[] = mapping?.defaultTimeWindow
    ? (Array.isArray(mapping.defaultTimeWindow) ? mapping.defaultTimeWindow : [mapping.defaultTimeWindow])
    : ['flexible'];

  // 'flexible' means any *named* window within the flexible range — NOT a free pass
  if (allowedWindows.includes('flexible')) {
    const flexWindow = timeWindows['flexible'];
    if (flexWindow && (taskHour < flexWindow.start || taskHour >= flexWindow.end)) {
      return { valid: false, actualWindow: null, allowedWindows };
    }
    return { valid: true, actualWindow: actualWindow || 'flexible', allowedWindows };
  }

  // Blanket guard: if task hour is outside ALL defined windows, always invalid
  if (actualWindow === null) {
    return { valid: false, actualWindow: null, allowedWindows };
  }

  // Check if actual window is in allowed list
  const valid = allowedWindows.includes(actualWindow);
  return { valid, actualWindow, allowedWindows };
}


/**
 * The windows a task of `category` may use today, in preference order.
 *
 * A category is placed ONLY in the windows it lists. `flexible` means "any window open today", so a
 * category listing it may use every active window (after its named ones). A category with no
 * window open today gets [] and is simply not placed today.
 *
 * WHY (2026-10-18): this used to fall back to EVERY active window whenever none of a category's
 * windows were open. A weekends-only category ("we will move ventures to weekends", the owner) would
 * then have spread across the whole weekday — the opposite of the setting. The weekend side of the
 * same fallback is why categories that relied on it now list `weekends` explicitly in the owner's row.
 */
export function getPreferredWindows(
  category: string,
  categoryMappings: Record<string, { defaultTimeWindow?: string[] }>,
  activeWindowNames: string[],
): string[] {
  const listed = categoryMappings[category]?.defaultTimeWindow;
  // An unknown/unmapped category keeps the old "anywhere today" behaviour — it has no rule to honour.
  if (!listed || listed.length === 0) return [...activeWindowNames];
  const out: string[] = [];
  for (const w of listed) {
    if (w !== 'flexible' && activeWindowNames.includes(w) && !out.includes(w)) out.push(w);
  }
  if (listed.includes('flexible')) {
    for (const w of activeWindowNames) if (!out.includes(w)) out.push(w);
  }
  return out;
}

/**
 * A keyword rule PREFERS its window; it does not confine the task to it. The keyword window leads,
 * then the task's own category windows follow, so a full keyword window relaxes to the category
 * rules instead of leaving the task unplaced (same contract the owner chose for caveats, AC-2).
 * e.g. "exercise" -> morning, on a LIFE task [after_work, weekends] => [morning, after_work] weekdays.
 */
export function withKeywordWindow(keywordWindow: string, categoryWindows: string[]): string[] {
  return [keywordWindow, ...categoryWindows.filter((w) => w !== keywordWindow)];
}
