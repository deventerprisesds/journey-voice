// Date utilities for consistent time handling across the application

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
 * @param date - Date object for the day
 * @param hhmm - Time string in "HH:mm" format
 * @returns ISO timestamp string in local timezone
 */
export function fromHHMMToISO(date: Date, hhmm: string): string {
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
      hour: '2-digit',
      minute: '2-digit',
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