// WHAT:       Named tests for P3 (work-session spreading) and P4 (early warning): one `it` per AC.
// WHY:        The owner wants every dated assignment worked "a little at a time until done", finished a
//             week ahead, re-planned nightly without duplicates, never touching his DONE or hand-moved
//             sessions, and warned the day it stops fitting — instead of one 90-min block two days out.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   docs/qc-evidence/FINDINGS-assignment-spreading.md §5 P3/P4 + owner decisions 2026-10-29
//             (build log); owner's live timeWindows (user_scheduling_prefs, read 2026-10-29).
// Run: node --experimental-strip-types --test supabase/functions/_shared/work-sessions.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  planWorkSessions, courseworkWindowsFor, resolveSessionConfig, DEFAULT_SESSION_CONFIG, sessionKey,
  buildSessionWarningLines, AT_RISK_TAG, RETIRED_TAG, SESSION_TAG,
  type ParentTask, type SessionTask, type DayAvailability, type SessionPlan,
} from './work-sessions.ts';
import { resolveCategoryDailyCap } from './scheduling-defaults.ts';
import { localDateOf } from './timezone.ts';

const TZ = 'America/New_York';
// Owner's live windows (2026-10-29) and coursework mapping.
const TW = {
  evening: { start: 19, end: 22, days: [0, 1, 2, 3, 4, 5, 6] },
  morning: { start: 6, end: 9, days: [1, 2, 3, 4, 5] },
  flexible: { start: 9, end: 22, days: [0, 1, 2, 3, 4, 5, 6] },
  weekends: { start: 10, end: 20, days: [0, 6] },
  after_work: { start: 17, end: 19, days: [1, 2, 3, 4, 5] },
  business_hours: { start: 9, end: 17, days: [1, 2, 3, 4, 5] },
};
const CFG = { categoryMappings: { PROF_EDUCATION: { maxPerDay: 2, maxPerDayWeekend: 6, defaultTimeWindow: ['evening', 'weekends'] } } };
const CM = CFG.categoryMappings;

function addDays(date: string, n: number) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function days(from: string, n: number, busy: Record<string, Array<[string, string]>> = {}, cfg: any = CFG): DayAvailability[] {
  return Array.from({ length: n }, (_, i) => {
    const date = addDays(from, i);
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    return {
      date,
      windows: courseworkWindowsFor(date, TZ, TW, cfg.categoryMappings),
      busy: (busy[date] ?? []).map(([s, e]) => ({ start: Date.parse(s), end: Date.parse(e) })),
      capRemaining: resolveCategoryDailyCap(cfg, 'PROF_EDUCATION', dow === 0 || dow === 6, { fallback: 2 }),
    };
  });
}
const parent = (over: Partial<ParentTask>): ParentTask => ({
  id: 'p-paper', title: '📚 Research Paper', status: 'UP_NEXT', completed_at: null,
  assignment_id: '6616bef3-cddb-49b1-b619-d83e660951f8', due_date: '2026-12-10T04:59:59.000Z',
  estimate_minutes: 180, tags: [], board_id: 'board', priority: 'MEDIUM', category: 'PROF_EDUCATION', ...over,
});
const PROPOSAL = parent({ id: 'p-prop', title: '📚 Research Proposal', assignment_id: 'aafbf80f-512a-4ea8-892b-0d9c9548c09e', due_date: '2026-10-31T03:59:59.000Z', priority: 'HIGH' });
const CP2 = parent({ id: 'p-cp2', title: '📚 Checkpoint 2 - Details', assignment_id: 'a3c3684e-0dce-4a76-9552-08e59608a428', due_date: '2026-11-09T04:59:59.000Z' });
const PAPER = parent({});
const NOW = new Date('2026-10-29T05:00:00Z'); // the 05:00 UTC build = Thu Oct 29 1 am ET

const run = (over: Partial<Parameters<typeof planWorkSessions>[0]> = {}): SessionPlan => planWorkSessions({
  parents: [PAPER], sessions: [], days: days('2026-10-29', 60), now: NOW, timezone: TZ,
  config: { ...DEFAULT_SESSION_CONFIG }, horizonDays: 7, ...over,
});
const localDay = (iso: string) => localDateOf(iso, TZ)!;
const localHM = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
/** Turn a plan's writes into the next night's existing session rows (as the DB would hold them). */
function applied(plan: SessionPlan, prev: SessionTask[] = []): SessionTask[] {
  const out = prev.map((s) => ({ ...s }));
  for (const r of plan.retimes) Object.assign(out.find((s) => s.id === r.taskId)!, r.patch);
  for (const u of plan.unschedules) Object.assign(out.find((s) => s.id === u.taskId)!, u.patch);
  plan.creates.forEach((c) => out.push({
    id: `s-${c.key}`, title: c.title, status: 'UP_NEXT', completed_at: null, assignment_id: c.key,
    start_time: c.insert.start_time as string | null, end_time: c.insert.end_time as string | null,
    estimate_minutes: c.insert.estimate_minutes as number, tags: c.insert.tags as string[],
    scheduling_context: c.insert.scheduling_context as Record<string, unknown>,
  }));
  return out;
}

