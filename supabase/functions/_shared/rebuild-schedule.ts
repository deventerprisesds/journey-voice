// WHAT:       rebuild_schedule — lets an agent re-run the scheduling job (nightly-schedule-builder) for
//             the CALLER only. action "start" (default) KICKS the job in the background and returns at once;
//             action "status" reports whether that run has finished (read from activity_log, the row the
//             builder itself writes on completion or failure). scope "today" = the app's "Reschedule today"
//             button (singleDay); "week" = the same 7-day run the nightly cron does, just now.
// WHY:        2026-11-07 the owner asked Iris "I want you to re run the scheduling job" and she could not.
//             v1 (journey-voice#100) then ran the builder SYNCHRONOUSLY; the rebuild takes longer than
//             Huddle's 30s per-tool cap (and the ~45s hosting ceiling), so Iris reported "timed out after 30
//             seconds" while the job actually finished (chat.pending_turns u-1794079732903 / u-1794079983154).
//             Owner: "It has to be able to run such a job and get around the 30 second timeout... I thought
//             we landed an approach for long running jobs". The landed approach is: never wait inside one
//             request -- start it in the background (EdgeRuntime.waitUntil, as drain-huddle-turns and
//             run-scheduled-ceremonies do) and report the result in a later turn.
// SUPERSEDES: the synchronous v1 of this file (5b67201). SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   src/components/FocusView.tsx handleRescheduleToday (same body {userId, singleDay:true}, same
//             completion signal: an activity_log row with activity_type 'nightly_schedule_built').

export interface FetchLike {
  (url: string, init: { method: string; headers: Record<string, string>; body: string }): Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<any>;
  }>;
}

export interface BuildRow {
  status: string | null;
  created_at: string;
  metadata: any;
}

export interface RebuildDeps {
  supabaseUrl: string;
  serviceKey: string;
  fetch: FetchLike;
  /** Keep the background run alive after the response returns (EdgeRuntime.waitUntil). */
  waitUntil: (p: Promise<unknown>) => void;
  /** Newest nightly_schedule_built row for this user created at/after sinceIso, or null. */
  latestBuildSince: (userId: string, sinceIso: string) => Promise<BuildRow | null>;
  /** Newest 'schedule_rebuild_requested' row for this user at/after sinceIso, or null. */
  latestRequestSince: (userId: string, sinceIso: string) => Promise<{ created_at: string; metadata: any } | null>;
  /** Record that a rebuild was requested (the "one at a time" guard reads it back). */
  recordRequest: (userId: string, scope: RebuildScope, startedAt: string) => Promise<void>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export type RebuildScope = 'today' | 'week';
export type ToolResult = Record<string, unknown> & { success: boolean };

/** How long a status check waits for the run to land before saying "still running". Well under 30s. */
export const STATUS_WAIT_MS = 20_000;
export const STATUS_POLL_MS = 4_000;
/**
 * One rebuild at a time per user. A run takes 66-196s (activity_log, 2026-11-05..07); on 2026-11-07 one
 * conversation fired three overlapping rebuilds in 80s and the overlapping week run cleared Nov 8's
 * placements without finishing (VERIFY-rebuild-schedule-tool-1.md). A start inside this window whose
 * request has no completion row yet is refused, not stacked.
 */
export const IN_FLIGHT_WINDOW_MS = 5 * 60_000;

export function normaliseScope(v: unknown): RebuildScope {
  return v === 'week' ? 'week' : 'today';
}

/** The exact body nightly-schedule-builder receives. userId is ALWAYS the caller — never from args. */
export function buildRebuildBody(userId: string, scope: RebuildScope) {
  return {
    userId,
    singleDay: scope === 'today',
    triggerSource: scope === 'today' ? 'agent_reschedule_today' : 'agent_rebuild_week',
  };
}

function describe(scope: RebuildScope) {
  return scope === 'today' ? "today's schedule" : 'the schedule for the next 7 days';
}

export async function rebuildSchedule(deps: RebuildDeps, userId: string, args: any): Promise<ToolResult> {
  if (!userId) return { success: false, error: 'No user to rebuild the schedule for.' };
  if (args?.action === 'status') return rebuildStatus(deps, userId, args);
  if (args?.user_explicitly_requested !== true) {
    return {
      success: false,
      error:
        'Not run: rebuilding clears and re-places scheduled times, so it only runs when the user explicitly asked to re-run or rebuild the schedule in this conversation. Ask them first.',
    };
  }
  const scope = normaliseScope(args?.scope);
  const now = deps.now ?? Date.now;
  const inFlight = await deps.latestRequestSince(userId, new Date(now() - IN_FLIGHT_WINDOW_MS).toISOString());
  if (inFlight) {
    const doneSince = await deps.latestBuildSince(userId, inFlight.created_at);
    if (!doneSince) {
      const prevStarted = inFlight.metadata?.started_at ?? inFlight.created_at;
      return {
        success: false,
        already_running: true,
        running_since: prevStarted,
        error: `A schedule rebuild is already running (started ${prevStarted}); a second one would overlap and clobber it, so none was started. Tell the user it is still running; use action "status" with since "${prevStarted}" to check it.`,
      };
    }
  }
  // One second earlier than the kick, so the builder's own completion row is always "since" this.
  const startedAt = new Date(now() - 1000).toISOString();
  const run = (async () => {
    try {
      await deps.fetch(`${deps.supabaseUrl}/functions/v1/nightly-schedule-builder`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${deps.serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRebuildBody(userId, scope)),
      });
    } catch (e) {
      // The builder writes its own error row on failure; a transport failure leaves none, so the
      // status check reports "not finished" and the agent tells the user rather than claiming success.
      console.error('[rebuild_schedule] builder call failed:', e instanceof Error ? e.message : String(e));
    }
  })();
  try {
    await deps.recordRequest(userId, scope, startedAt);
  } catch (_) {
    /* the guard is best-effort; never block the user's rebuild on its bookkeeping row */
  }
  deps.waitUntil(run);
  return {
    success: true,
    started: true,
    scope,
    started_at: startedAt,
    message: `Started rebuilding ${describe(scope)}. It runs in the background and usually takes a minute or two; the result is not in yet, so do NOT say it is done. Tell the user it has started and that you will report back. To find out, call rebuild_schedule with action "status" and since "${startedAt}".`,
  };
}

