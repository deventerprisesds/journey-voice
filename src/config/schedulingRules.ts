/**
 * Unified Scheduling Configuration
 * Blends rules from:
 * - smart-calendar-scheduler businessRules
 * - ItineraryEngine workingHours and workloadBalance
 * - useAutoScheduling and ItineraryEngine extractSchedulingContext
 *
 * ── READ-TIME NORMALISER — THIS FILE IS NOT A SERIALISER ────────────────────────────────────
 * `mergeSchedulingConfig` below is the READ-TIME NORMALISER/MIGRATOR. Its job: take a
 * possibly-partial, possibly-legacy stored config and produce a complete, valid, current-shape
 * config for the app to USE. It is field-by-field on purpose — each field has defaulting
 * semantics a spread cannot express (a two-level `contextRules` merge, a string→array migration
 * in `categoryMappings`, "blank means use the default" for `customAIInstructions`, validation of
 * `scoringModel`/`priorityBoost`). Do NOT "simplify" it to `{...DEFAULT, ...userConfig}`.
 *
 * Because it is a normaliser, it legitimately EMITS ONLY THE SHAPE IT KNOWS. Keys it has never
 * heard of (e.g. the server-only `dedup` namespace) are absent from its output BY DESIGN.
 *
 * That is safe only as long as its output is never used as a SAVE PAYLOAD. The write-time
 * persister is `saveUserSchedulingConfig` in `src/services/schedulingService.ts`; it applies a
 * PATCH to the stored JSONB and must never whole-object-replace `config` with what this function
 * returned. Historically it did, which silently deleted every key this normaliser does not emit
 * (docs/verify/nudge-delivery-loop1.md §F1). If you are about to persist the result of this
 * function, read the header of `schedulingService.ts` first.
 * ───────────────────────────────────────────────────────────────────────────────────────────
 */

export interface TimeWindow {
  start: number; // hour (0-23)
  end: number; // hour (0-23)
  days: number[]; // 0=Sunday, 6=Saturday
}

/**
 * Nudge delivery knobs. Read server-side by `nightly-schedule-builder` as
 * `config.nudges.deliverAtLocalHour` (index.ts:317). Every field is OPTIONAL and is omitted from
 * the stored config when the user has not set it, so the server's own default applies — the
 * client deliberately does not materialise a default here (see AssignmentsConfig's note).
 */
export interface NudgeConfig {
  /** Local hour, 0–23, at which the daily nudge digest is delivered. Server default: 8. */
  deliverAtLocalHour?: number;
}

/**
 * Coursework/assignment scoping + ordering knobs. Read server-side by
 * `nightly-schedule-builder` (`config.assignments.soonDays` / `.recentOverdueDays`, index.ts:790-791)
 * and by `_shared/nexus.ts`'s active-course resolution.
 *
 * EVERY FIELD IS OPTIONAL AND IS OMITTED WHEN UNSET — never materialised as `0`, `[]` or `false`.
 * That distinction is load-bearing, not stylistic: `resolveActiveCourseIds` treats an ABSENT
 * `activeCourseIds` as "infer the active set from ingestion recency" and a PRESENT one as "use
 * exactly these". Writing an empty array from the UI would therefore silently change which
 * courses are ingested. "Unset" must stay expressible.
 */
export interface AssignmentsConfig {
  /** Days ahead that still counts as "due soon". Server default: 14. */
  soonDays?: number;
  /** Days back that still counts as a "recent miss" rather than old backlog. */
  recentOverdueDays?: number;
  /** Pin the active course set explicitly. Absent = infer from ingestion recency. */
  activeCourseIds?: string[];
  /** Always drop these course ids, even if inferred or pinned. */
  excludeCourseIds?: string[];
  /** How far back from the newest ingestion still counts as the same era. Server default: 14. */
  activeCourseEraDays?: number;
  /** Treat assignments with no course_id as active. Server default: false. */
  includeUncoursed?: boolean;
}