describe('P3 work-session planner', () => {
  it('AC-P3-0 settings: seeded finish-by 7 days, 90-min sessions, 180-min default effort; user values win', () => {
    assert.deepEqual([DEFAULT_SESSION_CONFIG.finishBufferDays, DEFAULT_SESSION_CONFIG.sessionMinutes, DEFAULT_SESSION_CONFIG.defaultEffortMinutes], [7, 90, 180]);
    const c = resolveSessionConfig({ assignmentSessions: { finishBufferDays: 3, sessionMinutes: 60, defaultEffortMinutes: 240 } });
    assert.deepEqual([c.finishBufferDays, c.sessionMinutes, c.defaultEffortMinutes], [3, 60, 240]);
    assert.equal(resolveSessionConfig({ assignmentSessions: { finishBufferDays: -2 } }).finishBufferDays, 7);
  });

  it('AC-P3-1 Research Paper (due Wed Dec 9, 180 min) → 2 sessions, both on or before Wed Dec 2, different days', () => {
    const p = run();
    const a = p.assignments[0];
    assert.equal(a.finishBy, '2026-12-02');
    assert.equal(a.totalSessions, 2);
    assert.equal(p.creates.length, 2);
    const dates = p.creates.map((c) => c.placement.date);
    assert.ok(dates.every((d) => d <= '2026-12-02'), dates.join(','));
    assert.equal(new Set(dates).size, 2);
    assert.ok(dates[0] === '2026-10-29', 'spreading starts today');
  });

  it('AC-P3-1b 300 min → 4 sessions spread across the window (not bunched), one per day', () => {
    const p = run({ parents: [parent({ estimate_minutes: 300 })] });
    const dates = p.creates.map((c) => c.placement.date).sort();
    assert.equal(dates.length, 4);
    assert.equal(new Set(dates).size, 4);
    assert.ok(dates[3] <= '2026-12-02');
    assert.ok(dates[3] > '2026-11-20', `last session late in the window, got ${dates[3]}`);
  });

  it('AC-P3-2 Checkpoint 2 and Research Paper both get a session inside the 7-day horizon', () => {
    const p = run({ parents: [CP2, PAPER] });
    const horizonEnd = '2026-11-04';
    for (const par of [CP2, PAPER]) {
      const inH = p.creates.filter((c) => c.parentId === par.id && c.placement.date <= horizonEnd && c.placement.start);
      assert.ok(inH.length >= 1, par.title);
    }
  });

  it('AC-P3-3 a missed session is re-placed on a later day next night — same card, no duplicate, N unchanged', () => {
    const night1 = run();
    let rows = applied(night1);
    const first = rows.find((s) => s.scheduling_context?.session?.planned_date === '2026-10-29')!;
    // builder STEP 1 rollover clears the past, not-done block
    Object.assign(first, { start_time: null, end_time: null });
    const night2 = run({ sessions: rows, now: new Date('2026-10-30T05:00:00Z'), days: days('2026-10-30', 60) });
    assert.equal(night2.creates.length, 0, 'no duplicate card');
    const moved = night2.retimes.find((r) => r.taskId === first.id)!;
    assert.ok(moved.placement.date >= '2026-10-30', 'never on a past day');
    assert.equal(night2.assignments[0].totalSessions, 2);
  });

  it('AC-P3-3b idempotent: re-running the same night over its own result writes nothing', () => {
    const night1 = run({ parents: [CP2, PAPER] });
    const again = run({ parents: [CP2, PAPER], sessions: applied(night1) });
    assert.equal(again.creates.length, 0);
    assert.equal(again.retimes.length, 0);
    assert.equal(again.unschedules.length, 0);
  });

  it('AC-P3-4 parent marked DONE → no new sessions; un-started sessions come off the calendar', () => {
    const rows = applied(run());
    const p = run({ parents: [parent({ status: 'DONE' })], sessions: rows });
    assert.equal(p.creates.length, 0);
    assert.equal(p.unschedules.length, 2);
    for (const u of p.unschedules) {
      assert.equal(u.patch.start_time, null);
      assert.ok((u.patch.tags as string[]).includes(RETIRED_TAG));
      assert.equal(u.patch.status, undefined, 'never closes the session card');
    }
  });

  it('AC-P3-4b Nexus shows it submitted (flag tag) → planning stops the same way, parent never closed', () => {
    const rows = applied(run());
    const p = run({ parents: [parent({ tags: ['nexus-submitted'] })], sessions: rows });
    assert.equal(p.creates.length, 0);
    assert.ok(p.unschedules.every((u) => u.reason === 'parent-submitted'));
    assert.equal(p.parentTagPatches.length, 0);
  });

  it('AC-P3-5 late: Research Proposal (due Fri Oct 30 23:59) — finish-by already past → sessions Thu/Fri, all end ≥1 h before due, warned', () => {
    const p = run({ parents: [PROPOSAL] });
    const a = p.assignments[0];
    assert.equal(a.late, true);
    assert.equal(a.lastDate, '2026-10-30');
    assert.equal(p.creates.length, 2);
    for (const c of p.creates) {
      assert.ok(Date.parse(c.placement.end!) <= Date.parse('2026-10-31T03:59:59Z') - 3600000, c.placement.end!);
      assert.ok(['2026-10-29', '2026-10-30'].includes(c.placement.date));
    }
    assert.equal(p.warnings.length, 1);
    assert.equal(p.warnings[0].late, true);
  });

  it('AC-P3-5b due tomorrow and today is full: never scheduled after the due date, never dropped silently', () => {
    const full: Record<string, Array<[string, string]>> = {
      '2026-10-29': [['2026-10-29T23:00:00Z', '2026-10-30T02:00:00Z']],
      '2026-10-30': [['2026-10-30T23:00:00Z', '2026-10-31T02:00:00Z']],
    };
    const p = run({ parents: [PROPOSAL], days: days('2026-10-29', 60, full) });
    assert.equal(p.creates.length, 0);
    assert.equal(p.assignments[0].unplaced, 2);
    assert.equal(p.warnings.length, 1);
    assert.equal(p.warnings[0].fit, 0);
  });

  it('AC-P3-6 every block is inside the coursework windows (weekday 19–22, weekend 10–20) and the caps hold', () => {
    const many = [PAPER, CP2, parent({ id: 'p-x', title: '📚 Big Project', assignment_id: 'x', estimate_minutes: 900, due_date: '2026-11-20T04:59:59Z' })];
    const p = run({ parents: many });
    const perDay: Record<string, number> = {};
    for (const c of p.creates.filter((x) => x.placement.start)) {
      const day = localDay(c.placement.start!);
      const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
      const [sh, eh] = [localHM(c.placement.start!), localHM(c.placement.end!)];
      if (dow === 0 || dow === 6) assert.ok(sh >= '10:00' && eh <= '20:00', `${day} ${sh}-${eh}`);
      else assert.ok(sh >= '19:00' && eh <= '22:00', `${day} ${sh}-${eh}`);
      perDay[day] = (perDay[day] ?? 0) + 1;
      assert.ok(perDay[day] <= (dow === 0 || dow === 6 ? 6 : 2), `cap on ${day}`);
    }
  });

  it('AC-P3-7 only the 7-day horizon gets calendar blocks; later sessions carry a planned date only', () => {
    const p = run();
    const later = p.creates.filter((c) => c.placement.date > '2026-11-04');
    assert.ok(later.length >= 1);
    for (const c of later) { assert.equal(c.placement.start, null); assert.equal(c.insert.is_scheduled, false); }
    assert.deepEqual(Object.keys(p.placementsByDate), ['2026-10-29']);
  });

  it('AC-P3-8 no two sessions of one assignment on the same day while free days remain', () => {
    const p = run({ parents: [parent({ estimate_minutes: 540 })] }); // 6 sessions, ~34 free days
    const dates = p.creates.map((c) => c.placement.date);
    assert.equal(new Set(dates).size, dates.length);
  });

  it('AC-P3-9 a session the owner marked DONE is never moved, and counts toward the total', () => {
    const rows = applied(run());
    rows[0].status = 'DONE';
    const before = JSON.stringify(rows[0]);
    const p = run({ sessions: rows, now: new Date('2026-10-30T05:00:00Z'), days: days('2026-10-30', 60) });
    assert.ok(!p.retimes.some((r) => r.taskId === rows[0].id));
    assert.ok(!p.unschedules.some((u) => u.taskId === rows[0].id));
    assert.equal(p.assignments[0].doneMinutes, 90);
    assert.equal(p.assignments[0].needed, 1);
    assert.equal(JSON.stringify(rows[0]), before);
  });

  it('AC-P3-10 a session the owner moved by hand stays exactly where he put it', () => {
    const rows = applied(run({ parents: [CP2] }));
    const s = rows.find((x) => x.start_time)!;
    s.start_time = '2026-10-31T15:00:00.000Z'; // Sat 11 am, his choice
    s.end_time = '2026-10-31T16:30:00.000Z';
    const p = run({ parents: [CP2], sessions: rows });
    assert.ok(!p.retimes.some((r) => r.taskId === s.id));
    assert.ok(!p.unschedules.some((u) => u.taskId === s.id));
    assert.ok(p.assignments[0].placed.some((x) => x.kind === 'pinned' && x.key === s.assignment_id));
  });

  it('AC-P3-11 effort raised → a new session card with the next index; lowered → surplus retired, not deleted', () => {
    const rows = applied(run());
    const up = run({ parents: [parent({ estimate_minutes: 270 })], sessions: rows });
    assert.deepEqual(up.creates.map((c) => c.key), [sessionKey(PAPER.assignment_id!, 3)]);
    const down = run({ parents: [parent({ estimate_minutes: 90 })], sessions: rows });
    assert.equal(down.creates.length, 0);
    assert.equal(down.unschedules.length, 1);
    assert.equal(down.unschedules[0].reason, 'surplus');
  });

  it('AC-P3-12 session cards: own card per session, titled "session N of M", linked by key, tagged, no due date', () => {
    const c = run().creates[0];
    assert.equal(c.title, '📚 Research Paper — session 1 of 2');
    assert.equal(c.insert.assignment_id, '6616bef3-cddb-49b1-b619-d83e660951f8::session-1');
    assert.deepEqual(c.insert.tags, [SESSION_TAG]);
    assert.equal(c.insert.due_date, null);
    assert.equal(c.insert.status, 'UP_NEXT');
    assert.equal((c.insert.scheduling_context as any).session.parent_task_id, 'p-paper');
  });

  it('AC-P3-13 effort defaults to 180 min only when the card has no estimate', () => {
    assert.equal(run({ parents: [parent({ estimate_minutes: null })] }).assignments[0].effortMinutes, 180);
    assert.equal(run({ parents: [parent({ estimate_minutes: null })] }).assignments[0].effortDefaulted, true);
    assert.equal(run({ parents: [parent({ estimate_minutes: 45 })] }).assignments[0].totalSessions, 1);
  });
});

