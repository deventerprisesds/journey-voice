/**
 * ASSIGNMENT DUE-DATE CADENCE INFERENCE — one implementation, shared by every consumer.
 *
 * WHAT:       Fills a MISSING `due_date` on a course assignment by extrapolating the course's
 *             own weekly cadence from its latest DATED item, and marks the result as inferred.
 * WHY:        MIT "Applied Generative AI" runs a strict weekly cadence (measured 2026-09-03:
 *             Required Assignments 1.1-6.1 due 2026-07-14, 07-21, 07-28, 08-04, 08-11, 08-18,
 *             all at 16:29:00+00, exactly 7 days apart to the second) but 7.1 and the 8.1
 *             Capstone carried `due_date` NULL in Nexus. Undated work sorts to band 5 in
 *             `_shared/nexus.ts` `courseworkBand` and is invisible to the scheduler, so the
 *             genuinely UPCOMING items were the two that never surfaced.
 * SUPERSEDES: the private copy of this rule that lived at
 *             `supabase/functions/nightly-assignment-sync/index.ts:143-162` (2026-08-26).
 *             That copy was reachable only by the nightly sync, so the `list_pending_assignments`
 *             agent tool and the sync disagreed about the same two assignments. It has been
 *             replaced by an import of this module in the same commit.
 * SUPERSEDED-BY: nothing — current.
 * EVIDENCE:   docs/impl/laneB-assignment-intake.md §1.1 (the 16 live Nexus rows) and §2;
 *             docs/ac/nudge-and-ordering-ACs.md AC-2b..AC-2f.
 *
 * STILL TO WIRE (Lane A): `_shared/nexus.ts` must import `inferMissingDueDates` from here and
 * apply it in `fetchNexusAssignmentsResult`, so the agent tool and the Assignments page see the
 * same inferred dates the sync does. Until that lands, only `nightly-assignment-sync` benefits.
 * This module is deliberately import-free and Deno-free so any consumer — edge function, Vite
 * client bundle, or `node --experimental-strip-types` test — can use it.
 *
 * THREE PROPERTIES THIS MODULE GUARANTEES, each covered by a test in
 * `assignment-cadence.test.ts`:
 *   1. DETERMINISTIC — the same input list yields byte-identical output regardless of the array
 *      order it arrives in and regardless of the process timezone.
 *   2. NEVER OVERWRITES — a row that already carries a `due_date` is returned by REFERENCE,
 *      untouched and unmarked, even when its date contradicts the cadence.
 *   3. VISIBLY MARKED — an inferred row carries `_due_date_inferred: true`, so no consumer can
 *      present an extrapolation as a published deadline by accident.
 */

/** One week, the cadence step. Exported so a test can build fixtures from the same constant. */
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The marker key stamped onto an inferred row. Anything that persists or renders an assignment
 * MUST branch on this rather than re-deriving "did this come from a course or from us?".
 * `nightly-assignment-sync` maps it to `scheduling_context.due_date_inferred` on the task row.
 */
export const DUE_DATE_INFERRED_KEY = '_due_date_inferred' as const;

/**
 * The user-facing qualifier for an inferred date. Lives here, next to the rule that produces the
 * date, so a surface cannot show the date without the caveat being one import away. AC-2e: an
 * inferred date must never be stated as a published deadline.
 */
export const DUE_DATE_INFERRED_NOTE = 'estimated from the weekly course cadence, not published by the course';

/** The minimum an assignment must look like for this module. Extra fields pass through. */
export interface CadenceAssignment {
  title?: string | null;
  due_date?: string | null;
  [k: string]: unknown;
}

export interface InferCadenceOptions {
  /** Cadence step. Defaults to one week. */
  stepMs?: number;
  /** Where to send the per-inference audit line. Defaults to `console.log`; pass a no-op to silence. */
  log?: ((msg: string) => void) | null;
}

/** True when the row's date came from this module rather than from the course. */
export function isDueDateInferred(a: CadenceAssignment): boolean {
  return a?.[DUE_DATE_INFERRED_KEY] === true;
}

/**
 * The sequence number from a `N.M` title — `Required Assignment 7.1: …` -> 7.
 *
 * Returns `null` (not a sentinel number) when the title carries no sequence, so a caller cannot
 * accidentally arithmetic on "unknown". The original implementation used
 * `Number.MAX_SAFE_INTEGER`, which is a valid number and silently participates in comparisons.
 */
