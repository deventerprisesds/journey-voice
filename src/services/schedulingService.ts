import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_SCHEDULING_CONFIG,
  mergeSchedulingConfig,
  type SchedulingConfig,
  type TimeWindow,
} from "@/config/schedulingRules";
import { getBrowserTimezone } from "@/lib/timezone";

export type { SchedulingConfig, TimeWindow };

/**
 * Unified Scheduling Service
 * Provides centralized access to scheduling configuration and logic
 */

// Cache for user config to avoid repeated DB calls
let cachedConfig: SchedulingConfig | null = null;
let cachedUserId: string | null = null;

// Custom voice type for ElevenLabs
export interface CustomVoice {
  name: string;
  id: string;
}

// Scheduled call type for recurring voice calls
export interface ScheduledCall {
  id: string;
  name: string;
  time: string; // HH:mm format
  enabled: boolean;
  callType: 'morning_standup' | 'midday_checkin' | 'eod_wrapup' | 'custom';
  context: string;
}

// Phone call mode for infrastructure selection
export type PhoneCallMode = 'media_streams' | 'conversation_relay' | 'cloudflare';

// Extended config with AI instructions and TTS settings
export interface SchedulingConfigWithInstructions extends SchedulingConfig {
  core_instructions?: string;
  realtime_extensions?: string;
  assistant_extensions?: string;
  auto_greeting_timeout?: number;
  tts_provider?: 'openai' | 'elevenlabs';
  elevenlabs_voice_id?: string;
  openai_voice?: string;
  custom_voices?: CustomVoice[];
  scheduled_calls?: ScheduledCall[];
  recurring_calls_enabled?: boolean;
  phone_call_mode?: PhoneCallMode;
}

/**
 * Load user's scheduling preferences from database or return defaults
 * Auto-detects and saves timezone on first use
 */
