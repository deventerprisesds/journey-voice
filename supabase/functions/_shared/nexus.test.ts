/**
 * WHAT:       Tests for the coursework bands and for the NIGHTLY BUILDER'S composed
 *             candidate ordering (AC-1.1 .. AC-1.4, AC-9c).
 * WHY:        The previous round proved its ordering with a unit test on `courseworkOrder`
 *             in isolation while the real defect lived in the builder's composed
 *             comparator, which that test never touched — see `.claude/accuracy-log.md`
 *             ("a unit test on the new function is not evidence the user-visible behaviour
 *             changed") and docs/verify/nudge-delivery-loop1.md §C7. So every ordering
 *             assertion below runs through `orderBuilderCandidates` /
 *             `builderCandidateComparator` — the exact functions
 *             nightly-schedule-builder/index.ts calls — with REAL rows.
 * SUPERSEDES: nothing.
 * SUPERSEDED-BY: nothing — current.
 * EVIDENCE:   fixtures captured live 2026-09-03 (each block names its query below).
 *
 * Run: `node --experimental-strip-types --test supabase/functions/_shared/nexus.test.ts`
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  courseworkBand,
  courseworkOrder,
  orderBuilderCandidates,
  builderCandidateComparator,
  resolveActiveCourseIds,
  DEFAULT_RECENT_OVERDUE_DAYS,
  DEFAULT_SOON_DAYS,
  DEFAULT_ACTIVE_COURSE_ERA_DAYS,
  type SchedulingTask,
} from './nexus.ts';

/**
 * THE REAL MIT COURSEWORK, captured 2026-09-03 via:
 *   select id, title, due_date, is_priority, priority_rank from public.tasks
 *   where user_id='a3378f93-d655-4913-b2fa-ca5b1d8020f1' and assignment_id is not null
 *     and (title ilike '%Required Assignment%' or title ilike '%apstone%')
 *   order by due_date nulls last;
 * Real ids, real due dates (note 23:59:59Z, not midnight), real priority_rank values.
 */
const MIT: SchedulingTask[] = [
  { id: 'a38655a1-6ab6-44fd-bc60-f426e295ccdf', short: '1.1', title: '📚 Required Assignment 1.1: The AI Moment', due_date: '2026-07-14 23:59:59+00', is_priority: true, priority_rank: 50, assignment_id: 'x1', score: 12 },
  { id: '1ad009a5-5721-4955-b773-cff40016934e', short: '2.1', title: '📚 Required Assignment 2.1: Can You Trust This AI Output?', due_date: '2026-07-21 23:59:59+00', is_priority: true, priority_rank: 19, assignment_id: 'x2', score: 31 },
  { id: '3135aecb-22c2-4d98-bc65-5375a5b4b0f1', short: '3.1', title: '📚 Required Assignment 3.1: Your Prompt in Practice', due_date: '2026-07-28 23:59:59+00', is_priority: true, priority_rank: 39, assignment_id: 'x3', score: 22 },
  { id: '75b740c8-1079-48be-91f3-5ecc26e68f9b', short: '4.1', title: '📚 Required Assignment 4.1: Teach What You Know', due_date: '2026-08-04 23:59:59+00', is_priority: true, priority_rank: 17, assignment_id: 'x4', score: 44 },
  { id: '709294ab-98e4-46c4-aaee-e771f36e25ab', short: '5.1', title: '📚 Required Assignment 5.1: Responsible AI Governance Brief', due_date: '2026-08-11 23:59:59+00', is_priority: true, priority_rank: 30, assignment_id: 'x5', score: 27 },
  { id: '4ea52e0c-d76b-4fa7-a06b-6b9d6f2b651a', short: '6.1', title: '📚 Required Assignment 6.1: AI Readiness Assessment', due_date: '2026-08-18 23:59:59+00', is_priority: true, priority_rank: 6, assignment_id: 'x6', score: 61 },
  { id: 'ab6dfc3d-b041-46d4-9a5f-8e93f7fa91c7', short: '7.1', title: '📚 Required Assignment 7.1: Your AI Economy Briefing', due_date: '2026-08-25 23:59:59+00', is_priority: true, priority_rank: 29, assignment_id: 'x7', score: 35 },
  { id: 'ea3f30c6-6bef-4fc8-85e9-671b09925c19', short: '8.1', title: '📚 Required Capstone Assignment 8.1: Your AI Strategy Brief', due_date: '2026-09-01 23:59:59+00', is_priority: true, priority_rank: 11, assignment_id: 'x8', score: 18 },
];

/** The instant the owner's expected list is pinned to. */
const NOW = Date.parse('2026-09-03T12:00:00Z');
const shortOf = (t: SchedulingTask) => String(t.short);
const allTierC: Record<string, 'A' | 'B' | 'C'> = Object.fromEntries(MIT.map((t) => [t.id, 'C' as const]));

