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

/**
 * Default cap on how many hours of TASKS the builder will schedule into a single day
 * (mirrors DEFAULT_SCHEDULING_CONFIG.workingHours.maxDailyHours in the frontend). The
 * per-window capacities alone don't bound the day — weekday windows sum to ~16h — so
 * without this the builder can over-pack a day. Users override via
 * config.workingHours.maxDailyHours.
 */
export const DEFAULT_MAX_DAILY_HOURS = 7;

/**
 * Resolve the day's task-minute budget from user config (workingHours.maxDailyHours).
 * OPT-IN ONLY: if the user has not set a positive daily-hours limit, returns Infinity —
 * i.e. NO daily cap, so the day fills by window capacity exactly as it did before the cap
 * existed. This prevents the guard from silently thinning days nobody asked to limit;
 * the cap only bites when the user explicitly chooses a maxDailyHours.
 */
export function resolveMaxDailyMinutes(userConfig: any): number {
  const h = userConfig?.workingHours?.maxDailyHours;
  return (typeof h === 'number' && h > 0) ? h * 60 : Infinity;
}

/** True if scheduling `durationMinutes` more keeps the day within `maxDailyMinutes`. */
export function withinDailyCap(usedMinutes: number, durationMinutes: number, maxDailyMinutes: number): boolean {
  return usedMinutes + durationMinutes <= maxDailyMinutes;
}

// ── Impact classification (value-aware overflow) ──────────────────────────────
// When a window/day is full, ORDINARY tasks quietly roll to the next day, but a
// HIGH-IMPACT task should instead nudge the user (so it can bump a lower-value item)
// and land in the overflow queue. Impact reuses signals the scorer already elevates —
// we do NOT recompute a score here, just detect the factors.
export const FINANCIAL_KEYWORDS = ['payment', 'invoice', 'bill', 'tax', 'budget', 'contract', 'rent', 'mortgage', 'refund', 'fee', 'deposit'];
export const COMMUNICATION_KEYWORDS = ['email', 'call', 'reply', 'respond', 'follow up', 'message', 'meeting', 'text back', 'rsvp'];

export interface ImpactResult { highImpact: boolean; factors: string[] }

/**
 * Classify whether an overflowed task is HIGH-IMPACT (financial / communication /
 * time-sensitive / pinned / user-priority). Factors are additive and human-readable so
 * the nudge can explain WHY. `score` is the scorer's existing value — a high score alone
 * (>= scoreThreshold, default 12 so an is_priority +10 base clears it) also counts.
 */
export function classifyImpact(p: {
  title: string;
  score?: number;
  isPriority?: boolean;
  dueDate?: string | null;
  nowMs: number;
  pinned?: boolean;
  scoreThreshold?: number;
}): ImpactResult {
  const factors: string[] = [];
  const lower = (p.title || '').toLowerCase();
  if (FINANCIAL_KEYWORDS.some((k) => wordMatch(lower, k))) factors.push('financial');
  if (COMMUNICATION_KEYWORDS.some((k) => wordMatch(lower, k))) factors.push('communication');
  if (p.isPriority) factors.push('is_priority');
  if (p.pinned) factors.push('pinned');
  if (p.dueDate) {
    const due = new Date(p.dueDate).getTime();
    if (!Number.isNaN(due)) {
      if (due <= p.nowMs) factors.push('overdue');
      else if (due - p.nowMs <= ASSIGNMENT_URGENT_HOURS * 3600000) factors.push('due_soon');
    }
  }
  const threshold = p.scoreThreshold ?? 12;
  const highImpact = factors.length > 0 || (typeof p.score === 'number' && p.score >= threshold);
  return { highImpact, factors };
}

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
  // after_work ends where evening begins (17–19) so the two never overlap.
  after_work:     { start: 17, end: 19, days: [1, 2, 3, 4, 5] },
  evening:        { start: 19, end: 22, days: [0, 1, 2, 3, 4, 5, 6] },
  flexible:       { start: 9,  end: 22, days: [0, 1, 2, 3, 4, 5, 6] },
  weekends:       { start: 10, end: 20, days: [0, 6] },
};

