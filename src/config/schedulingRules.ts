/**
 * Unified Scheduling Configuration
 * Blends rules from:
 * - smart-calendar-scheduler businessRules
 * - ItineraryEngine workingHours and workloadBalance
 * - useAutoScheduling and ItineraryEngine extractSchedulingContext
 */

export interface TimeWindow {
  start: number; // hour (0-23)
  end: number; // hour (0-23)
  days: number[]; // 0=Sunday, 6=Saturday
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
      maxPerDay?: number; // Optional max tasks per day for this category
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
  // 'priority-rank' (default) = explicit is_priority dominates. 'composite' = recency/deadline/finance
  // lead and explicit priority becomes a small differentiator. Read by nightly-schedule-builder as
  // `config.scoringModel`; a body override still wins over this. Self-serve via Settings → Scheduling.
  scoringModel?: 'composite' | 'priority-rank';
}

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
      end: 22,
      days: [1, 2, 3, 4, 5, 6], // weekdays + Saturday
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
      maxPerDay: 2
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
      invoice: ['business_hours', 'CAREER'],
      bill: ['business_hours', 'LIFE'],
      tax: ['business_hours', 'LIFE'],
      budget: ['business_hours', 'CAREER'],
      contract: ['business_hours', 'CAREER'],
      
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
  scoringModel: 'priority-rank', // Default preserves today's behavior; user opts into 'composite'.
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
      keywords: { ...DEFAULT_SCHEDULING_CONFIG.contextRules.keywords, ...userConfig.contextRules?.keywords },
      priorityMappings: { ...DEFAULT_SCHEDULING_CONFIG.contextRules.priorityMappings, ...userConfig.contextRules?.priorityMappings },
    },
    // Use user instructions if provided and not empty, otherwise use default
    customAIInstructions: (userConfig.customAIInstructions && userConfig.customAIInstructions.trim() !== '')
      ? userConfig.customAIInstructions
      : DEFAULT_SCHEDULING_CONFIG.customAIInstructions,
    // Carry the user's scoring-model choice through the merge (built field-by-field, so it must be
    // named here or it would be silently dropped on load and the Settings toggle would never persist).
    scoringModel: userConfig.scoringModel === 'composite' ? 'composite' : 'priority-rank',
  };
}
