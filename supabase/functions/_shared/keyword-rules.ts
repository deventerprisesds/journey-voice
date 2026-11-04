// WHAT:          The single keyword rule shared by the nightly scheduler and the daily review's QC check:
//                which keyword (if any) steers a task's time window.
// WHY:           Settings stores each keyword as [timeWindow, lane] and has always let the owner edit the lane,
//                but both consumers read only the window. So "Work on Nexus application" (VENTURES) was pulled
//                into business hours by the "work" keyword, overriding the VENTURES windows the owner set
//                (owner 2026-11-03: extend the keywords to point at a lane, never remove them). The two consumers
//                also disagreed: QC flagged a task when ANY matching keyword disagreed, the scheduler used the
//                FIRST active one.
// SUPERSEDES:    getKeywordWindowOverride in nightly-schedule-builder/index.ts and the inline keyword loop in
//                src/utils/dailyReviewPipeline.ts (QC_VIOLATIONS).
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:      docs/qc-evidence/AC-job-category.md section 3 (spelling table S-1..S-33), keyword-rules.test.ts.
//
// THE RULE, for each keyword entry [window, lane] in the order the stored object iterates:
//   1. Skip it exactly as before if the window is empty or 'flexible', or the keyword is under 3 characters.
//   2. Match exactly as before: the lower-cased TITLE contains the keyword, with '_' read as a space.
//   3. NEW: if the lane names a real category and the task's category is a different one, skip it and KEEP
//      SCANNING. A lane that is not a category ('flexible', a status, empty) applies to every task, as before.
//   4. As before, the window must be open today (when the caller knows today's windows); otherwise keep scanning.
// A task whose category is unknown (undefined/null) is not gated at all, so callers that never knew the
// category behave exactly as they did.
//
// ORDER MATTERS AND IS NOT THE ORDER IN THE CODE. config is jsonb, and Postgres stores object keys sorted by
// length, then bytewise, so in production "work" is tested before "workout" and "homework". Tests must build
// their keyword maps in that order (see keyword-rules.test.ts).

import { laneCoversCategory, toCategoryKey } from './categories.ts';

export interface KeywordMatch {
  keyword: string;
  window: string;
  /** The category the keyword is tied to, or null when its lane is not a category (applies to all). */
  lane: string | null;
}

export function matchKeywordRule(
  title: string | null | undefined,
  keywords: Record<string, unknown> | null | undefined,
  opts: { category?: unknown; activeWindowNames?: readonly string[] } = {},
): KeywordMatch | null {
  if (!keywords || !title) return null;
  const lower = title.toLowerCase();
  // Gate only on a REAL category. Unknown / empty / missing category = the old, ungated behaviour.
  const gated = toCategoryKey(opts.category) !== null;

  for (const [keyword, mapping] of Object.entries(keywords)) {
    if (!Array.isArray(mapping) || mapping.length === 0) continue;
    const window = mapping[0];
    if (!window || window === 'flexible' || typeof window !== 'string') continue;

    const kw = keyword.toLowerCase().replace(/_/g, ' ');
    if (kw.length < 3) continue;
    if (!lower.includes(kw)) continue;

    const lane = toCategoryKey(mapping[1]);
    if (gated && lane && !laneCoversCategory(lane, opts.category)) continue;

    if (opts.activeWindowNames && !opts.activeWindowNames.includes(window)) continue;

    return { keyword, window, lane };
  }
  return null;
}

/**
 * The named windows open on `dayOfWeek` (0 = Sunday) -- the nightly scheduler's rule, shared so the daily QC
 * check asks the keyword rule about the SAME windows. On Saturday and Sunday ONLY 'weekends' is open, even
 * where another window's days include the weekend (the owner's evening window lists every day); on weekdays
 * 'weekends' is closed. 'flexible' is never a window of its own.
 */
export function activeWindowNamesForDay(
  timeWindows: Record<string, { start?: number; end?: number; days?: number[] }> | null | undefined,
  dayOfWeek: number,
): string[] {
  if (!timeWindows) return [];
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const out: string[] = [];
  for (const [name, win] of Object.entries(timeWindows)) {
    if (name === 'flexible') continue;
    if (isWeekend && name !== 'weekends') continue;
    if (!isWeekend && name === 'weekends') continue;
    if (!win?.days || !win.days.includes(dayOfWeek)) continue;
    if (((win.end ?? 0) - (win.start ?? 0)) <= 0) continue;
    out.push(name);
  }
  return out;
}