/** Deterministic shuffle — a fixed seed, so a failure is always reproducible. */
function seededShuffle<T>(items: T[], seed: number): T[] {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------------------------------------------------------------------------
// AC-1.1 — the boundary constant moved to 14 and is still overridable
// ---------------------------------------------------------------------------
test('AC-1.1 recentDays default is 14, and an explicit recentDays still overrides it', () => {
  assert.equal(DEFAULT_RECENT_OVERDUE_DAYS, 14);
  const a61 = MIT.find((t) => t.short === '6.1')!; // 16.5 days overdue at NOW
  // Default (14): a 16.5-day miss is OLD BACKLOG.
  assert.equal(courseworkBand(a61 as any, { now: NOW }), 4);
  // The old default (30) still reachable per user via config.assignments.recentOverdueDays.
  // Band 2 = RECENTLY MISSED after the owner-approved 2026-09-03 swap (was band 3).
  assert.equal(courseworkBand(a61 as any, { now: NOW, recentDays: 30 }), 2);
});

test('AC-1.1 / RISK-8 the two 14-day constants are NOT the same knob', () => {
  // Both are 14 and they sit ~70 lines apart in the same file. This test fails if someone
  // edits one believing it is the other: each is asserted through its OWN effect.
  assert.equal(DEFAULT_ACTIVE_COURSE_ERA_DAYS, 14);   // how recently a COURSE was ingested
  assert.equal(DEFAULT_RECENT_OVERDUE_DAYS, 14);      // how recently an ASSIGNMENT was missed

  // Era days: two courses, ingested 20 days apart. The default admits only the newer one.
  const ingested = [
    { id: 'i1', course_id: 'live', created_at: '2026-09-01T00:00:00Z' },
    { id: 'i2', course_id: 'stale', created_at: '2026-08-12T00:00:00Z' },
  ] as any[];
  assert.deepEqual([...resolveActiveCourseIds(ingested)], ['live']);
  assert.deepEqual([...resolveActiveCourseIds(ingested, { eraDays: 30 })].sort(), ['live', 'stale']);
  // ...and it has NO effect on banding, which is the other constant's job.
  assert.equal(courseworkBand({ due_date: '2026-08-18 23:59:59+00' } as any, { now: NOW }), 4);
});

// ---------------------------------------------------------------------------
// AC-1.2 — all four dated band directions asserted in ONE test
// ---------------------------------------------------------------------------
test('AC-1.2 every band direction at once: 1 asc, 2 asc, 3 most-recent-miss-first, 4 OLDEST-FIRST', () => {
  // One test on purpose. Reversing band 4 by flipping an expression shared with another
  // band would silently reverse that band too; asserting all four here makes that fail.
  const mk = (id: string, due: string | null) => ({ id, title: id, due_date: due }) as any;
  const cmp = courseworkOrder({ now: NOW });

  // band 1 — due within soonDays -> soonest first
  const band1 = [mk('b1-late', '2026-09-15'), mk('b1-soon', '2026-09-04')].sort(cmp);
  assert.deepEqual(band1.map((t) => t.id), ['b1-soon', 'b1-late']);

  // band 2 — future beyond soonDays -> soonest first
  const band2 = [mk('b2-far', '2026-12-01'), mk('b2-near', '2026-10-01')].sort(cmp);
  assert.deepEqual(band2.map((t) => t.id), ['b2-near', 'b2-far']);

  // band 3 — missed within recentDays -> MOST RECENT miss first
  const band3 = [mk('b3-older', '2026-08-25'), mk('b3-newer', '2026-09-01')].sort(cmp);
  assert.deepEqual(band3.map((t) => t.id), ['b3-newer', 'b3-older']);

  // band 4 — old backlog -> OLDEST FIRST (the direction that changed 2026-09-03)
  const band4 = ['2026-08-04', '2026-07-14', '2026-07-28', '2026-07-21']
    .map((d) => mk(`b4-${d}`, d)).sort(cmp);
  assert.deepEqual(band4.map((t) => t.due_date), ['2026-07-14', '2026-07-21', '2026-07-28', '2026-08-04']);

  // band 5 — undated always last, whatever else is present
  const mixed = [mk('undated', null), mk('b4', '2026-07-14'), mk('b1', '2026-09-04')].sort(cmp);
  assert.equal(mixed[mixed.length - 1].id, 'undated');
  assert.equal(mixed[0].id, 'b1');
});

// ---------------------------------------------------------------------------
// AC-1.3 — the recent/old boundary is decided explicitly, both sides asserted
// ---------------------------------------------------------------------------
test('AC-1.3 a miss of exactly recentDays is RECENT; one millisecond older is not', () => {
  const band = (deltaMs: number) =>
    courseworkBand({ due_date: new Date(NOW - deltaMs).toISOString() } as any, { now: NOW });
  const fourteenDays = 14 * 86400000;
  // Band 2 = RECENTLY MISSED, band 3 = FUTURE (owner-approved swap 2026-09-03): a recent
  // miss must outrank far-future work, which is the defect the two-band predecessor was
  // replaced for. The boundary behaviour below is unchanged; only the numbering moved.
  assert.equal(band(fourteenDays), 2, 'exactly 14 days late is still a RECENT miss');
  assert.equal(band(fourteenDays - 1), 2, '14 days minus 1ms is recent');
  assert.equal(band(fourteenDays + 1), 4, '14 days plus 1ms is old backlog');
  // ...and the same inclusive rule on the soon/future boundary.
  assert.equal(DEFAULT_SOON_DAYS, 14);
  assert.equal(courseworkBand({ due_date: new Date(NOW + fourteenDays).toISOString() } as any, { now: NOW }), 1);
  assert.equal(courseworkBand({ due_date: new Date(NOW + fourteenDays + 1).toISOString() } as any, { now: NOW }), 3);
});

// ---------------------------------------------------------------------------
// AC-1.4 — the BUILDER's comparator is a valid total order
// ---------------------------------------------------------------------------
/**
 * The verifier's exact counterexample (docs/verify/nudge-delivery-loop1.md §C7):
 * C1 assignment band 1 score 10, C2 assignment band 4 score 90, N non-assignment score 50.
 * Under the old comparator: C1 < C2 (coursework), C2 < N (score), N < C1 (score) — a cycle,
 * and six permutations produced three different orders.
 */
const CYCLE_FIXTURE: SchedulingTask[] = [
  { id: 'C1', title: 'C1', due_date: '2026-09-05', score: 10, assignment_id: 'a', is_priority: false },
  { id: 'C2', title: 'C2', due_date: '2026-01-10', score: 90, assignment_id: 'b', is_priority: false },
  { id: 'N', title: 'N', due_date: null, score: 50, is_priority: false },
];
const CYCLE_TIERS: Record<string, 'A' | 'B' | 'C'> = { C1: 'C', C2: 'C' };

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const out: T[][] = [];
  items.forEach((x, i) => {
    for (const rest of permutations([...items.slice(0, i), ...items.slice(i + 1)])) out.push([x, ...rest]);
  });
  return out;
}

