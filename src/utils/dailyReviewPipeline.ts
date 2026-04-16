/**
 * Daily Review Reasoning Pipeline
 * 
 * Structured 8-step pipeline that produces the ScheduleReasoning object
 * for DailyReviewModal. Each step logs its inputs and outputs to activity_log
 * for traceability and fine-tuning.
 */

import { format } from 'date-fns';
import { DEFAULT_SCHEDULING_CONFIG, type SchedulingConfig, mergeSchedulingConfig } from '@/config/schedulingRules';
import { scoreSchedulingCandidate } from '@/lib/schedulingCandidates';
import { getTimePartsInTimezone } from '@/lib/date';
import { Task, ExternalCalendarEvent } from '@/types/task';
import { logActivity } from '@/utils/activityLogger';

// ─── Types ───────────────────────────────────────────────────

export interface ScheduleReasoning {
  greeting: string;
  stats: {
    scheduledCount: number;
    rolledOverCount: number;
    overdueCount: number;
    externalEventCount: number;
    externalBlockedMinutes: number;
    autoScheduledCount: number;
    backlogOverdue: number;
    pendingAssignmentCount: number;
    assignmentsScheduledToday: number;
  };
  explanations: string[];
  windowSummaries: WindowSummary[];
  missingExplanations: string[];
  pipelineTrace: StepResult[];
}

export interface WindowSummary {
  window: string;
  label: string;
  taskCount: number;
  capacityNote: string;
  categoryBreakdown: Record<string, number>;
  missingCategories: string[];
}

interface StepResult {
  step: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  durationMs: number;
}

// ─── Window Labels ───────────────────────────────────────────

const windowLabels: Record<string, string> = {
  morning: 'Morning',
  business_hours: 'Business Hours',
  after_work: 'After Work',
  evening: 'Evening',
  weekends: 'Weekend',
};

// ─── Step Runner ─────────────────────────────────────────────

function runStep<T>(
  stepName: string,
  inputs: Record<string, unknown>,
  fn: () => T
): { result: T; stepResult: StepResult } {
  const start = performance.now();
  const result = fn();
  const durationMs = Math.round(performance.now() - start);
  return {
    result,
    stepResult: {
      step: stepName,
      inputs,
      outputs: result as Record<string, unknown>,
      durationMs,
    },
  };
}

// ─── Pipeline ────────────────────────────────────────────────