export async function loadUserSchedulingConfig(userId?: string): Promise<SchedulingConfigWithInstructions> {
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
      .select('config, timezone, core_instructions, realtime_extensions, assistant_extensions, auto_greeting_timeout, tts_provider, elevenlabs_voice_id, openai_voice, custom_voices, scheduled_calls, recurring_calls_enabled, phone_call_mode')
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
      
      const mergedConfig: SchedulingConfigWithInstructions = {
        ...mergeSchedulingConfig({ ...userConfig, timezone }),
        core_instructions: data.core_instructions || undefined,
        realtime_extensions: data.realtime_extensions || undefined,
        assistant_extensions: data.assistant_extensions || undefined,
        auto_greeting_timeout: data.auto_greeting_timeout || 5,
        tts_provider: (data.tts_provider as 'openai' | 'elevenlabs') || 'openai',
        elevenlabs_voice_id: data.elevenlabs_voice_id || 'EXAVITQu4vr4xnSDxMaL',
        openai_voice: data.openai_voice || 'alloy',
        custom_voices: Array.isArray(data.custom_voices) ? (data.custom_voices as unknown as CustomVoice[]) : [],
        scheduled_calls: Array.isArray(data.scheduled_calls) ? (data.scheduled_calls as unknown as ScheduledCall[]) : [],
        recurring_calls_enabled: data.recurring_calls_enabled ?? true,
        phone_call_mode: (data.phone_call_mode as PhoneCallMode) || 'media_streams',
      };
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
  config: Partial<SchedulingConfigWithInstructions>
): Promise<boolean> {
  try {
    // Extract fields to save in dedicated columns
    const { 
      timezone, 
      core_instructions, 
      realtime_extensions, 
      assistant_extensions, 
      auto_greeting_timeout, 
      tts_provider, 
      elevenlabs_voice_id, 
      openai_voice,
      custom_voices, 
      scheduled_calls,
      recurring_calls_enabled,
      phone_call_mode,
      ...restConfig 
    } = config;
    
    const updateData: any = {
      user_id: userId,
      config: restConfig as any,
      updated_at: new Date().toISOString(),
    };
    
    // Add timezone to dedicated column if provided
    if (timezone) {
      updateData.timezone = timezone;
    }
    
    // Add AI instruction fields if provided
    if (core_instructions !== undefined) {
      updateData.core_instructions = core_instructions;
    }
    
    if (realtime_extensions !== undefined) {
      updateData.realtime_extensions = realtime_extensions;
    }
    
    if (assistant_extensions !== undefined) {
      updateData.assistant_extensions = assistant_extensions;
    }
    
    if (auto_greeting_timeout !== undefined) {
      updateData.auto_greeting_timeout = auto_greeting_timeout;
    }
    
    // Add TTS settings
    if (tts_provider !== undefined) {
      updateData.tts_provider = tts_provider;
    }
    
    if (elevenlabs_voice_id !== undefined) {
      updateData.elevenlabs_voice_id = elevenlabs_voice_id;
    }
    
    if (openai_voice !== undefined) {
      updateData.openai_voice = openai_voice;
    }
    
    if (custom_voices !== undefined) {
      updateData.custom_voices = custom_voices;
    }
    
    if (scheduled_calls !== undefined) {
      updateData.scheduled_calls = scheduled_calls;
    }
    
    if (recurring_calls_enabled !== undefined) {
      updateData.recurring_calls_enabled = recurring_calls_enabled;
    }
    
    if (phone_call_mode !== undefined) {
      updateData.phone_call_mode = phone_call_mode;
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
 * Extract scheduling context from task text and metadata
 * Unified version combining logic from ItineraryEngine and useAutoScheduling
 */
export function extractSchedulingContext(
  taskText: string,
  category?: string,
  priority?: string,
  config: SchedulingConfig = DEFAULT_SCHEDULING_CONFIG
): {
  timeWindow: keyof SchedulingConfig['timeWindows']; // First window for backward compatibility
  allowedTimeWindows: string[]; // All allowed windows
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
      timeWindow: mapping.defaultTimeWindow[0] as keyof SchedulingConfig['timeWindows'], // First for backward compatibility
      allowedTimeWindows: mapping.defaultTimeWindow,
      suggestedStatus: mapping.defaultStatus,
      estimatedDuration: mapping.estimatedDuration,
      context: [`category:${category}`],
    };
  }

  // Fallback: Detect MIT/EMBA in task text and force EDUCATION category
  const lowerText = text.toLowerCase();
  if (lowerText.includes('mit') || lowerText.includes('emba')) {
    // Check if it's in a learning context (not selling)
    const learningKeywords = ['study', 'assignment', 'exam', 'homework', 'lecture', 'class', 'course', 'module', 'read', 'prepare', 'complete'];
    const isLearning = learningKeywords.some(keyword => lowerText.includes(keyword));
    
    if (isLearning) {
      console.log('🎓 Detected MIT/EMBA learning task - forcing EDUCATION category');
      return {
        timeWindow: 'business_hours',
        allowedTimeWindows: ['business_hours'],
        suggestedStatus: 'PROF_EDUCATION',
        estimatedDuration: 120,
        context: ['mit-emba-learning'],
      };
    }
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
    allowedTimeWindows: [matchedTimeWindow],
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
 * Check if a time slot is within allowed time window(s)
 * Supports both single window (backward compatibility) and array of windows
 */
export function isTimeSlotAllowed(
  date: Date,
  timeWindow: keyof SchedulingConfig['timeWindows'] | string[],
  config: SchedulingConfig = DEFAULT_SCHEDULING_CONFIG
): boolean {
  // Support both single window (backward compatibility) and array
  const windows = Array.isArray(timeWindow) ? timeWindow : [timeWindow];
  
  // Check if date/time falls within ANY of the allowed windows
  return windows.some(windowName => {
    const window = config.timeWindows[windowName as keyof SchedulingConfig['timeWindows']];
    if (!window) return false;
    
    const day = date.getDay();
    const hour = date.getHours();
    
    return window.days.includes(day) && hour >= window.start && hour < window.end;
  });
}

/**
 * Get available time slots for a given day and time window(s)
 * Supports both single window (backward compatibility) and array of windows
 */
export function getAvailableTimeSlots(
  date: Date,
  timeWindow: keyof SchedulingConfig['timeWindows'] | string[],
  busySlots: { start: Date; end: Date }[],
  config: SchedulingConfig = DEFAULT_SCHEDULING_CONFIG
): { start: Date; end: Date }[] {
  const windows = Array.isArray(timeWindow) ? timeWindow : [timeWindow];
  const allSlots: { start: Date; end: Date }[] = [];
  
  // Collect available slots from ALL allowed time windows
  windows.forEach(windowName => {
    const window = config.timeWindows[windowName as keyof SchedulingConfig['timeWindows']];
    if (!window) return;
    
    const day = date.getDay();
    if (!window.days.includes(day)) return;
    
    // Create time slots for the day
    const dayStart = new Date(date);
    dayStart.setHours(window.start, 0, 0, 0);
    
    const dayEnd = new Date(date);
    dayEnd.setHours(window.end, 0, 0, 0);
    
    // Sort busy slots
    const sortedBusy = busySlots
      .filter(slot => {
        const slotDate = new Date(slot.start);
        return slotDate.toDateString() === date.toDateString();
      })
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    
    // Find gaps
    let currentTime = dayStart;
    
    for (const busySlot of sortedBusy) {
      if (busySlot.start > currentTime) {
        allSlots.push({
          start: new Date(currentTime),
          end: new Date(busySlot.start),
        });
      }
      currentTime = busySlot.end > currentTime ? busySlot.end : currentTime;
    }
    
    // Add final slot if time remains
    if (currentTime < dayEnd) {
      allSlots.push({
        start: new Date(currentTime),
        end: new Date(dayEnd),
      });
    }
  });
  
  // Sort by start time and return
  return allSlots.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Clear cache (useful for testing or after logout)
 */
export function clearSchedulingConfigCache(): void {
  cachedConfig = null;
  cachedUserId = null;
}
