/**
 * NEXUS (Azure) ASSIGNMENTS — the frontend's single source for assignment data.
 *
 * WHY: nexus-hub moved `assignments` off Supabase to Azure on 2026-04-06. Supabase
 * `public.assignments` is a DEAD SNAPSHOT — measured 2026-08-29 it held 469 rows for the
 * primary user, every one `created_at` 2026-04-06, newest due 2026-06-23, and no cron
 * feeds it. The Assignments page, the task-creation picker and the sync utils were all
 * still reading it, so they showed a months-stale list with the user's current course
 * missing entirely. No mirror is being kept: journey reads Nexus live (owner decision,
 * 2026-08-29 — "nexus live no mirror needed, we will eventually be migrating away from
 * supabase").
 *
 * WHY A SECOND CLIENT rather than importing the edge function's `_shared/nexus.ts`:
 * that module is Deno (`Deno.env.get`, .ts specifiers) and cannot be imported by the Vite
 * browser build. This mirrors the existing, deliberate split between
 * `supabase/functions/_shared/scheduling-defaults.ts` and `src/config/schedulingRules.ts`.
 * Keep the two in sync when the Nexus contract changes.
 *
 * WHY FETCH-ALL-THEN-FILTER: the d1 API's filter grammar supports eq/gte/gt/lte/lt/neq/
 * like/ilike/is but has no `IN`, while callers filter by id lists, title, program and due
 * ranges. One owner-scoped request (a few hundred rows) filtered in memory is simpler and
 * far less brittle than encoding each caller's predicate into the query string — and it
 * lets the short cache below serve every consumer on a page from a single round trip.
 *
 * READS ONLY. Nexus requires a VERIFIED owner for writes (`requireWrite`); the browser's
 * unverified `?owner=` is read-only by design. Nothing here writes, and nothing in the
 * frontend wrote to `assignments` before this change either.
 */

const NEXUS_API =
  (import.meta as any).env?.VITE_NEXUS_API_URL || 'https://nexus-hub-api.azurewebsites.net';

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
  /** d1 re-attaches this embed for any course_id-bearing table. */
  courses?: { id: string; name: string; code: string } | null;
  [k: string]: unknown;
}

/** Short per-owner cache so a page rendering several assignment views makes ONE request.
 *  Deliberately brief — this is live data, not a mirror. */
const TTL_MS = 30_000;
const cache = new Map<string, { at: number; rows: NexusAssignment[] }>();

export function invalidateNexusAssignments(userId?: string) {
  if (userId) cache.delete(userId);
  else cache.clear();
}

/**
 * All of an owner's assignments, live from Nexus.
 *
 * THROWS on failure. Callers rendering a list must show an error state rather than an
 * empty one — "we couldn't reach the assignments service" and "you have no assignments"
 * are different facts and must not look identical to the user.
 */
export async function fetchNexusAssignments(
  userId: string,
  opts: { force?: boolean } = {},
): Promise<NexusAssignment[]> {
  if (!userId) return [];
  const hit = cache.get(userId);
  if (!opts.force && hit && Date.now() - hit.at < TTL_MS) return hit.rows;

  const url = `${NEXUS_API}/api/d1/assignments?owner=${encodeURIComponent(userId)}`;
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) {
    throw new Error(`Nexus assignments fetch failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const body = await res.json();
  // handleGet returns { rows: [...] }; tolerate a bare array if that ever changes.
  const rows: NexusAssignment[] = Array.isArray(body) ? body : (body?.rows ?? body?.data ?? []);
  cache.set(userId, { at: Date.now(), rows });
  return rows;
}

/** Same as fetchNexusAssignments but never throws — for non-critical/background callers
 *  where a failure should degrade quietly rather than break a flow. */
export async function fetchNexusAssignmentsSafe(userId: string): Promise<NexusAssignment[]> {
  try {
    return await fetchNexusAssignments(userId);
  } catch (e) {
    console.error('[nexus] assignments fetch failed:', e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Filters — the predicates the Supabase queries used to express server-side.
// ---------------------------------------------------------------------------

const CLOSED = ['completed', 'graded'];

export const isOpen = (a: NexusAssignment) => !CLOSED.includes(String(a.status ?? ''));

export const inProgram = (a: NexusAssignment, programId: string) => a.program_id === programId;

/** Mirrors the old `.or('program_id.is.null,program_id.neq.<MIT>')` — everything that is
 *  not MIT, including rows with no program at all. */
export const notInProgram = (a: NexusAssignment, programId: string) =>
  a.program_id == null || a.program_id !== programId;

export const dueBetween = (a: NexusAssignment, fromISO?: string | null, toISO?: string | null) => {
  if (!a.due_date) return false; // matches SQL: NULL fails a range comparison
  const d = new Date(a.due_date).getTime();
  if (fromISO && d < new Date(fromISO).getTime()) return false;
  if (toISO && d > new Date(toISO).getTime()) return false;
  return true;
};

export const titleNotLike = (a: NexusAssignment, needle: string) =>
  !String(a.title ?? '').toLowerCase().includes(needle.toLowerCase());

export const byIds = (rows: NexusAssignment[], ids: Array<string | number>) => {
  const want = new Set(ids.map(String));
  return rows.filter((a) => want.has(String(a.id)));
};
