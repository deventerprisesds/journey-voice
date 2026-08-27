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
export const MAX_ASSIGNMENTS_PER_DAY = 2;
export const ASSIGNMENT_URGENT_HOURS = 48;
export const ASSIGNMENT_PRIORITY_DAYS = 7;

export interface CategoryMapping {
  defaultTimeWindow: string[];
  estimatedDuration: number;
  defaultStatus: string;
  maxPerDay?: number;
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
  PROF_EDUCATION: { defaultTimeWindow: ['after_work', 'weekends'],    estimatedDuration: 90,  defaultStatus: 'PROF_EDUCATION', maxPerDay: 2 },
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
