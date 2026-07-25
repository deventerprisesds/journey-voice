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
  // after_work ends where evening begins (17–19) so the two never overlap.
  after_work:     { start: 17, end: 19, days: [1, 2, 3, 4, 5] },
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

export const DEFAULT_PRIORITY_WEIGHT: Record<string, number> = { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

/**
 * Resolve the priority→weight map from the user's config
 * (contextRules.priorityMappings, keyed lowercase e.g. {urgent:4}) falling back to
 * DEFAULT_PRIORITY_WEIGHT. Returns an UPPERCASE-keyed map so callers can index by
 * task.priority ('URGENT' | 'HIGH' | 'MEDIUM' | 'LOW'). Previously every scorer
 * hardcoded 4/3/2/1 and silently ignored this GUI setting.
 */
export function resolvePriorityWeight(userConfig: any): Record<string, number> {
  const pm = userConfig?.contextRules?.priorityMappings;
  if (!pm || typeof pm !== 'object') return { ...DEFAULT_PRIORITY_WEIGHT };
  const out: Record<string, number> = { ...DEFAULT_PRIORITY_WEIGHT };
  for (const [k, v] of Object.entries(pm)) {
    if (typeof v === 'number') out[k.toUpperCase()] = v;
  }
  return out;
}

/**
 * Inspect a task title for contextRules.keywords matches and return the preferred
 * window that should override the category default, if any. Shared so EVERY scheduler
 * (nightly builder + the voice/manual smart scheduler) honors the user's keyword rules
 * — previously only the nightly builder did, so a "bank" task created by voice ignored
 * the business_hours mapping.
 *
 * contextKeywords maps keyword -> [timeWindow, status] (per schedulingRules.ts).
 * Returns { window, matchedKeyword } when a keyword substring-matches the title AND the
 * resulting window is in activeWindowNames; null otherwise. 'flexible' is never an override.
 */
export function getKeywordWindowOverride(
  title: string,
  contextKeywords: Record<string, string[]> | undefined,
  activeWindowNames: string[]
): { window: string; matchedKeyword: string } | null {
  if (!contextKeywords || !title) return null;
  const lower = title.toLowerCase();
  for (const [keyword, mapping] of Object.entries(contextKeywords)) {
    if (!Array.isArray(mapping) || mapping.length === 0) continue;
    const targetWindow = mapping[0];
    if (!targetWindow || targetWindow === 'flexible') continue;
    const kw = keyword.toLowerCase().replace(/_/g, ' ');
    if (kw.length < 3) continue;
    if (lower.includes(kw) && activeWindowNames.includes(targetWindow)) {
      return { window: targetWindow, matchedKeyword: keyword };
    }
  }
  return null;
}

/** Normalize a category mapping's defaultTimeWindow (string | string[]) to an ordered array. */
export function allowedWindowsOf(mapping: any): string[] {
  const w = mapping?.defaultTimeWindow;
  if (Array.isArray(w)) return w.length ? w : ['flexible'];
  return w ? [w] : ['flexible'];
}

// ── Trait-based classification (systematic layer) ─────────────────────────────
// We classify a task by WHAT IT IS (traits), then rules act on the trait — instead
// of mapping specific nouns to windows. The anchor sets below are the deterministic
// FLOOR + the test oracle; a common-sense/LLM layer (added next) generalizes to
// unlisted siblings (optometrist, vet, DMV…). doctor/dentist and bank/post office are
// the agreed hardcoded anchors used to verify the systematic layer generalizes.
const VENUE_DEPENDENT_ANCHORS = ['bank', 'post office', 'post_office'];
const APPOINTMENT_ANCHORS = ['doctor', 'dentist'];

export interface TaskTraits {
  venueDependent: boolean; // needs a place/service with fixed operating hours
  appointment: boolean;    // an appointment (doctor/dentist-type)
}

function matchesAnyAnchor(lowerTitle: string, anchors: string[]): boolean {
  return anchors.some((a) => {
    const needle = a.replace(/_/g, ' ');
    return needle.length >= 3 && lowerTitle.includes(needle);
  });
}

/** Deterministic trait floor. The LLM layer (next increment) augments this. */
export function classifyTaskTraits(title: string): TaskTraits {
  const lower = (title || '').toLowerCase();
  return {
    appointment: matchesAnyAnchor(lower, APPOINTMENT_ANCHORS),
    venueDependent: matchesAnyAnchor(lower, VENUE_DEPENDENT_ANCHORS),
  };
}

export interface WindowPlan {
  allowedWindows: string[];               // ordered preference for placement
  trait: 'appointment' | 'venue_dependent' | null;
  matchedKeyword: string | null;          // set only when the keyword FALLBACK decided it
  nudgeToBusinessHours: boolean;          // venue-dependent: offer to move into business hours
  source: 'explicit' | 'trait' | 'keyword' | 'category';
}

/**
 * Resolve the ordered allowed windows for a task using the AGREED precedence:
 *   explicit request  >  trait (appointment / venue-dependent)  >  keyword table (FALLBACK)  >  category default
 * The keyword table is a FALLBACK — it only decides the window when no trait fired.
 * Shared by every scheduler so the voice/manual and nightly paths behave identically.
 */
export function resolveWindowPlan(
  title: string,
  category: string | undefined,
  userConfig: any,
  timeWindows: Record<string, TimeWindow>,
  categoryMappings: Record<string, CategoryMapping>,
  opts?: { explicitWindow?: string | null },
): WindowPlan {
  const catWindows = (category && categoryMappings[category])
    ? allowedWindowsOf(categoryMappings[category])
    : ['flexible'];

  // 1) explicit user/AI request wins outright
  if (opts?.explicitWindow) {
    return { allowedWindows: [opts.explicitWindow], trait: null, matchedKeyword: null, nudgeToBusinessHours: false, source: 'explicit' };
  }

  // 2) traits (systematic) beat both keyword and category
  const traits = classifyTaskTraits(title);
  if (traits.appointment) {
    // Unbooked appointment: flexible, NOT forced into business hours.
    // (A booked appointment carries a fixed time and is pinned elsewhere.)
    return { allowedWindows: ['flexible'], trait: 'appointment', matchedKeyword: null, nudgeToBusinessHours: false, source: 'trait' };
  }
  if (traits.venueDependent) {
    // Default to after-work (personal time); nudge the user to move it into
    // business hours when the venue is likely open then.
    const windows = ['after_work', ...catWindows.filter((w) => w !== 'after_work')];
    return { allowedWindows: windows, trait: 'venue_dependent', matchedKeyword: null, nudgeToBusinessHours: true, source: 'trait' };
  }

  // 3) keyword table — FALLBACK only (never beats a trait)
  const kw = getKeywordWindowOverride(title, userConfig?.contextRules?.keywords, Object.keys(timeWindows));
  if (kw) {
    return { allowedWindows: [kw.window, ...catWindows.filter((w) => w !== kw.window)], trait: null, matchedKeyword: kw.matchedKeyword, nudgeToBusinessHours: false, source: 'keyword' };
  }

  // 4) category default
  return { allowedWindows: catWindows, trait: null, matchedKeyword: null, nudgeToBusinessHours: false, source: 'category' };
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
