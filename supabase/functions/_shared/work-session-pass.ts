// WHAT:       The I/O half of P3/P4: read the owner's assignment cards, session cards, calendar and
//             settings; run the pure planner (work-sessions.ts); in APPLY mode write the session cards,
//             re-time / retire them, tag at-risk parents and queue the one Iris warning; in DRY mode
//             write NOTHING and return the plan.
// WHY:        One code path for the nightly build (apply) and the dry run (preview), so the preview is the
//             real thing. Called by nightly-schedule-builder before its own passes, and by
//             nightly-assignment-sync `{dryRun:true}` with the not-yet-created intake cards as extra parents.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   docs/qc-evidence/FINDINGS-assignment-spreading.md build log (P3/P4).
//
// WHAT COUNTS AS BUSY, and why it is the same in both modes: the builder's STEP 1.1 clears every
// non-DONE scheduled task in the next 7 days and re-places it AFTER this pass. So those blocks are
// not obstacles for sessions. Busy = external calendar events that are NOT task-backed
// (`source_task_id` null) + scheduled non-session tasks the clear does not touch (DONE, or starting
// beyond the 7-day horizon, or already past) + hand-pinned sessions (handled in the planner).

import { localDateOf, localDateToUtcBounds } from './timezone.ts';
import { digestSendAt } from './assignment-intake.ts';
import { resolveConfig, resolveCategoryDailyCap, MAX_ASSIGNMENTS_PER_DAY } from './scheduling-defaults.ts';
import {
  planWorkSessions, courseworkWindowsFor, resolveSessionConfig, isSessionTask, buildSessionWarningLines,
  describeSessionPlan, type ParentTask, type SessionTask, type DayAvailability, type SessionPlan,
} from './work-sessions.ts';

const MAX_PLAN_DAYS = 120; // far enough for a semester; bounds the calendar read
const COURSEWORK = 'PROF_EDUCATION';

export interface SessionPassOptions {
  userId: string;
  timezone: string;
  userConfig: any;
  now: Date;
  mode: 'apply' | 'dry';
  horizonDays?: number;
  /** Not-yet-written intake cards (dry run of the sync): planned as parents, never written. */
  extraParents?: ParentTask[];
  /** Builder hook: delete app-originated calendar events of sessions about to move. */
  beforeRetime?: (tasks: Array<{ id: string; external_event_id?: string | null }>) => Promise<void>;
}

