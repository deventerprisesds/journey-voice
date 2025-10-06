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

// Removed getTimezoneOffset - use IANA timezone directly with Date objects

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
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'short'
    });
    const parts = formatter.formatToParts(now);
    const timeZoneName = parts.find(part => part.type === 'timeZoneName')?.value || '';
    
    return `${timezone} ${timeZoneName ? `(${timeZoneName})` : ''}`;
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
