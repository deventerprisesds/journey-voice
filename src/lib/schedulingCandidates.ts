import { getDateInTimezone } from '@/lib/date';
import { Task } from '@/types/task';

/**
 * Assignment tier thresholds (mirror of scheduling-defaults.ts).
 * Keep these in sync with the backend constants.
 */
export const ASSIGNMENT_URGENT_HOURS = 48;
export const ASSIGNMENT_PRIORITY_DAYS = 7;
export const MAX_ASSIGNMENTS_PER_DAY = 2;

export type AssignmentTier = 'A' | 'B' | 'C';

export interface AssignmentTierBuckets {
  tierA: Task[]; // due ≤48h — deadline-critical, distribute across hours-until-due
  tierB: Task[]; // due 3-7d OR overdue ≤7d — capped 2/day, due ASC
  tierC: Task[]; // due >7d OR overdue >7d — capped 2/day, due DESC (recent first)
}

/**
 * Split assignment-linked tasks into three placement tiers.
 * - Tier A: due within ASSIGNMENT_URGENT_HOURS (48h) — sorted due ASC
 * - Tier B: due 3-7d OR overdue ≤7d — sorted due ASC
 * - Tier C: due >7d OR overdue >7d — sorted due DESC (recent overdue first;
 *   ancient overdue last because they're lowest-value to reschedule)
 *
 * Tasks without a due_date are excluded from tier classification.
 */
export function selectAssignmentCandidates(
  tasks: Task[],
  now: Date = new Date(),
): AssignmentTierBuckets {
  const tierA: Task[] = [];
  const tierB: Task[] = [];
  const tierC: Task[] = [];

  const urgentMs = ASSIGNMENT_URGENT_HOURS * 60 * 60 * 1000;
  const priorityMs = ASSIGNMENT_PRIORITY_DAYS * 24 * 60 * 60 * 1000;
  const nowMs = now.getTime();

  for (const task of tasks) {
    if (!(task as any).assignment_id) continue;
    if (task.status === 'DONE' || task.status === 'BLOCKED') continue;
    if (task.completed_at) continue;
    if (!task.due_date) continue;

    const dueMs = new Date(task.due_date).getTime();
    const deltaMs = dueMs - nowMs; // positive = future, negative = overdue

    if (deltaMs <= urgentMs && deltaMs >= -urgentMs) {
      // Within ±48h window — Tier A (includes very recently overdue)
      tierA.push(task);
    } else if (deltaMs > urgentMs && deltaMs <= priorityMs) {
      // Due 3-7 days out
      tierB.push(task);
    } else if (deltaMs < -urgentMs && deltaMs >= -priorityMs) {
      // Overdue between 2 and 7 days ago
      tierB.push(task);
    } else {
      // >7 days out OR >7 days overdue
      tierC.push(task);
    }
  }

  const dueAsc = (a: Task, b: Task) =>
    new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime();
  const dueDesc = (a: Task, b: Task) =>
    new Date(b.due_date!).getTime() - new Date(a.due_date!).getTime();

  tierA.sort(dueAsc);
  tierB.sort(dueAsc);
  tierC.sort(dueDesc); // most recent overdue first; ancient overdue last

  return { tierA, tierB, tierC };
}

