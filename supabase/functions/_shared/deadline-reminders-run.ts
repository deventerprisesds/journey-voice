// WHAT:       The I/O half of deadline reminders, for ONE user, with the Supabase client injected: read the
//             list from user_scheduling_prefs.config, find or create the occurrence task, keep its due date on
//             the deadline, and insert this hour's nag row. Called from notification-scheduler once per user.
// WHY:        notification-scheduler/index.ts calls `serve` on import, so nothing inside it is testable. Keeping
//             the I/O here (pure decisions in ./deadline-reminders.ts) lets a mock client prove: one task per
//             occurrence across repeat runs and a crash after the task write (AC-O2, AC-O3), one task query per
//             user (AC-P3), and that a bad item never reaches the scheduler's single bulk insert (H6, AC-R3):
//             nag rows go in their OWN idempotent upsert, keyed on the existing unique index
//             idx_scheduled_notifications_unique (user_id, task_id, notification_type, scheduled_for).
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   supabase/functions/_shared/deadline-reminders-run.test.ts; .claude/BUILD-deadline-reminders.md;
//             supabase/migrations/20250929221846_4077c911-33ab-406e-9e4b-9fe55fca73c0.sql (the unique index)

import {
  DEADLINE_REMINDER_TYPE,
  buildNagRow,
  currentSlotMs,
  liveOccurrence,
  nagBody,
  normalizeDeadlineReminder,
  pickOccurrenceTask,
  DEADLINE_REMINDERS_KEY,
  slotVerdict,
  type DeadlineReminder,
  type OccurrenceTaskLite,
} from './deadline-reminders.ts';
import { DEFAULT_TIMEZONE } from './digest-content.ts';

export interface DeadlineUserPrefs {
  user_id: string;
  timezone: string | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
}

export interface DeadlineRunResult {
  tasksCreated: number;
  tasksUpdated: number;
  nagsInserted: number;
  skipped: Array<{ itemId: string; reason: string }>;
  errors: Array<{ itemId: string | null; kind: string }>;
}

/** Look-back for occurrence tasks: a window is at most 7 days, so 16 days covers the current and previous one. */
const TASK_LOOKBACK_DAYS = 16;

