/**
 * Server-side mirror of `src/utils/buildDayContext.ts`.
 *
 * Builds the same structured DAY_CONTEXT JSON used by the client Daily Review
 * modal, but from edge-function context (e.g. when the voice/phone agent or a
 * scheduled task needs to ground a chat turn without the browser sending the
 * snapshot). Keeps a single contract: the agent always sees what the user sees.
 *
 * NOTE: We deliberately keep this lean — it does NOT recompute scoring (that
 * lives in `_shared/scheduling-defaults.ts` and the client's
 * `schedulingCandidates.explainSchedulingScore`). When server-built, score
 * fields are populated from `tasks.scheduling_context.score_breakdown` if
 * present, otherwise omitted.
 */

export interface DayContextScheduleItem {
  id: string;
  title: string;
  start: string | null;
  end: string | null;
  startLocal: string | null;
  window: string;
  category: string;
  priority: string;
  status: string;
  score: number | null;
  isAuto: boolean;
  externalEventId?: string | null;
  assignmentId?: string | null;
  assignmentUrl?: string | null;
  pushedCount: number;
  isPriority: boolean;
  priorityRank: number | null;
}

export interface DayContextGap {
  startHour: number;
  endHour: number;
  durationMin: number;
  window: string;
}

export interface DayContextPendingAssignment {
  taskId: string;
  title: string;
  dueDate: string | null;
  programId: string | null;
  url: string | null;
  hasLinkedTask: boolean;
  scheduledToday: boolean;
}

export interface DayContextPriorityItem {
  id: string;
  title: string;
  rank: number | null;
  scheduledToday: boolean;
}

export interface DayContextCalendarHold {
  id: string;
  title: string;
  start: string;
  end: string;
  startLocal: string;
  endLocal: string;
}

export interface DayContext {
  date: string;
  timezone: string;
  isWeekend: boolean;
  currentWindow: string;
  schedule: DayContextScheduleItem[];
  gaps: DayContextGap[];
  priorityLane: DayContextPriorityItem[];
  rolledOver: Array<{ id: string; title: string }>;
  overdue: Array<{ id: string; title: string; dueDate: string | null }>;
  pendingAssignments: DayContextPendingAssignment[];
  calendarHolds: DayContextCalendarHold[];
  builderRanAt?: string | null;
}

const WINDOW_RANGES: Record<string, { start: number; end: number }> = {
  morning: { start: 6, end: 9 },
  business_hours: { start: 9, end: 17 },
  after_work: { start: 17, end: 19 },
  evening: { start: 19, end: 22 },
};

function detectWindow(hour: number, isWeekend: boolean): string {
  if (isWeekend) return 'weekends';
  for (const [name, range] of Object.entries(WINDOW_RANGES)) {
    if (hour >= range.start && hour < range.end) return name;
  }
  return 'evening';
}

function hourInTz(iso: string, tz: string): number {
  const h = new Date(iso).toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false });
  return parseInt(h, 10);
}

function minuteInTz(iso: string, tz: string): number {
  const m = new Date(iso).toLocaleString('en-US', { timeZone: tz, minute: 'numeric' });
  return parseInt(m, 10);
}

function localTimeStr(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
}

function dateInTz(iso: string, tz: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });
}

function isWeekendInTz(tz: string, todayStr: string): boolean {
  const d = new Date(`${todayStr}T12:00:00Z`);
  const dow = d.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' });
  return dow === 'Sat' || dow === 'Sun';
}

/**
 * Build DAY_CONTEXT from raw rows fetched server-side. Caller is responsible
 * for the queries (so this stays free of supabase client dependencies and
 * trivially testable).
 */
