/**
 * buildDayContext — single source of truth for the itinerary AI assistant.
 *
 * Produces the SAME structured snapshot that the Daily Review modal renders
 * AND the AI receives as DAY_CONTEXT. This guarantees the agent "sees what
 * the user sees" — the same task IDs, scores, gaps, calendar holds, and
 * pending assignments.
 *
 * Used by `DailyReviewModal` → forwarded to `hybrid-assistant-api` via
 * `useChatAssistant.sendMessage` whenever the user is in the daily-review
 * interface. Voice/phone agents inherit the same structure server-side.
 */

import { Task, ExternalCalendarEvent } from '@/types/task';
import { ScheduleReasoning } from '@/utils/dailyReviewPipeline';
import { explainSchedulingScore } from '@/lib/schedulingCandidates';
import { getTimePartsInTimezone, formatTimeInTimezone } from '@/lib/date';

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
  score: number;
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

export interface DayContextVenueNudge {
  id: string;
  title: string;
  startLocal: string | null;
  toWindow: string;
  message: string;
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
  backlogOverdueCount: number;
  pendingAssignments: DayContextPendingAssignment[];
  calendarHolds: DayContextCalendarHold[];
  venueNudges: DayContextVenueNudge[];
  windowSummaries: Array<{ window: string; label: string; count: number; categories: string[]; missing: string[] }>;
  explanations: string[];
  missingExplanations: string[];
  builderRanAt?: string | null;
  builderVersion?: string | null;
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

function detectCurrentWindow(tz: string, isWeekend: boolean): string {
  const now = new Date();
  const hourStr = now.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false });
  const hour = parseInt(hourStr, 10);
  return detectWindow(hour, isWeekend);
}

