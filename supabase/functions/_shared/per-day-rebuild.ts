// WHAT:       Which pre-run placements belong to one local day, for the nightly builder's per-day rebuild.
// WHY:        Owner-approved 2026-11-05: the builder cleared the whole 7-day horizon up front, so a run cut off
//             by the edge-function time limit (2026-11-04 11:54Z, Sat-Mon) left every unreached day EMPTY.
//             Each day is now cleared just before it is filled; this picks that day's leftovers.
// SUPERSEDES: the up-front horizon clear in nightly-schedule-builder STEP 1.1 (full mode).
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   supabase/functions/_shared/per-day-rebuild.test.ts
//
// Times are compared as INSTANTS, never as text: Postgres returns "…+00:00" while day bounds are "….000Z",
// and a string comparison of those two spellings is not a time comparison.

export function pendingIdsForDay(
  pending: ReadonlyMap<string, string>,
  bounds: { start: string; end: string },
  alreadyPlaced: ReadonlySet<string>,
): string[] {
  const lo = Date.parse(bounds.start);
  const hi = Date.parse(bounds.end);
  const out: string[] = [];
  for (const [id, startTime] of pending) {
    if (alreadyPlaced.has(id)) continue;
    const t = Date.parse(startTime);
    if (Number.isFinite(t) && t >= lo && t < hi) out.push(id);
  }
  return out;
}

/**
 * The cleared placements a failed day should get back: every row that had a slot and was not re-placed
 * elsewhere in this run (re-placing it twice would double-book it). Added 2026-11-15 after two nights of
 * AI 403s emptied every day (nightly-schedule-builder restoreClearedDay).
 */
export function restorableRows<T extends { id: string; start_time: string | null }>(
  cleared: readonly T[],
  alreadyPlaced: ReadonlySet<string>,
): T[] {
  return cleared.filter((r) => !!r.start_time && !alreadyPlaced.has(r.id));
}