const PRIORITY_WEIGHT: Record<Task['priority'], number> = {
  URGENT: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

const PRIORITY_KEYWORDS = {
  financial: ['payment', 'invoice', 'bill', 'tax', 'budget', 'contract', 'financial', 'money', 'pay', 'credit', 'transfer', 'fee'],
  comms: ['email', 'follow up', 'follow-up', 'respond', 'reply', 'call', 'meeting', 'text', 'message', 'contact', 'coach'],
};

export function normalizeTaskTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function hasSchedulingPriorityKeyword(title: string): boolean {
  const lower = title.toLowerCase();
  return [...PRIORITY_KEYWORDS.financial, ...PRIORITY_KEYWORDS.comms].some((keyword) => lower.includes(keyword));
}

export function isDueSoon(dueDate?: string | null, hoursThreshold = 48): boolean {
  if (!dueDate) return false;
  const due = new Date(dueDate);
  const cutoff = new Date(Date.now() + hoursThreshold * 60 * 60 * 1000);
  return due <= cutoff;
}

export function isTaskScheduledOnDate(task: Pick<Task, 'start_time'>, timezone: string, targetDateStr: string): boolean {
  if (!task.start_time) return false;
  return getDateInTimezone(task.start_time, timezone) === targetDateStr;
}

interface ScoreCandidateOptions {
  priorityBoardIds?: Set<string>;
  targetDate?: Date;
}

export function scoreSchedulingCandidate(task: Task, options: ScoreCandidateOptions = {}): number {
  const { priorityBoardIds = new Set<string>(), targetDate = new Date() } = options;
  let score = PRIORITY_WEIGHT[task.priority] || 1;

  // Explicit user priority — base +10, rank bonus up to +5 (top items get more)
  if (task.is_priority) {
    score += 10 + Math.max(5 - (task.priority_rank ?? 0), 0);
  }

  // Topic-mapped — organizational nudge only (not the same as user priority)
  if (priorityBoardIds.has(task.id)) score += 2;

  // Pushed-count: soft signal only — never bury a task because the system
  // failed to schedule it. is_priority items skip even the mild -1 hint.
  if (task.pushed_count && task.pushed_count > 0) {
    const n = task.pushed_count;
    if (n <= 3) {
      score += 1; // mild "recently rolled" nudge
    } else if (n <= 7) {
      // neutral — no boost, no penalty
    } else if (!task.is_priority) {
      score -= 1; // flat hint, never more, never for explicit priority items
    }
  }

  // Urgency ladder: ±48h includes overdue (intentional)
  if (isDueSoon(task.due_date)) score += 5;

  if (task.due_date) {
    const dueDate = new Date(task.due_date);
    const twoDaysOut = new Date(targetDate.getTime() + 2 * 24 * 60 * 60 * 1000);
    const sevenDaysOut = new Date(targetDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // 3-7 day window (only if NOT already in the 48h window)
    if (dueDate > twoDaysOut && dueDate <= sevenDaysOut) score += 3;

    // Staleness penalties
    if (dueDate < thirtyDaysAgo) score -= 10;
    else if (dueDate < fourteenDaysAgo) score -= 3;
  }

  // Recency boost for recently created tasks
  const createdAt = new Date(task.created_at);
  const daysSinceCreated = (Date.now() - createdAt.getTime()) / (24 * 60 * 60 * 1000);
  if (daysSinceCreated <= 3) score += 2;
  else if (daysSinceCreated <= 7) score += 1;

  if (hasSchedulingPriorityKeyword(task.title)) score += 5;
  if (task.status === 'UP_NEXT') score += 1;

  return Math.max(score, 0);
}

interface SelectSchedulingCandidatesOptions {
  priorityBoardIds?: Set<string>;
  targetDate?: Date;
  targetDateStr: string;
  timezone: string;
  limit?: number;
}

export function selectSchedulingCandidates(
  tasks: Task[],
  { priorityBoardIds = new Set<string>(), targetDate = new Date(), targetDateStr, timezone, limit = 25 }: SelectSchedulingCandidatesOptions,
): Task[] {
  const seenTitles = new Set<string>();

  return tasks
    .filter((task) => task.status !== 'DONE' && task.status !== 'BLOCKED')
    .filter((task) => !task.completed_at)
    .filter((task) => !isTaskScheduledOnDate(task, timezone, targetDateStr))
    .map((task) => ({ task, score: scoreSchedulingCandidate(task, { priorityBoardIds, targetDate }) }))
    .sort((a, b) => {
      // Restored tiebreaker order: explicit priority → priority_rank → score → due_date NULLS LAST
      const aPri = a.task.is_priority ? 1 : 0;
      const bPri = b.task.is_priority ? 1 : 0;
      if (aPri !== bPri) return bPri - aPri;
      if (aPri && bPri) {
        const aRank = a.task.priority_rank ?? 9999;
        const bRank = b.task.priority_rank ?? 9999;
        if (aRank !== bRank) return aRank - bRank;
      }
      if (b.score !== a.score) return b.score - a.score;
      // Due_date ASC NULLS LAST — priority items without due dates no longer punished
      if (a.task.due_date && b.task.due_date) {
        return new Date(a.task.due_date).getTime() - new Date(b.task.due_date).getTime();
      }
      if (a.task.due_date) return -1;
      if (b.task.due_date) return 1;
      return 0;
    })
    .filter(({ task }) => {
      const normalizedTitle = normalizeTaskTitle(task.title);
      if (seenTitles.has(normalizedTitle)) return false;
      seenTitles.add(normalizedTitle);
      return true;
    })
    .slice(0, limit)
    .map(({ task }) => task);
}

/**
 * Build a per-candidate scoring breakdown for SCORING_AUDIT logs.
 * Mirrors scoreSchedulingCandidate logic but returns components separately.
 * Useful for diagnosing "why did X outscore Y" questions.
 */
export interface ScoringBreakdown {
  taskId: string;
  title: string;
  base: number;
  priorityExplicit: number;
  priorityBoard: number;
  pushed: number;
  dueSoon: number;
  dueWindow: number;
  staleness: number;
  recency: number;
  keyword: number;
  upNext: number;
  total: number;
  pushed_count: number;
  is_priority: boolean;
}

export function explainSchedulingScore(
  task: Task,
  options: ScoreCandidateOptions = {},
): ScoringBreakdown {
  const { priorityBoardIds = new Set<string>(), targetDate = new Date() } = options;
  const base = PRIORITY_WEIGHT[task.priority] || 1;
  const priorityExplicit = task.is_priority ? 10 + Math.max(5 - (task.priority_rank ?? 0), 0) : 0;
  const priorityBoard = priorityBoardIds.has(task.id) ? 2 : 0;

  let pushed = 0;
  if (task.pushed_count && task.pushed_count > 0) {
    const n = task.pushed_count;
    if (n <= 3) pushed = 1;
    else if (n <= 7) pushed = 0;
    else if (!task.is_priority) pushed = -1;
  }

  const dueSoon = isDueSoon(task.due_date) ? 5 : 0;

  let dueWindow = 0;
  let staleness = 0;
  if (task.due_date) {
    const dueDate = new Date(task.due_date);
    const twoDaysOut = new Date(targetDate.getTime() + 2 * 24 * 60 * 60 * 1000);
    const sevenDaysOut = new Date(targetDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    if (dueDate > twoDaysOut && dueDate <= sevenDaysOut) dueWindow = 3;
    if (dueDate < thirtyDaysAgo) staleness = -10;
    else if (dueDate < fourteenDaysAgo) staleness = -3;
  }

  const createdAt = new Date(task.created_at);
  const daysSinceCreated = (Date.now() - createdAt.getTime()) / (24 * 60 * 60 * 1000);
  const recency = daysSinceCreated <= 3 ? 2 : daysSinceCreated <= 7 ? 1 : 0;
  const keyword = hasSchedulingPriorityKeyword(task.title) ? 5 : 0;
  const upNext = task.status === 'UP_NEXT' ? 1 : 0;

  const raw = base + priorityExplicit + priorityBoard + pushed + dueSoon + dueWindow + staleness + recency + keyword + upNext;
  return {
    taskId: task.id,
    title: task.title,
    base,
    priorityExplicit,
    priorityBoard,
    pushed,
    dueSoon,
    dueWindow,
    staleness,
    recency,
    keyword,
    upNext,
    total: Math.max(raw, 0),
    pushed_count: task.pushed_count ?? 0,
    is_priority: !!task.is_priority,
  };
}

/**
 * UI helper: should we show the "consider archiving" hint for this task?
 * Visual only — does NOT affect scheduling order.
 */
export function isStalePushed(task: Pick<Task, 'pushed_count' | 'created_at'>): boolean {
  const n = task.pushed_count ?? 0;
  if (n < 8) return false;
  if (!task.created_at) return false;
  const ageDays = (Date.now() - new Date(task.created_at).getTime()) / (24 * 60 * 60 * 1000);
  return ageDays > 30;
}