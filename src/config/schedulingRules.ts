/**
 * Unified Scheduling Configuration
 * Blends rules from:
 * - smart-calendar-scheduler businessRules
 * - ItineraryEngine workingHours and workloadBalance
 * - useAutoScheduling and ItineraryEngine extractSchedulingContext
 */

import { resolveKeywords } from '@/utils/resolveKeywords';
// Activities are IMPORTED from the edge-function module, not mirrored: one implementation for the
// schedulers, the Settings screen and the calendar view, so the three cannot disagree.
import type { Activity } from '../../supabase/functions/_shared/activities.ts';
export type { Activity };

export interface TimeWindow {
  start: number; // hour (0-23)
  end: number; // hour (0-23)
  days: number[]; // 0=Sunday, 6=Saturday
}

/** Mirrors SchedulingCaveat in supabase/functions/_shared/scheduling-defaults.ts — keep in sync. */
export interface SchedulingCaveat {
  id: string;
  text: string;
  match: { categories?: string[]; tags?: string[]; keywords?: string[] };
  preferWindows: string[];
  expiresAt?: string | null;   // null/omitted = until explicitly cleared
  createdAt?: string;
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
      // Owner 2026-11-04 (option C): may a title keyword move this category's tasks OUTSIDE the windows
      // above? Absent = yes (the behaviour before). Contract: _shared/keyword-rules.ts rule 5.
      keywordsCanLeaveWindows?: boolean;
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
  /**
   * TEMPORARY caveats the scheduler follows until they expire or are cleared — e.g. "push research
   * to the evening for now". A read-time OVERLAY: never merged into timeWindows/categoryMappings, so
   * clearing one restores prior behaviour exactly, with no migration. Backend contract lives in
   * supabase/functions/_shared/scheduling-defaults.ts (SchedulingCaveat / activeCaveats / applyCaveats).
   */
  caveats?: SchedulingCaveat[];
  /**
   * Coursework WORK SESSIONS (P3, owner 2026-10-29): every dated assignment is split into
   * session cards of `sessionMinutes`, spread from today to `finishBufferDays` before its due date.
   * Backend contract: supabase/functions/_shared/work-sessions.ts (resolveSessionConfig).
   */
  assignmentSessions?: {
    enabled: boolean;
    finishBufferDays: number;     // finish this many days before the due date (owner: 7)
    sessionMinutes: number;       // length of one work session (owner: 90)
    defaultEffortMinutes: number; // total effort when Nexus gives none (owner: 180)
    lateBufferHours: number;      // already inside the window: last session ends this long before due
    onePaperPerDay?: boolean;     // at most one paper-type assignment's sessions per night (owner 2026-11-04)
    finiteTypeKeywords?: string[]; // title words that mark a finite type (reading, PowerPoint) -- not a paper
  };
  /**
   * Recurring / one-off / on-demand ACTIVITIES (lunch, gym, church, haircut, 1:1s) — reserved time
   * that is never a task. UNDEFINED means "never saved", and the shared seed (lunch + gym) applies;
   * an empty array means the owner removed them all. Never default this to [].
   * Contract: supabase/functions/_shared/activities.ts.
   */
  activities?: Activity[];
  /**
   * How strongly a category wins a contested slot (added to the scheduler's score). Owner 2026-11-04:
   * education outranks Ventures. Backend contract: _shared/scheduling-defaults.ts resolveCategoryWeights.
   */
  categoryWeights?: Record<string, number>;
  /**
   * Owner-defined "wins when tasks compete for the same time" rules. Empty/undefined = no effect.
   * Backend contract: supabase/functions/_shared/conflict-rules.ts (resolveConflictRules).
   */
  conflictRules?: ConflictRule[];
  /**
   * Per-account switch for the NIGHTLY build, plus an optional label for the account. Absent = on.
   * Backend contract: supabase/functions/_shared/nightly-switch.ts (skipNightlyRun).
   */
  nightlySchedule?: { enabled?: boolean; label?: string };
}

export type ConflictMatch =
  | { kind: 'category'; value: string }
  | { kind: 'tag'; value: string }
  | { kind: 'coursework' };

export interface ConflictRule {
  id: string;
  label?: string;
  match: ConflictMatch;
  weight: number;
  enabled?: boolean;
}

