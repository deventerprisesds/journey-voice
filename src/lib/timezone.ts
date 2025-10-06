/**
 * Timezone Utilities
 * Handles IANA timezone detection, conversion, and validation
 */

/**
 * Get the browser's detected timezone using the Intl API
 */
export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  } catch {
    return 'America/New_York';
  }
}

/**
 * Convert IANA timezone to current UTC offset in minutes
 * @param timezone IANA timezone identifier (e.g., 'America/New_York')
 * @returns Offset in minutes (positive for west of UTC, negative for east)
 */
export function getTimezoneOffset(timezone: string): number {
  try {
    const now = new Date();
    
    // Format the date in the target timezone
    const tzString = now.toLocaleString('en-US', { 
      timeZone: timezone,
      timeZoneName: 'short'
    });
    
    // Get the local time in that timezone
    const tzDate = new Date(tzString);
    
    // Calculate offset in minutes
    // JavaScript's getTimezoneOffset returns offset from UTC (positive = west)
    // We want the same convention
    const offset = (now.getTime() - tzDate.getTime()) / (1000 * 60);
    
    return Math.round(offset);
  } catch (error) {
    console.error('Error calculating timezone offset:', error);
    // Default to Eastern Time offset (UTC-5 or UTC-4 depending on DST)
    return 240; // EST offset
  }
}

/**
 * Validate if a string is a valid IANA timezone identifier
 */
export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Format timezone with current UTC offset
 * @param timezone IANA timezone identifier
 * @returns Formatted string like "America/New_York (UTC-5)"
 */
export function formatTimezoneWithOffset(timezone: string): string {
  try {
    const offset = getTimezoneOffset(timezone);
    const hours = Math.abs(Math.floor(offset / 60));
    const minutes = Math.abs(offset % 60);
    const sign = offset > 0 ? '-' : '+';
    
    const offsetStr = minutes > 0 
      ? `${sign}${hours}:${minutes.toString().padStart(2, '0')}`
      : `${sign}${hours}`;
    
    return `${timezone} (UTC${offsetStr})`;
  } catch {
    return timezone;
  }
}

/**
 * All available IANA timezones grouped by region
 * Organized for easy selection in a dropdown
 */
export const TIMEZONE_OPTIONS: { region: string; zones: string[] }[] = [
  {
    region: 'Americas',
    zones: [
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Phoenix',
      'America/Los_Angeles',
      'America/Anchorage',
      'Pacific/Honolulu',
      'America/Toronto',
      'America/Vancouver',
      'America/Mexico_City',
      'America/Sao_Paulo',
      'America/Argentina/Buenos_Aires',
    ],
  },
  {
    region: 'Europe',
    zones: [
      'Europe/London',
      'Europe/Paris',
      'Europe/Berlin',
      'Europe/Madrid',
      'Europe/Rome',
      'Europe/Amsterdam',
      'Europe/Brussels',
      'Europe/Vienna',
      'Europe/Stockholm',
      'Europe/Athens',
      'Europe/Istanbul',
      'Europe/Moscow',
    ],
  },
  {
    region: 'Asia',
    zones: [
      'Asia/Dubai',
      'Asia/Kolkata',
      'Asia/Bangkok',
      'Asia/Singapore',
      'Asia/Hong_Kong',
      'Asia/Shanghai',
      'Asia/Tokyo',
      'Asia/Seoul',
      'Asia/Jakarta',
      'Asia/Manila',
    ],
  },
  {
    region: 'Pacific',
    zones: [
      'Australia/Sydney',
      'Australia/Melbourne',
      'Australia/Perth',
      'Pacific/Auckland',
      'Pacific/Fiji',
      'Pacific/Guam',
    ],
  },
  {
    region: 'Africa',
    zones: [
      'Africa/Cairo',
      'Africa/Johannesburg',
      'Africa/Nairobi',
      'Africa/Lagos',
      'Africa/Casablanca',
    ],
  },
  {
    region: 'Atlantic',
    zones: [
      'Atlantic/Reykjavik',
      'Atlantic/Azores',
      'Atlantic/Bermuda',
    ],
  },
];

/**
 * Get all timezones as a flat array (for search functionality)
 */
export function getAllTimezones(): string[] {
  return TIMEZONE_OPTIONS.flatMap(group => group.zones);
}
