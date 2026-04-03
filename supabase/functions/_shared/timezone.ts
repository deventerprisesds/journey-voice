// =============================================================================
// CENTRALIZED TIMEZONE UTILITIES
// Used by all edge functions to ensure consistent date/time handling
// =============================================================================

/**
 * Get the timezone offset in minutes for a given IANA timezone at a specific moment.
 * Handles DST automatically by computing the offset at the exact timestamp.
 * 
 * @param date - The Date object to compute offset for
 * @param tz - IANA timezone string (e.g., 'America/New_York')
 * @returns Offset in minutes (negative for west of UTC, e.g., -300 for EST)
 */
export function getTzOffsetMinutesAt(date: Date, tz: string): number {
  try {
    // Format the date in the target timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const parts = formatter.formatToParts(date);
    const get = (type: string) => {
      const part = parts.find(p => p.type === type);
      return part ? parseInt(part.value, 10) : 0;
    };

    // Build a "wall clock" date in the target timezone
    const year = get('year');
    const month = get('month') - 1; // JavaScript months are 0-indexed
    const day = get('day');
    const hour = get('hour');
    const minute = get('minute');
    const second = get('second');

    // Create a UTC date representing the same wall-clock time
    const wallClockAsUtc = Date.UTC(year, month, day, hour, minute, second);
    
    // The offset is the difference between wall-clock-as-UTC and the actual UTC time
    const offsetMs = wallClockAsUtc - date.getTime();
    return Math.round(offsetMs / 60000);
  } catch (e) {
    console.warn(`[TIMEZONE] Failed to get offset for ${tz}, defaulting to 0:`, e);
    return 0;
  }
}

/**
 * Convert a local time (as if it were in the given timezone) to UTC ISO string.
 * Use this when you have a "naive" datetime that should be interpreted in the user's timezone.
 * 
 * @param localDate - Date string in YYYY-MM-DD format
 * @param localTime - Time string in HH:MM or HH:MM:SS format
 * @param tz - IANA timezone string
 * @returns UTC ISO string
 */
export function zonedTimeToUtc(localDate: string, localTime: string, tz: string): string {
  // Parse the local date and time components
  const [year, month, day] = localDate.split('-').map(Number);
  const timeParts = localTime.split(':').map(Number);
  const hour = timeParts[0] || 0;
  const minute = timeParts[1] || 0;
  const second = timeParts[2] || 0;

  // Create a date assuming UTC first (we'll adjust)
  const naiveUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  // Get the offset at that moment in the target timezone
  const offsetMinutes = getTzOffsetMinutesAt(naiveUtc, tz);

  // Subtract the offset to get the true UTC time
  // (If offset is -300 for EST, we add 300 minutes to get UTC)
  const utcMs = naiveUtc.getTime() - (offsetMinutes * 60000);
  
  return new Date(utcMs).toISOString();
}

/**
 * Normalize a due date to end-of-day in the user's timezone, stored as UTC.
 * This ensures that a "due date" of "2026-01-29" in US Eastern always displays
 * as January 29th, not January 28th.
 * 
 * @param input - Date string (YYYY-MM-DD, ISO with/without offset, or null)
 * @param tz - IANA timezone string
 * @returns UTC ISO string representing 23:59:59.999 in the user's timezone, or null
 */
export function normalizeDueDate(input: string | null | undefined, tz: string): string | null {
  if (!input) return null;
  
  try {
    // Check if input is date-only (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
      // Convert to end-of-day in user's timezone
      return zonedTimeToUtc(input, '23:59:59', tz);
    }
    
    // Check if input has timezone offset or Z
    if (/[Zz]$/.test(input) || /[+-]\d{2}:\d{2}$/.test(input)) {
      // Already has timezone info - extract the date portion in the user's TZ
      // and convert to end-of-day in their timezone
      const date = new Date(input);
      const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz });
      const localDate = formatter.format(date); // YYYY-MM-DD
      return zonedTimeToUtc(localDate, '23:59:59', tz);
    }
    
    // Naive ISO datetime (no Z or offset) - treat as local time in user's timezone
    // Extract date portion and convert to end-of-day
    const datePortion = input.split('T')[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePortion)) {
      return zonedTimeToUtc(datePortion, '23:59:59', tz);
    }
    
    // Fallback: try to parse and convert
    console.warn(`[TIMEZONE] Unexpected due_date format: ${input}, falling back to direct parse`);
    const date = new Date(input);
    if (isNaN(date.getTime())) return null;
    
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    const localDate = formatter.format(date);
    return zonedTimeToUtc(localDate, '23:59:59', tz);
  } catch (e) {
    console.error(`[TIMEZONE] Error normalizing due_date "${input}":`, e);
    return null;
  }
}

