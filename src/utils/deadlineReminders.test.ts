// WHAT:       Guards for the Settings "Deadline reminders" card logic (src/utils/deadlineReminders.ts) and the
//             source shape of its mount + save guard in SchedulingSettings.tsx.
// WHY:        AC-S1..S12. No browser or node_modules here, so the card's behaviour is proven through its pure
//             helpers plus assertions on the source that wires them (the calendarIgnoreCategories pattern).
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   .claude/ac-deadline-reminders.md; .claude/BUILD-deadline-reminders.md

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  addDeadlineReminder,
  buildSchedulingSavePayload,
  deadlineRemindersFor,
  deadlineWeekday,
  isSeededList,
  patchDeadlineReminder,
  removeDeadlineReminder,
  validateDeadlineReminders,
  withDeadlineWeekday,
} from './deadlineReminders.ts';
import { mergeStoredConfig } from './mergeStoredConfig.ts';

const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const NOW = new Date('2026-11-26T12:00:00Z');

test('AC-S2: a never-saved config shows the seeded time card (Fri 19:00 -> Sat 20:00, not before 08:00)', () => {
  const list = deadlineRemindersFor({});
  assert.equal(isSeededList({}), true);
  assert.equal(list.length, 1);
  const r = list[0];
  assert.deepEqual([r.enabled, r.days, r.start, deadlineWeekday(r), r.deadline, r.notBefore, r.email, r.chat, r.everyNWeeks ?? 1],
    [true, [5], '19:00', 6, '20:00', '08:00', true, true, 1]);
});

test('AC-S3: deleting the seed stores [] and it is not re-added', () => {
  const list = removeDeadlineReminder(deadlineRemindersFor({}), 'time-card');
  const payload = buildSchedulingSavePayload({ deadlineReminders: list }, { activities: false, deadlineReminders: true });
  const stored = mergeStoredConfig({ timeWindows: { a: 1 } }, payload) as any;
  assert.deepEqual(stored.deadlineReminders, []);
  assert.deepEqual(deadlineRemindersFor(stored), []);
  assert.equal(isSeededList(stored), false);
});

test('AC-S4: Add + edit (Mon 09:00 -> Tue 17:00, email off) keeps the time card and gives distinct ids', () => {
  let list = addDeadlineReminder(deadlineRemindersFor({}), NOW);
  const id = list[1].id;
  list = patchDeadlineReminder(list, id, { name: 'Expense report', email: false, chat: true }, NOW);
  list = patchDeadlineReminder(list, id, withDeadlineWeekday({ ...list[1], days: [1] }, 2), NOW);
  list = patchDeadlineReminder(list, id, { start: '09:00', deadline: '17:00' }, NOW);
  const v = validateDeadlineReminders(list, NOW);
  assert.ok(v.ok);
  assert.equal(v.items.length, 2);
  assert.notEqual(v.items[0].id, v.items[1].id);
  assert.deepEqual(v.items[0], { ...deadlineRemindersFor({})[0], createdAt: v.items[0].createdAt });
  const e = v.items[1];
  assert.deepEqual([e.name, e.days, e.start, e.deadlineAfterDays, e.deadline, e.email, e.chat], ['Expense report', [1], '09:00', 1, '17:00', false, true]);
});

test('AC-S5: editing the start keeps the id and every other field', () => {
  const before = deadlineRemindersFor({})[0];
  const after = patchDeadlineReminder([before], before.id, { start: '18:00' }, NOW)[0];
  assert.deepEqual(after, { ...before, start: '18:00' });
});

test('AC-S6 / AC-E5: switching Off keeps the item (enabled:false); back On stamps enabledSince', () => {
  const r = deadlineRemindersFor({})[0];
  const off = patchDeadlineReminder([r], r.id, { enabled: false }, NOW);
  assert.equal(off.length, 1);
  assert.equal(off[0].enabled, false);
  const on = patchDeadlineReminder(off, r.id, { enabled: true }, NOW)[0];
  assert.equal(on.enabled, true);
  assert.equal(on.enabledSince, NOW.toISOString());
});

test('AC-S7: delete removes only that item; the others keep id and values', () => {
  const list = addDeadlineReminder(deadlineRemindersFor({}), NOW);
  const left = removeDeadlineReminder(list, list[1].id);
  assert.deepEqual(left, [list[0]]);
});