export function assignmentSequence(title: unknown): number | null {
  const m = /(\d+)\.\d+/.exec(String(title ?? ''));
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a due date to epoch ms, TIMEZONE-INDEPENDENTLY.
 *
 * This is the determinism-critical step (AC-2c). `Date.parse` treats a bare `YYYY-MM-DD` as UTC
 * but a date-TIME with no offset (`2026-08-18T16:29:00`) as LOCAL, so the same input would infer
 * a different day under `TZ=America/New_York` than under `TZ=UTC`. Nexus returns
 * `2026-08-18 16:29:00+00` today, but the rule must not depend on that staying true. An
 * offset-less timestamp is therefore read as UTC explicitly.
 */
export function parseDueMs(due: unknown): number | null {
  if (due == null) return null;
  const s = String(due).trim();
  if (!s) return null;

  const finite = (t: number) => (Number.isFinite(t) ? t : null);

  // Bare date -> UTC midnight. Handled before offset detection because "2026-08-18" ENDS in
  // "-18", which any naive trailing-offset regex reads as a -18:00 offset. (Caught by the
  // committed test, not in review.)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return finite(Date.parse(`${s}T00:00:00Z`));

  const iso = s.replace(' ', 'T');
  const tIdx = iso.indexOf('T');
  if (tIdx < 0) return finite(Date.parse(iso)); // unrecognised shape — no normalisation to apply

  const datePart = iso.slice(0, tIdx);
  const timePart = iso.slice(tIdx + 1);

  if (/[zZ]$/.test(timePart)) return finite(Date.parse(`${datePart}T${timePart.slice(0, -1)}Z`));

  // Postgres renders a UTC timestamptz as "+00" — a TWO-digit offset, which is valid ISO 8601
  // but NOT accepted by Date.parse (ES requires ±HH:mm). Widen it rather than dropping to the
  // local-time interpretation, which is exactly the timezone dependence this function exists
  // to remove.
  const off = /([+-])(\d{2}):?(\d{2})?$/.exec(timePart);
  if (off) {
    return finite(Date.parse(
      `${datePart}T${timePart.slice(0, off.index)}${off[1]}${off[2]}:${off[3] ?? '00'}`,
    ));
  }
  return finite(Date.parse(`${datePart}T${timePart}Z`)); // no offset at all -> read as UTC
}

/**
 * Fill missing due dates from the course's weekly cadence.
 *
 * ANCHOR: the DATED item with the latest due date. Ties are broken by sequence number then
 * title so the anchor cannot depend on the order rows arrived in — `Array.prototype.sort` is
 * stable, so without an explicit tie-break two same-dated items would hand the anchor to
 * whichever the database happened to return first.
 *
 * A row is inferred ONLY when `due_date` is null/undefined. A present-but-unparseable value
 * (`''`, `'null'`, garbage) is left EXACTLY as it is: this module's job is to fill a gap, never
 * to correct or replace a value someone else wrote. A row that cannot be placed in the sequence
 * — no `N.M` in the title, or a sequence at or before the anchor's — is also left alone rather
 * than guessed at.
 *
 * Rows that are not inferred are returned by REFERENCE, so `output[i] === input[i]` is a valid
 * assertion for them (AC-2d).
 */
export function inferMissingDueDates<T extends CadenceAssignment>(
  list: readonly T[],
  opts: InferCadenceOptions = {},
): T[] {
  const stepMs = opts.stepMs ?? WEEK_MS;
  const log = opts.log === undefined ? (m: string) => console.log(m) : opts.log;

  if (!Array.isArray(list) || list.length === 0) return list as unknown as T[];

  // Candidate anchors: rows with a PARSEABLE date. An unparseable one cannot anchor arithmetic.
  const dated = list
    .map((a) => ({ a, ms: parseDueMs(a?.due_date), seq: assignmentSequence(a?.title) }))
    .filter((x): x is { a: T; ms: number; seq: number | null } => x.ms !== null);

  if (dated.length === 0) return list.slice() as T[]; // nothing to extrapolate from

  // Deterministic anchor selection: latest date, then highest sequence, then title.
  dated.sort((x, y) =>
    y.ms - x.ms
    || (y.seq ?? -1) - (x.seq ?? -1)
    || String(x.a.title ?? '').localeCompare(String(y.a.title ?? '')),
  );
  const anchor = dated[0];
  const anchorSeq = anchor.seq;

  return list.map((a) => {
    if (a?.due_date != null) return a;              // present — never touched, never marked
    if (anchorSeq === null) return a;               // anchor carries no sequence to count from
    const s = assignmentSequence(a?.title);
    if (s === null || s <= anchorSeq) return a;     // cannot place it in the sequence
    const inferredMs = anchor.ms + (s - anchorSeq) * stepMs;
    const inferred = new Date(inferredMs).toISOString();
    log?.(
      `[CADENCE] Inferred due date for "${String(a.title ?? '')}": ${inferred.slice(0, 10)} `
      + `(weekly cadence, +${s - anchorSeq}w from "${String(anchor.a.title ?? '')}" `
      + `@ ${new Date(anchor.ms).toISOString().slice(0, 10)})`,
    );
    return { ...a, due_date: inferred, [DUE_DATE_INFERRED_KEY]: true };
  });
}

/**
 * The same rule, applied PER COURSE.
 *
 * WHY THIS EXISTS: `inferMissingDueDates` anchors on the latest dated item in the list it is
 * given. That is correct for one course and nonsense for several — course A's missing 7.1 would
 * be extrapolated from whichever course happened to have the newest deadline. The private copy
 * this replaced never hit that because its caller was pinned to a single course id; removing the
 * pin (AC-3) is exactly what makes the grouping necessary.
 *
 * Output order is the INPUT order, not the group order, so the result is independent of how the
 * groups happened to be enumerated (AC-2c).
 */
export function inferMissingDueDatesByCourse<T extends CadenceAssignment>(
  list: readonly T[],
  opts: InferCadenceOptions & { groupBy?: (a: T) => string } = {},
): T[] {
  if (!Array.isArray(list) || list.length === 0) return list as unknown as T[];
  const groupBy = opts.groupBy ?? ((a: T) => String((a as CadenceAssignment).course_id ?? ''));

  const groups = new Map<string, number[]>();  // group key -> indices into `list`
  list.forEach((a, i) => {
    const k = groupBy(a);
    const bucket = groups.get(k);
    if (bucket) bucket.push(i); else groups.set(k, [i]);
  });

  const out = list.slice() as T[];
  for (const indices of groups.values()) {
    const inferred = inferMissingDueDates(indices.map((i) => list[i]), opts);
    indices.forEach((listIndex, groupIndex) => { out[listIndex] = inferred[groupIndex]; });
  }
  return out;
}