test("AC-1.4 the verifier's intransitivity counterexample now sorts identically in all 6 permutations", () => {
  const opts = { now: NOW, scoringModel: 'composite' as const, assignmentTier: CYCLE_TIERS };
  const results = permutations(CYCLE_FIXTURE)
    .map((p) => orderBuilderCandidates(p, opts).map((t) => t.id).join(','));
  assert.equal(new Set(results).size, 1, `expected one order, got: ${[...new Set(results)].join(' | ')}`);
});

test('AC-1.4 the builder comparator satisfies antisymmetry and transitivity over every triple', () => {
  // A ~24-item mixed fixture spanning all five bands and both score branches, built from
  // the real MIT rows plus non-assignment work.
  const nonAssignments: SchedulingTask[] = Array.from({ length: 8 }, (_, i) => ({
    id: `n-${i}`, title: `errand ${i}`, score: (i * 17) % 90,
    due_date: i % 3 === 0 ? null : `2026-0${(i % 9) + 1}-1${i % 9}`,
    is_priority: i % 2 === 0, priority_rank: i % 4 === 0 ? i : null,
  }));
  const future: SchedulingTask[] = [
    { id: 'f-soon', title: 'soon', due_date: '2026-09-06', score: 5, assignment_id: 'fa' },
    { id: 'f-far', title: 'far', due_date: '2026-12-20', score: 5, assignment_id: 'fb' },
    { id: 'f-undated', title: 'undated assignment', due_date: null, score: 5, assignment_id: 'fc' },
  ];
  const fixture = [...MIT, ...nonAssignments, ...future];
  const tiers: Record<string, 'A' | 'B' | 'C'> = {
    ...allTierC, 'f-soon': 'A', 'f-far': 'C', 'f-undated': 'C',
  };
  const cmp = builderCandidateComparator(fixture, {
    now: NOW, scoringModel: 'composite', assignmentTier: tiers,
  });

  for (const a of fixture) {
    assert.equal(cmp(a, a), 0, `reflexive: ${a.id}`);
    for (const b of fixture) {
      // `+ … === 0` rather than `=== -sign`: Object.is(-0, 0) is false and would fail on
      // the reflexive pair for a reason that has nothing to do with the ordering.
      assert.equal(Math.sign(cmp(a, b)) + Math.sign(cmp(b, a)), 0, `antisymmetry: ${a.id} vs ${b.id}`);
      for (const c of fixture) {
        if (cmp(a, b) <= 0 && cmp(b, c) <= 0) {
          assert.ok(cmp(a, c) <= 0, `transitivity broken: ${a.id} <= ${b.id} <= ${c.id} but not ${a.id} <= ${c.id}`);
        }
      }
    }
  }

  // ...and permutation-invariance over the same set, 200 deterministic shuffles.
  const expected = orderBuilderCandidates(fixture, {
    now: NOW, scoringModel: 'composite', assignmentTier: tiers,
  }).map((t) => t.id).join(',');
  for (let seed = 1; seed <= 200; seed++) {
    const got = orderBuilderCandidates(seededShuffle(fixture, seed), {
      now: NOW, scoringModel: 'composite', assignmentTier: tiers,
    }).map((t) => t.id).join(',');
    assert.equal(got, expected, `permutation ${seed} produced a different order`);
  }
});

