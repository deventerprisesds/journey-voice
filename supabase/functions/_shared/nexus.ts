/**
 * NEXUS (Azure) DATA CLIENT — the single place journey talks to nexus-hub.
 *
 * WHY THIS EXISTS
 * nexus-hub migrated `assignments` / `programs` / `courses` off Supabase to Azure on
 * 2026-04-06 (schema `content.*`, served by nexus-hub-api `/api/d1/<table>`). The
 * Supabase `public.assignments` table is a DEAD SNAPSHOT frozen at that date — measured
 * 2026-08-29 it held 469 rows for the primary user, ALL marked open, newest due
 * 2026-06-23, every row `created_at` 2026-04-06, and no cron feeds it. Anything still
 * reading it shows an assignment list that is months stale and missing the user's
 * current course entirely.
 *
 * `nightly-assignment-sync` was repointed first (2026-08-28) and grew a private copy of
 * this fetch. Every other consumer — the Assignments page, its utils, the task-creation
 * picker, and the `list_pending_assignments` agent tool — was still on the dead table.
 * Rather than copy the fetch a sixth time, it lives here once.
 *
 * READ AUTH: reads use the unverified `?owner=<uuid>` fallback (nexus-hub
 * `api/src/lib/auth.ts` resolveOwner, step 4), so no session token and NO NEW SECRET is
 * needed — honouring the standing "never mint a new org secret for cross-app calls" rule.
 * NOTE for whoever hardens this later: unverified means anyone holding a user uuid can
 * read that user's assignments. That is a pre-existing nexus-hub design decision, called
 * out here so it is not mistaken for something journey introduced.
 *
 * WRITES are deliberately NOT implemented here. nexus-hub's `requireWrite` demands a
 * VERIFIED owner (nexus HMAC session, a real Supabase user token, or the UAT bypass);
 * a service-role edge function has none of those. Adding a write path is a security
 * decision, not a plumbing one — see the sheet-sync discussion before implementing it.
 */

// Guarded rather than a bare `Deno.env.get(...)`: a top-level Deno reference makes this
// module unimportable by any non-Deno runtime, which blocks offline unit-testing of the
// pure ordering/scoping logic below (all of which needs no environment at all).
export const NEXUS_API =
  (typeof Deno !== 'undefined' ? Deno.env.get('NEXUS_API_URL') : undefined)
  || 'https://nexus-hub-api.azurewebsites.net';

/** Shape returned by `SELECT *` on `content.assignments`, plus the nested course embed. */
export interface NexusAssignment {
  id: string;
  user_id: string;
  course_id: string | null;
  program_id: string | null;
  module_id: string | null;
  title: string;
  description: string | null;
  type: string | null;
  status: string | null;
  due_date: string | null;
  priority: string | null;
  points: number | null;
  level_of_effort: string | null;
  assignment_url: string | null;
  academic_semester: string | null;
  category: string | null;
  courses?: { id: string; name: string; code: string } | null;
  [k: string]: unknown;
}

export interface FetchAssignmentsOptions {
  /** Restrict to these course ids. Omit for every course the owner has. */
  courseIds?: string[];
  /** Restrict to one program id. */
  programId?: string;
  /** Drop completed/graded. Default true. */
  openOnly?: boolean;
  /** Keep only rows with points > 0 (the "Required" discriminator). Default false. */
  requiredOnly?: boolean;
}

const OPEN_EXCLUDED = ['completed', 'graded'];

/** points > 0 separates "Required Assignment"/"Capstone" from ungraded Captain's-Log
 *  style entries. It is the ONLY structurally discriminating column — type, category,
 *  priority, submission_types and canvas_meta are identical or null across both groups —
 *  so this avoids title pattern-matching, which rots the first time a course renames. */
export const isRequiredAssignment = (a: Pick<NexusAssignment, 'points'>) =>
  Number(a?.points ?? 0) > 0;