export interface SessionPassResult {
  enabled: boolean;
  plan: SessionPlan | null;
  managedIds: string[];
  placementsByDate: Record<string, number>;
  placedBlocks: Array<{ start_time: string; end_time: string }>;
  written: { created: number; retimed: number; unscheduled: number; tagged: number; warningQueued: boolean };
  summary: ReturnType<typeof describeSessionPlan> | null;
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export async function runWorkSessionPass(supabase: any, opts: SessionPassOptions): Promise<SessionPassResult> {
  const { userId, timezone: tz, userConfig, now, mode } = opts;
  const horizonDays = opts.horizonDays ?? 7;
  const config = resolveSessionConfig(userConfig);
  const empty: SessionPassResult = {
    enabled: config.enabled, plan: null, managedIds: [], placementsByDate: {}, placedBlocks: [],
    written: { created: 0, retimed: 0, unscheduled: 0, tagged: 0, warningQueued: false }, summary: null,
  };

  // ---- reads (all read-only) ----
  const { data: linked, error: linkedErr } = await supabase
    .from('tasks')
    .select('id, title, status, completed_at, assignment_id, due_date, estimate_minutes, tags, board_id, priority, category, start_time, end_time, scheduling_context, external_event_id')
    .eq('user_id', userId)
    .not('assignment_id', 'is', null);
  if (linkedErr) throw new Error(`session pass: task read failed: ${linkedErr.message}`);
  const rows = (linked ?? []) as any[];
  const sessions: SessionTask[] = rows.filter(isSessionTask);
  const parents: ParentTask[] = [...rows.filter((t) => !isSessionTask(t)), ...(opts.extraParents ?? [])];

  if (!config.enabled) {
    // Disabled in Settings: plan nothing, but keep existing session cards out of the builder's other passes.
    return { ...empty, managedIds: sessions.map((s) => s.id) };
  }

  const today = localDateOf(now.toISOString(), tz)!;
  const lastDue = parents
    .filter((p) => p.due_date && Date.parse(p.due_date) > now.getTime() && p.status !== 'DONE' && !p.completed_at)
    .map((p) => localDateOf(p.due_date!, tz)!)
    .sort()
    .pop();
  const nDays = lastDue ? Math.min(MAX_PLAN_DAYS, Math.max(1, Math.round((Date.parse(`${lastDue}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000) + 1)) : horizonDays;
  const lastDate = addDays(today, nDays - 1);
  const rangeStart = localDateToUtcBounds(today, tz).start;
  const rangeEnd = localDateToUtcBounds(lastDate, tz).end;
  const horizonEndMs = Date.parse(localDateToUtcBounds(addDays(today, horizonDays - 1), tz).end);

  const { data: events } = await supabase
    .from('external_calendar_events')
    .select('start_time, end_time, source_task_id, is_all_day')
    .eq('user_id', userId)
    .eq('is_all_day', false)
    .gte('start_time', rangeStart)
    .lt('start_time', rangeEnd);
  const { data: scheduled } = await supabase
    .from('tasks')
    .select('id, start_time, end_time, status, assignment_id, estimate_minutes')
    .eq('user_id', userId)
    .eq('is_scheduled', true)
    .gte('start_time', rangeStart)
    .lt('start_time', rangeEnd);

  const nowMs = now.getTime();
  const busyByDate = new Map<string, Array<{ start: number; end: number }>>();
  const fixedCourseworkByDate = new Map<string, number>();
  const addBusy = (startISO: string, endISO: string | null, minutes = 60) => {
    const start = Date.parse(startISO);
    const end = endISO ? Date.parse(endISO) : start + minutes * 60000;
    const date = localDateOf(startISO, tz)!;
    const list = busyByDate.get(date) ?? [];
    list.push({ start, end });
    busyByDate.set(date, list);
    return date;
  };
  for (const e of (events ?? []) as any[]) {
    if (e.source_task_id) continue; // a task's own calendar copy, not an obstacle (the task is re-placed)
    if (e.start_time) addBusy(e.start_time, e.end_time);
  }
  for (const t of (scheduled ?? []) as any[]) {
    if (!t.start_time || isSessionTask(t)) continue; // sessions: the planner decides
    const startMs = Date.parse(t.start_time);
    const survivesClear = t.status === 'DONE' || startMs >= horizonEndMs || startMs < nowMs;
    if (!survivesClear) continue;
    const date = addBusy(t.start_time, t.end_time, t.estimate_minutes || 60);
    if (t.assignment_id && t.status !== 'DONE') fixedCourseworkByDate.set(date, (fixedCourseworkByDate.get(date) ?? 0) + 1);
  }

  const { timeWindows, categoryMappings } = resolveConfig(userConfig);
  const days: DayAvailability[] = [];
  for (let i = 0; i < nDays; i++) {
    const date = addDays(today, i);
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    const cap = resolveCategoryDailyCap(userConfig, COURSEWORK, dow === 0 || dow === 6, { fallback: MAX_ASSIGNMENTS_PER_DAY });
    days.push({
      date,
      windows: courseworkWindowsFor(date, tz, timeWindows, categoryMappings, COURSEWORK),
      busy: busyByDate.get(date) ?? [],
      capRemaining: Math.max(0, (Number.isFinite(cap) ? cap : 99) - (fixedCourseworkByDate.get(date) ?? 0)),
    });
  }

  const plan = planWorkSessions({ parents, sessions, days, now, timezone: tz, config, horizonDays });
  const summary = describeSessionPlan(plan, tz);
  const placedBlocks: Array<{ start_time: string; end_time: string }> = [];
  for (const c of plan.creates) if (c.placement.start) placedBlocks.push({ start_time: c.placement.start, end_time: c.placement.end! });
  for (const r of plan.retimes) if (r.placement.start) placedBlocks.push({ start_time: r.placement.start, end_time: r.placement.end! });
  const result: SessionPassResult = {
    enabled: true, plan, managedIds: plan.managedIds, placementsByDate: plan.placementsByDate, placedBlocks,
    written: { created: 0, retimed: 0, unscheduled: 0, tagged: 0, warningQueued: false }, summary,
  };
  // Pinned sessions inside the horizon count toward the builder's per-day coursework tally too.
  for (const a of plan.assignments) {
    for (const p of a.placed) {
      if (p.kind === 'pinned' && p.start && Date.parse(p.start) < horizonEndMs) {
        result.placementsByDate[p.date] = (result.placementsByDate[p.date] ?? 0) + 1;
      }
    }
  }
  if (mode === 'dry') return result;

  // ---- writes (apply mode only) ----
  const userIdFor = (insert: Record<string, unknown>) => ({ ...insert, user_id: userId });
  if (plan.creates.length) {
    const { data, error } = await supabase.from('tasks').insert(plan.creates.map((c) => userIdFor(c.insert))).select('id');
    if (error) console.error('[SESSIONS] insert failed:', error);
    else result.written.created = data?.length ?? 0;
  }
  const byId = new Map(sessions.map((x) => [x.id, x]));
  const moving = [...plan.retimes.map((r) => r.taskId), ...plan.unschedules.map((u) => u.taskId)]
    .map((id) => ({ id, external_event_id: byId.get(id)?.external_event_id ?? null }))
    .filter((t) => t.external_event_id);
  if (opts.beforeRetime && moving.length) {
    try { await opts.beforeRetime(moving); } catch (e) { console.warn('[SESSIONS] calendar cleanup failed (non-fatal):', e); }
  }
  for (const r of plan.retimes) {
    // Guarded: a session the owner marked DONE between the read and this write is never touched.
    const { data, error } = await supabase.from('tasks').update({ ...r.patch, external_event_id: null })
      .eq('id', r.taskId).neq('status', 'DONE').is('completed_at', null).select('id');
    if (!error && data?.length) result.written.retimed++;
  }
  for (const u of plan.unschedules) {
    const { data, error } = await supabase.from('tasks').update({ ...u.patch, external_event_id: null })
      .eq('id', u.taskId).neq('status', 'DONE').is('completed_at', null).select('id');
    if (!error && data?.length) result.written.unscheduled++;
  }
  for (const tp of plan.parentTagPatches) {
    const { error } = await supabase.from('tasks').update({ tags: tp.tags, updated_at: now.toISOString() })
      .eq('id', tp.taskId).neq('status', 'DONE').is('completed_at', null);
    if (!error) result.written.tagged++;
  }

  const lines = buildSessionWarningLines(plan, tz);
  if (lines.length) result.written.warningQueued = await queueWarning(supabase, userId, lines, now, tz);
  return result;
}

/**
 * P4: at most ONE Iris message per night. If tonight's intake digest (source 'assignment_sync') is still
 * queued and undelivered, the warning lines are appended to it; otherwise one new scheduled_chat row,
 * held to the end of quiet hours exactly like the digest.
 */
async function queueWarning(supabase: any, userId: string, lines: string[], now: Date, tz: string): Promise<boolean> {
  const block = `Heads up on your coursework plan:\n\n${lines.join('\n')}`;
  const since = new Date(now.getTime() - 6 * 3600000).toISOString();
  const { data: pending } = await supabase
    .from('scheduled_notifications')
    .select('id, body, metadata, scheduled_for')
    .eq('user_id', userId)
    .eq('notification_type', 'scheduled_chat')
    .is('delivered_at', null)
    .is('failed_at', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5);
  const digest = (pending ?? []).find((n: any) => n?.metadata?.source === 'assignment_sync');
  if (digest) {
    const message = `${digest.metadata.message ?? digest.body}\n\n${block}`;
    const { error } = await supabase.from('scheduled_notifications')
      .update({ body: message, metadata: { ...digest.metadata, message, session_warnings: lines } })
      .eq('id', digest.id).is('delivered_at', null);
    return !error;
  }
  const { data: prefs } = await supabase.from('notification_prefs')
    .select('quiet_hours_start, quiet_hours_end').eq('user_id', userId).maybeSingle();
  const sendAt = digestSendAt(now, tz, prefs?.quiet_hours_start, prefs?.quiet_hours_end);
  const { error } = await supabase.from('scheduled_notifications').insert({
    user_id: userId, notification_type: 'scheduled_chat', scheduled_for: sendAt,
    title: 'Coursework plan: needs attention', body: block,
    metadata: { message: block, source: 'assignment_sessions', session_warnings: lines },
  });
  return !error;
}