// ---------------------------------------------------------------------------
// AC-1.x — the owner's pinned expected list, on BOTH paths the data takes
// ---------------------------------------------------------------------------
const OWNER_EXPECTED = ['8.1', '7.1', '1.1', '2.1', '3.1', '4.1', '5.1', '6.1'];

test("AC-1.5 the TOOL's order for the real MIT set matches the owner's pinned list", () => {
  // This is the ordering `list_pending_assignments` applies (execute-tool imports the same
  // courseworkOrder). Owner-final 2026-09-03, pinned at now = 2026-09-03T12:00Z:
  //   8.1, 7.1, 1.1, 2.1, 3.1, 4.1, 5.1, 6.1
  // 6.1 is 16.5 days late, so under recentDays=14 it is band 4 and sorts LAST — the
  // owner accepted this explicitly.
  const sorted = seededShuffle(MIT, 7).slice().sort(courseworkOrder({ now: NOW }) as any);
  assert.deepEqual(sorted.map(shortOf), OWNER_EXPECTED);
});

test("AC-1.6 the SCHEDULER places the real MIT set in that SAME order", () => {
  // The owner chose "work it first" as well as "show it first", so the builder's
  // placement order must equal the tool's list order. This runs the builder's own
  // ordering function, not courseworkOrder.
  const placed = orderBuilderCandidates(seededShuffle(MIT, 99), {
    now: NOW, scoringModel: 'composite', assignmentTier: allTierC,
  });
  assert.deepEqual(placed.map(shortOf), OWNER_EXPECTED);

  // And under the legacy scoring model too — the coursework order among assignments is
  // not supposed to depend on which score branch the user is on.
  const placedLegacy = orderBuilderCandidates(seededShuffle(MIT, 100), {
    now: NOW, scoringModel: 'priority-rank', assignmentTier: allTierC,
  });
  assert.deepEqual(placedLegacy.map(shortOf), OWNER_EXPECTED);
});

test('AC-1.6 an ordinary assignment still does not jump higher-scoring non-assignment work', () => {
  // The carve-out that must survive the total-order fix: score decides where Tier C sits
  // relative to non-assignment work; coursework order only arranges assignments among the
  // slots score already gave them.
  const hot: SchedulingTask = { id: 'hot', title: 'urgent errand', score: 999, due_date: null };
  const cold: SchedulingTask = { id: 'cold', title: 'someday errand', score: 0, due_date: null };
  const out = orderBuilderCandidates([...MIT, hot, cold], {
    now: NOW, scoringModel: 'composite', assignmentTier: allTierC,
  }).map((t) => String(t.id));
  assert.equal(out[0], 'hot', 'the 999-score non-assignment still leads');
  assert.equal(out[out.length - 1], 'cold', 'the 0-score non-assignment still trails');
  // ...while the assignments between them read in coursework order.
  const assignmentsInOrder = orderBuilderCandidates([...MIT, hot, cold], {
    now: NOW, scoringModel: 'composite', assignmentTier: allTierC,
  }).filter((t) => t.assignment_id).map(shortOf);
  assert.deepEqual(assignmentsInOrder, OWNER_EXPECTED);
});

test('AC-1.6 Tier A/B lead the queue, in coursework order within each tier', () => {
  const tiers: Record<string, 'A' | 'B' | 'C'> = {
    ...allTierC,
    [MIT[0].id]: 'B',  // 1.1 — oldest, but tier B
    [MIT[5].id]: 'A',  // 6.1 — tier A
  };
  const out = orderBuilderCandidates(seededShuffle(MIT, 5), {
    now: NOW, scoringModel: 'composite', assignmentTier: tiers,
  }).map(shortOf);
  assert.deepEqual(out.slice(0, 2), ['6.1', '1.1'], 'tier A then tier B lead');
  assert.deepEqual(out.slice(2), ['8.1', '7.1', '2.1', '3.1', '4.1', '5.1']);
});