export interface SchedulingConfig {
  timezone: string; // IANA timezone identifier (e.g., 'America/New_York')
  timeWindows: {
    morning: TimeWindow;
    business_hours: TimeWindow;
    after_work: TimeWindow;
    evening: TimeWindow;
    flexible: TimeWindow;
    weekends: TimeWindow;
  };
  workingHours: {
    defaultStart: number; // hour
    defaultEnd: number; // hour
    breakMinutes: number;
    maxDailyHours: number;
  };
  workloadBalance: {
    projectToTaskRatio: number; // 0-1, e.g., 0.6 = 60% project work
    oneOffTaskRatio: number; // 0-1, e.g., 0.3 = 30% one-off tasks
    bufferRatio: number; // 0-1, e.g., 0.1 = 10% buffer time
  };
  categoryMappings: {
    [category: string]: {
      defaultTimeWindow: string[]; // Array of allowed time windows
      defaultStatus: string;
      estimatedDuration: number; // minutes
      maxPerDay?: number; // Optional max tasks per day for this category (weekdays)
      // Optional SEPARATE weekend allowance. maxPerDay was sized for a weekday evening but
      // was being applied to Saturday/Sunday too, where the `weekends` window is 10:00–20:00.
      // Absent → falls back to maxPerDay, so existing saved configs behave exactly as before.
      maxPerDayWeekend?: number;
    };
  };
  contextRules: {
    keywords: {
      [key: string]: string[]; // keyword -> [timeWindow, status]
    };
    priorityMappings: {
      [priority: string]: number; // priority -> weight multiplier
    };
  };
  customAIInstructions?: string; // Free-form text instructions for AI scheduler
  // Which scheduling ordering the nightly builder uses for THIS user.
  // 'composite' (default) = recency/deadline/finance lead and explicit priority is a differentiator.
  // 'priority-rank' = legacy, explicit is_priority dominates. Read by nightly-schedule-builder as
  // `config.scoringModel`; a body override still wins over this. Self-serve via Settings → Scheduling.
  scoringModel?: 'composite' | 'priority-rank';
  // Whether the is_priority lane grants SCORE privileges in the nightly builder.
  // true (default) = existing behavior: flagged tasks get a score boost and are immune to the
  // pushed-count and staleness penalties.
  // false = the lane is ignored for scoring, so due date / recency / keywords decide ordering.
  // Added 2026-08-25: the lane had spread to 89% of one board, so it no longer discriminated and
  // long-overdue flagged items were outranking fresh due-today work. Reversible at any time.
  priorityBoost?: boolean;
  // Nudge delivery + coursework scoping. Both are OPTIONAL and are omitted when unset so the
  // server keeps its own defaults — see the interfaces above.
  nudges?: NudgeConfig;
  assignments?: AssignmentsConfig;
}

/**
 * A config key that NO source file branches on, kept permanently so a round-trip test can prove
 * the SAVE PATH preserves keys it has never heard of — not merely the handful of namespaces that
 * happen to be known today (AC-6c).
 *
 * Exported only so the regression script does not hardcode the string. It is deliberately NOT a
 * member of `SchedulingConfig`, NOT referenced by `mergeSchedulingConfig`, and NOT referenced by
 * `saveUserSchedulingConfig`. If either function ever grows a branch on it, the probe stops
 * testing what it claims to test.
 */
export const CONFIG_ROUNDTRIP_PROBE_KEY = '__ac6_probe';

