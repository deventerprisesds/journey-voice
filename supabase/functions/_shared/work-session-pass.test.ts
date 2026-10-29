// WHAT:       Tests for the P3/P4 I/O pass (work-session-pass.ts) against an in-memory Supabase stand-in,
//             plus static checks that nightly-schedule-builder wires PASS 0 the way the plan needs.
// WHY:        The dry run must write NOTHING; apply mode must guard every update against a DONE card; the
//             builder must neither clear nor double-place what PASS 0 owns; and the one-message rule must
//             hold across the sync's digest and the builder's warning.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   docs/qc-evidence/FINDINGS-assignment-spreading.md build log (P3/P4).
// Run: node --experimental-strip-types --test supabase/functions/_shared/work-session-pass.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runWorkSessionPass } from './work-session-pass.ts';

const TZ = 'America/New_York';
const TW = {
  evening: { start: 19, end: 22, days: [0, 1, 2, 3, 4, 5, 6] },
  weekends: { start: 10, end: 20, days: [0, 6] },
  flexible: { start: 9, end: 22, days: [0, 1, 2, 3, 4, 5, 6] },
};
const CONFIG = { timeWindows: TW, categoryMappings: { PROF_EDUCATION: { maxPerDay: 2, maxPerDayWeekend: 6, defaultTimeWindow: ['evening', 'weekends'] } } };
const NOW = new Date('2026-10-30T05:00:00Z'); // Fri 1 am ET build

type Call = { table: string; op: 'insert' | 'update' | 'select'; payload?: any; filters: Array<[string, ...any[]]> };
function fake(tables: Record<string, any[]>) {
  const calls: Call[] = [];
  const builder = (table: string, op: Call['op'], payload?: any) => {
    const call: Call = { table, op, payload, filters: [] };
    calls.push(call);
    const b: any = {};
    for (const f of ['eq', 'neq', 'not', 'gte', 'lt', 'is', 'like', 'order', 'limit', 'in']) {
      b[f] = (...a: any[]) => { call.filters.push([f, ...a]); return b; };
    }
    b.select = () => b;
    b.maybeSingle = () => Promise.resolve({ data: (tables[table] ?? [])[0] ?? null, error: null });
    b.then = (res: any, rej: any) => Promise.resolve({
      data: op === 'select' ? (tables[table] ?? []) : (Array.isArray(payload) ? payload.map((_: any, i: number) => ({ id: `new-${i}` })) : [{ id: 'x' }]),
      error: null,
    }).then(res, rej);
    return b;
  };
  return {
    calls,
    from: (table: string) => ({
      select: () => builder(table, 'select'),
      insert: (p: any) => builder(table, 'insert', p),
      update: (p: any) => builder(table, 'update', p),
    }),
  };
}
const PAPER = { id: 'p-paper', title: '📚 Research Paper', status: 'UP_NEXT', completed_at: null, assignment_id: 'paper',
  due_date: '2026-12-10T04:59:59Z', estimate_minutes: 180, tags: [], board_id: 'b', priority: 'MEDIUM', category: 'PROF_EDUCATION' };

