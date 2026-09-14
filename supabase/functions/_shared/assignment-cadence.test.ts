// Offline unit tests for the shared due-date cadence inference. Run:
//   node --experimental-strip-types --test supabase/functions/_shared/assignment-cadence.test.ts
// and, for the timezone half of AC-2c:
//   TZ=America/New_York node --experimental-strip-types --test supabase/functions/_shared/assignment-cadence.test.ts
//
// WHAT:       Proves the three properties the module claims — deterministic, never overwrites,
//             visibly marked — plus the per-course grouping the course-unpinning change requires.
// WHY:        `.claude/accuracy-log.md`: "My tests could not have failed: they called my new
//             function directly, never the path that persists and renders the message." These
//             tests use the REAL 16-row MIT fixture measured from Nexus on 2026-09-03
//             (docs/impl/laneB-assignment-intake.md §1.1), not a convenient invented one, and
//             assert the concrete dates the owner named as literals.
// EVIDENCE:   docs/ac/nudge-and-ordering-ACs.md AC-2c, AC-2d, AC-2e.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inferMissingDueDates,
  inferMissingDueDatesByCourse,
  isDueDateInferred,
  assignmentSequence,
  parseDueMs,
  DUE_DATE_INFERRED_KEY,
  WEEK_MS,
  type CadenceAssignment,
} from './assignment-cadence.ts';

const SILENT = { log: null };
const MIT = '8036ebab-d1bc-460b-92b0-c45fb312a12e';

/** The real course, exactly as Nexus held it before the AC-2a data fix. */
function mitFixture(): CadenceAssignment[] {
  const dated: Array<[number, string]> = [
    [1, '2026-07-14T16:29:00+00:00'],
    [2, '2026-07-21T16:29:00+00:00'],
    [3, '2026-07-28T16:29:00+00:00'],
    [4, '2026-08-04T16:29:00+00:00'],
    [5, '2026-08-11T16:29:00+00:00'],
    [6, '2026-08-18T16:29:00+00:00'],
  ];
  return [
    ...dated.map(([n, d]) => ({
      id: `req-${n}`, course_id: MIT, points: 1,
      title: `Required Assignment ${n}.1: something`, due_date: d,
    })),
    { id: 'req-7', course_id: MIT, points: 1, title: 'Required Assignment 7.1: Your AI Economy Briefing', due_date: null },
    { id: 'req-8', course_id: MIT, points: 1, title: 'Required Capstone Assignment 8.1: Your AI Strategy Brief', due_date: null },
    // The eight ungraded Captain's Logs carry no N.M sequence AND no date. They must stay
    // undated: guessing a deadline for an item that has no place in the sequence is exactly
    // the "presented as fact" failure AC-2e exists to stop.
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `log-${i + 1}`, course_id: MIT, points: 0,
      title: `Module ${i + 1}: Captain's Log`, due_date: null,
    })),
  ];
}

const byId = (rows: CadenceAssignment[]) => new Map(rows.map((r) => [String(r.id), r]));

// ---------------------------------------------------------------------------
// AC-2c — deterministic across input order and timezone
// ---------------------------------------------------------------------------

test('AC-2c: infers the owner-stated dates 7.1 -> 2026-08-25 and 8.1 -> 2026-09-01', () => {
  const out = byId(inferMissingDueDates(mitFixture(), SILENT));
  // Asserted as LITERALS, per AC-2c. The time of day is the course's own 16:29Z cadence,
  // not midnight — every dated item in the course is at 16:29Z.
  assert.equal(out.get('req-7')!.due_date, '2026-08-25T16:29:00.000Z');
  assert.equal(out.get('req-8')!.due_date, '2026-09-01T16:29:00.000Z');
});