// Default configuration blending all existing rules
export const DEFAULT_SCHEDULING_CONFIG: SchedulingConfig = {
  timezone: 'America/New_York', // Will be auto-detected on first use
  timeWindows: {
    morning: {
      start: 6,
      end: 9,
      days: [1, 2, 3, 4, 5], // weekdays
    },
    business_hours: {
      start: 9,
      end: 17,
      days: [1, 2, 3, 4, 5], // weekdays
    },
    after_work: {
      start: 17,
      end: 19, // ends where evening begins — no overlap with evening (19–22)
      days: [1, 2, 3, 4, 5], // weekdays only (Saturday is covered by weekends)
    },
    evening: {
      start: 19,
      end: 22,
      days: [0, 1, 2, 3, 4, 5, 6], // all days
    },
    flexible: {
      start: 9,
      end: 22,
      days: [0, 1, 2, 3, 4, 5, 6], // all days
    },
    weekends: {
      start: 10,
      end: 20,
      days: [0, 6], // Sunday, Saturday
    },
  },
  workingHours: {
    defaultStart: 9,
    defaultEnd: 17,
    breakMinutes: 60,
    maxDailyHours: 7,
  },
  workloadBalance: {
    projectToTaskRatio: 0.6,
    oneOffTaskRatio: 0.3,
    bufferRatio: 0.1,
  },
  categoryMappings: {
    CAREER: {
      defaultTimeWindow: ['business_hours'],
      defaultStatus: 'CAREER',
      estimatedDuration: 120,
    },
    PROF_EDUCATION: {
      defaultTimeWindow: ['after_work', 'weekends'],
      defaultStatus: 'PROF_EDUCATION',
      estimatedDuration: 90,
      maxPerDay: 2,
      // Seed only — changeable in Settings → Scheduling. The weekends window is 10:00–20:00
      // and a study block is 90m, so six fit; 4 leaves the day room for non-coursework.
      maxPerDayWeekend: 4
    },
    EDUCATION: {
      defaultTimeWindow: ['flexible'],
      defaultStatus: 'EDUCATION',
      estimatedDuration: 90,
    },
    VENTURES: {
      defaultTimeWindow: ['after_work', 'weekends'],
      defaultStatus: 'VENTURES',
      estimatedDuration: 120,
    },
    LIFE: {
      defaultTimeWindow: ['flexible'],
      defaultStatus: 'LIFE',
      estimatedDuration: 60,
    },
    PERSONAL: {
      defaultTimeWindow: ['flexible'],
      defaultStatus: 'LIFE',
      estimatedDuration: 60,
    },
  },
  contextRules: {
    keywords: {
      // Morning keywords
      morning: ['morning', 'flexible'],
      workout: ['morning', 'LIFE'],
      exercise: ['morning', 'LIFE'],
      breakfast: ['morning', 'LIFE'],
      
      // Business hours keywords
      meeting: ['business_hours', 'CAREER'],
      work: ['business_hours', 'CAREER'],
      office: ['business_hours', 'CAREER'],
      call: ['business_hours', 'CAREER'],
      interview: ['business_hours', 'CAREER'],
      review: ['business_hours', 'CAREER'],
      
      // Education keywords — study/class/lecture/assignment go to evening (personal
      // study time after the workday); homework stays after_work.
      study: ['evening', 'PROF_EDUCATION'],
      class: ['evening', 'PROF_EDUCATION'],
      lecture: ['evening', 'PROF_EDUCATION'],
      assignment: ['evening', 'PROF_EDUCATION'],
      homework: ['after_work', 'PROF_EDUCATION'],
      
      // After work keywords
      project: ['after_work', 'VENTURES'],
      side: ['after_work', 'VENTURES'],
      startup: ['after_work', 'VENTURES'],
      business: ['after_work', 'VENTURES'],
      
      // Meal and social keywords
      lunch: ['business_hours', 'LIFE'],
      brunch: ['morning', 'LIFE'],
      dinner: ['evening', 'LIFE'],
      family: ['evening', 'LIFE'],
      relax: ['evening', 'LIFE'],
      social: ['evening', 'LIFE'],
      
      // Weekend keywords
      weekend: ['weekends', 'LIFE'],
      hobby: ['weekends', 'LIFE'],
      
      // Errands & appointments - after work or specific times
      errands: ['after_work', 'LIFE'],
      shopping: ['after_work', 'LIFE'],
      mall: ['after_work', 'LIFE'],
      store: ['after_work', 'LIFE'],
      grocery: ['after_work', 'LIFE'],
      groceries: ['after_work', 'LIFE'],
      // bank / post_office / doctor / dentist are handled by the TRAIT layer
      // (venue-dependent → after-work + nudge; appointment → flexible), which
      // overrides keywords — so they are intentionally NOT keyword entries here.
      appointment: ['flexible', 'LIFE'],
      
      // Financial impact keywords — flexible window (can be done any time 9am–10pm);
      // their HIGH-IMPACT priority is handled separately by the scorer, not the window.
      payment: ['flexible', 'LIFE'],
      invoice: ['flexible', 'CAREER'],
      bill: ['flexible', 'LIFE'],
      tax: ['flexible', 'LIFE'],
      budget: ['flexible', 'CAREER'],
      contract: ['flexible', 'CAREER'],
      
      // Communications / people keywords
      email: ['business_hours', 'CAREER'],
      follow_up: ['business_hours', 'CAREER'],
      respond: ['business_hours', 'CAREER'],
      reply: ['business_hours', 'CAREER'],
      text: ['business_hours', 'LIFE'],
      message: ['business_hours', 'CAREER'],
    },
    priorityMappings: {
      urgent: 4,
      high: 3,
      medium: 2,
      low: 1,
    },
  },
  customAIInstructions: `You are a time scheduling expert. When analyzing tasks for scheduling:

1. Consider typical timing for the activity type (meals, meetings, errands, workouts, etc.)
2. Find the NEXT AVAILABLE slot that matches natural timing patterns
3. Avoid all user's busy times
4. Respect category defaults (CAREER during business_hours, EDUCATION/VENTURES after_work, LIFE flexible)
5. If a suggested time is in the past or conflicted, propose the next logical occurrence
6. ALWAYS prioritize: (a) tasks with due dates within 48 hours, (b) tasks involving people or communications (meetings, calls, emails, follow-ups), and (c) tasks with financial impact (payments, invoices, contracts). Schedule these earlier in the day and give them preference over same-priority tasks.

Return your suggestion with reasoning that explains why this time makes sense for this specific activity.`, // Default AI instructions
  scoringModel: 'composite', // Composite is the default; user can opt into legacy 'priority-rank'.
  priorityBoost: true, // Default preserves existing behavior; set false to ignore the is_priority lane when scoring.
};