export async function runDeadlineRemindersForUser(
  client: any,
  prefs: DeadlineUserPrefs,
  now: Date,
): Promise<DeadlineRunResult> {
  const out: DeadlineRunResult = { tasksCreated: 0, tasksUpdated: 0, nagsInserted: 0, skipped: [], errors: [] };

  const { data: sched, error: schedErr } = await client
    .from('user_scheduling_prefs')
    .select('config, timezone')
    .eq('user_id', prefs.user_id)
    .maybeSingle();
  if (schedErr) { out.errors.push({ itemId: null, kind: 'config_read_failed' }); return out; }

  const tz = prefs.timezone || sched?.timezone || DEFAULT_TIMEZONE;
  const quiet = { timezone: tz, quiet_hours_start: prefs.quiet_hours_start, quiet_hours_end: prefs.quiet_hours_end };

  // The scheduler acts ONLY on a list the owner SAVED. An absent or malformed key means no nags for this
  // account: the time-card seed is a Settings starting example, never a live reminder for an account that
  // never saved one (coordinator decision 2026-11-26, superseding the Activities-parity seed).
  const saved = sched?.config?.[DEADLINE_REMINDERS_KEY];
  if (!Array.isArray(saved)) return out;

  // Only items that still validate can nag: a hand-edited bad row is skipped, never guessed at.
  const items: DeadlineReminder[] = [];
  for (const raw of saved) {
    if (!raw || typeof raw !== 'object' || !raw.id || !raw.name) { out.errors.push({ itemId: null, kind: 'invalid_item:shape' }); continue; }
    const { item, error } = normalizeDeadlineReminder(raw, now);
    if (item) items.push({ ...item, id: String(raw.id) });
    else out.errors.push({ itemId: String(raw?.id ?? ''), kind: `invalid_item:${error}` });
  }

  const live = items
    .map((item) => ({ item, occ: liveOccurrence(item, now, tz) }))
    .filter((x): x is { item: DeadlineReminder; occ: NonNullable<typeof x.occ> } => !!x.occ);
  if (!live.length) return out;

  // ONE task query per user per run, whatever the number of items (AC-P3). DONE tasks are included on
  // purpose: a Done occurrence must stop its nags, not get a fresh task (AC-N10).
  const since = new Date(now.getTime() - TASK_LOOKBACK_DAYS * 86400000).toISOString();
  const { data: taskRows, error: taskErr } = await client
    .from('tasks')
    .select('id, status, deadline_reminder_ref, due_date')
    .eq('user_id', prefs.user_id)
    .not('deadline_reminder_ref', 'is', null)
    .gte('created_at', since);
  if (taskErr) { out.errors.push({ itemId: null, kind: 'task_read_failed' }); return out; }
  const tasks: OccurrenceTaskLite[] = [...(taskRows || [])];

  let boardId: string | null | undefined;
  for (const { item, occ } of live) {
    try {
      let task = pickOccurrenceTask(tasks, item, occ);
      const dueIso = new Date(occ.deadlineMs).toISOString();

      if (!task) {
        if (boardId === undefined) boardId = await defaultBoardId(client, prefs.user_id);
        if (!boardId) { out.errors.push({ itemId: item.id, kind: 'no_board' }); continue; }
        const { data: created, error: insErr } = await client
          .from('tasks')
          .insert({
            user_id: prefs.user_id,
            board_id: boardId,
            title: item.name,
            description: nagBody(item, occ, tz),
            status: 'TODO',
            priority: 'HIGH',
            due_date: dueIso,
            deadline_reminder_ref: occ.ref,
          })
          .select('id, status, deadline_reminder_ref, due_date')
          .single();
        if (insErr || !created) {
          // Another run (or a crash after a successful write) got there first: the partial unique index on
          // (user_id, deadline_reminder_ref) refuses a second row, so re-read and reuse it (AC-O2, AC-O3).
          const { data: again } = await client
            .from('tasks')
            .select('id, status, deadline_reminder_ref, due_date')
            .eq('user_id', prefs.user_id)
            .eq('deadline_reminder_ref', occ.ref)
            .maybeSingle();
          if (!again) { out.errors.push({ itemId: item.id, kind: 'task_insert_failed' }); continue; }
          task = again;
        } else {
          task = created;
          out.tasksCreated++;
        }
        tasks.push(task!);
      } else if (task.status !== 'DONE' && task.due_date && Date.parse(task.due_date) !== occ.deadlineMs) {
        // G5: the deadline was edited mid-window -- the open task's due date follows it.
        const { error: updErr } = await client.from('tasks').update({ due_date: dueIso }).eq('id', task.id);
        if (updErr) out.errors.push({ itemId: item.id, kind: 'task_update_failed' });
        else { out.tasksUpdated++; task.due_date = dueIso; }
      }

      if (task!.status === 'DONE') { out.skipped.push({ itemId: item.id, reason: 'done' }); continue; }

      const slot = currentSlotMs(occ, item.intervalMinutes, now.getTime());
      if (slot === null) continue;
      const verdict = slotVerdict(item, occ, slot, now, quiet);
      if (!verdict.fire) { out.skipped.push({ itemId: item.id, reason: verdict.reason }); continue; }

      const row = buildNagRow(prefs.user_id, task!.id, item, occ, slot, tz);
      // Idempotent per (user, task, type, slot) on the existing unique index: three runs in one hour leave
      // ONE row (AC-N6). Its own statement, never part of the scheduler's bulk insert (H6).
      const { error: nagErr } = await client
        .from('scheduled_notifications')
        .upsert(row, { onConflict: 'user_id,task_id,notification_type,scheduled_for', ignoreDuplicates: true });
      if (nagErr) out.errors.push({ itemId: item.id, kind: 'nag_insert_failed' });
      else out.nagsInserted++;
    } catch (e) {
      out.errors.push({ itemId: item.id, kind: e instanceof Error ? e.name : 'unknown' });
    }
  }
  return out;
}

async function defaultBoardId(client: any, userId: string): Promise<string | null> {
  const { data } = await client
    .from('boards').select('id, is_default')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(20);
  const rows = data || [];
  return (rows.find((b: any) => b.is_default) ?? rows[0])?.id ?? null;
}

export { DEADLINE_REMINDER_TYPE };
