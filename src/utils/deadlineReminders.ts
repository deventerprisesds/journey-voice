// WHAT:       Pure helpers behind the Settings "Deadline reminders" card: add / change / remove an item, the
//             deadline-day picker, validate the whole list before Save, and build the save payload that sends
//             each agent-editable list ONLY when it was edited on this page.
// WHY:        Owner 2026-11-26: the time-card nag must be "an actual feature I can edit, turn on and off, add a
//             similar item". No node_modules install here, so the card's logic lives in pure functions with
//             tests (src/utils/deadlineReminders.test.ts), the same way calendarIgnoreCategories.ts does.
//             The save guard mirrors `activitiesEdited` (SchedulingSettings.tsx): an untouched list is sent as
//             `undefined`, which mergeStoredConfig skips, so a stale page never overwrites a newer list (H9).
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   .claude/ac-deadline-reminders.md AC-S1..S12; supabase/functions/_shared/deadline-reminders.ts (contract).

import {
  DEADLINE_REMINDERS_KEY,
  normalizeDeadlineReminder,
  resolveDeadlineReminders,
  setEnabled,
  type DeadlineReminder,
} from '../../supabase/functions/_shared/deadline-reminders.ts';

export type { DeadlineReminder };

/** Never saved -> the card shows the seed (the time card); the first edit saves it as the owner's own list. */
export function deadlineRemindersFor(config: any): DeadlineReminder[] {
  return resolveDeadlineReminders(config);
}
export function isSeededList(config: any): boolean {
  return !Array.isArray(config?.[DEADLINE_REMINDERS_KEY]);
}

/** A new item with a fresh id; the owner edits it from there. */
export function addDeadlineReminder(list: DeadlineReminder[], now: Date = new Date()): DeadlineReminder[] {
  const { item } = normalizeDeadlineReminder({
    name: 'New reminder', days: [1], start: '09:00', deadlineAfterDays: 1, deadline: '17:00',
    intervalMinutes: 60, email: true, chat: true,
  }, now);
  return item ? [...list, { ...item, id: uniqueId(list, item.id) }] : list;
}
function uniqueId(list: DeadlineReminder[], id: string): string {
  let out = id;
  for (let i = 2; list.some((r) => r.id === out); i++) out = `${id}-${i}`;
  return out;
}

/** Change one item, keeping its id and every untouched field (AC-S5). Turning it On stamps enabledSince (AC-E5). */
export function patchDeadlineReminder(
  list: DeadlineReminder[],
  id: string,
  change: Partial<DeadlineReminder>,
  now: Date = new Date(),
): DeadlineReminder[] {
  return list.map((r) => {
    if (r.id !== id) return r;
    const { enabled, ...rest } = change;
    let next: DeadlineReminder = { ...r, ...rest, id: r.id };
    if (enabled !== undefined) next = setEnabled(next, enabled, now);
    if ((next.everyNWeeks ?? 1) <= 1) { delete next.everyNWeeks; delete next.anchorDate; }
    return next;
  });
}

export function removeDeadlineReminder(list: DeadlineReminder[], id: string): DeadlineReminder[] {
  return list.filter((r) => r.id !== id);
}

/** Weekday (0=Sun..6=Sat) the deadline falls on, from the first start day plus the offset. */
export function deadlineWeekday(r: DeadlineReminder): number {
  return ((r.days?.[0] ?? 0) + (r.deadlineAfterDays ?? 0)) % 7;
}
/**
 * The offset for a chosen deadline weekday. The SAME weekday as the start means the same day (offset 0) --
 * never silently "next week" -- so a deadline earlier than the start on that day is rejected (S-24).
 */
export function withDeadlineWeekday(r: DeadlineReminder, weekday: number): DeadlineReminder {
  const start = r.days?.[0] ?? 0;
  return { ...r, deadlineAfterDays: (weekday - start + 7) % 7 };
}

export type ValidateResult =
  | { ok: true; items: DeadlineReminder[] }
  | { ok: false; index: number; name: string; field: string; error: string };

/** Validate every item before Save. On any error NOTHING is saved (AC-S8). */
export function validateDeadlineReminders(list: DeadlineReminder[], now: Date = new Date()): ValidateResult {
  const items: DeadlineReminder[] = [];
  for (let i = 0; i < list.length; i++) {
    const res = normalizeDeadlineReminder(list[i], now);
    if (!res.item) return { ok: false, index: i, name: String(list[i]?.name ?? ''), field: res.field ?? 'item', error: res.error ?? 'invalid' };
    items.push({ ...res.item, id: list[i].id, createdAt: list[i].createdAt ?? res.item.createdAt });
  }
  return { ok: true, items };
}

/**
 * What Settings sends to saveUserSchedulingConfig. A list that was NOT edited on this page goes as
 * `undefined` (mergeStoredConfig skips it), so an agent's or another tab's newer list survives (AC-S9, H9).
 */
export function buildSchedulingSavePayload<T extends Record<string, any>>(
  config: T,
  edited: { activities: boolean; deadlineReminders: boolean },
): T {
  return {
    ...config,
    activities: edited.activities ? config.activities : undefined,
    [DEADLINE_REMINDERS_KEY]: edited.deadlineReminders ? config[DEADLINE_REMINDERS_KEY] : undefined,
  };
}