// ---------------------------------------------------------------------------
// WRITES — server-to-server, authorised by the UAT bypass token
// ---------------------------------------------------------------------------
/**
 * nexus-hub's `requireWrite` needs a VERIFIED owner, and a service-role edge function
 * has no user session. Of the three paths resolveOwner accepts (nexus HMAC session, a
 * real Supabase user token, the UAT bypass), only the bypass works machine-to-machine.
 *
 * Owner-approved 2026-09-03 ("go ahead and use UAT_BYPASS_TOKEN"). It reuses the
 * EXISTING org secret rather than minting a new one, per the standing rule.
 *
 * BE HONEST ABOUT WHAT THIS IS: a token named for UAT, now load-bearing in a production
 * write path. It grants write access to ANY owner passed in `?owner=`, so anything
 * holding it can write as anyone. It lives only in edge-function secrets and must never
 * reach the browser — which is why writes are here, server-side, and deliberately absent
 * from src/utils/nexusAssignments.ts. The durable fix is a real service credential in
 * nexus-hub with a per-service owner scope; until then this is the accepted trade-off.
 */
function uatToken(): string | null {
  const t = typeof Deno !== 'undefined' ? Deno.env.get('UAT_BYPASS_TOKEN') : undefined;
  return t && t.length > 0 ? t : null;
}

export function nexusWritesConfigured(): boolean {
  return uatToken() !== null;
}

export interface NexusWriteResult<T = any> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