// Helper function to validate config
export function validateSchedulingConfig(config: Partial<SchedulingConfig>): boolean {
  // Validate workload balance
  if (config.workloadBalance) {
    const { projectToTaskRatio, oneOffTaskRatio, bufferRatio } = config.workloadBalance;
    const sum = projectToTaskRatio + oneOffTaskRatio + bufferRatio;
    if (Math.abs(sum - 1) > 0.01) {
      console.warn('Workload balance ratios should sum to 1.0');
      return false;
    }
  }
  
  // Validate time windows - each category must have at least one
  if (config.categoryMappings) {
    for (const [category, mapping] of Object.entries(config.categoryMappings)) {
      if (!mapping.defaultTimeWindow || mapping.defaultTimeWindow.length === 0) {
        console.error(`Category ${category} must have at least one time window`);
        return false;
      }
    }
  }
  
  return true;
}

/** An integer within [min,max], or undefined. Anything else (NaN, '8am', 25, 1.5) is DROPPED,
 *  never substituted with a client-side guess — an absent key lets the server default apply. */
function normalizeIntInRange(value: unknown, min: number, max: number): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return undefined;
  return n;
}

/** A list of non-empty, de-duplicated strings, or undefined when the key was absent.
 *  An EMPTY array is preserved as an empty array — it is a value the user can mean. */
function normalizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const v of value) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * Pass-through-with-validation. Returns undefined ONLY when the user config had no such object,
 * so "the user has never set this" stays distinguishable from "the user set it to nothing" — the
 * server treats those two differently (see AssignmentsConfig).
 */
function normalizeNudgeConfig(value: unknown): NudgeConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const src = value as Record<string, unknown>;
  const out: NudgeConfig = {};
  const hour = normalizeIntInRange(src.deliverAtLocalHour, 0, 23);
  if (hour !== undefined) out.deliverAtLocalHour = hour;
  return out;
}

function normalizeAssignmentsConfig(value: unknown): AssignmentsConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const src = value as Record<string, unknown>;
  const out: AssignmentsConfig = {};
  const soonDays = normalizeIntInRange(src.soonDays, 0, 365);
  if (soonDays !== undefined) out.soonDays = soonDays;
  const recentOverdueDays = normalizeIntInRange(src.recentOverdueDays, 0, 365);
  if (recentOverdueDays !== undefined) out.recentOverdueDays = recentOverdueDays;
  const eraDays = normalizeIntInRange(src.activeCourseEraDays, 0, 365);
  if (eraDays !== undefined) out.activeCourseEraDays = eraDays;
  const activeCourseIds = normalizeStringList(src.activeCourseIds);
  if (activeCourseIds !== undefined) out.activeCourseIds = activeCourseIds;
  const excludeCourseIds = normalizeStringList(src.excludeCourseIds);
  if (excludeCourseIds !== undefined) out.excludeCourseIds = excludeCourseIds;
  if (typeof src.includeUncoursed === 'boolean') out.includeUncoursed = src.includeUncoursed;
  return out;
}

/**
 * STRUCTURAL GUARD — the reason `priorityBoost` was unpersistable for as long as it was.
 *
 * `priorityBoost` was declared in `SchedulingConfig` and in `DEFAULT_SCHEDULING_CONFIG` but was
 * missing from the return literal below, so nothing ever emitted it and the Settings toggle could
 * not round-trip. That is a CLASS of defect — "a declared, defaulted field is silently omitted by
 * the normaliser" — and adding one line for `priorityBoost` alone would leave the class open for
 * whatever field is added next.
 *
 * This asserts keys(DEFAULT_SCHEDULING_CONFIG) ⊆ keys(normaliser output), so the NEXT omission is
 * caught where it is introduced. Subset, not equality: namespaces that must not carry invented
 * client defaults (`nudges`, `assignments`) are legitimately absent from the defaults object while
 * still being emitted when the user has set them. Dev-only; never throws in production.
 */
