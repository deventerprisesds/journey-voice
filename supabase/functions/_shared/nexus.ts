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
// COURSEWORK ORDER — four bands, deliberately does NOT lead with the oldest
// ---------------------------------------------------------------------------
/**
 * The order coursework should be worked in (owner-specified 2026-09-03):
 *
 *   1. UPCOMING SOON      due within `soonDays`      -> soonest first
 *   2. RECENTLY OVERDUE   missed within `recentDays` -> most recent miss first
 *   3. FUTURE BEYOND      due after `soonDays`       -> soonest first
 *   4. OLD                missed before `recentDays` -> most recent first, oldest last
 *
 * WHY NOT PLAIN DUE-DATE ASC (what this replaced): with the full Nexus history visible,
 * ascending order is dominated by a multi-year backlog. Measured 2026-09-03 the agent
 * tool returned 30 rows ALL dated 21-27 January 2025 and the user's live course did not
 * appear at all. Sorting by "most overdue" is the same trap: the oldest item is the
 * least likely to still matter, so it must not lead.
 *
 * Undated assignments sort after every dated one — they carry no deadline signal, and
 * defaulting them to "urgent" would let untracked items crowd out real deadlines.
 */
export interface CourseworkOrderOptions {
  now?: number;
  /** Horizon for band 1. */
  soonDays?: number;
  /** How far back a miss still counts as "recent" (band 2 vs band 4). */
  recentDays?: number;
}

export const DEFAULT_SOON_DAYS = 14;
export const DEFAULT_RECENT_OVERDUE_DAYS = 30;

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
  if (delta >= 0) return delta <= soon ? 1 : 3;
  return -delta <= recent ? 2 : 4;
}

/** Comparator implementing the four bands above. */
export function courseworkOrder(opts: CourseworkOrderOptions = {}) {
  const now = opts.now ?? Date.now();
  return (a: NexusAssignment, b: NexusAssignment): number => {
    const ba = courseworkBand(a, { ...opts, now });
    const bb = courseworkBand(b, { ...opts, now });
    if (ba !== bb) return ba - bb;
    if (ba === 5) return String(a.title ?? '').localeCompare(String(b.title ?? ''));
    const da = Date.parse(String(a.due_date));
    const db = Date.parse(String(b.due_date));
    // Bands 1 and 3 look forward (soonest first); 2 and 4 look back (most recent first).
    return ba === 1 || ba === 3 ? da - db : db - da;
  };
}

export const COURSEWORK_BAND_LABEL: Record<number, string> = {
  1: 'due soon',
  2: 'recently overdue',
  3: 'upcoming',
  4: 'old backlog',
  5: 'no due date',
};

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