// Default configuration blending all existing rules
export const DEFAULT_SCHEDULING_CONFIG: SchedulingConfig = {
  // Seeds only: education wins a slot over other work by default (owner 2026-11-04).
  categoryWeights: { PROF_EDUCATION: 20, EDUCATION: 20 },
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
      end: 22,
      days: [1, 2, 3, 4, 5], // weekdays only -- Saturday is covered by `weekends`
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
  // Seeds only — every value is changeable in Settings → Scheduling → Coursework work sessions.
  assignmentSessions: {
    enabled: true,
    finishBufferDays: 7,
    sessionMinutes: 90,
    defaultEffortMinutes: 180,
    lateBufferHours: 1,
    onePaperPerDay: true,
    finiteTypeKeywords: ['reading', 'readings', 'read', 'chapter', 'chapters', 'powerpoint', 'slides', 'slide deck', 'presentation', 'ppt'],
  },
  categoryMappings: {
    // JOB = the employer's work; CAREER = getting the next role (owner 2026-11-03). Seeds only -- both rows
    // are changeable in Settings. JOB's lane is BACKLOG because task_status has no JOB value.
    JOB: {
      defaultTimeWindow: ['business_hours'],
      defaultStatus: 'BACKLOG',
      estimatedDuration: 120,
    },
    CAREER: {
      defaultTimeWindow: ['after_work', 'weekends'],
      defaultStatus: 'CAREER',
      estimatedDuration: 120,
    },
    PROF_EDUCATION: {
      defaultTimeWindow: ['after_work', 'weekends'],
      defaultStatus: 'PROF_EDUCATION',
      estimatedDuration: 90,
      maxPerDay: 2,
      // Seed only — changeable in Settings → Scheduling. Owner 2026-10-28: weekday 2, weekend 6
      // (the weekends window is 10:00–20:00 and a study block is 90m, so six fit).
      maxPerDayWeekend: 6
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
      meeting: ['business_hours', 'JOB'],
      work: ['business_hours', 'JOB'],
      office: ['business_hours', 'JOB'],
      call: ['business_hours', 'JOB'],
      interview: ['business_hours', 'CAREER'],
      review: ['business_hours', 'JOB'],
      
      // Education keywords
      study: ['business_hours', 'PROF_EDUCATION'],
      class: ['business_hours', 'PROF_EDUCATION'],
      lecture: ['business_hours', 'PROF_EDUCATION'],
      assignment: ['business_hours', 'PROF_EDUCATION'],
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
      bank: ['business_hours', 'LIFE'],
      post_office: ['business_hours', 'LIFE'],
      doctor: ['business_hours', 'LIFE'],
      dentist: ['business_hours', 'LIFE'],
      appointment: ['flexible', 'LIFE'],
      
      // Financial impact keywords
      payment: ['business_hours', 'LIFE'],
      invoice: ['business_hours', 'JOB'],
      bill: ['business_hours', 'LIFE'],
      tax: ['business_hours', 'LIFE'],
      budget: ['business_hours', 'JOB'],
      contract: ['business_hours', 'JOB'],
      
      // Communications / people keywords
      email: ['business_hours', 'JOB'],
      follow_up: ['business_hours', 'JOB'],
      respond: ['business_hours', 'JOB'],
      reply: ['business_hours', 'JOB'],
      text: ['business_hours', 'LIFE'],
      message: ['business_hours', 'JOB'],
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
4. Respect the category windows in this config (JOB during business_hours by default, CAREER/EDUCATION/VENTURES after_work and weekends, LIFE flexible)
5. If a suggested time is in the past or conflicted, propose the next logical occurrence
6. ALWAYS prioritize: (a) tasks with due dates within 48 hours, (b) tasks involving people or communications (meetings, calls, emails, follow-ups), and (c) tasks with financial impact (payments, invoices, contracts). Schedule these earlier in the day and give them preference over same-priority tasks.

Return your suggestion with reasoning that explains why this time makes sense for this specific activity.`, // Default AI instructions
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

// Helper to merge user config with defaults
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

  return {
    timezone: userConfig.timezone ?? DEFAULT_SCHEDULING_CONFIG.timezone,
    timeWindows: { ...DEFAULT_SCHEDULING_CONFIG.timeWindows, ...userConfig.timeWindows },
    workingHours: { ...DEFAULT_SCHEDULING_CONFIG.workingHours, ...userConfig.workingHours },
    workloadBalance: { ...DEFAULT_SCHEDULING_CONFIG.workloadBalance, ...userConfig.workloadBalance },
    categoryMappings: { 
      ...DEFAULT_SCHEDULING_CONFIG.categoryMappings, 
      ...migratedCategoryMappings 
    },
    contextRules: {
      // Stored list replaces the defaults wholesale, as the nightly scheduler reads it (see resolveKeywords).
      keywords: resolveKeywords(userConfig.contextRules?.keywords, DEFAULT_SCHEDULING_CONFIG.contextRules.keywords),
      priorityMappings: { ...DEFAULT_SCHEDULING_CONFIG.contextRules.priorityMappings, ...userConfig.contextRules?.priorityMappings },
    },
    // Use user instructions if provided and not empty, otherwise use default
    customAIInstructions: (userConfig.customAIInstructions && userConfig.customAIInstructions.trim() !== '') 
      ? userConfig.customAIInstructions 
      : DEFAULT_SCHEDULING_CONFIG.customAIInstructions,
    // Caveats are a pass-through overlay. They MUST be carried here: this function rebuilds the
    // config object explicitly, so any key it forgets is silently dropped on the next save — which
    // would wipe the owner's active caveats the moment they touched any other setting.
    caveats: Array.isArray(userConfig.caveats) ? userConfig.caveats : [],
    // Carried for the same reason as caveats: a key this function forgets is dropped on the next save.
    assignmentSessions: { ...DEFAULT_SCHEDULING_CONFIG.assignmentSessions!, ...(userConfig.assignmentSessions ?? {}) },
    // Same pass-through rule: defaults under saved, so a seed applies until the owner changes it.
    categoryWeights: { ...DEFAULT_SCHEDULING_CONFIG.categoryWeights!, ...(userConfig.categoryWeights ?? {}) },
    // Owner rules only; never seeded. A save of an unrelated setting must not drop them.
    conflictRules: Array.isArray(userConfig.conflictRules) ? userConfig.conflictRules : [],
    // Same pass-through rule: dropping it on an unrelated save would silently switch an account back on.
    nightlySchedule: userConfig.nightlySchedule && typeof userConfig.nightlySchedule === 'object'
      ? { ...userConfig.nightlySchedule }
      : undefined,
    // Same pass-through rule — but UNDEFINED when never saved, so the seed keeps applying and a save
    // of an unrelated setting never writes an empty list that would erase lunch.
    activities: Array.isArray(userConfig.activities) ? userConfig.activities : undefined,
  };
}
