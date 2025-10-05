import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_SCHEDULING_CONFIG,
  mergeSchedulingConfig,
  type SchedulingConfig,
  type TimeWindow,
} from "@/config/schedulingRules";

export type { SchedulingConfig, TimeWindow };

/**
 * Unified Scheduling Service
 * Provides centralized access to scheduling configuration and logic
 */

// Cache for user config to avoid repeated DB calls
let cachedConfig: SchedulingConfig | null = null;
let cachedUserId: string | null = null;

/**
 * Load user's scheduling preferences from database or return defaults
 */
export async function loadUserSchedulingConfig(userId?: string): Promise<SchedulingConfig> {
  if (!userId) {
    return DEFAULT_SCHEDULING_CONFIG;
  }

  // Return cached config if available for this user
  if (cachedUserId === userId && cachedConfig) {
    return cachedConfig;
  }

  try {
    const { data, error } = await supabase
      .from('user_scheduling_prefs')
      .select('config')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.warn('Error loading user scheduling config:', error);
      return DEFAULT_SCHEDULING_CONFIG;
    }

    if (data?.config) {
      const userConfig = data.config as Partial<SchedulingConfig>;
      cachedConfig = mergeSchedulingConfig(userConfig);
      cachedUserId = userId;
      return cachedConfig;
    }

    return DEFAULT_SCHEDULING_CONFIG;
  } catch (error) {
    console.error('Failed to load scheduling config:', error);
    return DEFAULT_SCHEDULING_CONFIG;
  }
}

/**
 * Save user's scheduling preferences to database
 */
export async function saveUserSchedulingConfig(
  userId: string,
  config: Partial<SchedulingConfig>
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('user_scheduling_prefs')
      .upsert({
        user_id: userId,
        config: config as any,
        updated_at: new Date().toISOString(),
      });

    if (error) {
      console.error('Error saving scheduling config:', error);
      return false;
    }

    // Invalidate cache
    cachedConfig = null;
    cachedUserId = null;

    return true;
  } catch (error) {
    console.error('Failed to save scheduling config:', error);
    return false;
  }
}

/**
 * Extract scheduling context from task text and metadata
 * Unified version combining logic from ItineraryEngine and useAutoScheduling
 */
export function extractSchedulingContext(
  taskText: string,
  category?: string,
  priority?: string,
  config: SchedulingConfig = DEFAULT_SCHEDULING_CONFIG
): {
  timeWindow: keyof SchedulingConfig['timeWindows'];
  suggestedStatus: string;
  estimatedDuration: number;
  context: string[];
} {
  const text = taskText.toLowerCase();
  const context: string[] = [];

  // Check category mapping first
  if (category && config.categoryMappings[category]) {
    const mapping = config.categoryMappings[category];
    return {
      timeWindow: mapping.defaultTimeWindow,
      suggestedStatus: mapping.defaultStatus,
      estimatedDuration: mapping.estimatedDuration,
      context: [`category:${category}`],
    };
  }

  // Analyze keywords in task text
  let matchedTimeWindow: keyof SchedulingConfig['timeWindows'] = 'flexible';
  let suggestedStatus = 'TODO';
  let estimatedDuration = 60;

  for (const [keyword, [timeWindow, status]] of Object.entries(config.contextRules.keywords)) {
    if (text.includes(keyword)) {
      matchedTimeWindow = timeWindow as keyof SchedulingConfig['timeWindows'];
      suggestedStatus = status;
      context.push(keyword);
      
      // Estimate duration based on keyword type
      if (['meeting', 'call', 'interview'].includes(keyword)) {
        estimatedDuration = 60;
      } else if (['project', 'study', 'assignment'].includes(keyword)) {
        estimatedDuration = 120;
      } else if (['workout', 'exercise'].includes(keyword)) {
        estimatedDuration = 45;
      }
      break;
    }
  }

  // Adjust for priority
  if (priority && config.contextRules.priorityMappings[priority.toLowerCase()]) {
    const priorityWeight = config.contextRules.priorityMappings[priority.toLowerCase()];
    estimatedDuration = Math.ceil(estimatedDuration * priorityWeight * 0.8);
  }

  return {
    timeWindow: matchedTimeWindow,
    suggestedStatus,
    estimatedDuration,
    context,
  };
}

/**
 * Get time window constraints for scheduling
 */
export function getTimeWindowConstraints(
  timeWindow: keyof SchedulingConfig['timeWindows'],
  config: SchedulingConfig = DEFAULT_SCHEDULING_CONFIG
): TimeWindow {
  return config.timeWindows[timeWindow];
}

/**
 * Get working hours configuration
 */
export function getWorkingHoursConfig(
  config: SchedulingConfig = DEFAULT_SCHEDULING_CONFIG
): SchedulingConfig['workingHours'] {
  return config.workingHours;
}

/**
 * Get workload balance configuration
 */
export function getWorkloadBalanceConfig(
  config: SchedulingConfig = DEFAULT_SCHEDULING_CONFIG
): SchedulingConfig['workloadBalance'] {
  return config.workloadBalance;
}

/**
 * Check if a time slot is within allowed time window
 */
export function isTimeSlotAllowed(
  date: Date,
  timeWindow: keyof SchedulingConfig['timeWindows'],
  config: SchedulingConfig = DEFAULT_SCHEDULING_CONFIG
): boolean {
  const constraints = config.timeWindows[timeWindow];
  const dayOfWeek = date.getDay();
  const hour = date.getHours();

  return (
    constraints.days.includes(dayOfWeek) &&
    hour >= constraints.start &&
    hour < constraints.end
  );
}

/**
 * Get available time slots for a given day and time window
 */
export function getAvailableTimeSlots(
  date: Date,
  timeWindow: keyof SchedulingConfig['timeWindows'],
  busySlots: { start: Date; end: Date }[],
  config: SchedulingConfig = DEFAULT_SCHEDULING_CONFIG
): { start: Date; end: Date }[] {
  const constraints = config.timeWindows[timeWindow];
  const dayOfWeek = date.getDay();

  // Check if day is allowed
  if (!constraints.days.includes(dayOfWeek)) {
    return [];
  }

  // Create time slots for the day
  const dayStart = new Date(date);
  dayStart.setHours(constraints.start, 0, 0, 0);

  const dayEnd = new Date(date);
  dayEnd.setHours(constraints.end, 0, 0, 0);

  // Sort busy slots
  const sortedBusy = busySlots
    .filter(slot => {
      const slotDate = new Date(slot.start);
      return slotDate.toDateString() === date.toDateString();
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  // Find gaps
  const availableSlots: { start: Date; end: Date }[] = [];
  let currentTime = dayStart;

  for (const busySlot of sortedBusy) {
    if (busySlot.start > currentTime) {
      availableSlots.push({
        start: new Date(currentTime),
        end: new Date(busySlot.start),
      });
    }
    currentTime = busySlot.end > currentTime ? busySlot.end : currentTime;
  }

  // Add final slot if time remains
  if (currentTime < dayEnd) {
    availableSlots.push({
      start: new Date(currentTime),
      end: new Date(dayEnd),
    });
  }

  return availableSlots;
}

/**
 * Clear cache (useful for testing or after logout)
 */
export function clearSchedulingConfigCache(): void {
  cachedConfig = null;
  cachedUserId = null;
}
