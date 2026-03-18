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

export interface CategoryMapping {
  defaultTimeWindow: string[];
  estimatedDuration: number;
  defaultStatus: string;
  maxPerDay?: number;
}

export const DEFAULT_TIME_WINDOWS: Record<string, TimeWindow> = {
  morning:        { start: 6,  end: 9,  days: [1, 2, 3, 4, 5] },
  business_hours: { start: 9,  end: 17, days: [1, 2, 3, 4, 5] },
  after_work:     { start: 17, end: 22, days: [1, 2, 3, 4, 5, 6] },
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

  // 'flexible' means any window is allowed
  if (allowedWindows.includes('flexible')) {
    return { valid: true, actualWindow, allowedWindows };
  }

  // Check if actual window is in allowed list
  const valid = actualWindow !== null && allowedWindows.includes(actualWindow);
  return { valid, actualWindow, allowedWindows };
}