async function nexusRequest<T = any>(
  method: 'POST' | 'PATCH' | 'DELETE',
  table: string,
  qs: Record<string, string>,
  body?: unknown,
): Promise<NexusWriteResult<T>> {
  const token = uatToken();
  if (!token) {
    // Fail LOUDLY rather than silently no-op: a sync that reports success while writing
    // nothing is worse than one that stops.
    return { ok: false, status: 0, error: 'UAT_BYPASS_TOKEN is not set — Nexus writes are disabled' };
  }
  const url = `${NEXUS_API}/api/d1/${table}?${new URLSearchParams(qs).toString()}`;
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-UAT-Token': token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: any = undefined;
    try { parsed = text ? JSON.parse(text) : undefined; } catch { /* non-JSON */ }
    if (!res.ok) return { ok: false, status: res.status, error: text.slice(0, 300) };
    return { ok: true, status: res.status, data: parsed };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Insert one assignment. `owner` is the Nexus user uuid the row belongs to. */
export function createNexusAssignment(owner: string, row: Record<string, unknown>) {
  return nexusRequest('POST', 'assignments', { owner }, row);
}

/** Update one assignment by id. Only whitelisted writable columns are accepted upstream. */
export function updateNexusAssignment(owner: string, id: string, patch: Record<string, unknown>) {
  return nexusRequest('PATCH', 'assignments', { owner, id }, patch);
}

// ---------------------------------------------------------------------------
// ACTIVE-COURSE RESOLUTION — dynamic, no hardcoded ids
// ---------------------------------------------------------------------------
/**
 * Which courses is the user actually taking right now?
 *
 * NOTHING IN NEXUS ANSWERS THIS DIRECTLY, and the two fields that look like they
 * should were both measured useless on 2026-09-03:
 *   - `programs.is_active` is TRUE on every program.
 *   - `status` is never advanced, so open_assignments == assignments for EVERY course
 *     (all 27 of them), including courses finished in 2025.
 * The only signal that tracks reality is INGESTION RECENCY: a course being imported is
 * a course being taken. Measured that day — AI and Business Strategy 5 days ago,
 * Applied Generative AI 14 days ago, then a cliff to 26+ days for everything else.
 *
 * RELATIVE, not a fixed window. An absolute "last N days" rule silently empties the
 * moment the user stops importing for N days, and 14 sat exactly on the MIT course's
 * boundary. Instead: anchor on the NEWEST ingestion the user has, and take every course
 * imported within `eraDays` of that anchor. That scales with the user's own cadence and
 * cannot go empty while any assignment exists.
 *
 * Config always wins — `activeCourseIds` pins the set explicitly, `excludeCourseIds`
 * removes noise, so the user is never stuck with what this infers (the standing
 * "no behaviour-affecting value may be code-only" rule).
 */
export interface ActiveCourseOptions {
  /** Explicit pin. When non-empty this IS the answer; nothing is inferred. */
  activeCourseIds?: string[];
  /** Always drop these, even if inferred or pinned. */
  excludeCourseIds?: string[];
  /** How far back from the newest ingestion still counts as the same era. */
  eraDays?: number;
  /** Treat assignments with no course_id as active. Default false — 32 such orphans
   *  existed on 2026-09-03 and they cannot be scoped or attributed to a course. */
  includeUncoursed?: boolean;
}

/**
 * 14, chosen from the measured gap rather than picked round. On 2026-09-03 the ingestion
 * ages behind the anchor were 0d (AI and Business Strategy), 9d (Applied Generative AI),
 * then a cliff to 21d for the whole stale cluster. 21 sits exactly ON that cliff and
 * re-admits all of it (caught by the unit test, not in review); 14 clears the live pair
 * by 5 days and the stale cluster by 7. Overridable per user via
 * `config.assignments.activeCourseEraDays`.
 */
export const DEFAULT_ACTIVE_COURSE_ERA_DAYS = 14;

export function resolveActiveCourseIds(
  assignments: NexusAssignment[],
  opts: ActiveCourseOptions = {},
): Set<string> {
  const exclude = new Set(opts.excludeCourseIds ?? []);

  if (opts.activeCourseIds?.length) {
    return new Set(opts.activeCourseIds.filter((id) => !exclude.has(id)));
  }

  const eraDays = opts.eraDays ?? DEFAULT_ACTIVE_COURSE_ERA_DAYS;
  const lastSeen = new Map<string, number>();
  for (const a of assignments) {
    const cid = a.course_id;
    if (!cid) continue;
    const t = Date.parse(String(a.created_at ?? ''));
    if (!Number.isFinite(t)) continue;
    lastSeen.set(cid, Math.max(lastSeen.get(cid) ?? 0, t));
  }
  if (lastSeen.size === 0) return new Set();

  const anchor = Math.max(...lastSeen.values());
  const cutoff = anchor - eraDays * 86400000;
  const active = new Set<string>();
  for (const [cid, t] of lastSeen) {
    if (t >= cutoff && !exclude.has(cid)) active.add(cid);
  }
  return active;
}

/** Keep only assignments belonging to an active course. */
export function scopeToActiveCourses(
  assignments: NexusAssignment[],
  opts: ActiveCourseOptions = {},
): NexusAssignment[] {
  const active = resolveActiveCourseIds(assignments, opts);
  return assignments.filter((a) =>
    a.course_id ? active.has(a.course_id) : !!opts.includeUncoursed,
  );
}

// ---------------------------------------------------------------------------
// COURSEWORK ORDER — five bands, OWNER-FINAL 2026-09-03
// ---------------------------------------------------------------------------
/**
 * The order coursework is both SHOWN in and WORKED in (owner-final 2026-09-03):
 *
 *   1. UPCOMING SOON   due within `soonDays`         -> soonest first
 *   2. FUTURE BEYOND   due after `soonDays`          -> soonest first
 *   3. RECENTLY MISSED missed within `recentDays`    -> most recent miss first
 *   4. OLD BACKLOG     missed before `recentDays`    -> OLDEST FIRST
 *   5. UNDATED         no parseable due date         -> always last
 *
 * TWO THINGS CHANGED HERE, and both are deliberate — do not "restore" either.
 *
 * (a) BAND 4 NOW LEADS WITH THE OLDEST. The comment this replaces argued the exact
 *     opposite: *"the oldest item is the least likely to still matter, so it must not
 *     lead."* The owner overruled that on 2026-09-03: old backlog is cleared
 *     front-to-back, so within band 4 the OLDEST item is worked first. The owner
 *     accepted the consequence on the live MIT set — assignment 6.1 (16 days late on
 *     2026-09-03, so band 4 under `recentDays = 14`) sorts LAST, not third:
 *     expected order today = 8.1, 7.1, 1.1, 2.1, 3.1, 4.1, 5.1, 6.1.
 *
 * (b) THIS GOVERNS PLACEMENT, NOT ONLY DISPLAY. `courseworkOrder` has exactly two
 *     importers — the `list_pending_assignments` agent tool and this repo's nightly
 *     schedule builder — and the owner chose "work it first" as well as "show it
 *     first", so BOTH move together. A future change that reverses one and not the
 *     other reintroduces the divergence that made the queue order and the per-day pick
 *     order disagree.
 *
 * WHY NOT PLAIN DUE-DATE ASC (what this originally replaced): with the full Nexus
 * history visible, ascending order is dominated by a multi-year backlog. Measured
 * 2026-09-03 the agent tool returned 30 rows ALL dated 21-27 January 2025 and the
 * user's live course did not appear at all. The BAND is what keeps that backlog off the
 * top; the direction WITHIN the backlog band is the owner's front-to-back choice.
 *
 * Undated assignments sort after every dated one — they carry no deadline signal, and
 * defaulting them to "urgent" would let untracked items crowd out real deadlines.
 */
export interface CourseworkOrderOptions {
  now?: number;
  /** Horizon for band 1 (band 2 is everything further out). */
  soonDays?: number;
  /** How far back a miss still counts as "recent" (band 3 vs band 4). */
  recentDays?: number;
}

export const DEFAULT_SOON_DAYS = 14;
/**
 * 30 -> 14, owner-final 2026-09-03. A miss older than a fortnight is backlog, not a
 * recent slip. Overridable per user via `config.assignments.recentOverdueDays`.
 *
 * NOT THE SAME CONSTANT AS `DEFAULT_ACTIVE_COURSE_ERA_DAYS` (also 14, ~70 lines above).
 * That one measures how recently a COURSE WAS INGESTED; this one measures how recently
 * an ASSIGNMENT WAS MISSED. They are unrelated and now hold the same value, so editing
 * the wrong one produces a plausible-looking change with a completely different effect.
 * `nexus.test.ts` asserts each one's effect independently so a swap fails loudly.
 */
export const DEFAULT_RECENT_OVERDUE_DAYS = 14;

export function courseworkBand(
  a: Pick<NexusAssignment, 'due_date'>,
  opts: CourseworkOrderOptions = {},
): 1 | 2 | 3 | 4 | 5 {
  const now = opts.now ?? Date.now();
  const soon = (opts.soonDays ?? DEFAULT_SOON_DAYS) * 86400000;
  const recent = (opts.recentDays ?? DEFAULT_RECENT_OVERDUE_DAYS) * 86400000;
  const due = a.due_date ? Date.parse(String(a.due_date)) : NaN;
  if (!Number.isFinite(due)) return 5; // undated — always last
  const delta = due - now;
  if (delta >= 0) return delta <= soon ? 1 : 2;
  // BOUNDARY, decided explicitly rather than by accident: a miss of EXACTLY
  // `recentDays` is still RECENT (band 3). One millisecond older is band 4.
  return -delta <= recent ? 3 : 4;
}

/**
 * Comparator implementing the five bands above.
 *
 * The within-band direction is written as an explicit per-band switch, NOT as one
 * shared `da - db` / `db - da` expression. The previous single expression served two
 * bands at once, so flipping it to reverse the backlog silently reversed the other band
 * too — the exact trap called out in docs/ac/nudge-and-ordering-ACs.md AC-1.2.
 *
 * A deterministic `id` tiebreak closes the comparator: without it, two items sharing a
 * band and a due date compare equal, and the sorted result then depends on the order
 * Postgres happened to return rows in.
 */
export function courseworkOrder(opts: CourseworkOrderOptions = {}) {
  const now = opts.now ?? Date.now();
  return (a: NexusAssignment, b: NexusAssignment): number => {
    const ba = courseworkBand(a, { ...opts, now });
    const bb = courseworkBand(b, { ...opts, now });
    if (ba !== bb) return ba - bb;
    if (ba === 5) {
      const byTitle = String(a.title ?? '').localeCompare(String(b.title ?? ''));
      return byTitle !== 0 ? byTitle : String(a.id ?? '').localeCompare(String(b.id ?? ''));
    }
    const da = Date.parse(String(a.due_date));
    const db = Date.parse(String(b.due_date));
    let byDate: number;
    switch (ba) {
      case 1: byDate = da - db; break; // due soon      -> soonest first
      case 2: byDate = da - db; break; // future beyond -> soonest first
      case 3: byDate = db - da; break; // recently missed -> MOST RECENT miss first
      default: byDate = da - db; break; // band 4 old backlog -> OLDEST FIRST
    }
    if (byDate !== 0) return byDate;
    return String(a.id ?? '').localeCompare(String(b.id ?? ''));
  };
}

export const COURSEWORK_BAND_LABEL: Record<number, string> = {
  1: 'due soon',
  2: 'upcoming',
  3: 'recently overdue',
  4: 'old backlog',
  5: 'no due date',
};

// ---------------------------------------------------------------------------
// SCHEDULING CANDIDATE ORDER — the builder's composed ordering, made a TOTAL order
// ---------------------------------------------------------------------------
/**
 * THE DEFECT THIS FIXES (independent verifier, docs/verify/nudge-delivery-loop1.md §C7).
 * The nightly builder sorted its candidates with a comparator that switched ordering
 * RULE depending on which pair it was handed: coursework order for assignment-vs-
 * assignment, score order for everything else. That is intransitive, and it was proven
 * with real values —
 *
 *   C1 assignment band 1 score 10 | C2 assignment band 4 score 90 | N non-assignment score 50
 *   C1 < C2 (coursework) , C2 < N (score) , N < C1 (score)  => a cycle
 *
 * — so six permutations of the same three tasks produced THREE different sorted orders.
 * The per-day pick order was therefore a function of the candidate query's row order,
 * not of the tasks. `Array.prototype.sort` gives no guarantees at all on a comparator
 * that is not a valid ordering, so this could not be fixed by tuning the branches.
 *
 * THE FIX: stop composing two orderings inside one comparator. Instead compute ONE
 * total order over the whole candidate set up front, then compare precomputed integer
 * ranks. Both original intents survive intact:
 *
 *   1. Tier A/B lead, A before B, coursework order within each tier (unchanged).
 *   2. Among everyone else, the SCORE branch decides where an ordinary assignment sits
 *      relative to non-assignment work — so Tier C still never auto-jumps priority-board
 *      work, which was the whole point of that carve-out.
 *   3. Assignments in that group are then permuted AMONG THE SLOTS SCORE ALREADY GAVE
 *      THEM so that, read top to bottom, they appear in coursework order. They take no
 *      slot from a non-assignment, and they no longer appear in an arbitrary order.
 *
 * The returned comparator compares integer ranks only, so it is antisymmetric and
 * transitive by construction, and sorting is permutation-invariant. `nexus.test.ts`
 * asserts both axioms over every ordered triple of a mixed fixture, and asserts 200
 * random permutations of a 40-item set sort identically.
 */
export interface SchedulingCandidateOrderOptions<T> {
  /** Stable unique id — also the final tiebreak, so the order never depends on row order. */
  idOf: (t: T) => string;
  /** 'A' | 'B' = deadline tier that leads the queue; 'C' = ordinary assignment; null = not an assignment. */
  tierOf: (t: T) => 'A' | 'B' | 'C' | null;
  /** Coursework comparator — normally `courseworkOrder({...})`. */
  courseworkCompare: (a: T, b: T) => number;
  /** Score/priority comparator deciding assignment-vs-non-assignment and non-vs-non. */
  scoreCompare: (a: T, b: T) => number;
}

/** Returns a NEW array in the builder's candidate order. Does not mutate the input. */
export function orderSchedulingCandidates<T>(
  tasks: T[],
  opts: SchedulingCandidateOrderOptions<T>,
): T[] {
  const { idOf, tierOf, courseworkCompare, scoreCompare } = opts;
  // Every leaf comparison ends in an id tiebreak, so each of these is a strict total
  // order and none of them can depend on the incoming array order.
  const byId = (a: T, b: T) => String(idOf(a)).localeCompare(String(idOf(b)));
  const tie = (cmp: (a: T, b: T) => number) => (a: T, b: T) => {
    const r = cmp(a, b);
    return r !== 0 ? r : byId(a, b);
  };

  const lead: T[] = [];
  const rest: T[] = [];
  for (const t of tasks) {
    const tier = tierOf(t);
    (tier === 'A' || tier === 'B' ? lead : rest).push(t);
  }

  const leadOrdered = lead.slice().sort(tie((a, b) => {
    const ta = tierOf(a), tb = tierOf(b);
    if (ta !== tb) return ta === 'A' ? -1 : 1;
    return courseworkCompare(a, b);
  }));

  // Baseline: score decides the whole of the rest, so an assignment can never take a
  // slot from higher-scoring non-assignment work.
  const restOrdered = rest.slice().sort(tie(scoreCompare));

  // Then permute the assignments WITHIN the slots score already gave them, so they read
  // in coursework order without displacing anything.
  const slots: number[] = [];
  const assignmentsInRest: T[] = [];
  restOrdered.forEach((t, i) => {
    if (tierOf(t) !== null) { slots.push(i); assignmentsInRest.push(t); }
  });
  assignmentsInRest.sort(tie(courseworkCompare));
  slots.forEach((slot, k) => { restOrdered[slot] = assignmentsInRest[k]; });

  return [...leadOrdered, ...restOrdered];
}

/**
 * The same ordering, exposed as a comparator over THIS candidate set — the shape
 * `Array.prototype.sort` wants, and the shape the transitivity/antisymmetry axiom tests
 * need. It compares precomputed ranks, so it cannot be intransitive. A task absent from
 * the set the ranks were built from falls back to the id order rather than to 0, so an
 * unknown pair still yields a total order instead of a silent cycle.
 */
export function schedulingCandidateOrder<T>(
  tasks: T[],
  opts: SchedulingCandidateOrderOptions<T>,
): (a: T, b: T) => number {
  const rank = new Map<string, number>();
  orderSchedulingCandidates(tasks, opts).forEach((t, i) => rank.set(String(opts.idOf(t)), i));
  return (a: T, b: T): number => {
    const ra = rank.get(String(opts.idOf(a)));
    const rb = rank.get(String(opts.idOf(b)));
    if (ra === undefined || rb === undefined) {
      return String(opts.idOf(a)).localeCompare(String(opts.idOf(b)));
    }
    return ra - rb;
  };
}

/** The candidate row shape the nightly builder sorts (a `public.tasks` row + `score`). */
export interface SchedulingTask {
  id: string;
  title?: string | null;
  due_date?: string | null;
  score?: number;
  is_priority?: boolean | null;
  priority_rank?: number | null;
  assignment_id?: string | null;
  [k: string]: unknown;
}

export interface BuilderCandidateOrderOptions extends CourseworkOrderOptions {
  /** Per-user Settings toggle. 'composite' is the default; 'priority-rank' is legacy. */
  scoringModel: 'composite' | 'priority-rank';
  /** taskId -> deadline tier, as computed by the builder. A row missing from this map
   *  that still carries an `assignment_id` is treated as tier C, matching the builder. */
  assignmentTier: Record<string, 'A' | 'B' | 'C'>;
}

/**
 * THE ORDER THE NIGHTLY BUILDER PLACES WORK IN — one exported entry point, so the
 * builder and its tests run the SAME code rather than two reconstructions of it.
 *
 * This exists as a named export specifically because of the failure recorded in
 * `.claude/accuracy-log.md`: a previous round proved its ordering with a unit test on
 * `courseworkOrder` in isolation while the real defect lived in the builder's COMPOSED
 * comparator, which the test never touched. Anything asserting placement order must
 * call this, not `courseworkOrder`.
 */
export function orderBuilderCandidates<T extends SchedulingTask>(
  tasks: T[],
  opts: BuilderCandidateOrderOptions,
): T[] {
  return orderSchedulingCandidates(tasks, builderOrderParts<T>(opts));
}

/** The same ordering as a comparator, for axiom (antisymmetry / transitivity) tests. */
export function builderCandidateComparator<T extends SchedulingTask>(
  tasks: T[],
  opts: BuilderCandidateOrderOptions,
): (a: T, b: T) => number {
  return schedulingCandidateOrder(tasks, builderOrderParts<T>(opts));
}

function builderOrderParts<T extends SchedulingTask>(
  opts: BuilderCandidateOrderOptions,
): SchedulingCandidateOrderOptions<T> {
  const { scoringModel, assignmentTier, ...courseworkOpts } = opts;
  const coursework = courseworkOrder(courseworkOpts);
  return {
    idOf: (t) => String(t.id),
    tierOf: (t) => (t.assignment_id ? (assignmentTier[String(t.id)] || 'C') : null),
    courseworkCompare: (a, b) => coursework(a as unknown as NexusAssignment, b as unknown as NexusAssignment),
    // The score branch, moved here VERBATIM from nightly-schedule-builder/index.ts so
    // there is one copy. Tier A/B are handled by the tier partition above and never
    // reach this; it decides ordinary-assignment-vs-non-assignment and non-vs-non.
    scoreCompare: (a, b) => {
      const aPri = a.is_priority ? 1 : 0;
      const bPri = b.is_priority ? 1 : 0;
      const aScore = a.score ?? 0;
      const bScore = b.score ?? 0;
      if (scoringModel === 'composite') {
        // COMPOSITE: composite score leads (recency/deadline/finance already baked in);
        // is_priority / priority_rank are only lower tiebreakers.
        if (bScore !== aScore) return bScore - aScore;
        if (aPri !== bPri) return bPri - aPri;
        const aRankC = a.priority_rank ?? 9999;
        const bRankC = b.priority_rank ?? 9999;
        if (aRankC !== bRankC) return aRankC - bRankC;
      } else {
        // PRIORITY-RANK (legacy): is_priority -> priority_rank -> score -> due ASC.
        if (aPri !== bPri) return bPri - aPri;
        if (aPri && bPri) {
          const aRank = a.priority_rank ?? 9999;
          const bRank = b.priority_rank ?? 9999;
          if (aRank !== bRank) return aRank - bRank;
        }
        if (bScore !== aScore) return bScore - aScore;
      }
      // due_date ASC NULLS LAST
      if (a.due_date && b.due_date) {
        return new Date(String(a.due_date)).getTime() - new Date(String(b.due_date)).getTime();
      }
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return 0;
    },
  };
}

/**
 * Fetch a user's assignments from Nexus.
 *
 * NEVER THROWS. Nexus being unreachable must not take down a nightly run, an agent turn,
 * or a page render, so every failure is logged and yields an empty list. Callers that
 * need to distinguish "no assignments" from "Nexus is down" should use fetchNexusAssignmentsResult.
 */
export async function fetchNexusAssignments(
  userId: string,
  opts: FetchAssignmentsOptions = {},
): Promise<NexusAssignment[]> {
  return (await fetchNexusAssignmentsResult(userId, opts)).assignments;
}

export async function fetchNexusAssignmentsResult(
  userId: string,
  opts: FetchAssignmentsOptions = {},
): Promise<{ assignments: NexusAssignment[]; ok: boolean; error?: string }> {
  const { courseIds, programId, openOnly = true, requiredOnly = false } = opts;
  // One request per course id (course_id is a whitelisted equality filter, not an IN),
  // or a single unfiltered request when no course scope was given.
  const scopes: Array<Record<string, string>> = courseIds?.length
    ? courseIds.map((id) => ({ course_id: id }))
    : [{}];

  const out: NexusAssignment[] = [];
  let ok = true;
  let error: string | undefined;

  for (const scope of scopes) {
    const qs = new URLSearchParams({ owner: userId, ...scope });
    if (programId) qs.set('program_id', programId);
    const url = `${NEXUS_API}/api/d1/assignments?${qs.toString()}`;
    try {
      const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) {
        ok = false;
        error = `${res.status} ${(await res.text()).slice(0, 200)}`;
        console.error(`[NEXUS] assignments fetch failed (${JSON.stringify(scope)}): ${error}`);
        continue;
      }
      const body = await res.json();
      // handleGet returns { rows: [...] }; tolerate a bare array in case that changes.
      const rows: NexusAssignment[] = Array.isArray(body) ? body : (body?.rows ?? body?.data ?? []);
      out.push(...rows);
    } catch (e) {
      ok = false;
      error = e instanceof Error ? e.message : String(e);
      console.error(`[NEXUS] assignments fetch threw (${JSON.stringify(scope)}):`, error);
    }
  }

  let filtered = out;
  if (openOnly) {
    filtered = filtered.filter((a) => !OPEN_EXCLUDED.includes(String(a?.status ?? '')));
  }
  if (requiredOnly) filtered = filtered.filter(isRequiredAssignment);

  return { assignments: filtered, ok, error };
}