export async function rebuildStatus(deps: RebuildDeps, userId: string, args: any): Promise<ToolResult> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const sinceMs = Date.parse(String(args?.since ?? ''));
  // No usable "since": look back 15 minutes — never further, so an old nightly run can't pass as this one.
  const since = new Date(Number.isFinite(sinceMs) ? sinceMs : now() - 15 * 60_000).toISOString();
  const deadline = now() + Math.max(0, Math.min(Number(args?.wait_ms ?? STATUS_WAIT_MS), STATUS_WAIT_MS));
  let row = await deps.latestBuildSince(userId, since);
  while (!row && now() < deadline) {
    await sleep(STATUS_POLL_MS);
    row = await deps.latestBuildSince(userId, since);
  }
  if (!row) {
    return {
      success: true,
      finished: false,
      since,
      message: 'The schedule rebuild has not finished yet. Tell the user it is still running; do not say it is done.',
    };
  }
  const m = row.metadata ?? {};
  if (row.status === 'error' || m.error) {
    return { success: false, finished: true, since, error: `The schedule rebuild failed: ${m.error ?? 'unknown error'}` };
  }
  const placed = typeof m.total_scheduled === 'number' ? m.total_scheduled : null;
  const scope: RebuildScope = m.singleDay === false ? 'week' : 'today';
  return {
    success: true,
    finished: true,
    since,
    scope,
    totalScheduled: placed,
    daysProcessed: m.days_processed ?? null,
    finishedAt: row.created_at,
    message: `Rebuilt ${describe(scope)}${placed === null ? '' : ` — ${placed} task${placed === 1 ? '' : 's'} placed`}. Read the schedule again before describing it.`,
  };
}

/** Production deps from execute-tool's service-role client. */
export function makeRebuildDeps(supabase: any, supabaseUrl: string, serviceKey: string, fetchImpl: FetchLike): RebuildDeps {
  return {
    supabaseUrl,
    serviceKey,
    fetch: fetchImpl,
    waitUntil: (p) => {
      try {
        // deno-lint-ignore no-explicit-any
        (globalThis as any).EdgeRuntime.waitUntil(p);
      } catch (_) {
        /* local dev: the promise still runs, it just isn't held open */
      }
    },
    latestRequestSince: async (userId, sinceIso) => {
      const { data } = await supabase
        .from('activity_log')
        .select('created_at, metadata')
        .eq('user_id', userId)
        .eq('activity_type', 'schedule_rebuild_requested')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(1);
      return (data && data[0]) || null;
    },
    recordRequest: async (userId, scope, startedAt) => {
      await supabase.from('activity_log').insert({
        user_id: userId,
        activity_type: 'schedule_rebuild_requested',
        status: 'started',
        metadata: { scope, started_at: startedAt, source: 'agent_tool' },
      });
    },
    latestBuildSince: async (userId, sinceIso) => {
      const { data } = await supabase
        .from('activity_log')
        .select('status, created_at, metadata')
        .eq('user_id', userId)
        .eq('activity_type', 'nightly_schedule_built')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(1);
      return (data && data[0]) || null;
    },
  };
}
