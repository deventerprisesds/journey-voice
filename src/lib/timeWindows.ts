/**
 * Shared time window detection for the frontend.
 * Source of truth is call-context-builder.ts on the server.
 * This is a lightweight mirror for UI hints only.
 */

export const WINDOW_RANGES: Record<string, { start: number; end: number }> = {
  morning: { start: 6, end: 9 },
  business_hours: { start: 9, end: 17 },
  after_work: { start: 17, end: 19 },
  evening: { start: 19, end: 22 },
  weekends: { start: 10, end: 20 }
};

export const CATEGORY_WINDOW_MAPPING: Record<string, string[]> = {
  'CAREER': ['business_hours'],
  'PROF_EDUCATION': ['after_work', 'evening', 'weekends'],
  'EDUCATION': ['business_hours', 'after_work'],
  'VENTURES': ['after_work', 'evening', 'weekends'],
  'LIFE': ['morning', 'after_work', 'evening', 'weekends'],
  'PERSONAL': ['morning', 'after_work', 'evening', 'weekends'],
};

export function detectCurrentWindow(): string {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();

  if (day === 0 || day === 6) return 'weekends';
  for (const [window, range] of Object.entries(WINDOW_RANGES)) {
    if (window === 'weekends') continue;
    if (hour >= range.start && hour < range.end) return window;
  }
  return 'evening';
}

export function getWindowCategories(window: string): string[] {
  return Object.entries(CATEGORY_WINDOW_MAPPING)
    .filter(([_, windows]) => windows.includes(window))
    .map(([cat]) => cat);
}
