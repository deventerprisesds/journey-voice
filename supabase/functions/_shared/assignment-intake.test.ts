// WHAT:       Named tests for the P1 acceptance criteria of the Nexus assignment intake (pure planner)
//             and the read helper. One `it` per AC; the AC id leads every test name.
// WHY:        The nightly sync read a table frozen on 2026-04-06 and created 0 tasks a night; the
//             replacement must provably import exactly the owner's dated, current DBA items, at the
//             right instant, and refresh without ever touching a DONE card or auto-closing anything.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   docs/qc-evidence/FINDINGS-assignment-spreading.md §5 P1 AC-P1-1..AC-P1-11; fixture
//             assignment-intake.fixture.ts (live Nexus rows, 2026-10-29).
// Run: node --experimental-strip-types --test supabase/functions/_shared/assignment-intake.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  planAssignmentSync, buildSyncDigest, describePlan, nexusDueInstant, digestSendAt, type ExistingTask, type PlanInput,
} from './assignment-intake.ts';
import { fetchNexusAssignments } from './nexus-read.ts';
import { DBA_ROWS, EXPECTED_IMPORT_IDS, NON_CURRENT_ROWS, OWNER } from './assignment-intake.fixture.ts';

const TZ = 'America/New_York';
const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  rows: DBA_ROWS, tasks: [], todayISO: '2026-10-29', timezone: TZ,
  boardId: 'board-oldest', userId: OWNER, nowISO: '2026-10-29T05:00:00.000Z', ...over,
});
const linkedTask = (over: Partial<ExistingTask>): ExistingTask => ({
  id: 'task-1', title: '📚 Checkpoint 2 - Details', status: 'UP_NEXT', completed_at: null,
  assignment_id: 'a3c3684e-0dce-4a76-9552-08e59608a428', due_date: '2026-11-09T04:59:59+00:00',
  tags: [], scheduling_context: { source: 'MGT-702' }, ...over,
});
/** Apply a plan to an in-memory task list the way the edge function writes it (inserts + patches). */
function applyPlan(tasks: ExistingTask[], plan: ReturnType<typeof planAssignmentSync>): ExistingTask[] {
  const out = tasks.map((t) => ({ ...t }));
  for (const u of plan.updates) {
    const t = out.find((x) => x.id === u.taskId)!;
    Object.assign(t, u.patch);
  }
  plan.creates.forEach((c, i) => out.push({
    id: `new-${i}`, title: c.insert.title as string, status: c.insert.status as string, completed_at: null,
    assignment_id: c.insert.assignment_id as string, due_date: c.insert.due_date as string,
    tags: [], scheduling_context: c.insert.scheduling_context as Record<string, unknown>,
  }));
  return out;
}