function assertNormaliserCoversDefaults(result: SchedulingConfig): void {
  const missing = Object.keys(DEFAULT_SCHEDULING_CONFIG).filter((k) => !(k in result));
  if (missing.length) {
    console.error(
      `[schedulingRules] mergeSchedulingConfig omits declared field(s): ${missing.join(', ')}. ` +
        'A field in DEFAULT_SCHEDULING_CONFIG that the normaliser never emits can never be saved ' +
        '— add it to the return literal with its own defaulting rule.',
    );
  }
}

// Helper to merge user config with defaults.
// READ-TIME NORMALISER. See the file header: its output is a normalised VIEW for the app to use
// and must never be written back as a whole-object save payload.
export function mergeSchedulingConfig(
  userConfig: Partial<SchedulingConfig>
): SchedulingConfig {
  // Migrate old single-string time windows to arrays
  const migratedCategoryMappings = userConfig.categoryMappings 
    ? Object.entries(userConfig.categoryMappings).reduce((acc, [key, mapping]) => {
        acc[key] = {
          ...mapping,
          defaultTimeWindow: Array.isArray(mapping.defaultTimeWindow)
            ? mapping.defaultTimeWindow
            : [mapping.defaultTimeWindow], // Wrap string in array for backward compatibility
        };
        return acc;
      }, {} as SchedulingConfig['categoryMappings'])
    : undefined;

  const normalizedNudges = normalizeNudgeConfig(userConfig.nudges);
  const normalizedAssignments = normalizeAssignmentsConfig(userConfig.assignments);

  const merged: SchedulingConfig = {
    timezone: userConfig.timezone ?? DEFAULT_SCHEDULING_CONFIG.timezone,
    timeWindows: { ...DEFAULT_SCHEDULING_CONFIG.timeWindows, ...userConfig.timeWindows },
    workingHours: { ...DEFAULT_SCHEDULING_CONFIG.workingHours, ...userConfig.workingHours },
    workloadBalance: { ...DEFAULT_SCHEDULING_CONFIG.workloadBalance, ...userConfig.workloadBalance },
    categoryMappings: { 
      ...DEFAULT_SCHEDULING_CONFIG.categoryMappings, 
      ...migratedCategoryMappings 
    },
    contextRules: {
      keywords: { ...DEFAULT_SCHEDULING_CONFIG.contextRules.keywords, ...userConfig.contextRules?.keywords },
      priorityMappings: { ...DEFAULT_SCHEDULING_CONFIG.contextRules.priorityMappings, ...userConfig.contextRules?.priorityMappings },
    },
    // Use user instructions if provided and not empty, otherwise use default
    customAIInstructions: (userConfig.customAIInstructions && userConfig.customAIInstructions.trim() !== '')
      ? userConfig.customAIInstructions
      : DEFAULT_SCHEDULING_CONFIG.customAIInstructions,
    // Carry the user's scoring-model choice through the merge (built field-by-field, so it must be
    // named here or it would be silently dropped on load and the Settings toggle would never persist).
    // Composite is the default: only an explicit 'priority-rank' opts out; absent/anything-else = composite.
    scoringModel: userConfig.scoringModel === 'priority-rank' ? 'priority-rank' : 'composite',
    // Same reason as scoringModel: declared, defaulted, and previously ABSENT from this literal,
    // so the Settings toggle could never round-trip. Only an explicit `false` opts out; absent or
    // anything else keeps the existing behaviour (true). Guarded structurally by
    // assertNormaliserCoversDefaults so the next omitted field is caught, not just this one.
    priorityBoost: userConfig.priorityBoost === false ? false : true,
    // Emitted ONLY when the user has actually set them, so "unset" stays distinguishable from
    // "set to nothing" and the server's own defaults still apply. Never given a client default.
    ...(normalizedNudges !== undefined ? { nudges: normalizedNudges } : {}),
    ...(normalizedAssignments !== undefined ? { assignments: normalizedAssignments } : {}),
  };

  assertNormaliserCoversDefaults(merged);
  return merged;
}
