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
      defaultTimeWindow: keyof SchedulingConfig['timeWindows'];
      defaultStatus: string;
      estimatedDuration: number; // minutes
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
}

// Default configuration blending all existing rules
export const DEFAULT_SCHEDULING_CONFIG: SchedulingConfig = {
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
      defaultTimeWindow: 'business_hours',
      defaultStatus: 'CAREER',
      estimatedDuration: 120,
    },
    PROF_EDUCATION: {
      defaultTimeWindow: 'business_hours',
      defaultStatus: 'PROF_EDUCATION',
      estimatedDuration: 90,
    },
    EDUCATION: {
      defaultTimeWindow: 'business_hours',
      defaultStatus: 'PROF_EDUCATION',
      estimatedDuration: 90,
    },
    VENTURES: {
      defaultTimeWindow: 'after_work',
      defaultStatus: 'VENTURES',
      estimatedDuration: 120,
    },
    LIFE: {
      defaultTimeWindow: 'flexible',
      defaultStatus: 'LIFE',
      estimatedDuration: 60,
    },
    PERSONAL: {
      defaultTimeWindow: 'flexible',
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
      
      // Evening keywords
      dinner: ['evening', 'LIFE'],
      family: ['evening', 'LIFE'],
      relax: ['evening', 'LIFE'],
      
      // Weekend keywords
      weekend: ['weekends', 'LIFE'],
      hobby: ['weekends', 'LIFE'],
      
      // Flexible keywords
      errands: ['flexible', 'LIFE'],
      shopping: ['flexible', 'LIFE'],
      appointment: ['flexible', 'LIFE'],
    },
    priorityMappings: {
      high: 3,
      medium: 2,
      low: 1,
    },
  },
};

// Helper function to validate config
export function validateSchedulingConfig(config: Partial<SchedulingConfig>): boolean {
  // Basic validation
  if (config.workloadBalance) {
    const { projectToTaskRatio, oneOffTaskRatio, bufferRatio } = config.workloadBalance;
    const sum = projectToTaskRatio + oneOffTaskRatio + bufferRatio;
    if (Math.abs(sum - 1) > 0.01) {
      console.warn('Workload balance ratios should sum to 1.0');
      return false;
    }
  }
  return true;
}

// Helper to merge user config with defaults
export function mergeSchedulingConfig(
  userConfig: Partial<SchedulingConfig>
): SchedulingConfig {
  return {
    timeWindows: { ...DEFAULT_SCHEDULING_CONFIG.timeWindows, ...userConfig.timeWindows },
    workingHours: { ...DEFAULT_SCHEDULING_CONFIG.workingHours, ...userConfig.workingHours },
    workloadBalance: { ...DEFAULT_SCHEDULING_CONFIG.workloadBalance, ...userConfig.workloadBalance },
    categoryMappings: { ...DEFAULT_SCHEDULING_CONFIG.categoryMappings, ...userConfig.categoryMappings },
    contextRules: {
      keywords: { ...DEFAULT_SCHEDULING_CONFIG.contextRules.keywords, ...userConfig.contextRules?.keywords },
      priorityMappings: { ...DEFAULT_SCHEDULING_CONFIG.contextRules.priorityMappings, ...userConfig.contextRules?.priorityMappings },
    },
  };
}