test('AC-2c: 20 shuffles of the input produce ONE distinct result set', () => {
  // Deterministic shuffle (seeded LCG) so a failure is reproducible.
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const shuffle = <T,>(xs: T[]): T[] => {
    const a = xs.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const canonical = (rows: CadenceAssignment[]) => JSON.stringify(
    rows.map((r) => [String(r.id), r.due_date ?? null, isDueDateInferred(r)])
      .sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
  );

  const results = new Set<string>();
  for (let i = 0; i < 20; i++) {
    results.add(canonical(inferMissingDueDates(shuffle(mitFixture()), SILENT)));
  }
  assert.equal(results.size, 1, `expected 1 distinct result, got ${results.size}`);
});

test('AC-2c: a tied latest date cannot let input order pick the anchor', () => {
  // Two items share the latest date. A stable sort with no tie-break would hand the anchor to
  // whichever arrived first, so the two orderings below would infer different dates for 5.1.
  const rows = (order: 'ab' | 'ba'): CadenceAssignment[] => {
    const a = { id: 'a', course_id: 'c', title: 'Assignment 3.1', due_date: '2026-08-18T16:29:00Z' };
    const b = { id: 'b', course_id: 'c', title: 'Assignment 4.1', due_date: '2026-08-18T16:29:00Z' };
    const gap = { id: 'g', course_id: 'c', title: 'Assignment 5.1', due_date: null };
    return order === 'ab' ? [a, b, gap] : [b, a, gap];
  };
  const ab = byId(inferMissingDueDates(rows('ab'), SILENT)).get('g')!.due_date;
  const ba = byId(inferMissingDueDates(rows('ba'), SILENT)).get('g')!.due_date;
  assert.equal(ab, ba);
  // Highest sequence wins the tie -> anchor is 4.1, so 5.1 is one week on.
  assert.equal(ab, '2026-08-25T16:29:00.000Z');
});

test('AC-2c: an offset-less timestamp is read as UTC, so TZ cannot move the inferred day', () => {
  // This is the determinism trap: Date.parse treats "2026-08-18T16:29:00" as LOCAL time. Under
  // TZ=America/New_York that is 20:29Z, which would shift the inferred date's rendered day.
  // parseDueMs pins it to UTC explicitly.
  assert.equal(parseDueMs('2026-08-18T16:29:00'), Date.parse('2026-08-18T16:29:00Z'));
  assert.equal(parseDueMs('2026-08-18 16:29:00+00'), Date.parse('2026-08-18T16:29:00Z'));
  assert.equal(parseDueMs('2026-08-18'), Date.parse('2026-08-18T00:00:00Z'));

  const rows: CadenceAssignment[] = [
    { id: 'a', course_id: 'c', title: 'Assignment 6.1', due_date: '2026-08-18T16:29:00' },
    { id: 'b', course_id: 'c', title: 'Assignment 7.1', due_date: null },
  ];
  assert.equal(byId(inferMissingDueDates(rows, SILENT)).get('b')!.due_date, '2026-08-25T16:29:00.000Z');
  // ...and the process TZ is genuinely not consulted anywhere in the module.
  assert.equal(WEEK_MS, 7 * 24 * 60 * 60 * 1000);
});

// ---------------------------------------------------------------------------
// AC-2d — never overwrites a real date
// ---------------------------------------------------------------------------

test('AC-2d: a date that CONTRADICTS the cadence is returned unchanged and unmarked', () => {
  const rows = mitFixture();
  // 5.1 deliberately violates the weekly cadence. A "recompute anyway" implementation would
  // rewrite it to 2026-08-11; a `?? inferred` one would keep it by luck. Neither may pass.
  const i5 = rows.findIndex((r) => r.id === 'req-5');
  rows[i5] = { ...rows[i5], due_date: '2026-08-30T09:00:00Z' };

  const out = inferMissingDueDates(rows, SILENT);
  const got = byId(out).get('req-5')!;
  assert.equal(got.due_date, '2026-08-30T09:00:00Z');
  assert.equal(isDueDateInferred(got), false);
  assert.equal(DUE_DATE_INFERRED_KEY in got, false);
});

test('AC-2d: every dated row comes back by REFERENCE — untouched, not rebuilt', () => {
  const rows = mitFixture();
  const out = inferMissingDueDates(rows, SILENT);
  rows.forEach((row, i) => {
    if (row.due_date != null) {
      assert.equal(out[i], row, `dated row ${row.id} was rebuilt instead of passed through`);
    }
  });
});

test('AC-2d: a present-but-unparseable value is left alone, never replaced', () => {
  // The adversarial case from AC-2d: `a.due_date ?? inferred` silently overwrites '' and 'null'.
  for (const bad of ['', '   ', 'null', 'not a date']) {
    const rows: CadenceAssignment[] = [
      { id: 'a', course_id: 'c', title: 'Assignment 6.1', due_date: '2026-08-18T16:29:00Z' },
      { id: 'b', course_id: 'c', title: 'Assignment 7.1', due_date: bad },
    ];
    const got = byId(inferMissingDueDates(rows, SILENT)).get('b')!;
    assert.equal(got.due_date, bad, `value ${JSON.stringify(bad)} was overwritten`);
    assert.equal(isDueDateInferred(got), false);
  }
});

test('AC-2d: an item with no place in the sequence is NOT given a guessed date', () => {
  const out = byId(inferMissingDueDates(mitFixture(), SILENT));
  for (let i = 1; i <= 8; i++) {
    const log = out.get(`log-${i}`)!;
    assert.equal(log.due_date, null, `Captain's Log ${i} was given an invented deadline`);
    assert.equal(isDueDateInferred(log), false);
  }
  // Sequence at or BEFORE the anchor is also refused — backfilling a past gap from a later
  // anchor would assert a deadline that has already passed.
  const rows: CadenceAssignment[] = [
    { id: 'anchor', course_id: 'c', title: 'Assignment 6.1', due_date: '2026-08-18T16:29:00Z' },
    { id: 'earlier', course_id: 'c', title: 'Assignment 2.1', due_date: null },
    { id: 'same', course_id: 'c', title: 'Assignment 6.2', due_date: null },
  ];
  const out2 = byId(inferMissingDueDates(rows, SILENT));
  assert.equal(out2.get('earlier')!.due_date, null);
  assert.equal(out2.get('same')!.due_date, null);
});

test('AC-2d: with no dated row at all, nothing is invented', () => {
  const rows: CadenceAssignment[] = [
    { id: 'a', course_id: 'c', title: 'Assignment 1.1', due_date: null },
    { id: 'b', course_id: 'c', title: 'Assignment 2.1', due_date: null },
  ];
  const out = inferMissingDueDates(rows, SILENT);
  assert.deepEqual(out.map((r) => r.due_date), [null, null]);
  assert.equal(out.some(isDueDateInferred), false);
});

// ---------------------------------------------------------------------------
// AC-2e — visibly marked as inferred
// ---------------------------------------------------------------------------

test('AC-2e: exactly the inferred rows carry the marker, and no others', () => {
  const out = inferMissingDueDates(mitFixture(), SILENT);
  const marked = out.filter(isDueDateInferred).map((r) => String(r.id)).sort();
  assert.deepEqual(marked, ['req-7', 'req-8']);
  // The marker is the literal key the persistence site branches on.
  assert.equal((out.find((r) => r.id === 'req-7') as any)[DUE_DATE_INFERRED_KEY], true);
});

test('AC-2e: the inference is audible — one log line per inferred row', () => {
  const lines: string[] = [];
  inferMissingDueDates(mitFixture(), { log: (m) => lines.push(m) });
  assert.equal(lines.length, 2);
  assert.match(lines[0], /Inferred due date/);
  assert.match(lines.join('\n'), /2026-08-25/);
  assert.match(lines.join('\n'), /2026-09-01/);
});

// ---------------------------------------------------------------------------
// AC-3 fallout — per-course grouping, required once the course pin is gone
// ---------------------------------------------------------------------------

test('AC-3: a second course cannot supply the anchor for the first', () => {
  // THE BUG THE COURSE PIN WAS HIDING. Course B was ingested later and has a much newer
  // deadline. Ungrouped, B's 2026-10-06 anchor would date course A's 7.1 — a date from a
  // course the assignment does not belong to.
  const rows: CadenceAssignment[] = [
    { id: 'a6', course_id: 'A', title: 'Required Assignment 6.1', due_date: '2026-08-18T16:29:00Z' },
    { id: 'a7', course_id: 'A', title: 'Required Assignment 7.1', due_date: null },
    { id: 'b3', course_id: 'B', title: 'Required Assignment 3.1', due_date: '2026-10-06T12:00:00Z' },
    { id: 'b4', course_id: 'B', title: 'Required Assignment 4.1', due_date: null },
  ];

  const grouped = byId(inferMissingDueDatesByCourse(rows, SILENT));
  assert.equal(grouped.get('a7')!.due_date, '2026-08-25T16:29:00.000Z'); // from A's own 6.1
  assert.equal(grouped.get('b4')!.due_date, '2026-10-13T12:00:00.000Z'); // from B's own 3.1

  // Prove the grouping is what does it: ungrouped, A's 7.1 is dated off course B.
  const ungrouped = byId(inferMissingDueDates(rows, SILENT));
  assert.notEqual(ungrouped.get('a7')!.due_date, grouped.get('a7')!.due_date);
});

test('AC-3: grouping preserves INPUT order, not group order', () => {
  const rows: CadenceAssignment[] = [
    { id: '0', course_id: 'B', title: 'Required Assignment 3.1', due_date: '2026-10-06T12:00:00Z' },
    { id: '1', course_id: 'A', title: 'Required Assignment 6.1', due_date: '2026-08-18T16:29:00Z' },
    { id: '2', course_id: 'B', title: 'Required Assignment 4.1', due_date: null },
    { id: '3', course_id: 'A', title: 'Required Assignment 7.1', due_date: null },
  ];
  const out = inferMissingDueDatesByCourse(rows, SILENT);
  assert.deepEqual(out.map((r) => String(r.id)), ['0', '1', '2', '3']);
  assert.equal(out[3].due_date, '2026-08-25T16:29:00.000Z');
});

test('AC-3: the real MIT fixture is unaffected by grouping (one course in it)', () => {
  const flat = byId(inferMissingDueDates(mitFixture(), SILENT));
  const grouped = byId(inferMissingDueDatesByCourse(mitFixture(), SILENT));
  for (const id of ['req-7', 'req-8']) {
    assert.equal(grouped.get(id)!.due_date, flat.get(id)!.due_date);
  }
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

test('assignmentSequence returns null (not a sentinel) when there is no N.M', () => {
  assert.equal(assignmentSequence('Required Assignment 7.1: x'), 7);
  assert.equal(assignmentSequence('Required Capstone Assignment 8.1: x'), 8);
  assert.equal(assignmentSequence("Module 3: Captain's Log"), null);
  assert.equal(assignmentSequence(''), null);
  assert.equal(assignmentSequence(null), null);
  assert.equal(assignmentSequence(undefined), null);
});

test('parseDueMs returns null for the empty and unparseable cases', () => {
  assert.equal(parseDueMs(null), null);
  assert.equal(parseDueMs(undefined), null);
  assert.equal(parseDueMs(''), null);
  assert.equal(parseDueMs('   '), null);
  assert.equal(parseDueMs('not a date'), null);
});

test('an empty or single-element list is handled without throwing', () => {
  assert.deepEqual(inferMissingDueDates([], SILENT), []);
  assert.deepEqual(inferMissingDueDatesByCourse([], SILENT), []);
  const one: CadenceAssignment[] = [{ id: 'x', course_id: 'c', title: 'Assignment 1.1', due_date: null }];
  assert.equal(inferMissingDueDates(one, SILENT)[0].due_date, null);
});