export function buildDailyReviewReasoning(
  tasks: Task[],
  externalEvents: ExternalCalendarEvent[],
  builderLog: any,
  tz: string,
  todayStr: string,
  isWeekend: boolean,
  userId: string | null,
  userConfig?: Partial<SchedulingConfig> | null
): ScheduleReasoning {
  // Resolve config: user prefs merged over defaults, or defaults if none provided
  const config: SchedulingConfig = userConfig
    ? mergeSchedulingConfig(userConfig)
    : DEFAULT_SCHEDULING_CONFIG;
  const usingUserConfig = !!userConfig;
  const steps: StepResult[] = [];

  // ── Step 1: FILTER_SCHEDULED_TODAY ──
  const { result: scheduledToday, stepResult: s1 } = runStep(
    'FILTER_SCHEDULED_TODAY',
    { totalTasks: tasks.length, todayStr, tz },
    () => {
      const filtered = tasks.filter(t =>
        t.start_time && new Date(t.start_time).toLocaleDateString('en-CA', { timeZone: tz }) === todayStr
      );
      return {
        ids: filtered.map(t => t.id),
        count: filtered.length,
        titles: filtered.map(t => t.title),
        _tasks: filtered, // internal, not logged
      };
    }
  );
  steps.push({ ...s1, outputs: { ids: scheduledToday.ids, count: scheduledToday.count, titles: scheduledToday.titles } });

  const todayTasks = scheduledToday._tasks;

  // ── Step 2: SCOPE_STATS ──
  const { result: scopedStats, stepResult: s2 } = runStep(
    'SCOPE_STATS',
    { scheduledTodayCount: todayTasks.length },
    () => {
      const rolledOver = todayTasks.filter(t =>
        (t.pushed_count ?? 0) > 0 && t.status !== 'DONE' && !t.completed_at
      );
      const overdue = todayTasks.filter(t =>
        t.due_date && new Date(t.due_date) < new Date() && t.status !== 'DONE' && !t.completed_at
      );
      const autoScheduled = todayTasks.filter(t =>
        (t.scheduling_context as any)?.pre_schedule_status
      );
      const backlogOverdue = tasks.filter(t =>
        t.due_date && new Date(t.due_date) < new Date() && t.status !== 'DONE' && !t.completed_at && !todayTasks.includes(t)
      ).length;

      return {
        rolledOverCount: rolledOver.length,
        rolledOverIds: rolledOver.map(t => t.id),
        overdueCount: overdue.length,
        overdueIds: overdue.map(t => t.id),
        autoScheduledCount: autoScheduled.length,
        backlogOverdue,
      };
    }
  );
  steps.push(s2);

  // ── Step 3: WINDOW_ASSIGNMENT ──
  const { result: windowData, stepResult: s3 } = runStep(
    'WINDOW_ASSIGNMENT',
    { scheduledTodayCount: todayTasks.length, isWeekend, usingUserConfig },
    () => {
      const windowToCategories: Record<string, string[]> = {};
      for (const [cat, mapping] of Object.entries(config.categoryMappings)) {
        for (const win of mapping.defaultTimeWindow) {
          if (!windowToCategories[win]) windowToCategories[win] = [];
          windowToCategories[win].push(cat);
        }
      }

      const windowNames = isWeekend ? ['weekends'] : ['morning', 'business_hours', 'after_work', 'evening'];
      const summaries: WindowSummary[] = windowNames.map(w => {
        const tasksInWindow = todayTasks.filter(t => {
          if (!t.start_time) return false;
          const { hour } = getTimePartsInTimezone(t.start_time, tz);
          if (w === 'morning') return hour >= 6 && hour < 9;
          if (w === 'business_hours') return hour >= 9 && hour < 17;
          if (w === 'after_work') return hour >= 17 && hour < 19;
          if (w === 'evening') return hour >= 19 && hour < 23;
          if (w === 'weekends') return true;
          return false;
        });
        const totalMin = tasksInWindow.reduce((s, t) => s + (t.estimate_minutes || 60), 0);
        const categoryBreakdown: Record<string, number> = {};
        tasksInWindow.forEach(t => {
          const cat = t.category || 'UNCATEGORIZED';
          categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;
        });
        const expectedCats = windowToCategories[w] || [];
        const missingCategories = expectedCats.filter(cat => !categoryBreakdown[cat]);

        return {
          window: w,
          label: windowLabels[w] || w,
          taskCount: tasksInWindow.length,
          capacityNote: tasksInWindow.length > 0
            ? `${tasksInWindow.length} task${tasksInWindow.length > 1 ? 's' : ''}, ~${totalMin} min`
            : 'Empty',
          categoryBreakdown,
          missingCategories,
        };
      });

      return { summaries, windowToCategories };
    }
  );
  steps.push({ ...s3, outputs: { summaries: windowData.summaries.map(s => ({ window: s.window, taskCount: s.taskCount, categoryBreakdown: s.categoryBreakdown, missingCategories: s.missingCategories })) } });

  // ── Step 4: EMPTY_WINDOW_DIAGNOSIS ──
  const { result: emptyDiagnosis, stepResult: s4 } = runStep(
    'EMPTY_WINDOW_DIAGNOSIS',
    { emptyWindows: windowData.summaries.filter(w => w.taskCount === 0).map(w => w.window) },
    () => {
      const missingExplanations: string[] = [];
      const emptyWindows = windowData.summaries.filter(w => w.taskCount === 0);
      const incompleteTasks = tasks.filter(t => t.status !== 'DONE');

      emptyWindows.forEach(w => {
        const eligibleCats = windowData.windowToCategories[w.window] || [];
        const eligibleTasks = incompleteTasks.filter(t => eligibleCats.includes(t.category || ''));

        const windowDef = config.timeWindows[w.window as keyof typeof config.timeWindows];
        if (windowDef) {
          const windowStart = windowDef.start;
          const windowEnd = windowDef.end;
          const blockingEvents = externalEvents.filter(e => {
            const eStart = new Date(e.start_time).getHours();
            const eEnd = new Date(e.end_time).getHours();
            return eStart < windowEnd && eEnd > windowStart;
          });
          const blockedMin = blockingEvents.reduce((sum, e) => {
            const s = Math.max(new Date(e.start_time).getHours(), windowStart);
            const end = Math.min(new Date(e.end_time).getHours(), windowEnd);
            return sum + Math.max(0, (end - s) * 60);
          }, 0);
          const windowMin = (windowEnd - windowStart) * 60;
          if (blockedMin >= windowMin && blockingEvents.length > 0) {
            missingExplanations.push(`${w.label} is empty — fully blocked by ${blockingEvents.length} calendar event${blockingEvents.length > 1 ? 's' : ''} (${blockedMin} min)`);
            return;
          }
        }

        if (eligibleTasks.length === 0) {
          missingExplanations.push(`${w.label} is empty — no ${eligibleCats.join('/')} tasks in your backlog`);
        } else {
          const scheduledElsewhere = eligibleTasks.filter(t => t.start_time && new Date(t.start_time).toLocaleDateString('en-CA', { timeZone: tz }) !== todayStr);
          const scheduledTodayOtherWindow = eligibleTasks.filter(t => t.start_time && new Date(t.start_time).toLocaleDateString('en-CA', { timeZone: tz }) === todayStr);
          const unscheduled = eligibleTasks.filter(t => !t.start_time);

          if (unscheduled.length > 0) {
            const scored = unscheduled.map(t => ({ t, score: scoreSchedulingCandidate(t) })).sort((a, b) => b.score - a.score);
            missingExplanations.push(`${w.label} is empty — ${unscheduled.length} eligible ${eligibleCats.join('/')} task${unscheduled.length > 1 ? 's' : ''} scored below scheduling threshold (highest score: ${scored[0].score})`);
          } else if (scheduledElsewhere.length > 0) {
            missingExplanations.push(`${w.label} is empty — ${scheduledElsewhere.length} ${eligibleCats.join('/')} task${scheduledElsewhere.length > 1 ? 's' : ''} scheduled on other days`);
          } else if (scheduledTodayOtherWindow.length > 0) {
            missingExplanations.push(`${w.label} is empty — ${scheduledTodayOtherWindow.length} ${eligibleCats.join('/')} task${scheduledTodayOtherWindow.length > 1 ? 's' : ''} already placed in other windows today`);
          } else {
            missingExplanations.push(`${w.label} is empty — all ${eligibleCats.join('/')} tasks are completed`);
          }
        }
      });

      return { missingExplanations };
    }
  );
  steps.push(s4);

  // ── Step 5: ASSIGNMENT_QC ──
  const { result: assignmentQC, stepResult: s5 } = runStep(
    'ASSIGNMENT_QC',
    { totalTasks: tasks.length },
    () => {
      const assignmentTasksToday = todayTasks.filter(t =>
        (t as any).assignment_id && t.status !== 'DONE'
      );
      const pendingAssignments = tasks.filter(t =>
        (t as any).assignment_id && t.status !== 'DONE' && !t.completed_at
      );
      const explanations: string[] = [];

      if (assignmentTasksToday.length === 0 && pendingAssignments.length > 0) {
        const withDueDate = pendingAssignments
          .filter(t => t.due_date)
          .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime());
        if (withDueDate.length > 0) {
          explanations.push(`No assignment tasks scheduled today — ${pendingAssignments.length} assignment${pendingAssignments.length > 1 ? 's' : ''} pending, next due: "${withDueDate[0].title}" on ${format(new Date(withDueDate[0].due_date!), 'MMM d')}`);
        } else {
          explanations.push(`No assignment tasks scheduled today — ${pendingAssignments.length} assignment${pendingAssignments.length > 1 ? 's' : ''} pending (no due dates set)`);
        }
      }

      return {
        pendingAssignmentCount: pendingAssignments.length,
        assignmentsScheduledToday: assignmentTasksToday.length,
        nextDueTitle: pendingAssignments.filter(t => t.due_date).sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime())[0]?.title || null,
        explanations,
      };
    }
  );
  steps.push(s5);

  // ── Step 6: BUILDER_LOG_MERGE ──
  const { result: builderMerge, stepResult: s6 } = runStep(
    'BUILDER_LOG_MERGE',
    { hasBuilderLog: !!builderLog },
    () => {
      return {
        archivedStale: (builderLog as any)?.archived_stale ?? 0,
        totalScheduled: (builderLog as any)?.total_scheduled ?? null,
        lastRunTimestamp: (builderLog as any)?.timestamp ?? null,
        rawKeys: builderLog ? Object.keys(builderLog) : [],
      };
    }
  );
  steps.push(s6);

  // ── Step 7: CHAT_SESSION_BOUNDARY ──
  // This step is informational — the actual boundary is tracked via useRef in the component
  const { stepResult: s7 } = runStep(
    'CHAT_SESSION_BOUNDARY',
    {},
    () => ({ note: 'Boundary tracked via messageCountAtOpen ref in DailyReviewModal' })
  );
  steps.push(s7);

  // ── Step 8: BUILD_VERSION_PROOF ──
  const { result: versionProof, stepResult: s8 } = runStep(
    'BUILD_VERSION_PROOF',
    {},
    () => {
      let buildVersion = 'unknown';
      try {
        const meta = document.querySelector('meta[name="build-version"]');
        buildVersion = meta?.getAttribute('content') || 'missing-meta';
      } catch { /* SSR safety */ }
      return {
        buildVersion,
        swCacheVersion: 'v10',
        usingUserConfig,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 80) : 'unknown',
      };
    }
  );
  steps.push(s8);

  // ── Build explanations ──
  const explanations: string[] = [];
  if (scopedStats.rolledOverCount > 0) {
    explanations.push(`${scopedStats.rolledOverCount} task${scopedStats.rolledOverCount > 1 ? 's' : ''} rolled over from previous days (push count increased)`);
  }
  if (scopedStats.autoScheduledCount > 0) {
    const autoTasks = todayTasks.filter(t => (t.scheduling_context as any)?.pre_schedule_status);
    const topScorer = autoTasks
      .map(t => ({ t, score: scoreSchedulingCandidate(t) }))
      .sort((a, b) => b.score - a.score)[0];
    if (topScorer) {
      explanations.push(`${scopedStats.autoScheduledCount} task${scopedStats.autoScheduledCount > 1 ? 's' : ''} auto-scheduled from backlog — top: "${topScorer.t.title}" (score: ${topScorer.score})`);
    }
  }
  const externalMinutes = externalEvents.reduce((sum, e) => {
    const start = new Date(e.start_time).getTime();
    const end = new Date(e.end_time).getTime();
    return sum + Math.round((end - start) / 60000);
  }, 0);
  if (externalEvents.length > 0) {
    explanations.push(`${externalEvents.length} calendar event${externalEvents.length > 1 ? 's' : ''} blocking ${externalMinutes} min total`);
  }
  if (builderMerge.archivedStale > 0) {
    explanations.push(`${builderMerge.archivedStale} stale tasks archived by the nightly builder`);
  }

  const allMissingExplanations = [
    ...emptyDiagnosis.missingExplanations,
    ...assignmentQC.explanations,
  ];

  // ── Build greeting ──
  const hour = new Date().getHours();
  const greetingWord = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const reasoning: ScheduleReasoning = {
    greeting: `${greetingWord} — here's your day`,
    stats: {
      scheduledCount: scheduledToday.count,
      rolledOverCount: scopedStats.rolledOverCount,
      overdueCount: scopedStats.overdueCount,
      externalEventCount: externalEvents.length,
      externalBlockedMinutes: externalMinutes,
      autoScheduledCount: scopedStats.autoScheduledCount,
      backlogOverdue: scopedStats.backlogOverdue,
      pendingAssignmentCount: assignmentQC.pendingAssignmentCount,
      assignmentsScheduledToday: assignmentQC.assignmentsScheduledToday,
    },
    explanations,
    windowSummaries: windowData.summaries,
    missingExplanations: allMissingExplanations,
    pipelineTrace: steps,
  };

  // ── Log full pipeline trace to activity_log (fire-and-forget) ──
  logActivity({
    userId,
    activityType: 'daily_review_reasoning',
    status: 'completed',
    stage: 'pipeline_complete',
    metadata: {
      totalSteps: steps.length,
      steps: steps.map(s => ({
        step: s.step,
        inputs: s.inputs,
        outputs: s.outputs,
        durationMs: s.durationMs,
      })),
      finalStats: reasoning.stats,
      explanationCount: explanations.length,
      missingExplanationCount: allMissingExplanations.length,
      buildVersion: versionProof.buildVersion,
      swCacheVersion: versionProof.swCacheVersion,
      usingUserConfig,
    },
  });

  // ── Console fallback trace: ensures pipeline output is visible
  // even if the activity_log POST is blocked by RLS, network, or auth ──
  console.log('[DailyReviewPipeline] trace', {
    userId,
    usingUserConfig,
    buildVersion: versionProof.buildVersion,
    swCacheVersion: versionProof.swCacheVersion,
    todayStr,
    tz,
    isWeekend,
    stats: reasoning.stats,
    windowSummaries: reasoning.windowSummaries.map(w => ({
      window: w.window,
      taskCount: w.taskCount,
      categoryBreakdown: w.categoryBreakdown,
      missingCategories: w.missingCategories,
    })),
    explanations,
    missingExplanations: allMissingExplanations,
  });

  return reasoning;
}
