// WHAT:       Adversarial verifier tests for _shared/activities.ts (planPush, DST, update merge).
// WHY:        VERIFY-activities-reserved-time-1 claims 3, 6, 7. Not part of the suite; run with
//             node --experimental-strip-types --test docs/qc-evidence/activities-verify.test.ts
// SUPERSEDES: nothing. SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   docs/qc-evidence/VERIFY-activities-reserved-time-1.md
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planPush, expandActivitiesForDate, normalizeActivity, defaultActivities, type PushItem,
} from '../../supabase/functions/_shared/activities.ts';

const H = 3600000, M = 60000;
const T0 = Date.UTC(2026, 9, 29, 0, 0); // arbitrary day origin
const at = (h: number, m = 0) => T0 + h * H + m * M;
const task = (id: string, s: number, e: number, limit = at(22)): PushItem => ({ id, title: id, kind: 'task', startMs: s, endMs: e, movable: true, limitMs: limit });
const wall = (id: string, s: number, e: number): PushItem => ({ id, title: id, kind: 'event', startMs: s, endMs: e, movable: false, limitMs: 0 });
const ov = (a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }) => a.startMs < b.endMs && b.startMs < a.endMs;

function checkInvariants(items: PushItem[], bs: number, be: number) {
  const plan = planPush(items, bs, be);
  const byId = new Map(items.map((i) => [i.id, i]));
  // never move immovable
  for (const m of plan.moves) assert.equal(byId.get(m.id)!.movable, true, `moved immovable ${m.id}`);
  for (const o of plan.overflow) assert.equal(byId.get(o.id)!.movable, true, `overflowed immovable ${o.id}`);
  const overflowIds = new Set(plan.overflow.map((o) => o.id));
  const movedMap = new Map(plan.moves.map((m) => [m.id, m]));
  // final positions of every movable that is still scheduled and was displaced
  const finals = items.filter((i) => i.movable && !overflowIds.has(i.id) && i.endMs > bs)
    .map((i) => ({ id: i.id, startMs: movedMap.get(i.id)?.startMs ?? i.startMs, endMs: movedMap.get(i.id)?.endMs ?? i.endMs, orig: i }));
  for (const f of finals) {
    // duration preserved
    assert.equal(f.endMs - f.startMs, f.orig.endMs - f.orig.startMs);
    // not overlapping block or any immovable
    assert.ok(!ov(f, { startMs: bs, endMs: be }), `${f.id} overlaps block`);
    for (const w of items.filter((i) => !i.movable)) assert.ok(!ov(f, w), `${f.id} overlaps wall ${w.id}`);
    // within limit
    assert.ok(f.endMs <= f.orig.limitMs, `${f.id} exceeds limit`);
  }
  // no two placed items overlap each other
  for (let i = 0; i < finals.length; i++) for (let j = i + 1; j < finals.length; j++) {
    assert.ok(!ov(finals[i], finals[j]), `${finals[i].id} overlaps ${finals[j].id}`);
  }
  // order kept among placed displaced items
  const sortedOrig = [...finals].sort((a, b) => a.orig.startMs - b.orig.startMs || 0);
  for (let i = 1; i < sortedOrig.length; i++) assert.ok(sortedOrig[i].startMs >= sortedOrig[i - 1].startMs, 'order broken');
  return plan;
}

test('C3 back-to-back meetings after the block: task hops past both', () => {
  const items = [task('a', at(10), at(11)), wall('m1', at(12), at(13)), wall('m2', at(13), at(14))];
  const p = checkInvariants(items, at(10), at(12));
  assert.deepEqual(p.moves.map((m) => [m.id, m.startMs]), [['a', at(14)]]);
});

test('C3 item in progress at block start moves whole after block', () => {
  const items = [task('a', at(9, 30), at(10, 30))];
  const p = checkInvariants(items, at(10), at(12));
  assert.deepEqual(p.moves.map((m) => [m.startMs, m.endMs]), [[at(12), at(13)]]);
});

test('C3 items exactly touching the block are untouched', () => {
  const items = [task('before', at(9), at(10)), task('after', at(12), at(13))];
  const p = checkInvariants(items, at(10), at(12));
  assert.equal(p.moves.length, 0);
  assert.equal(p.overflow.length, 0);
});

test('C3 zero gaps chain, last one overflows instead of exceeding limit', () => {
  const items = [task('a', at(10), at(11), at(15)), task('b', at(11), at(12), at(15)), task('c', at(12), at(13), at(15)), task('d', at(13), at(14), at(15))];
  const p = checkInvariants(items, at(10), at(12));
  assert.deepEqual(p.moves.map((m) => m.id), ['a', 'b', 'c']);
  assert.deepEqual(p.overflow.map((o) => o.id), ['d']);
});

test('C3 block past end of day: everything displaced overflows', () => {
  const items = [task('a', at(21), at(21, 30), at(22))];
  const p = checkInvariants(items, at(21), at(23));
  assert.deepEqual(p.overflow.map((o) => o.id), ['a']);
});

test('C3 wall overlapping the block is a conflict and never moved', () => {
  const items = [wall('m', at(10, 30), at(11)), task('a', at(10), at(10, 30))];
  const p = checkInvariants(items, at(10), at(12));
  assert.deepEqual(p.conflicts.map((c) => c.id), ['m']);
});