describe('P3 session pass (I/O)', () => {
  it('PASS-1 dry mode reads only: zero insert/update calls, plan returned', async () => {
    const sb = fake({ tasks: [PAPER] });
    const r = await runWorkSessionPass(sb, { userId: 'u', timezone: TZ, userConfig: CONFIG, now: NOW, mode: 'dry' });
    assert.equal(sb.calls.filter((c) => c.op !== 'select').length, 0);
    assert.equal(r.plan!.creates.length, 2);
    assert.ok(r.managedIds.includes('p-paper'));
  });

  it('PASS-2 apply mode inserts session cards for this user and guards every update against DONE', async () => {
    const session = { id: 's1', title: '📚 Research Paper — session 1 of 2', status: 'UP_NEXT', completed_at: null,
      assignment_id: 'paper::session-1', start_time: null, end_time: null, estimate_minutes: 90, tags: ['work-session'],
      scheduling_context: { session: { planned_date: '2026-10-29' } }, external_event_id: null };
    const sb = fake({ tasks: [PAPER, session] });
    await runWorkSessionPass(sb, { userId: 'u', timezone: TZ, userConfig: CONFIG, now: NOW, mode: 'apply' });
    const ins = sb.calls.find((c) => c.op === 'insert' && c.table === 'tasks')!;
    assert.ok(ins.payload.every((row: any) => row.user_id === 'u'));
    const upd = sb.calls.filter((c) => c.op === 'update' && c.table === 'tasks');
    assert.ok(upd.length >= 1);
    for (const u of upd) {
      assert.ok(u.filters.some(([f, col, v]) => f === 'neq' && col === 'status' && v === 'DONE'), JSON.stringify(u.filters));
      assert.ok(u.filters.some(([f, col]) => f === 'is' && col === 'completed_at'));
    }
  });

  it('PASS-3 busy = real calendar events + blocks the builder will NOT clear; task-backed events and in-horizon tasks are not obstacles', async () => {
    const fri7pm = ['2026-10-30T23:00:00Z', '2026-10-31T02:00:00Z'];
    // A task-backed calendar copy and an in-horizon scheduled task on Fri evening: both get re-placed, so not busy.
    const sb = fake({
      tasks: [{ ...PAPER, due_date: '2026-11-08T04:59:59Z' }],
      external_calendar_events: [{ start_time: fri7pm[0], end_time: fri7pm[1], source_task_id: 'some-task', is_all_day: false }],
    });
    const r = await runWorkSessionPass(sb, { userId: 'u', timezone: TZ, userConfig: CONFIG, now: NOW, mode: 'dry' });
    assert.ok(r.plan!.creates.some((c) => c.placement.date === '2026-10-30'), 'Fri evening is still usable');
    const sb2 = fake({
      tasks: [{ ...PAPER, due_date: '2026-11-08T04:59:59Z' }],
      external_calendar_events: [{ start_time: fri7pm[0], end_time: fri7pm[1], source_task_id: null, is_all_day: false }],
    });
    const r2 = await runWorkSessionPass(sb2, { userId: 'u', timezone: TZ, userConfig: CONFIG, now: NOW, mode: 'dry' });
    assert.ok(!r2.plan!.creates.some((c) => c.placement.date === '2026-10-30'), 'a real event blocks Fri evening');
  });

  it('PASS-4 (AC-P4-3/AC-P1-8) one message per night: the warning is appended to the queued intake digest', async () => {
    const late = { ...PAPER, id: 'p-late', title: '📚 Research Proposal', assignment_id: 'prop', due_date: '2026-10-31T03:59:59Z' };
    const sb = fake({
      tasks: [late],
      scheduled_notifications: [{ id: 'n1', body: 'Coursework update from Nexus: …', metadata: { source: 'assignment_sync', message: 'Coursework update from Nexus: …' } }],
    });
    const r = await runWorkSessionPass(sb, { userId: 'u', timezone: TZ, userConfig: CONFIG, now: NOW, mode: 'apply' });
    assert.equal(r.written.warningQueued, true);
    assert.equal(sb.calls.filter((c) => c.op === 'insert' && c.table === 'scheduled_notifications').length, 0, 'no second message');
    const upd = sb.calls.find((c) => c.op === 'update' && c.table === 'scheduled_notifications')!;
    assert.match(upd.payload.metadata.message, /Coursework update from Nexus[\s\S]*Research Proposal/);
  });

  it('PASS-5 disabled in Settings → no plan, no writes, existing session cards still kept out of the builder', async () => {
    const s = { id: 's1', assignment_id: 'paper::session-1', title: 'x', status: 'UP_NEXT', completed_at: null };
    const sb = fake({ tasks: [PAPER, s] });
    const r = await runWorkSessionPass(sb, { userId: 'u', timezone: TZ, userConfig: { ...CONFIG, assignmentSessions: { enabled: false } }, now: NOW, mode: 'apply' });
    assert.equal(r.plan, null);
    assert.deepEqual(r.managedIds, ['s1']);
    assert.equal(sb.calls.filter((c) => c.op !== 'select').length, 0);
  });
});

describe('P3 builder wiring (static)', () => {
  const B = readFileSync(new URL('../nightly-schedule-builder/index.ts', import.meta.url), 'utf8');
  it('WIRE-1 both STEP 1.1 clears leave work-session cards to PASS 0', () => {
    assert.equal((B.match(/\.not\('tags', 'cs', '\{work-session\}'\)/g) ?? []).length, 2);
  });
  it('WIRE-2 PASS 0 runs before tiering; managed tasks are skipped by the tiers and the daily candidates', () => {
    const pass0 = B.indexOf('runWorkSessionPass(supabase');
    const tiers = B.indexOf('ASSIGNMENT TIER CLASSIFICATION (cross-horizon)');
    assert.ok(pass0 > 0 && pass0 < tiers);
    assert.match(B, /if \(sessionManagedIds\.has\(t\.id\)\) continue;/);
    assert.match(B, /!scheduledTaskIds\.has\(id\) && !sessionManagedIds\.has\(id\)/);
  });
  it('WIRE-3 the coursework tally starts from PASS 0 placements (sessions count toward the daily cap)', () => {
    assert.match(B, /for \(const \[day, n\] of Object\.entries\(sessionPass\?\.placementsByDate \?\? \{\}\)\)/);
  });
  it('WIRE-4 single-day mode never re-plans sessions (dry read only)', () => {
    assert.match(B, /mode: singleDay \? 'dry' : 'apply'/);
  });
});