describe('P1 Nexus intake planner', () => {
  it('AC-P1-1 exactly the 3 open DBA items dated today+ become PROF_EDUCATION tasks linked by Nexus id', () => {
    const plan = planAssignmentSync(base());
    assert.deepEqual(plan.creates.map((c) => c.assignmentId).sort(), [...EXPECTED_IMPORT_IDS].sort());
    for (const c of plan.creates) {
      assert.equal(c.insert.category, 'PROF_EDUCATION');
      assert.equal(c.insert.assignment_id, c.assignmentId);
      assert.equal(c.insert.board_id, 'board-oldest');
      assert.equal(c.insert.user_id, OWNER);
    }
    assert.equal(plan.updates.length, 0);
  });

  it('AC-P1-1b status is a workflow lane (UP_NEXT for a dated import), never a category (#28/#33)', () => {
    for (const c of planAssignmentSync(base()).creates) assert.equal(c.insert.status, 'UP_NEXT');
  });

  it('AC-P1-2 past-due open items (MGT-701 x4 Oct 2, MGT-702 Slide Deck Oct 6) create nothing', () => {
    const plan = planAssignmentSync(base());
    const ids = plan.creates.map((c) => c.assignmentId);
    for (const past of ['71a143bf-449a-4c26-875d-8f8683ca8506', '5f4f2c6a-3ddb-4051-aba7-6844119e7194',
      '9108bfe5-c9cb-4a3c-b9fb-1a7f3020ab73', '9ca2034c-3813-40ee-b053-302426c863d9',
      '057f1e99-b12e-4285-92b8-76e3ad72cb06']) assert.ok(!ids.includes(past), past);
    assert.equal(plan.excluded.pastDue, 6); // the five above + Introductions (Sep 10)
  });

  it('AC-P1-3 undated items (Final Grade, discussion forum slide deck, Residency participation) create nothing', () => {
    const plan = planAssignmentSync(base());
    assert.equal(plan.excluded.undated, 3);
    assert.ok(!plan.creates.some((c) => /Final Grade|slide deck|Residency/i.test(String(c.insert.title))));
  });

  it('AC-P1-3b submitted items are never imported as new cards', () => {
    const plan = planAssignmentSync(base());
    assert.equal(plan.excluded.closed, 3);
  });

  it('AC-P1-4 UTC due-time: Checkpoint 2 (Sun Nov 8 23:59 ET) keeps the exact Nexus instant, stays Sunday', () => {
    const cp2 = planAssignmentSync(base()).creates.find((c) => c.assignmentId === 'a3c3684e-0dce-4a76-9552-08e59608a428')!;
    assert.equal(cp2.insert.due_date, '2026-11-09T04:59:59.000Z');
    assert.notEqual(cp2.insert.due_date, '2026-11-09T23:59:59Z'); // the old UTC-day rewrite
    const local = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: '2-digit' })
      .format(new Date(cp2.insert.due_date as string));
    assert.equal(local, 'Sun 11:59 PM');
  });

  it('AC-P1-4b a non-23:59 due time is kept exactly (19:00 ET is not moved to 23:59)', () => {
    assert.equal(nexusDueInstant('2026-11-10T00:00:00.000Z'), '2026-11-10T00:00:00.000Z');
  });

  it('AC-P1-4c an item due TODAY (local) is imported even though its UTC date is tomorrow', () => {
    const today = { ...DBA_ROWS[10], id: 'due-tonight', due_date: '2026-10-30T03:59:59.000Z' }; // Thu Oct 29 23:59 ET
    const plan = planAssignmentSync(base({ rows: [today] }));
    assert.equal(plan.creates.length, 1);
    const yesterday = { ...today, id: 'due-last-night', due_date: '2026-10-29T03:59:59.000Z' }; // Wed Oct 28 ET
    assert.equal(planAssignmentSync(base({ rows: [yesterday] })).creates.length, 0);
  });

  it('AC-P1-5 a linked not-DONE task follows a moved Nexus due date and records one from/to change', () => {
    const moved = DBA_ROWS.map((r) => r.id === 'a3c3684e-0dce-4a76-9552-08e59608a428'
      ? { ...r, due_date: '2026-11-16T04:59:59.000Z' } : r);
    const plan = planAssignmentSync(base({ rows: moved, tasks: [linkedTask({})] }));
    assert.equal(plan.updates.length, 1);
    const u = plan.updates[0];
    assert.equal(u.patch.due_date, '2026-11-16T04:59:59.000Z');
    const log = (u.patch.scheduling_context as any).nexus_changes;
    assert.equal(log.length, 1);
    assert.deepEqual({ field: log[0].field, from: log[0].from, to: log[0].to },
      { field: 'due_date', from: '2026-11-09T04:59:59+00:00', to: '2026-11-16T04:59:59.000Z' });
    assert.equal(u.patch.status, undefined);
    assert.ok(!plan.creates.some((c) => c.assignmentId === u.assignmentId), 'no duplicate card');
  });

  it('AC-P1-5b a renamed Nexus item renames the linked card', () => {
    const renamed = DBA_ROWS.map((r) => r.id === 'a3c3684e-0dce-4a76-9552-08e59608a428'
      ? { ...r, title: 'Checkpoint 2 - Details & Methods' } : r);
    const u = planAssignmentSync(base({ rows: renamed, tasks: [linkedTask({})] })).updates[0];
    assert.equal(u.patch.title, '📚 Checkpoint 2 - Details & Methods');
  });

  it('AC-P1-6 a task the owner marked DONE is never touched — moved date, rename or submitted', () => {
    const done = linkedTask({ status: 'DONE', completed_at: '2026-10-20T01:00:00Z' });
    const before = JSON.stringify(done);
    for (const change of [{ due_date: '2026-11-20T04:59:59.000Z' }, { title: 'Renamed' }, { status: 'submitted' }]) {
      const rows = DBA_ROWS.map((r) => r.id === done.assignment_id ? { ...r, ...change } : r);
      const plan = planAssignmentSync(base({ rows, tasks: [done] }));
      assert.equal(plan.updates.length, 0, JSON.stringify(change));
      assert.equal(plan.creates.filter((c) => c.assignmentId === done.assignment_id).length, 0, 'not re-created');
      assert.equal(plan.untouchedDone.length, 1);
    }
    assert.equal(JSON.stringify(done), before);
  });

  it('AC-P1-6b completed_at alone (status not yet DONE) also counts as done', () => {
    const plan = planAssignmentSync(base({ tasks: [linkedTask({ completed_at: '2026-10-20T01:00:00Z' })],
      rows: DBA_ROWS.map((r) => r.id === 'a3c3684e-0dce-4a76-9552-08e59608a428' ? { ...r, title: 'X' } : r) }));
    assert.equal(plan.updates.length, 0);
  });

  it('AC-P1-7 Nexus submitted → flagged (tag + nexus_status), task status unchanged, never closed', () => {
    const rows = DBA_ROWS.map((r) => r.id === 'a3c3684e-0dce-4a76-9552-08e59608a428' ? { ...r, status: 'submitted' } : r);
    const plan = planAssignmentSync(base({ rows, tasks: [linkedTask({})] }));
    assert.equal(plan.updates.length, 1);
    const u = plan.updates[0];
    assert.equal(u.flag, 'submitted');
    assert.equal(u.patch.status, undefined);
    assert.equal(u.patch.completed_at, undefined);
    assert.deepEqual(u.patch.tags, ['nexus-submitted']);
    assert.equal((u.patch.scheduling_context as any).nexus_status, 'submitted');
  });

  it('AC-P1-7b the flag survives the builder wiping scheduling_context: no second flag, no second message', () => {
    const rows = DBA_ROWS.map((r) => r.id === 'a3c3684e-0dce-4a76-9552-08e59608a428' ? { ...r, status: 'submitted' } : r);
    const first = planAssignmentSync(base({ rows, tasks: [linkedTask({})] }));
    const after = applyPlan([linkedTask({})], first);
    after[0].scheduling_context = { pre_schedule_status: 'UP_NEXT', assignment_tier: 'A' }; // builder :835
    const second = planAssignmentSync(base({ rows, tasks: after }));
    assert.equal(second.updates.length, 0);
    assert.equal(buildSyncDigest(second, TZ), null);
  });

  it('AC-P1-8 a run with changes yields exactly ONE digest; a run with none yields zero', () => {
    const rows = DBA_ROWS.map((r) => r.id === 'a3c3684e-0dce-4a76-9552-08e59608a428'
      ? { ...r, status: 'submitted', due_date: '2026-11-16T04:59:59.000Z' } : r);
    const plan = planAssignmentSync(base({ rows, tasks: [linkedTask({})] }));
    const digest = buildSyncDigest(plan, TZ);
    assert.ok(digest);
    assert.equal(typeof digest!.message, 'string');
    assert.equal(digest!.lineCount, 4); // 2 new cards + due change + submitted flag
    const quiet = planAssignmentSync(base({ rows: [], tasks: [linkedTask({})] }));
    assert.equal(buildSyncDigest(quiet, TZ), null);
  });

  it('AC-P1-9 idempotent: a second run over the first run\'s result creates 0 and updates 0', () => {
    const first = planAssignmentSync(base());
    const tasks = applyPlan([], first).map((t) => ({ ...t, due_date: String(t.due_date).replace('.000Z', '+00:00') }));
    const second = planAssignmentSync(base({ tasks }));
    assert.equal(second.creates.length, 0);
    assert.equal(second.updates.length, 0);
    assert.equal(buildSyncDigest(second, TZ), null);
  });

  it('AC-P1-10 a non-current course (EMBA/MIT: no open item dated today+) is excluded', () => {
    const plan = planAssignmentSync(base({ rows: [...DBA_ROWS, ...NON_CURRENT_ROWS] }));
    assert.ok(!plan.creates.some((c) => /EMBA|MIT/.test(String(c.courseCode))));
    assert.deepEqual(plan.currentCourses.sort(), ['MGT-702', 'MGT-782']);
  });

  it('AC-P1-10b any course with an open dated-today+ item is imported the same way (no DBA hardcode)', () => {
    const future = { ...NON_CURRENT_ROWS[1], id: 'mit-future', due_date: '2026-11-03T04:59:00.000Z' };
    const plan = planAssignmentSync(base({ rows: [future] }));
    assert.equal(plan.creates.length, 1);
    assert.equal(plan.creates[0].courseCode, 'MIT-CTO');
    const src = readFileSync(new URL('./assignment-intake.ts', import.meta.url), 'utf8')
      + readFileSync(new URL('../nightly-assignment-sync/index.ts', import.meta.url), 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.ok(!/DBA|Doctorate|MGT-7/.test(code), 'no program/course literal in intake code');
    assert.ok(!/MIT_PROGRAM_ID|from\('assignments'\)/.test(code), 'old program literal / frozen table gone');
  });

  it('AC-P1-12 an unlinked card with the same title is linked, not duplicated', () => {
    const legacy: ExistingTask = { id: 'legacy', title: '📚 Research Paper', status: 'BACKLOG', completed_at: null,
      assignment_id: null, due_date: null, tags: [], scheduling_context: null };
    const plan = planAssignmentSync(base({ tasks: [legacy] }));
    assert.equal(plan.creates.length, 2);
    const link = plan.updates.find((u) => u.taskId === 'legacy')!;
    assert.equal(link.kind, 'link');
    assert.equal(link.patch.assignment_id, '6616bef3-cddb-49b1-b619-d83e660951f8');
  });

  it('AC-P1-13 no default board: nothing is created, the reason is counted', () => {
    const plan = planAssignmentSync(base({ boardId: null }));
    assert.equal(plan.creates.length, 0);
    assert.equal(plan.excluded.noBoard, 3);
  });

  it('AC-P1-8b the 1 am run delivers its message when quiet hours end (06:00 ET), not at 1 am', () => {
    assert.equal(digestSendAt(new Date('2026-10-29T05:00:00Z'), TZ, '22:00:00', '06:00:00'), '2026-10-29T10:00:00.000Z');
    assert.equal(digestSendAt(new Date('2026-10-30T03:30:00Z'), TZ, '22:00:00', '06:00:00'), '2026-10-30T10:00:00.000Z'); // 23:30 ET
    assert.equal(digestSendAt(new Date('2026-10-29T15:00:00Z'), TZ, '22:00:00', '06:00:00'), '2026-10-29T15:00:00.000Z');
    assert.equal(digestSendAt(new Date('2026-10-29T05:00:00Z'), TZ, null, null), '2026-10-29T05:00:00.000Z');
  });

  it('DRY-1 describePlan lists exactly what would be created, with local due times', () => {
    const d = describePlan(planAssignmentSync(base()), TZ);
    assert.deepEqual(d.would_create.map((c) => `${c.title} | ${c.due_local}`), [
      '📚 Research Proposal | Fri, Oct 30, 11:59 PM',
      '📚 Checkpoint 2 - Details | Sun, Nov 8, 11:59 PM',
      '📚 Research Paper | Wed, Dec 9, 11:59 PM',
    ]);
  });
});

