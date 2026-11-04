// WHAT:       Tests for the work-session grouping display layer (src/lib/workSessions.ts).
// WHY:        Grouping hides cards from list views; it must never hide work it cannot attach.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   owner 2026-11-04: one assignment with "1 of x" blocks, grouped by default, switchable.
// Run: node --experimental-strip-types --test src/lib/workSessions.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { groupWorkSessions, resolveSessionDisplay, findSessionParent, sessionsOf } from './workSessions.ts';

const parent = { id: 'p', title: '📚 Research Paper', assignment_id: 'nx1', status: 'UP_NEXT' };
const s = (k: number, extra: Record<string, unknown> = {}) => ({
  id: `s${k}`, title: `📚 Research Paper — session ${k} of 3`, assignment_id: `nx1::session-${k}`,
  status: 'UP_NEXT', tags: ['work-session'], start_time: `2026-11-0${4 + k}T00:00:00Z`, ...extra,
});
const other = { id: 'o', title: 'Order fat burners', status: 'TODO' };

describe('work-session grouping (display only)', () => {
  it('G1 sessions with their assignment in the list collapse into ONE card carrying progress', () => {
    const out = groupWorkSessions([parent, s(1, { status: 'DONE' }), s(2), s(3), other]);
    assert.deepEqual(out.map((t) => t.id), ['p', 'o']);
    const ws = out[0].workSessions!;
    assert.equal(ws.total, 3);
    assert.equal(ws.done, 1);
    assert.equal(ws.next!.id, 's2');
    assert.deepEqual(ws.sessions.map((x) => x.id), ['s1', 's2', 's3']);
  });

  it('G2 a session whose assignment is NOT in the list stays visible (grouping never hides work)', () => {
    const out = groupWorkSessions([s(1), other]);
    assert.deepEqual(out.map((t) => t.id), ['s1', 'o']);
  });

  it('G3 retired sessions are absorbed but not counted', () => {
    const out = groupWorkSessions([parent, s(1), s(2, { tags: ['work-session', 'session-not-needed'] })]);
    assert.deepEqual(out.map((t) => t.id), ['p']);
    assert.equal(out[0].workSessions!.total, 1);
  });

  it('G4 next is the EARLIEST unfinished scheduled session, not the lowest number', () => {
    const out = groupWorkSessions([parent, s(1, { start_time: '2026-11-20T00:00:00Z' }), s(2, { start_time: '2026-11-06T00:00:00Z' })]);
    assert.equal(out[0].workSessions!.next!.id, 's2');
  });

  it('G5 a parent with no sessions is returned untouched', () => {
    const out = groupWorkSessions([parent, other]);
    assert.equal(out[0].workSessions, undefined);
  });

  it('D1 display defaults to grouped; only an explicit "separate" switches it', () => {
    assert.equal(resolveSessionDisplay(undefined), 'grouped');
    assert.equal(resolveSessionDisplay({ assignmentSessions: {} }), 'grouped');
    assert.equal(resolveSessionDisplay({ assignmentSessions: { display: 'separate' } }), 'separate');
    assert.equal(resolveSessionDisplay({ assignmentSessions: { display: 'nonsense' } }), 'grouped');
  });

  it('P1 detail view: a session finds its assignment, and the assignment lists its sessions in order', () => {
    const all = [s(3), parent, s(1), other];
    assert.equal(findSessionParent(s(1), all)!.id, 'p');
    assert.equal(findSessionParent(other as any, all), null);
    assert.deepEqual(sessionsOf(parent, all).map((x) => x.id), ['s1', 's3']);
  });
});