export const DEFAULT_CATEGORY_MAPPINGS: Record<string, CategoryMapping> = {
  CAREER:         { defaultTimeWindow: ['business_hours'],            estimatedDuration: 120, defaultStatus: 'CAREER' },
  // maxPerDayWeekend 4: the `weekends` window is 10:00–20:00 and a study block is 90m,
  // so six fit; 4 leaves the day room for non-coursework. A SEED the user can change in
  // Settings → Scheduling, not a constant.
  PROF_EDUCATION: { defaultTimeWindow: ['after_work', 'weekends'],    estimatedDuration: 90,  defaultStatus: 'PROF_EDUCATION', maxPerDay: 2, maxPerDayWeekend: 4 },
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

/** Deterministic trait floor. Anchors + the guard when the LLM is unavailable. */
export function classifyTaskTraits(title: string): TaskTraits {
  const lower = (title || '').toLowerCase();
  return {
    appointment: matchesAnyAnchor(lower, APPOINTMENT_ANCHORS),
    venueDependent: matchesAnyAnchor(lower, VENUE_DEPENDENT_ANCHORS),
  };
}

/** OR-merge two trait sets — a trait is set if EITHER source detected it. */
export function mergeTraits(a: TaskTraits, b: TaskTraits | null | undefined): TaskTraits {
  if (!b) return a;
  return { venueDependent: a.venueDependent || b.venueDependent, appointment: a.appointment || b.appointment };
}

/**
 * Extract an explicit clock time (minutes-from-midnight) from a task title, if one is
 * stated — e.g. "dentist at 3pm" → 900, "eye exam 10:30am" → 630, "call at 14:00" → 840.
 * A stated time is the booked/fixed-time signal for an appointment (→ pinned). To avoid
 * false positives ("30 minutes", "week 3", "top 5"), a match REQUIRES an am/pm suffix or
 * a colon — a bare number is never treated as a time. Returns null when none is found.
 */
export function parseFixedClockTime(title: string): number | null {
  if (!title) return null;
  const t = title.toLowerCase();
  // 12-hour with am/pm: "3pm", "3:30 pm", "at 3 pm"
  const ampm = t.match(/\b(1[0-2]|0?[1-9])(?::([0-5][0-9]))?\s*(a\.?m\.?|p\.?m\.?)\b/);
  if (ampm) {
    let hour = parseInt(ampm[1], 10) % 12;
    const min = ampm[2] ? parseInt(ampm[2], 10) : 0;
    if (ampm[3].startsWith('p')) hour += 12;
    return hour * 60 + min;
  }
  // 24-hour with a colon: "14:00", "at 9:15" (colon required — no bare integer)
  const h24 = t.match(/\b([01]?[0-9]|2[0-3]):([0-5][0-9])\b/);
  if (h24) return parseInt(h24[1], 10) * 60 + parseInt(h24[2], 10);
  return null;
}

/**
 * LLM common-sense trait classification — generalizes BEYOND the deterministic anchors
 * (catches optometrist, DMV, pharmacy, vet, physio, …) so the keyword fallback is rarely
 * reached. Returns null on ANY failure (no key, network, bad JSON) so the caller falls
 * back to the deterministic floor — the guard is NEVER silently lost. Uses the Lovable
 * AI gateway (same as the smart scheduler's aiSuggestion path).
 */
export async function classifyTaskTraitsLLM(title: string, apiKey: string | undefined): Promise<TaskTraits | null> {
  if (!apiKey || !title) return null;
  try {
    const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        temperature: 0,
        messages: [{
          role: 'user',
          content:
            `Classify this to-do by two INDEPENDENT boolean traits. Return ONLY compact JSON.\n` +
            `Task: "${title}"\n` +
            `venueDependent = true ONLY if completing it REQUIRES physically visiting a place/service with fixed operating hours ` +
            `(bank, post office, government office/DMV, pharmacy pickup, in-person store, library, clinic front desk). ` +
            `false for anything doable from anywhere (calls, email, online, chores at home, exercise).\n` +
            `appointment = true if it is an appointment or booked in-person service ` +
            `(doctor, dentist, optometrist, physical therapy, vet, haircut, a booked meeting). false otherwise.\n` +
            `Respond with exactly: {"venueDependent":true|false,"appointment":true|false}`,
        }],
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const text: string = data?.choices?.[0]?.message?.content ?? '';
    const m = text.match(/\{[^}]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    return { venueDependent: parsed.venueDependent === true, appointment: parsed.appointment === true };
  } catch (_e) {
    return null;
  }
}

export interface WindowPlan {
  allowedWindows: string[];               // ordered preference for placement
  trait: 'appointment' | 'venue_dependent' | null;
  matchedKeyword: string | null;          // set only when the keyword FALLBACK decided it
  nudgeToBusinessHours: boolean;          // venue-dependent: offer to move into business hours
  pinned: boolean;                        // booked appointment: place at fixedTimeMinutes, immovable, ANY window
  fixedTimeMinutes: number | null;        // the booked time (minutes-from-midnight) when pinned
  source: 'explicit' | 'trait' | 'keyword' | 'category' | 'pinned';
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
  opts?: { explicitWindow?: string | null; traits?: TaskTraits; fixedTimeMinutes?: number | null },
): WindowPlan {
  const catWindows = (category && categoryMappings[category])
    ? allowedWindowsOf(categoryMappings[category])
    : ['flexible'];

  // 1) explicit user/AI request wins outright
  if (opts?.explicitWindow) {
    return { allowedWindows: [opts.explicitWindow], trait: null, matchedKeyword: null, nudgeToBusinessHours: false, pinned: false, fixedTimeMinutes: null, source: 'explicit' };
  }

  // 2) traits (systematic) beat both keyword and category. Callers may pass a richer
  //    trait classification (e.g. an LLM common-sense pass that generalizes beyond the
  //    deterministic anchors); otherwise we use the deterministic anchor floor.
  const traits = opts?.traits ?? classifyTaskTraits(title);
  if (traits.appointment) {
    // A stated clock time (caller-supplied or parsed from the title) is the booked/
    // fixed-time signal. BOOKED → pinned at that time, immovable, valid in ANY window
    // ("appointed outside your control"). UNBOOKED → flexible, NOT forced to business hours.
    const fixed = (opts?.fixedTimeMinutes ?? null) !== null ? opts!.fixedTimeMinutes! : parseFixedClockTime(title);
    if (fixed !== null) {
      return { allowedWindows: ['flexible'], trait: 'appointment', matchedKeyword: null, nudgeToBusinessHours: false, pinned: true, fixedTimeMinutes: fixed, source: 'pinned' };
    }
    return { allowedWindows: ['flexible'], trait: 'appointment', matchedKeyword: null, nudgeToBusinessHours: false, pinned: false, fixedTimeMinutes: null, source: 'trait' };
  }
  if (traits.venueDependent) {
    // Default to after-work (personal time); nudge the user to move it into
    // business hours when the venue is likely open then.
    const windows = ['after_work', ...catWindows.filter((w) => w !== 'after_work')];
    return { allowedWindows: windows, trait: 'venue_dependent', matchedKeyword: null, nudgeToBusinessHours: true, pinned: false, fixedTimeMinutes: null, source: 'trait' };
  }

  // 3) keyword table — FALLBACK only (never beats a trait). Uses the user's saved
  //    keywords if present, otherwise the shared DEFAULT_CONTEXT_KEYWORDS so the
  //    fallback layer applies even for users who never customized it.
  const keywords = userConfig?.contextRules?.keywords ?? DEFAULT_CONTEXT_KEYWORDS;
  const kw = getKeywordWindowOverride(title, keywords, Object.keys(timeWindows));
  if (kw) {
    return { allowedWindows: [kw.window, ...catWindows.filter((w) => w !== kw.window)], trait: null, matchedKeyword: kw.matchedKeyword, nudgeToBusinessHours: false, pinned: false, fixedTimeMinutes: null, source: 'keyword' };
  }

  // 4) category default
  return { allowedWindows: catWindows, trait: null, matchedKeyword: null, nudgeToBusinessHours: false, pinned: false, fixedTimeMinutes: null, source: 'category' };
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
    // Explicit requests, appointments, and pinned (booked) items may fill weekend evening.
    return plan.source === 'explicit' || plan.source === 'pinned' || plan.trait === 'appointment';
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
