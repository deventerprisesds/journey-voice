// WHAT:       rebuild_schedule — lets an agent re-run the scheduling job (nightly-schedule-builder) for
//             the CALLER only: scope "today" = the app's "Reschedule today" button (singleDay), scope
//             "week" = the same 7-day run the nightly cron does, just now.
// WHY:        2026-11-07 the owner asked Iris "I want you to re run the scheduling job" and she had to
//             answer "I can't directly trigger the nightly scheduling job from this chat" — the job was
//             only reachable from the app's buttons and the 05:00 UTC cron. Owner: "This needs to be
//             fixed right away."
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   src/components/FocusView.tsx handleRescheduleToday (same body: {userId, singleDay:true});
//             nightly-schedule-builder/index.ts serve() (body.userId filter, singleDay, triggerSource).

export interface FetchLike {
  (url: string, init: { method: string; headers: Record<string, string>; body: string }): Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<any>;
  }>;
}

export interface RebuildDeps {
  supabaseUrl: string;
  serviceKey: string;
  fetch: FetchLike;
}

export type RebuildScope = 'today' | 'week';
export type ToolResult = Record<string, unknown> & { success: boolean };

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

export async function rebuildSchedule(deps: RebuildDeps, userId: string, args: any): Promise<ToolResult> {
  if (!userId) return { success: false, error: 'No user to rebuild the schedule for.' };
  if (args?.user_explicitly_requested !== true) {
    return {
      success: false,
      error:
        'Not run: rebuilding clears and re-places scheduled times, so it only runs when the user explicitly asked to re-run or rebuild the schedule in this conversation. Ask them first.',
    };
  }
  const scope = normaliseScope(args?.scope);
  let res;
  try {
    res = await deps.fetch(`${deps.supabaseUrl}/functions/v1/nightly-schedule-builder`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${deps.serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRebuildBody(userId, scope)),
    });
  } catch (e) {
    return { success: false, error: `The scheduling job could not be reached: ${e instanceof Error ? e.message : String(e)}` };
  }
  let payload: any = null;
  try { payload = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    return { success: false, error: `The scheduling job failed (HTTP ${res.status})${payload?.error ? `: ${payload.error}` : ''}.` };
  }
  const r = payload?.results?.[userId];
  if (!r) {
    return {
      success: false,
      error: payload?.message
        ? `The scheduling job did not run for this account: ${payload.message}`
        : 'The scheduling job returned no result for this account.',
    };
  }
  if (r.skipped === 'nightly_schedule_off') {
    return {
      success: false,
      scope,
      error: 'The scheduling job is switched off for this account, so nothing was rebuilt. It can be switched back on in scheduling settings.',
    };
  }
  if (r.error) return { success: false, scope, error: `The scheduling job ran but failed: ${r.error}` };
  const placed = typeof r.totalScheduled === 'number' ? r.totalScheduled : null;
  const what = scope === 'today' ? "today's schedule" : 'the schedule for the next 7 days';
  return {
    success: true,
    scope,
    totalScheduled: placed,
    daysProcessed: r.daysProcessed ?? null,
    rolledOver: r.rolledOver ?? null,
    runId: r.runId ?? null,
    message: `Rebuilt ${what}${placed === null ? '' : ` — ${placed} task${placed === 1 ? '' : 's'} placed`}. Read the schedule again before describing it.`,
  };
}
