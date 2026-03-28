/**
 * Calendar display utilities shared across views.
 */

/**
 * Convert a raw calendar_id into a human-readable label.
 * Examples:
 *   "primary" → "Primary"
 *   "family12345@group.calendar.google.com" → "Family12345"
 *   "Canvas" → "Canvas"
 */
export function humanizeCalendarId(calendarId: string): string {
  if (!calendarId) return '';
  if (calendarId === 'primary') return 'Primary';
  if (calendarId.includes('@')) {
    const localPart = calendarId.split('@')[0];
    return localPart.charAt(0).toUpperCase() + localPart.slice(1);
  }
  return calendarId;
}