/**
 * Normalize a datetime to proper UTC, interpreting naive datetimes as local to the user's timezone.
 * Use this for start_time/end_time values that should represent specific moments.
 * 
 * @param input - ISO datetime string (with or without offset), or null
 * @param tz - IANA timezone string (used only for naive datetimes)
 * @returns UTC ISO string, or null
 */
export function normalizeDateTime(input: string | null | undefined, tz: string): string | null {
  if (!input) return null;
  
  try {
    // Check if input has timezone offset or Z - already properly specified
    if (/[Zz]$/.test(input) || /[+-]\d{2}:\d{2}$/.test(input)) {
      // Parse and return as ISO string (ensures consistent format)
      const date = new Date(input);
      if (isNaN(date.getTime())) return null;
      return date.toISOString();
    }
    
    // Naive ISO datetime - treat as local time in user's timezone
    // Format: YYYY-MM-DDTHH:MM:SS or YYYY-MM-DDTHH:MM
    const match = input.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)$/);
    if (match) {
      const [, datePart, timePart] = match;
      return zonedTimeToUtc(datePart, timePart, tz);
    }
    
    // Date-only input - treat as start of day in user's timezone
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
      return zonedTimeToUtc(input, '00:00:00', tz);
    }
    
    // Fallback: try to parse directly
    console.warn(`[TIMEZONE] Unexpected datetime format: ${input}, falling back to direct parse`);
    const date = new Date(input);
    if (isNaN(date.getTime())) return null;
    return date.toISOString();
  } catch (e) {
    console.error(`[TIMEZONE] Error normalizing datetime "${input}":`, e);
    return null;
  }
}

/**
 * Get the current date in YYYY-MM-DD format in a specific timezone.
 * 
 * @param tz - IANA timezone string
 * @returns Date string in YYYY-MM-DD format
 */
export function getTodayInTimezone(tz: string): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz });
  return formatter.format(now);
}

/**
 * Check if an ISO datetime falls on a specific date in the given timezone.
 * 
 * @param isoDateTime - ISO datetime string
 * @param dateStr - Date to check (YYYY-MM-DD)
 * @param tz - IANA timezone string
 * @returns true if the datetime falls on that date in the timezone
 */
export function isDateInTimezone(isoDateTime: string, dateStr: string, tz: string): boolean {
  try {
    const date = new Date(isoDateTime);
    if (isNaN(date.getTime())) return false;
    
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    const localDate = formatter.format(date);
    return localDate === dateStr;
  } catch {
    return false;
  }
}

/**
 * Format an ISO datetime string in a human-readable format in the user's timezone.
 * 
 * @param isoDateTime - ISO datetime string
 * @param tz - IANA timezone string
 * @param options - Intl.DateTimeFormat options
 * @returns Formatted string
 */
/**
 * Convert a local date (YYYY-MM-DD) to UTC start/end bounds for database queries.
 * Returns the UTC ISO strings that represent midnight-to-midnight in the user's timezone.
 * 
 * @param dateStr - Date string in YYYY-MM-DD format (local date)
 * @param tz - IANA timezone string
 * @returns { start: string, end: string } — UTC ISO bounds for the full local day
 */
export function localDateToUtcBounds(dateStr: string, tz: string): { start: string; end: string } {
  // Start of the day in the user's timezone → UTC
  const startUtc = zonedTimeToUtc(dateStr, '00:00:00', tz);
  
  // End of the day: start of the next day in the user's timezone → UTC
  const [year, month, day] = dateStr.split('-').map(Number);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const nextDayStr = `${nextDay.getUTCFullYear()}-${String(nextDay.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDay.getUTCDate()).padStart(2, '0')}`;
  const endUtc = zonedTimeToUtc(nextDayStr, '00:00:00', tz);
  
  return { start: startUtc, end: endUtc };
}

/**
 * Format an ISO datetime string in a human-readable format in the user's timezone.
 * 
 * @param isoDateTime - ISO datetime string
 * @param tz - IANA timezone string
 * @param options - Intl.DateTimeFormat options
 * @returns Formatted string
 */
export function formatInTimezone(
  isoDateTime: string, 
  tz: string, 
  options: Intl.DateTimeFormatOptions = { timeStyle: 'short' }
): string {
  try {
    const date = new Date(isoDateTime);
    if (isNaN(date.getTime())) return isoDateTime;
    
    return date.toLocaleString('en-US', { timeZone: tz, ...options });
  } catch {
    return isoDateTime;
  }
}
