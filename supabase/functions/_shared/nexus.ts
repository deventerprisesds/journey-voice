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

export const NEXUS_API =
  Deno.env.get('NEXUS_API_URL') || 'https://nexus-hub-api.azurewebsites.net';

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