export function buildDayContext(params: {
  tasks: Task[];
  externalEvents: ExternalCalendarEvent[];
  reasoning: ScheduleReasoning;
  pendingAssignmentTasks: Task[];
  builderLog: any;
  tz: string;
  todayStr: string;
  isWeekend: boolean;
}): DayContext {
  const { tasks, externalEvents, reasoning, pendingAssignmentTasks, builderLog, tz, todayStr, isWeekend } = params;

  // Scheduled today, sorted
  const todayTasks = tasks
    .filter(t => t.start_time && new Date(t.start_time).toLocaleDateString('en-CA', { timeZone: tz }) === todayStr)
    .sort((a, b) => new Date(a.start_time!).getTime() - new Date(b.start_time!).getTime());

  const schedule: DayContextScheduleItem[] = todayTasks.map(t => {
    const breakdown = explainSchedulingScore(t);
    const hour = t.start_time ? getTimePartsInTimezone(t.start_time, tz).hour : 0;
    return {
      id: t.id,
      title: t.title,
      start: t.start_time ?? null,
      end: t.end_time ?? null,
      startLocal: t.start_time ? formatTimeInTimezone(t.start_time, tz) : null,
      window: detectWindow(hour, isWeekend),
      category: t.category || 'UNCATEGORIZED',
      priority: t.priority,
      status: t.status,
      score: breakdown.total,
      isAuto: !!(t.scheduling_context as any)?.pre_schedule_status,
      externalEventId: t.external_event_id ?? null,
      assignmentId: t.assignment_id ?? null,
      assignmentUrl: t.assignment_url ?? null,
      pushedCount: t.pushed_count ?? 0,
      isPriority: !!t.is_priority,
      priorityRank: t.priority_rank ?? null,
    };
  });

  // Gaps (only for weekday business windows). Naive: scan 6am-23pm in 30-min steps,
  // mark periods uncovered by either a scheduled task or an external event.
  const gaps: DayContextGap[] = [];
  if (!isWeekend) {
    const occupied: Array<{ start: number; end: number }> = [];
    for (const item of schedule) {
      if (!item.start) continue;
      const sH = getTimePartsInTimezone(item.start, tz).hour + getTimePartsInTimezone(item.start, tz).minute / 60;
      const dur = (item.end ? new Date(item.end).getTime() - new Date(item.start).getTime() : 60 * 60 * 1000) / (60 * 60 * 1000);
      occupied.push({ start: sH, end: sH + dur });
    }
    for (const e of externalEvents) {
      const sH = getTimePartsInTimezone(e.start_time, tz).hour + getTimePartsInTimezone(e.start_time, tz).minute / 60;
      const eH = getTimePartsInTimezone(e.end_time, tz).hour + getTimePartsInTimezone(e.end_time, tz).minute / 60;
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

  // Priority lane (is_priority items, sorted by rank)
  const priorityLane: DayContextPriorityItem[] = tasks
    .filter(t => t.is_priority && t.status !== 'DONE' && !t.completed_at)
    .sort((a, b) => (a.priority_rank ?? 9999) - (b.priority_rank ?? 9999))
    .map(t => ({
      id: t.id,
      title: t.title,
      rank: t.priority_rank ?? null,
      scheduledToday: todayTasks.some(s => s.id === t.id),
    }));

  // Rolled-over (from reasoning's scoped IDs)
  const idMap = new Map(tasks.map(t => [t.id, t]));
  const rolledOver = (reasoning.scopedIds.rolledOverIds || [])
    .map(id => idMap.get(id))
    .filter(Boolean)
    .map(t => ({ id: t!.id, title: t!.title }));

  const overdue = (reasoning.scopedIds.overdueIds || [])
    .map(id => idMap.get(id))
    .filter(Boolean)
    .map(t => ({ id: t!.id, title: t!.title, dueDate: t!.due_date ?? null }));

  // Pending assignments (not done, has assignment_id), include URL + scheduled-today flag
  const todayIds = new Set(todayTasks.map(t => t.id));
  const pendingAssignments: DayContextPendingAssignment[] = pendingAssignmentTasks
    .filter(t => (t as any).assignment_id && t.status !== 'DONE' && !t.completed_at)
    .slice(0, 30)
    .map(t => ({
      taskId: t.id,
      title: t.title,
      dueDate: t.due_date ?? null,
      programId: (t as any).program_id ?? null,
      url: t.assignment_url ?? null,
      hasLinkedTask: true,
      scheduledToday: todayIds.has(t.id),
    }));

  const calendarHolds: DayContextCalendarHold[] = externalEvents.map(e => ({
    id: e.id,
    title: e.title,
    start: e.start_time,
    end: e.end_time,
    startLocal: formatTimeInTimezone(e.start_time, tz),
    endLocal: formatTimeInTimezone(e.end_time, tz),
  }));

  // Venue-dependent nudges: tasks the builder placed after-work with a
  // scheduling_context.venue_nudge marker — surfaced so the Daily Review can offer to
  // move them into business hours (when the venue is likely open).
  const venueNudges: DayContextVenueNudge[] = todayTasks
    .filter(t => (t.scheduling_context as any)?.venue_nudge?.message)
    .map(t => ({
      id: t.id,
      title: t.title,
      startLocal: t.start_time ? formatTimeInTimezone(t.start_time, tz) : null,
      toWindow: (t.scheduling_context as any).venue_nudge.toWindow || 'business_hours',
      message: (t.scheduling_context as any).venue_nudge.message,
    }));

  return {
    date: todayStr,
    timezone: tz,
    isWeekend,
    currentWindow: detectCurrentWindow(tz, isWeekend),
    schedule,
    gaps,
    priorityLane,
    rolledOver,
    overdue,
    backlogOverdueCount: reasoning.stats.backlogOverdue,
    pendingAssignments,
    calendarHolds,
    venueNudges,
    windowSummaries: reasoning.windowSummaries.map(w => ({
      window: w.window,
      label: w.label,
      count: w.taskCount,
      categories: Object.keys(w.categoryBreakdown),
      missing: w.missingCategories,
    })),
    explanations: reasoning.explanations,
    missingExplanations: reasoning.missingExplanations,
    builderRanAt: builderLog?.ranAt ?? builderLog?.builtAt ?? null,
    builderVersion: builderLog?.version ?? null,
  };
}

/**
 * Build a compact human-readable summary suitable for embedding in a chat
 * prompt prefix. Keeps the structured JSON separate but provides the model
 * a quick reference.
 */
export function summarizeDayContext(ctx: DayContext): string {
  const lines: string[] = [];
  lines.push(`Date: ${ctx.date} (${ctx.timezone}, ${ctx.isWeekend ? 'weekend' : 'weekday'}, current window: ${ctx.currentWindow})`);
  lines.push(`Scheduled today (${ctx.schedule.length}):`);
  for (const item of ctx.schedule) {
    lines.push(`  - [${item.id}] ${item.startLocal ?? '—'} ${item.title} (${item.category}/${item.priority}, score=${item.score}, window=${item.window}${item.isPriority ? ', PRIORITY' : ''})`);
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
  if (ctx.backlogOverdueCount) lines.push(`Backlog overdue: ${ctx.backlogOverdueCount}`);
  if (ctx.venueNudges.length) {
    lines.push(`Venue nudges (${ctx.venueNudges.length}) — after-work errands you may want to move to business hours:`);
    for (const n of ctx.venueNudges) lines.push(`  - [${n.id}] ${n.startLocal ?? '—'} ${n.title} → ${n.toWindow}`);
  }
  if (ctx.explanations.length) lines.push(`Why: ${ctx.explanations.slice(0, 3).join(' | ')}`);
  if (ctx.missingExplanations.length) lines.push(`Gaps explained: ${ctx.missingExplanations.slice(0, 3).join(' | ')}`);
  return lines.join('\n');
}
