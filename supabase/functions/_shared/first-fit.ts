// WHAT:       Deterministic fallback placement: the first free start (15-min grid) on a day where a task of a
//             given length fits its allowed hours and overlaps nothing busy. Pure; used by
//             batch-calendar-scheduler for tasks whose AI-chosen slot was rejected.
// WHY:        2026-11-17 build: the AI placed tasks on top of meetings ("Work Block 2", "1:1 Andrew and Von")
//             or outside their windows; validation rejected them and nothing retried, so Thu 11-19 and
//             Fri 11-20 got 0 of 3 candidates while business hours had 240 free minutes.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   _shared/first-fit.test.ts; function_logs 2026-11-18 01:22 OVERLAPS_EXTERNAL_EVENT / WINDOW VIOLATION.

export interface Interval { start: number; end: number }

export function firstFit(opts: {
  dayStartMs: number;
  durationMs: number;
  notBeforeMs: number;
  busy: readonly Interval[];
  /** Both ends of the slot must sit in an allowed window for this task. */
  isAllowed: (startMs: number, endMs: number) => boolean;
  stepMs?: number;
}): Interval | null {
  const step = opts.stepMs ?? 15 * 60000;
  if (!(opts.durationMs > 0)) return null;
  const dayEnd = opts.dayStartMs + 24 * 3600000;
  let t = opts.dayStartMs;
  if (opts.notBeforeMs > t) t = opts.dayStartMs + Math.ceil((opts.notBeforeMs - opts.dayStartMs) / step) * step;
  for (; t + opts.durationMs <= dayEnd; t += step) {
    const end = t + opts.durationMs;
    if (opts.busy.some((b) => t < b.end && end > b.start)) continue;
    if (!opts.isAllowed(t, end)) continue;
    return { start: t, end };
  }
  return null;
}
