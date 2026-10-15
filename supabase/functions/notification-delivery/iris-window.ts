// WHAT:       When journey delivers a WINDOW call (Morning Kickstart, Business Hours Start, Daily
//             Wrap-up, Evening Start, Weekend Morning), ask Huddle for Iris's matching message: what
//             is still ahead in that window — meetings, classes and tasks — in her own voice.
// WHY:        Owner, 2026-10-15: "i have tasks everyday and i do want a similar message for day in
//             the morning and for each window as they pop up". journey OWNS the window times (the
//             owner edits them in journey's settings), so journey's own delivery is the trigger: the
//             email and Iris fire from the same moment and can never drift onto different clocks.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   huddle-extension-app /api/public/run-schedule-brief `window` (PR #84).
//
// The 8am MORNING window is sent WITHOUT a window, as Huddle's morning edition: it shares the turn
// key of Huddle's own 8am brief, so the owner gets ONE 8am message whichever fires first.

export interface IrisWindowRequest {
  caller: { entra_email: string };
  timeZone: string;
  window?: { name: string; start: number; end: number };
}

/**
 * Pure. Returns the body to POST to Huddle's run-schedule-brief, or null when this call is not a
 * window call (custom calls, stand-ups) or names a window we have no hours for.
 */
export function irisWindowRequest(
  callId: string,
  context: string,
  email: string | null | undefined,
  timeZone: string,
  ranges: Record<string, { start: number; end: number }>,
): IrisWindowRequest | null {
  if (!email || !String(callId || '').startsWith('window_')) return null;
  const name = String(context || '').match(/\[WINDOW:(\w+)\]/i)?.[1]?.toLowerCase() || '';
  const range = ranges[name];
  if (!range) return null;
  const base = { caller: { entra_email: email }, timeZone: timeZone || 'America/New_York' };
  return name === 'morning' ? base : { ...base, window: { name, start: range.start, end: range.end } };
}