test('C3 random property sweep (5000 cases)', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let ran = 0, moved = 0;
  for (let n = 0; n < 5000; n++) {
    const items: PushItem[] = [];
    const k = 1 + Math.floor(rnd() * 8);
    for (let i = 0; i < k; i++) {
      const s = at(8) + Math.floor(rnd() * 56) * 15 * M; // 8:00..22:00 in 15-min steps
      const d = (1 + Math.floor(rnd() * 8)) * 15 * M;
      if (rnd() < 0.35) items.push(wall(`w${i}`, s, s + d));
      else items.push(task(`t${i}`, s, s + d, at(17 + Math.floor(rnd() * 6))));
    }
    // movable tasks in the input must not overlap each other for the order/overlap property to be meaningful
    const ts = items.filter((i) => i.movable).sort((a, b) => a.startMs - b.startMs);
    let okInput = true;
    for (let i = 1; i < ts.length; i++) if (ts[i].startMs < ts[i - 1].endMs) okInput = false;
    if (!okInput) continue;
    ran++;
    const bs = at(9) + Math.floor(rnd() * 48) * 15 * M;
    const pl = checkInvariants(items, bs, bs + 120 * M); if (pl.moves.length) moved++;
  }
  console.log(`sweep ran=${ran} withMoves=${moved}`);
});

test('C3 a task already overlapping a meeting AFTER the block (pre-existing conflict) still ends clean', () => {
  const items = [task('a', at(10), at(11)), wall('m', at(12), at(13)), task('b', at(12, 30), at(13, 30))];
  checkInvariants(items, at(10), at(12));
});

const NY = 'America/New_York';
const localHHMM = (iso: string, tz: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

test('C6 locked 10:00 activity lands at 10:00 local either side of US DST changes', () => {
  const church = { id: 'c', name: 'Church', kind: 'recurring' as const, mode: 'locked' as const, start: '10:00', durationMin: 90, days: [0, 1, 2, 3, 4, 5, 6] };
  for (const d of ['2026-03-07', '2026-03-08', '2026-03-09', '2026-10-31', '2026-11-01', '2026-11-02']) {
    for (const tz of [NY, 'America/Los_Angeles', 'America/Phoenix']) {
      const [b] = expandActivitiesForDate([church], d, tz);
      assert.equal(localHHMM(b.start_time, tz), '10:00', `${d} ${tz} -> ${b.start_time}`);
      assert.equal(new Date(b.start_time).toLocaleDateString('en-CA', { timeZone: tz }), d);
    }
  }
});

test('C6 (probe, informational) early-morning locked activity on DST day', () => {
  const a = { id: 'x', name: 'X', kind: 'recurring' as const, mode: 'locked' as const, start: '03:00', durationMin: 30, days: [0] };
  const [b] = expandActivitiesForDate([a], '2026-03-08', NY);
  console.log('03:00 on 2026-03-08 NY ->', b.start_time, 'local', localHHMM(b.start_time, NY));
});

// mirror of execute-tool updateActivity merge (supabase/functions/execute-tool/index.ts updateActivity)
function updateLikeTool(current: any, args: any) {
  const merged = { ...current };
  for (const [k, v] of Object.entries(args || {})) {
    if (v === undefined || k === 'activity_id' || k === 'activity') continue;
    if (k === 'new_name') { merged.name = v; continue; }
    if (k === 'name') continue;
    merged[k] = v;
  }
  return normalizeActivity({ ...merged, id: current.id, createdAt: current.createdAt });
}

test('C7 update duration_min overrides stored durationMin', () => {
  const church = normalizeActivity({ name: 'Church', kind: 'recurring', start: '10:00', duration_min: 90, days: [0] }).activity!;
  const r = updateLikeTool(church, { name: 'Church', duration_min: 45 });
  assert.equal(r.activity!.durationMin, 45);
});

test('C7 update start and days', () => {
  const church = normalizeActivity({ name: 'Church', kind: 'recurring', start: '10:00', duration_min: 90, days: [0] }).activity!;
  const r = updateLikeTool(church, { name: 'Church', start: '11:15', days: [6] });
  assert.equal(r.activity!.start, '11:15');
  assert.deepEqual(r.activity!.days, [6]);
});

test('C7 update every_n_weeks back to 1 clears biweekly', () => {
  const oneone = normalizeActivity({ name: '1:1 Sam', kind: 'recurring', start: '14:00', duration_min: 30, days: [2], every_n_weeks: 2, anchor_date: '2026-10-27' }).activity!;
  const r = updateLikeTool(oneone, { name: '1:1 Sam', every_n_weeks: 1 });
  assert.equal(r.activity!.everyNWeeks, undefined);
});

test('C7 PROBE: floating lunch start moved to 15:00 keeps stale earliest/latest', () => {
  const lunch = defaultActivities({})[0];
  const r = updateLikeTool(lunch, { name: 'Lunch', start: '15:00' });
  console.log('updated lunch:', JSON.stringify({ start: r.activity?.start, earliest: r.activity?.earliest, latest: r.activity?.latest, error: r.error }));
  if (r.activity) {
    const [b] = expandActivitiesForDate([r.activity], '2026-10-28', NY);
    console.log('expanded lunch block local:', localHHMM(b.start_time, NY), '-', localHHMM(b.end_time, NY), 'conflict', b.conflict);
  }
});

test('C7 PROBE: pushes_schedule:false cannot turn off stored pushesSchedule:true', () => {
  const gym = defaultActivities({})[1];
  const r = updateLikeTool(gym, { name: 'Gym', pushes_schedule: false });
  console.log('gym pushesSchedule after pushes_schedule:false ->', r.activity?.pushesSchedule);
});
