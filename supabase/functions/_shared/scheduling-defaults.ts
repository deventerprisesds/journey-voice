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

// Default keyword→[window, category] FALLBACK table. Used when a user has not saved
// their own contextRules.keywords, so the fallback layer actually applies on the edge
// (placement) side too — not just the frontend. KEEP IN SYNC with the frontend
// src/config/schedulingRules.ts contextRules.keywords (until a shared source lands).
// Note: bank/post_office/doctor/dentist are intentionally ABSENT — the trait layer owns
// them (venue-dependent / appointment) and overrides keywords anyway.
export const DEFAULT_CONTEXT_KEYWORDS: Record<string, string[]> = {
  morning: ['morning', 'flexible'], workout: ['morning', 'LIFE'], exercise: ['morning', 'LIFE'], breakfast: ['morning', 'LIFE'],
  meeting: ['business_hours', 'CAREER'], work: ['business_hours', 'CAREER'], office: ['business_hours', 'CAREER'],
  call: ['business_hours', 'CAREER'], interview: ['business_hours', 'CAREER'], review: ['business_hours', 'CAREER'],
  study: ['evening', 'PROF_EDUCATION'], class: ['evening', 'PROF_EDUCATION'], lecture: ['evening', 'PROF_EDUCATION'],
  assignment: ['evening', 'PROF_EDUCATION'], homework: ['after_work', 'PROF_EDUCATION'],
  project: ['after_work', 'VENTURES'], side: ['after_work', 'VENTURES'], startup: ['after_work', 'VENTURES'], business: ['after_work', 'VENTURES'],
  lunch: ['business_hours', 'LIFE'], brunch: ['morning', 'LIFE'], dinner: ['evening', 'LIFE'], family: ['evening', 'LIFE'],
  relax: ['evening', 'LIFE'], social: ['evening', 'LIFE'], weekend: ['weekends', 'LIFE'], hobby: ['weekends', 'LIFE'],
  errands: ['after_work', 'LIFE'], shopping: ['after_work', 'LIFE'], mall: ['after_work', 'LIFE'], store: ['after_work', 'LIFE'],
  grocery: ['after_work', 'LIFE'], groceries: ['after_work', 'LIFE'], appointment: ['flexible', 'LIFE'],
  payment: ['flexible', 'LIFE'], invoice: ['flexible', 'CAREER'], bill: ['flexible', 'LIFE'], tax: ['flexible', 'LIFE'],
  budget: ['flexible', 'CAREER'], contract: ['flexible', 'CAREER'],
  email: ['business_hours', 'CAREER'], follow_up: ['business_hours', 'CAREER'], respond: ['business_hours', 'CAREER'],
  reply: ['business_hours', 'CAREER'], text: ['business_hours', 'LIFE'], message: ['business_hours', 'CAREER'],
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
/**
 * Whole-word match: "work" matches "extra work" but NOT "homework"/"workout". Underscores
 * in keys become spaces (follow_up → "follow up"). Prevents substring collisions.
 */
export function wordMatch(lowerText: string, phrase: string): boolean {
  const p = (phrase || '').toLowerCase().replace(/_/g, ' ').trim();
  if (p.length < 3) return false;
  const re = new RegExp('\\b' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
  return re.test(lowerText);
}

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
    // 'flexible' IS a valid keyword target now (e.g. financial tasks → flexible) — it
    // must win over the category default, so it is no longer skipped as a no-op.
    if (!targetWindow) continue;
    if (wordMatch(lower, keyword) && activeWindowNames.includes(targetWindow)) {
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
  return anchors.some((a) => wordMatch(lowerTitle, a));
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

  // 3) keyword table — FALLBACK only (never beats a trait). Uses the user's saved
  //    keywords if present, otherwise the shared DEFAULT_CONTEXT_KEYWORDS so the
  //    fallback layer applies even for users who never customized it.
  const keywords = userConfig?.contextRules?.keywords ?? DEFAULT_CONTEXT_KEYWORDS;
  const kw = getKeywordWindowOverride(title, keywords, Object.keys(timeWindows));
  if (kw) {
    return { allowedWindows: [kw.window, ...catWindows.filter((w) => w !== kw.window)], trait: null, matchedKeyword: kw.matchedKeyword, nudgeToBusinessHours: false, source: 'keyword' };
  }

  // 4) category default
  return { allowedWindows: catWindows, trait: null, matchedKeyword: null, nudgeToBusinessHours: false, source: 'category' };
}

/**
 * Weekend-evening protection: the `evening` window (19:00–22:00) on Saturday/Sunday is
 * VALID (validateTaskWindow still accepts it) but must NOT be AUTO-filled by the scheduler
 * — it's protected downtime — UNLESS the placement is an explicit user request or an
 * appointment (fixed-time). Returns true if `windowName` may be auto-placed on `dayOfWeek`.
 */
export function isAutoPlaceableWindow(
  windowName: string,
  dayOfWeek: number,
  plan: { source?: string; trait?: string | null },
): boolean {
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  if (windowName === 'evening' && isWeekend) {
    return plan.source === 'explicit' || plan.trait === 'appointment';
  }
  return true;
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