describe('P4 early warning', () => {
  const tight = (): Record<string, Array<[string, string]>> => {
    const b: Record<string, Array<[string, string]>> = {};
    for (let i = 0; i < 4; i++) { const d = addDays('2026-10-29', i); b[d] = [[`${d}T10:00:00Z`, `${addDays(d, 1)}T03:00:00Z`]]; }
    return b;
  };
  const CP2_EARLY = parent({ id: 'p-cp2', title: '📚 Checkpoint 2 - Details', assignment_id: 'cp2', due_date: '2026-11-09T04:59:59.000Z', estimate_minutes: 180 });

  it('AC-P4-1 sessions that no longer fit before finish-by → one line naming the item, fit vs needed and the dates', () => {
    const p = run({ parents: [CP2_EARLY], days: days('2026-10-29', 60, tight()) }); // every day to Nov 1 busy
    assert.equal(p.warnings.length, 1);
    const lines = buildSessionWarningLines(p, TZ);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /Checkpoint 2/);
    assert.match(lines[0], /0 of 2/);
    assert.match(lines[0], /Sun, Nov 1/);
    assert.deepEqual(p.parentTagPatches, [{ taskId: 'p-cp2', tags: [AT_RISK_TAG] }]);
  });

  it('AC-P4-2 everything fits → no warning, no tag', () => {
    const p = run({ parents: [PAPER] });
    assert.equal(p.warnings.length, 0);
    assert.equal(p.parentTagPatches.length, 0);
  });

  it('AC-P4-3 three items at risk in one run → three lines (one message), not three messages', () => {
    const items = ['a', 'b', 'c'].map((x) => parent({ id: `p-${x}`, title: `📚 Item ${x}`, assignment_id: x, due_date: '2026-11-09T04:59:59.000Z' }));
    const p = run({ parents: items, days: days('2026-10-29', 60, tight()) });
    assert.equal(buildSessionWarningLines(p, TZ).length, 3);
  });

  it('AC-P4-4 warned once: the next night (still at risk, tag present) sends nothing; fits again → tag removed', () => {
    const still = run({ parents: [parent({ ...CP2_EARLY, tags: [AT_RISK_TAG] })], days: days('2026-10-29', 60, tight()) });
    assert.equal(still.warnings.length, 0);
    const fits = run({ parents: [parent({ ...CP2_EARLY, tags: [AT_RISK_TAG] })] });
    assert.deepEqual(fits.parentTagPatches, [{ taskId: 'p-cp2', tags: [] }]);
  });
});