test('AC-S8: invalid input names the field and blocks the save', () => {
  const r = deadlineRemindersFor({})[0];
  const cases: Array<[any, string]> = [
    [{ ...r, start: '7pm' }, 'start'],
    [{ ...r, deadline: '24:00' }, 'deadline'],
    [{ ...r, deadlineAfterDays: 0, deadline: '08:00' }, 'deadline'],
    [{ ...r, deadlineAfterDays: 8 }, 'deadline'],
    [{ ...r, days: [] }, 'days'],
    [{ ...r, name: '  ' }, 'name'],
  ];
  for (const [bad, field] of cases) {
    const v = validateDeadlineReminders([bad], NOW);
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.field, field, JSON.stringify(bad));
  }
  const page = src('../components/SchedulingSettings.tsx');
  const guard = page.indexOf('if (!checked.ok)');
  const save = page.indexOf('await saveUserSchedulingConfig(');
  assert.ok(guard > 0 && guard < save, 'validation runs before the save call');
  assert.match(page.slice(guard, save), /return;/);
});

test('AC-S9 / H9: an unedited deadline list is sent as undefined, so the stored (newer) list survives', () => {
  const stale = { timeWindows: { x: 2 }, deadlineReminders: [] as any[], activities: [] as any[] };
  const payload = buildSchedulingSavePayload(stale, { activities: false, deadlineReminders: false });
  assert.equal(payload.deadlineReminders, undefined);
  assert.equal(payload.activities, undefined);
  const newer = [{ id: 'agent', name: 'From agent' }];
  const stored = mergeStoredConfig({ deadlineReminders: newer, activities: [{ id: 'gym' }] }, payload) as any;
  assert.deepEqual(stored.deadlineReminders, newer);
  assert.deepEqual(stored.activities, [{ id: 'gym' }]);
  const page = src('../components/SchedulingSettings.tsx');
  assert.match(page, /buildSchedulingSavePayload\(toSave, \{ activities: activitiesEdited, deadlineReminders: deadlineRemindersEdited \}\)/);
  assert.match(page, /setDeadlineRemindersEdited\(true\)/);
});

test('AC-S10: a deadline-only save leaves every other top-level key byte-identical', () => {
  const storedBefore = { activities: [{ id: 'gym' }], timeWindows: { a: { s: '09:00' } }, categoryMappings: { x: 1 }, deadlineReminders: [] };
  const list = deadlineRemindersFor({});
  const payload = buildSchedulingSavePayload({ ...storedBefore, deadlineReminders: list }, { activities: false, deadlineReminders: true });
  const after = mergeStoredConfig(storedBefore, payload) as any;
  for (const k of ['activities', 'timeWindows', 'categoryMappings']) assert.equal(JSON.stringify(after[k]), JSON.stringify((storedBefore as any)[k]), k);
  assert.deepEqual(after.deadlineReminders, list);
});

test('AC-S12: every-other-week saved without an anchor gets one on the start weekday', () => {
  const r = deadlineRemindersFor({})[0];
  const list = patchDeadlineReminder([r], r.id, { everyNWeeks: 2, anchorDate: undefined }, NOW);
  const v = validateDeadlineReminders(list, NOW);
  assert.ok(v.ok);
  if (v.ok) assert.equal(v.items[0].anchorDate, '2026-11-27');
  const back = patchDeadlineReminder(list, r.id, { everyNWeeks: 1 }, NOW)[0];
  assert.equal(back.everyNWeeks, undefined);
  assert.equal(back.anchorDate, undefined);
});

test('S-24 via the picker: choosing the start weekday as deadline day is the SAME day, never next week', () => {
  const r = deadlineRemindersFor({})[0];
  assert.equal(withDeadlineWeekday(r, 5).deadlineAfterDays, 0);
  assert.equal(withDeadlineWeekday(r, 6).deadlineAfterDays, 1);
  assert.equal(withDeadlineWeekday(r, 4).deadlineAfterDays, 6);
});

test('AC-S1: the card is its OWN card mounted right after Activities, titled "Deadline reminders"', () => {
  const page = src('../components/SchedulingSettings.tsx');
  const act = page.indexOf('<ActivitiesSettings');
  const dl = page.indexOf('<DeadlineRemindersSettings');
  assert.ok(act > 0 && dl > act, 'mounted after the Activities card');
  assert.ok(!/deadline/i.test(page.slice(act, page.indexOf('/>', act))), 'not inside the Activities card');
  const card = src('../components/DeadlineRemindersSettings.tsx');
  assert.match(card, /<CardTitle>Deadline reminders<\/CardTitle>/);
  assert.ok(!/resolveActivities|activities/.test(card.replace(/Activities/g, '')), 'the card never reads the activities list');
  const rules = src('../config/schedulingRules.ts');
  assert.match(rules, /deadlineReminders: Array\.isArray\(userConfig\.deadlineReminders\) \? userConfig\.deadlineReminders : undefined/);
});
