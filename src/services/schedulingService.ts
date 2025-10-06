import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_SCHEDULING_CONFIG,
  mergeSchedulingConfig,
  type SchedulingConfig,
  type TimeWindow,
} from "@/config/schedulingRules";
import { getBrowserTimezone, getTimezoneOffset } from "@/lib/timezone";

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
 * Auto-detects and saves timezone on first use
 */
export async function loadUserSchedulingConfig(userId?: string): Promise<SchedulingConfig> {
  if (!userId) {
    const config = { ...DEFAULT_SCHEDULING_CONFIG };
    config.timezone = getBrowserTimezone();
    return config;
  }

  // Return cached config if available for this user
  if (cachedUserId === userId && cachedConfig) {
    return cachedConfig;
  }

  try {
    const { data, error } = await supabase
      .from('user_scheduling_prefs')
      .select('config, timezone')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.warn('Error loading user scheduling config:', error);
      const config = { ...DEFAULT_SCHEDULING_CONFIG };
      config.timezone = getBrowserTimezone();
      return config;
    }

    if (data) {
      // Merge config from JSONB column
      const userConfig = (data.config as Partial<SchedulingConfig>) || {};
      
      // Use timezone from dedicated column (preferred) or config, or auto-detect
      const timezone = data.timezone || userConfig.timezone || getBrowserTimezone();
      
      // If no timezone was saved, save the auto-detected one
      if (!data.timezone && !userConfig.timezone) {
        console.log('🌍 Auto-detected timezone:', timezone, '- saving to database');
        await saveUserSchedulingConfig(userId, { timezone });
      }
      
      const mergedConfig = mergeSchedulingConfig({ ...userConfig, timezone });
      cachedConfig = mergedConfig;
      cachedUserId = userId;
      return mergedConfig;
    }

    // No data found - auto-detect and save timezone
    const timezone = getBrowserTimezone();
    console.log('🌍 First-time timezone setup:', timezone);
    await saveUserSchedulingConfig(userId, { timezone });
    
    const config = { ...DEFAULT_SCHEDULING_CONFIG, timezone };
    cachedConfig = config;
    cachedUserId = userId;
    return config;
  } catch (error) {
    console.error('Failed to load scheduling config:', error);
    const config = { ...DEFAULT_SCHEDULING_CONFIG };
    config.timezone = getBrowserTimezone();
    return config;
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
    // Extract timezone to save in dedicated column
    const { timezone, ...restConfig } = config;
    
    const updateData: any = {
      user_id: userId,
      config: restConfig as any,
      updated_at: new Date().toISOString(),
    };
    
    // Add timezone to dedicated column if provided
    if (timezone) {
      updateData.timezone = timezone;
    }
    
    const { error } = await supabase
      .from('user_scheduling_prefs')
      .upsert(updateData, { onConflict: 'user_id' });

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
 * Get user's timezone from their config
 */
export function getUserTimezone(config: SchedulingConfig): string {
  return config.timezone || getBrowserTimezone();
}

/**
 * Get user's timezone offset in minutes
 */
export function getUserTimezoneOffset(config: SchedulingConfig): number {
  return getTimezoneOffset(config.timezone || getBrowserTimezone());
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

  // Intelligent time suggestions based on keywords
  const timeSuggestions: { [key: string]: { hour: number; minute: number; duration: number } } = {
    standup: { hour: 9, minute: 0, duration: 30 },
    sync: { hour: 10, minute: 0, duration: 30 },
    lunch: { hour: 12, minute: 0, duration: 60 },
    brunch: { hour: 10, minute: 30, duration: 75 },
    dinner: { hour: 19, minute: 0, duration: 90 },  // 7pm, not 9pm!
    breakfast: { hour: 7, minute: 30, duration: 30 },
    gym: { hour: 17, minute: 30, duration: 60 },    // 5:30pm after work
    workout: { hour: 6, minute: 30, duration: 60 },
    exercise: { hour: 17, minute: 30, duration: 60 },
    shopping: { hour: 17, minute: 30, duration: 45 }, // After work
    grocery: { hour: 17, minute: 30, duration: 60 },
    groceries: { hour: 17, minute: 30, duration: 60 },
    bank: { hour: 12, minute: 0, duration: 45 },     // Lunch break
    doctor: { hour: 9, minute: 0, duration: 60 },
    dentist: { hour: 9, minute: 0, duration: 60 },
    coffee: { hour: 10, minute: 0, duration: 45 },
    meeting: { hour: 10, minute: 0, duration: 60 },
  };

  // Find matching suggestion first
  const matchedSuggestion = Object.keys(timeSuggestions).find(key => 
    text.includes(key)
  );

  if (matchedSuggestion) {
    const suggestion = timeSuggestions[matchedSuggestion];
    context.push(`suggested_time:${suggestion.hour}:${suggestion.minute}`);
    estimatedDuration = suggestion.duration;
  }

  // Then check keyword mappings for time windows
  for (const [keyword, [timeWindow, status]] of Object.entries(config.contextRules.keywords)) {
    if (text.includes(keyword)) {
      matchedTimeWindow = timeWindow as keyof SchedulingConfig['timeWindows'];
      suggestedStatus = status;
      context.push(keyword);
      
      // Use time suggestion duration if available, otherwise estimate
      if (!matchedSuggestion) {
        if (['meeting', 'call', 'interview'].includes(keyword)) {
          estimatedDuration = 60;
        } else if (['project', 'study', 'assignment'].includes(keyword)) {
          estimatedDuration = 120;
        } else if (['workout', 'exercise'].includes(keyword)) {
          estimatedDuration = 45;
        }
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