describe('P1 Nexus read helper', () => {
  const ok = (body: unknown, status = 200) => async () => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });

  it('READ-1 reads {rows} from /api/d1/assignments?owner=<uuid> with no auth header', async () => {
    let seen: { url: string; init: any } | null = null;
    const r = await fetchNexusAssignments(OWNER, {
      baseUrl: 'https://nexus.example/',
      fetchImpl: async (url, init) => { seen = { url, init }; return ok({ rows: DBA_ROWS })(); },
    });
    assert.equal(r.ok, true);
    assert.equal(r.rows.length, 15);
    assert.equal(seen!.url, `https://nexus.example/api/d1/assignments?owner=${OWNER}`);
    assert.equal(seen!.init.method, 'GET');
    assert.ok(!('Authorization' in seen!.init.headers) && !('X-UAT-Token' in seen!.init.headers));
  });

  it('AC-P1-11 a 5xx / throw / malformed body is ok:false with no rows (the sync then writes nothing)', async () => {
    const fiveXX = await fetchNexusAssignments(OWNER, { fetchImpl: ok({ rows: DBA_ROWS }, 503) });
    assert.equal(fiveXX.ok, false);
    assert.equal(fiveXX.rows.length, 0, 'a 5xx body is never trusted, even if it parses');
    const thrown = await fetchNexusAssignments(OWNER, { fetchImpl: async () => { throw new Error('ECONNRESET'); } });
    assert.equal(thrown.ok, false);
    assert.equal(thrown.rows.length, 0);
    assert.equal((await fetchNexusAssignments(OWNER, { fetchImpl: ok({ nope: 1 }) })).ok, false);
  });
});