export function buildDayContextServer(params: {
  tasks: any[];
  externalEvents: any[];
  pendingAssignmentTasks: any[];
  builderLog?: { ranAt?: string; builtAt?: string } | null;
  tz: string;
  todayStr: string;
}): DayContext {
  const { tasks, externalEvents, pendingAssignmentTasks, builderLog, tz, todayStr } = params;
  const isWeekend = isWeekendInTz(tz, todayStr);

  const todayTasks = tasks
    .filter(t => t.start_time && dateInTz(t.start_time, tz) === todayStr)
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

  const schedule: DayContextScheduleItem[] = todayTasks.map(t => {
    const hour = t.start_time ? hourInTz(t.start_time, tz) : 0;
    const breakdown = t.scheduling_context?.score_breakdown;
    return {
      id: t.id,
      title: t.title,
      start: t.start_time ?? null,
      end: t.end_time ?? null,
      startLocal: t.start_time ? localTimeStr(t.start_time, tz) : null,
      window: detectWindow(hour, isWeekend),
      category: t.category || 'UNCATEGORIZED',
      priority: t.priority,
      status: t.status,
      score: typeof breakdown?.total === 'number' ? breakdown.total : null,
      isAuto: !!t.scheduling_context?.pre_schedule_status,
      externalEventId: t.external_event_id ?? null,
      assignmentId: t.assignment_id ?? null,
      assignmentUrl: t.assignment_url ?? null,
      pushedCount: t.pushed_count ?? 0,
      isPriority: !!t.is_priority,
      priorityRank: t.priority_rank ?? null,
    };
  });

  // Gaps (weekdays only, 6am–11pm)
  const gaps: DayContextGap[] = [];
  if (!isWeekend) {
    const occupied: Array<{ start: number; end: number }> = [];
    for (const item of schedule) {
      if (!item.start) continue;
      const sH = hourInTz(item.start, tz) + minuteInTz(item.start, tz) / 60;
      const dur = item.end
        ? (new Date(item.end).getTime() - new Date(item.start).getTime()) / 3600000
        : 1;
      occupied.push({ start: sH, end: sH + dur });
    }
    for (const e of externalEvents) {
      const sH = hourInTz(e.start_time, tz) + minuteInTz(e.start_time, tz) / 60;
      const eH = hourInTz(e.end_time, tz) + minuteInTz(e.end_time, tz) / 60;
      occupied.push({ start: sH, end: eH });
    }
    occupied.sort((a, b) => a.start - b.start);

    let cursor = 6;
    for (const span of occupied) {
      if (span.start > cursor + 0.5) {
        gaps.push({
          startHour: cursor,
          endHour: span.start,
          durationMin: Math.round((span.start - cursor) * 60),
          window: detectWindow(Math.floor(cursor), isWeekend),
        });
      }
      cursor = Math.max(cursor, span.end);
    }
    if (cursor < 23) {
      gaps.push({
        startHour: cursor,
        endHour: 23,
        durationMin: Math.round((23 - cursor) * 60),
        window: detectWindow(Math.floor(cursor), isWeekend),
      });
    }
  }

  const todayIds = new Set(todayTasks.map(t => t.id));

  const priorityLane: DayContextPriorityItem[] = tasks
    .filter(t => t.is_priority && t.status !== 'DONE' && !t.completed_at)
    .sort((a, b) => (a.priority_rank ?? 9999) - (b.priority_rank ?? 9999))
    .map(t => ({
      id: t.id,
      title: t.title,
      rank: t.priority_rank ?? null,
      scheduledToday: todayIds.has(t.id),
    }));

  // Rolled over: tasks whose original_due_date < today and now scheduled today
  const rolledOver = tasks
    .filter(t => t.original_due_date && t.original_due_date < todayStr && todayIds.has(t.id))
    .map(t => ({ id: t.id, title: t.title }));

  // Overdue today: due_date <= today and not done
  const overdue = tasks
    .filter(t => t.due_date && t.due_date <= todayStr && t.status !== 'DONE' && !t.completed_at)
    .map(t => ({ id: t.id, title: t.title, dueDate: t.due_date ?? null }));

  const pendingAssignments: DayContextPendingAssignment[] = pendingAssignmentTasks
    .filter(t => t.assignment_id && t.status !== 'DONE' && !t.completed_at)
    .slice(0, 30)
    .map(t => ({
      taskId: t.id,
      title: t.title,
      dueDate: t.due_date ?? null,
      programId: t.program_id ?? null,
      url: t.assignment_url ?? null,
      hasLinkedTask: true,
      scheduledToday: todayIds.has(t.id),
    }));

  const calendarHolds: DayContextCalendarHold[] = externalEvents.map(e => ({
    id: e.id,
    title: e.title,
    start: e.start_time,
    end: e.end_time,
    startLocal: localTimeStr(e.start_time, tz),
    endLocal: localTimeStr(e.end_time, tz),
  }));

  // Current window
  const nowHour = parseInt(
    new Date().toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }),
    10
  );

  return {
    date: todayStr,
    timezone: tz,
    isWeekend,
    currentWindow: detectWindow(nowHour, isWeekend),
    schedule,
    gaps,
    priorityLane,
    rolledOver,
    overdue,
    pendingAssignments,
    calendarHolds,
    builderRanAt: builderLog?.ranAt ?? builderLog?.builtAt ?? null,
  };
}

/**
 * Compact prompt-friendly summary. Mirrors `summarizeDayContext` on the client.
 */
export function summarizeDayContext(ctx: DayContext): string {
  const lines: string[] = [];
  lines.push(`Date: ${ctx.date} (${ctx.timezone}, ${ctx.isWeekend ? 'weekend' : 'weekday'}, current window: ${ctx.currentWindow})`);
  lines.push(`Scheduled today (${ctx.schedule.length}):`);
  for (const item of ctx.schedule) {
    lines.push(`  - [${item.id}] ${item.startLocal ?? '—'} ${item.title} (${item.category}/${item.priority}${item.score != null ? `, score=${item.score}` : ''}, window=${item.window}${item.isPriority ? ', PRIORITY' : ''})`);
  }
  if (ctx.calendarHolds.length) {
    lines.push(`Calendar holds (${ctx.calendarHolds.length}):`);
    for (const h of ctx.calendarHolds) lines.push(`  - ${h.startLocal}–${h.endLocal} ${h.title}`);
  }
  if (ctx.gaps.length) {
    lines.push(`Open gaps:`);
    for (const g of ctx.gaps) lines.push(`  - ${g.startHour.toFixed(1)}h–${g.endHour.toFixed(1)}h (${g.durationMin}m, ${g.window})`);
  }
  if (ctx.priorityLane.length) {
    lines.push(`Priority lane (${ctx.priorityLane.length}):`);
    for (const p of ctx.priorityLane.slice(0, 8)) lines.push(`  - [${p.id}] rank=${p.rank ?? '?'} ${p.title}${p.scheduledToday ? ' ✓today' : ''}`);
  }
  if (ctx.pendingAssignments.length) {
    lines.push(`Pending assignments (${ctx.pendingAssignments.length}):`);
    for (const a of ctx.pendingAssignments.slice(0, 10)) lines.push(`  - [${a.taskId}] ${a.title} due=${a.dueDate ?? '?'}${a.scheduledToday ? ' ✓today' : ''}${a.url ? ' [has URL]' : ''}`);
  }
  if (ctx.rolledOver.length) lines.push(`Rolled over: ${ctx.rolledOver.map(t => t.title).join(', ')}`);
  if (ctx.overdue.length) lines.push(`Overdue today: ${ctx.overdue.map(t => t.title).join(', ')}`);
  return lines.join('\n');
}
