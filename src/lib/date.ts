// Date utilities for consistent time handling across the application
// ARCHITECTURE: Store UTC, Display in User's Timezone

/**
 * Get hour and minute from an ISO timestamp in a specific timezone.
 * Use for grid positioning and time window matching.
 * @param isoTimestamp - ISO timestamp string
 * @param timezone - IANA timezone string (e.g., 'America/New_York')
 * @returns Object with hour (0-23) and minute (0-59) in the specified timezone
 */
export function getTimePartsInTimezone(
  isoTimestamp: string,
  timezone: string
): { hour: number; minute: number } {
  try {
    const date = new Date(isoTimestamp);
    if (isNaN(date.getTime())) {
      return { hour: 0, minute: 0 };
    }
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(date);
    return {
      hour: parseInt(parts.find(p => p.type === 'hour')?.value || '0'),
      minute: parseInt(parts.find(p => p.type === 'minute')?.value || '0')
    };
  } catch {
    // Fallback to browser-local if timezone is invalid
    const date = new Date(isoTimestamp);
    return { hour: date.getHours(), minute: date.getMinutes() };
  }
}

/**
 * Get date string (YYYY-MM-DD) in a specific timezone from an ISO timestamp.
 * Use for filtering tasks by date.
 * @param isoTimestamp - ISO timestamp string
 * @param timezone - IANA timezone string
 * @returns Date string in YYYY-MM-DD format
 */
export function getDateInTimezone(isoTimestamp: string, timezone: string): string {
  try {
    const date = new Date(isoTimestamp);
    if (isNaN(date.getTime())) {
      return '';
    }
    // Use 'en-CA' locale which outputs YYYY-MM-DD format
    return date.toLocaleDateString('en-CA', { timeZone: timezone });
  } catch {
    const date = new Date(isoTimestamp);
    return date.toISOString().split('T')[0];
  }
}

/**
 * Check if an ISO timestamp falls on a specific date in a given timezone.
 * Use for "is this task scheduled for today?" checks.
 * @param isoTimestamp - ISO timestamp string
 * @param dateStr - Date string in YYYY-MM-DD format
 * @param timezone - IANA timezone string
 * @returns True if the timestamp falls on the specified date in the timezone
 */
export function isSameDateInTimezone(
  isoTimestamp: string,
  dateStr: string,
  timezone: string
): boolean {
  return getDateInTimezone(isoTimestamp, timezone) === dateStr;
}

/**
 * Convert a date + HH:mm time to UTC ISO string, treating the input as local time in the user's timezone.
 * Use for task creation and rescheduling - converts user input to UTC for storage.
 * @param dateStr - Date string in YYYY-MM-DD format
 * @param timeStr - Time string in HH:mm format
 * @param timezone - IANA timezone string
 * @returns ISO timestamp string in UTC
 */
export function localTimeToUtcISO(
  dateStr: string,
  timeStr: string,
  timezone: string
): string {
  try {
    const [hours, minutes] = timeStr.split(':').map(Number);
    
    // Create a date object for the target date at midnight UTC
    const [year, month, day] = dateStr.split('-').map(Number);
    
    // Use Intl.DateTimeFormat to find the UTC offset for this timezone at this date/time
    const testDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0)); // Noon to avoid DST edge cases
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset'
    });
    
    // Parse the offset from the formatted string
    const formatted = formatter.format(testDate);
    const offsetMatch = formatted.match(/GMT([+-]\d{1,2}(?::\d{2})?)/);
    
    let offsetMinutes = 0;
    if (offsetMatch) {
      const offsetStr = offsetMatch[1];
      const [offsetHours, offsetMins = '0'] = offsetStr.split(':');
      offsetMinutes = parseInt(offsetHours) * 60 + (offsetStr.startsWith('-') ? -1 : 1) * parseInt(offsetMins);
    }
    
    // Calculate UTC time by subtracting the offset
    const localMinutes = hours * 60 + minutes;
    const utcMinutes = localMinutes - offsetMinutes;
    
    // Create the UTC date
    const utcDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
    utcDate.setUTCMinutes(utcMinutes);
    
    return utcDate.toISOString();
  } catch {
    // Fallback: use browser-local conversion
    const [hours, minutes] = timeStr.split(':').map(Number);
    const date = new Date(dateStr);
    date.setHours(hours, minutes, 0, 0);
    return date.toISOString();
  }
}

/**
 * Converts an ISO timestamp to local time in HH:mm format
 * @param iso - ISO timestamp string
 * @returns Time in "HH:mm" format in local timezone
 */
export function toLocalTimeHHMM(iso: string): string {
  const date = new Date(iso);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Converts a date and time string (HH:mm) to ISO timestamp
 * Uses browser-local timezone by default. For timezone-aware conversion, use localTimeToUtcISO.
 * @param date - Date object for the day
 * @param hhmm - Time string in "HH:mm" format
 * @param timezone - Optional IANA timezone string for timezone-aware conversion
 * @returns ISO timestamp string
 */
export function fromHHMMToISO(date: Date, hhmm: string, timezone?: string): string {
  if (timezone) {
    const dateStr = date.toISOString().split('T')[0];
    return localTimeToUtcISO(dateStr, hhmm, timezone);
  }
  // Fallback to browser-local
  const [hours, minutes] = hhmm.split(':').map(Number);
  const newDate = new Date(date);
  newDate.setHours(hours, minutes, 0, 0);
  return newDate.toISOString();
}

/**
 * Formats date for display (no time, just date)
 * @param dateString - Date string (YYYY-MM-DD or ISO)
 * @returns Formatted date string or null if invalid
 */
export function formatDateOnly(dateString?: string): string | null {
  if (!dateString) return null;
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  } catch {
    return null;
  }
}

/**
 * Formats time duration in minutes to human readable format
 * @param minutes - Duration in minutes
 * @returns Formatted duration string
 */
export function formatDuration(minutes?: number): string {
  if (!minutes) return '';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

/**
 * Format a timestamp for display in user's timezone
 * @param isoTimestamp - ISO timestamp string
 * @param timezone - IANA timezone string (e.g., 'America/New_York')
 * @param options - Optional Intl.DateTimeFormat options
 * @returns Formatted time string in the specified timezone
 */
export function formatTimeInTimezone(
  isoTimestamp: string,
  timezone: string,
  options?: Intl.DateTimeFormatOptions
): string {
  try {
    const date = new Date(isoTimestamp);
    return date.toLocaleTimeString('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      ...options
    });
  } catch {
    return new Date(isoTimestamp).toLocaleTimeString();
  }
}

/**
 * Get current time formatted in user's timezone
 * @param timezone - IANA timezone string
 * @returns Current time string formatted as HH:mm:ss
 */
export function getCurrentTimeInTimezone(timezone: string): string {
  try {
    return new Date().toLocaleTimeString('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return new Date().toLocaleTimeString();
  }
}

/**
 * Get a default/fallback timezone
 * @returns Browser's detected timezone or 'America/New_York' as fallback
 */
export function getDefaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'America/New_York';
  }
}