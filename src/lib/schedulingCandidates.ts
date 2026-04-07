import { getDateInTimezone } from '@/lib/date';
import { Task } from '@/types/task';

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

  if (task.pushed_count && task.pushed_count > 0) {
    if (task.pushed_count <= 3) {
      score += task.pushed_count;
    } else {
      score += 3;
      score -= (task.pushed_count - 3);
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
      if (b.score !== a.score) return b.score - a.score;
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