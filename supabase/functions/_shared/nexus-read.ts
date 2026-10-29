// WHAT:       The READ-ONLY Nexus (nexus-hub, Azure) assignments client: one GET of
//             `content.assignments` for one owner, through nexus-hub-api `/api/d1/assignments`.
// WHY:        TaskOS read its coursework from journey's own Supabase `public.assignments`, a table
//             frozen on 2026-04-06 (EMBA/MIT only, newest row 04-06). The owner's DBA assignments live
//             in Nexus `content.assignments`, so the nightly sync scanned 469 dead rows a night and
//             created 0 tasks (live activity_log 2026-10-28: created 0, skipped 469). The owner:
//             "Part of the problem may be not pointing to the correct tables in nexus from taskos."
// SUPERSEDES: nothing on main. It is the READ half only of the parked branch
//             claude/huddle-journey-integration-xokgv1 `_shared/nexus.ts` (fetchNexusAssignmentsResult);
//             the write client, the UAT token and the coursework ordering there are NOT brought in.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   docs/qc-evidence/FINDINGS-assignment-spreading.md §1, §5 P1; nexus-hub
//             api/src/functions/d1.ts handleGet (SELECT * + attachCourses → `{ rows }`, each row
//             carrying `courses: {id, name, code}`) and api/src/lib/auth.ts resolveOwner step 4.
//
// AUTH — NO TOKEN, NO NEW SECRET. nexus-hub's resolveOwner accepts an unverified `?owner=<uuid>` for
// READS (step 4). Writes need a verified owner and are deliberately absent from this file. The
// unverified read is a pre-existing nexus-hub design decision, not something journey introduces.
// `NEXUS_API_URL` is optional: the API host is public, so the default below is used when it is unset.

// Guarded rather than a bare `Deno.env.get(...)`, so this module is importable by node's test runner.
export const NEXUS_API_DEFAULT = 'https://nexus-hub-api.azurewebsites.net';
export function nexusApiBase(): string {
  const env = typeof Deno !== 'undefined' ? Deno.env.get('NEXUS_API_URL') : undefined;
  return (env && env.trim()) || NEXUS_API_DEFAULT;
}

/** The fields of a `content.assignments` row this repo reads (the API returns `SELECT *`). */
export interface NexusAssignmentRow {
  id: string;
  user_id?: string;
  course_id: string | null;
  program_id?: string | null;
  title: string;
  description?: string | null;
  status: string | null;
  due_date: string | null;
  priority?: string | null;
  points?: number | null;
  level_of_effort?: string | null;
  assignment_url?: string | null;
  courses?: { id: string; name: string | null; code: string | null } | null;
  [k: string]: unknown;
}

export interface NexusReadResult {
  ok: boolean;
  rows: NexusAssignmentRow[];
  status?: number;
  error?: string;
}

type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

/**
 * Every assignment row Nexus holds for `ownerId`. Never throws: an unreachable or failing API comes
 * back as `{ ok: false }` so the caller can refuse to act on it (a sync that "succeeds" on no data
 * would be the silent-green this replaces).
 */
export async function fetchNexusAssignments(
  ownerId: string,
  opts: { fetchImpl?: FetchLike; baseUrl?: string; timeoutMs?: number } = {},
): Promise<NexusReadResult> {
  const doFetch: FetchLike = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const base = (opts.baseUrl ?? nexusApiBase()).replace(/\/+$/, '');
  const url = `${base}/api/d1/assignments?${new URLSearchParams({ owner: ownerId }).toString()}`;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000) : null;
  try {
    const res = await doFetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      ...(ctrl ? { signal: ctrl.signal } : {}),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, rows: [], status: res.status, error: text.slice(0, 300) };
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      return { ok: false, rows: [], status: res.status, error: 'non-JSON response from Nexus' };
    }
    // handleGet returns { rows: [...] }; a bare array is tolerated in case that changes.
    const rows = Array.isArray(body) ? body : (body as any)?.rows;
    if (!Array.isArray(rows)) {
      return { ok: false, rows: [], status: res.status, error: 'Nexus response had no rows array' };
    }
    return { ok: true, rows: rows as NexusAssignmentRow[], status: res.status };
  } catch (e) {
    return { ok: false, rows: [], error: e instanceof Error ? e.message : String(e) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
