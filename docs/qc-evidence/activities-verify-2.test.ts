// WHAT:       Loop-2 verifier harness: runs the REAL execute-tool activity functions (extracted verbatim
//             from supabase/functions/execute-tool/index.ts at test time) against a mock Supabase client.
// WHY:        index.ts imports deno.land/esm.sh and cannot be imported by node; a hand-written mirror can
//             drift. Extracting the source text at run time keeps the test bound to the shipped code.
// SUPERSEDES: nothing. SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   docs/qc-evidence/VERIFY-activities-reserved-time-2.md
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const REPO = resolve(import.meta.dirname, '../..');
const src = readFileSync(join(REPO, 'supabase/functions/execute-tool/index.ts'), 'utf8').split('\n');
const startIdx = src.findIndex((l) => l.startsWith('async function readActivityPrefs('));
const endIdx = src.findIndex((l) => l.startsWith('async function unscheduleTask('));
const errStart = src.findIndex((l) => l.startsWith('function extractErrorMessage('));
assert.ok(startIdx > 0 && endIdx > startIdx && errStart > 0, 'anchors found');
let errEnd = errStart; while (src[errEnd] !== '}') errEnd++;
const S = (p: string) => 'file://' + join(REPO, p);
const body = [
  `import { normalizeDueDate, normalizeDateTime, getTodayInTimezone, formatInTimezone, localDateToUtcBounds } from '${S('supabase/functions/_shared/timezone.ts')}';`,
  `import { activityBusySlots, resolveActivities, normalizeActivity, matchActivity, planPush, toMinutes, minutesToHHMM, parseClockTime } from '${S('supabase/functions/_shared/activities.ts')}';`,
  `import { resolveConfig } from '${S('supabase/functions/_shared/scheduling-defaults.ts')}';`,
  `type PushItem = any; type ExecuteToolResponse = any;`,
  ...src.slice(errStart, errEnd + 1),
  ...src.slice(startIdx, endIdx),
  `export { readActivityPrefs, writeActivityConfig, addActivity, updateActivity, removeActivity, skipActivity, startActivity, undoActivityStart };`,
].join('\n');
const dir = mkdtempSync(join(tmpdir(), 'actmirror-'));
writeFileSync(join(dir, 'mirror.ts'), body);
const M: any = await import('file://' + join(dir, 'mirror.ts'));

// ---- mock supabase ---------------------------------------------------------
type Log = { table: string; op: string; payload?: any; filters: any[] }[];
function mockSb(opts: { prefs?: any; prefsError?: any; tasks?: any[]; events?: any[]; failTaskUpdateAt?: number; upsertError?: any }) {
  const log: Log = [];
  let taskUpdates = 0;
  function builder(table: string) {
    const entry: any = { table, op: 'select', filters: [] };
    const b: any = {
      select() { return b; },
      eq(...a: any[]) { entry.filters.push(['eq', ...a]); return b; },
      neq(...a: any[]) { entry.filters.push(['neq', ...a]); return b; },
      gte(...a: any[]) { entry.filters.push(['gte', ...a]); return b; },
      lt(...a: any[]) { entry.filters.push(['lt', ...a]); return b; },
      lte(...a: any[]) { entry.filters.push(['lte', ...a]); return b; },
      maybeSingle() { log.push(entry); return Promise.resolve(opts.prefsError ? { data: null, error: opts.prefsError } : { data: opts.prefs ?? null, error: null }); },
      upsert(p: any) { entry.op = 'upsert'; entry.payload = structuredClone(p); log.push(entry); return Promise.resolve({ error: opts.upsertError ?? null }); },
      update(p: any) { entry.op = 'update'; entry.payload = p; return b; },
      then(res: any, rej: any) {
        log.push(entry);
        if (entry.op === 'update' && table === 'tasks') {
          taskUpdates++;
          if (opts.failTaskUpdateAt && taskUpdates === opts.failTaskUpdateAt) return Promise.resolve({ error: { message: 'boom' } }).then(res, rej);
          return Promise.resolve({ error: null }).then(res, rej);
        }
        if (table === 'tasks') return Promise.resolve({ data: opts.tasks ?? [], error: null }).then(res, rej);
        if (table === 'external_calendar_events') return Promise.resolve({ data: opts.events ?? [], error: null }).then(res, rej);
        return Promise.resolve({ data: null, error: null }).then(res, rej);
      },
    };
    return b;
  }
  return { sb: { from: builder }, log };
}

const FULL = {
  timeWindows: { work: { start: 9, end: 17 } },
  categoryMappings: { WORK: { defaultTimeWindow: ['work'] } },
  caveats: [{ id: 'c1' }], contextRules: { x: 1 },
  activities: [{ id: 'gym', name: 'Gym', kind: 'recurring', mode: 'locked', start: '18:00', durationMin: 60, days: [0,1,2,3,4,5,6], enabled: true, aliases: ['gym'] }],
};

// ---- Claim 5: a failed read never writes ----------------------------------
const writers: [string, (sb: any) => Promise<any>][] = [
  ['add', (sb) => M.addActivity(sb, 'u1', { name: 'Church', kind: 'recurring', mode: 'locked', start: '10:00', duration_min: 90, days: [0] })],
  ['update', (sb) => M.updateActivity(sb, 'u1', { name: 'Gym', start: '19:00' })],
  ['remove', (sb) => M.removeActivity(sb, 'u1', { name: 'Gym' })],
  ['skip', (sb) => M.skipActivity(sb, 'u1', { name: 'Gym' })],
  ['start', (sb) => M.startActivity(sb, 'u1', { name: 'Gym', start_time: '09:30' })],
  ['undo', (sb) => M.undoActivityStart(sb, 'u1')],
];
for (const [n, fn] of writers) {
  test(`C5 ${n}: failed prefs read -> no upsert, no task update, success:false`, async () => {
    const { sb, log } = mockSb({ prefsError: { message: 'timeout' } });
    const r = await fn(sb);
    assert.equal(r.success, false);
    assert.match(String(r.error), /Could not read scheduling settings/);
    assert.equal(log.filter((e) => e.op === 'upsert' || e.op === 'update').length, 0);
  });
  test(`C5 ${n}: successful read -> upsert keeps every other config key`, async () => {
    const prefs = { config: { ...structuredClone(FULL), lastActivityStart: { instanceId: 'adhoc_gym_x', tasks: [] } }, timezone: 'America/New_York' };
    const { sb, log } = mockSb({ prefs });
    const r = await fn(sb);
    const ups = log.filter((e) => e.op === 'upsert');
    assert.equal(r.success, true, JSON.stringify(r));
    assert.equal(ups.length, 1);
    for (const k of ['timeWindows', 'categoryMappings', 'caveats', 'contextRules']) assert.deepEqual(ups[0].payload.config[k], (FULL as any)[k], k);
    assert.deepEqual(Object.keys(ups[0].payload).sort(), ['config', 'user_id']);
  });
}

// ---- Claim 4: startActivity ----------------------------------------------
test('C4 start: config (block + undo) is upserted BEFORE any task update', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const tasks = [
    { id: 't1', title: 'A', start_time: new Date(`${today}T13:30:00Z`).toISOString(), end_time: new Date(`${today}T14:30:00Z`).toISOString(), category: 'WORK', status: 'TODO' },
    { id: 't2', title: 'B', start_time: new Date(`${today}T14:30:00Z`).toISOString(), end_time: new Date(`${today}T15:00:00Z`).toISOString(), category: 'WORK', status: 'TODO' },
  ];
  const { sb, log } = mockSb({ prefs: { config: structuredClone(FULL), timezone: 'America/New_York' }, tasks, failTaskUpdateAt: 2 });
  const r = await M.startActivity(sb, 'u1', { name: 'Gym', start_time: '09:30' });
  const writes = log.filter((e) => e.op === 'upsert' || e.op === 'update');
  assert.equal(writes[0].op, 'upsert', 'first write is the config');
  assert.ok(writes.some((w) => w.op === 'update'), 'tasks were updated after');
  const undo = writes[0].payload.config.lastActivityStart;
  assert.deepEqual(undo.tasks.map((t: any) => t.id).sort(), ['t1', 't2']);
  assert.equal(undo.tasks.find((t: any) => t.id === 't1').start_time, tasks[0].start_time);
  assert.ok(writes[0].payload.config.activities.some((a: any) => a.id === undo.instanceId), 'block stored');
  assert.equal(r.success, false); // second update failed
  assert.match(r.error, /undo/);
  // every task update is user-scoped
  for (const w of writes.filter((x) => x.op === 'update')) assert.ok(w.filters.some((f: any) => f[1] === 'user_id' && f[2] === 'u1'));
});

const startCases: [string, string | null][] = [
  ['9:30', '09:30'], ['09:30', '09:30'], ['09:30:00', '09:30'], ['23:59', '23:59'], ['0:05', '00:05'],
  ['24:00', null], ['9:60', null], ['9.30', null], ['930', null], ['9:30pm', null], ['abc', null], [' 9:30 ', '09:30'], ['09:30:60', null],
];
for (const [inp, want] of startCases) {
  test(`C4 start_time ${JSON.stringify(inp)} -> ${want ?? 'ERROR'}`, async () => {
    const { sb, log } = mockSb({ prefs: { config: structuredClone(FULL), timezone: 'America/New_York' } });
    const r = await M.startActivity(sb, 'u1', { name: 'Gym', start_time: inp });
    if (want === null) {
      assert.equal(r.success, false); assert.match(r.error, /start_time must be HH:mm/);
      assert.equal(log.filter((e) => e.op !== 'select').length, 0, 'no write on bad start_time');
    } else {
      assert.equal(r.success, true, JSON.stringify(r)); assert.equal(r.result.activity.start, want);
    }
  });
}
for (const bad of [930, true, {}, []]) {
  test(`C4 start_time non-string ${JSON.stringify(bad)} -> error or explicit parse, never now`, async () => {
    const { sb } = mockSb({ prefs: { config: structuredClone(FULL), timezone: 'America/New_York' } });
    const r = await M.startActivity(sb, 'u1', { name: 'Gym', start_time: bad });
    // print what happens so the report can quote it
    console.log(`# start_time ${JSON.stringify(bad)} ->`, r.success ? `start=${r.result.activity.start}` : r.error);
  });
}

test('C4 LA owner at 21:30 local: the just-created block survives the prune (column timezone)', async () => {
  // config.timezone absent; column = LA. Use a fixed "today" by mocking Date for the instance.
  const RealDate = Date;
  const fixed = new RealDate('2026-10-29T04:30:00Z'); // 21:30 PDT on 2026-10-28, 00:30 EDT 10-29
  (globalThis as any).Date = class extends RealDate { constructor(...a: any[]) { super(...(a.length ? a : [fixed.getTime()])); } static now() { return fixed.getTime(); } } as any;
  try {
    const { sb, log } = mockSb({ prefs: { config: structuredClone(FULL), timezone: 'America/Los_Angeles' } });
    const r = await M.startActivity(sb, 'u1', { name: 'Gym' });
    assert.equal(r.success, true, JSON.stringify(r));
    assert.equal(r.result.activity.date, '2026-10-28');
    assert.equal(r.result.activity.start, '21:30');
    const ups = log.filter((e) => e.op === 'upsert');
    assert.ok(ups[0].payload.config.activities.some((a: any) => a.id === r.result.activity.id), 'kept after prune');
  } finally { (globalThis as any).Date = RealDate; }
});

// ---- Claim 7-related: floating update moves its range -----------------------
test('C7 update floating Lunch start 15:00 (no earliest/latest) moves the range with it', async () => {
  const cfg = { ...structuredClone(FULL), activities: [{ id: 'lunch', name: 'Lunch', kind: 'recurring', mode: 'floating', start: '12:00', earliest: '11:30', latest: '13:30', durationMin: 60, days: [1,2,3,4,5], enabled: true, aliases: ['lunch'] }] };
  const { sb, log } = mockSb({ prefs: { config: cfg, timezone: 'America/New_York' } });
  const r = await M.updateActivity(sb, 'u1', { name: 'Lunch', start: '15:00' });
  assert.equal(r.success, true, JSON.stringify(r));
  const a = log.find((e) => e.op === 'upsert')!.payload.config.activities[0];
  assert.deepEqual([a.start, a.earliest, a.latest], ['15:00', '14:30', '16:30']);
});
test('C7 update floating Lunch start "9:30" (unpadded) moves range and stores padded start?', async () => {
  const cfg = { ...structuredClone(FULL), activities: [{ id: 'lunch', name: 'Lunch', kind: 'recurring', mode: 'floating', start: '12:00', earliest: '11:30', latest: '13:30', durationMin: 60, days: [1,2,3,4,5], enabled: true, aliases: ['lunch'] }] };
  const { sb, log } = mockSb({ prefs: { config: cfg, timezone: 'America/New_York' } });
  const r = await M.updateActivity(sb, 'u1', { name: 'Lunch', start: '9:30' });
  console.log('# update start "9:30" ->', r.success ? JSON.stringify(log.find((e) => e.op === 'upsert')!.payload.config.activities[0]) : r.error);
});
test('C7 update floating Lunch start 23:30 near midnight (range clamped at 23:59)', async () => {
  const cfg = { ...structuredClone(FULL), activities: [{ id: 'lunch', name: 'Lunch', kind: 'recurring', mode: 'floating', start: '12:00', earliest: '11:30', latest: '13:30', durationMin: 60, days: [1,2,3,4,5], enabled: true, aliases: ['lunch'] }] };
  const { sb, log } = mockSb({ prefs: { config: cfg, timezone: 'America/New_York' } });
  const r = await M.updateActivity(sb, 'u1', { name: 'Lunch', start: '23:30' });
  console.log('# update start "23:30" ->', r.success ? JSON.stringify(log.find((e) => e.op === 'upsert')!.payload.config.activities[0]) : r.error);
});
test('C7 update with explicit earliest/latest keeps the given range', async () => {
  const cfg = { ...structuredClone(FULL), activities: [{ id: 'lunch', name: 'Lunch', kind: 'recurring', mode: 'floating', start: '12:00', earliest: '11:30', latest: '13:30', durationMin: 60, days: [1,2,3,4,5], enabled: true, aliases: ['lunch'] }] };
  const { sb, log } = mockSb({ prefs: { config: cfg, timezone: 'America/New_York' } });
  const r = await M.updateActivity(sb, 'u1', { name: 'Lunch', start: '15:00', earliest: '14:00', latest: '17:00' });
  assert.equal(r.success, true, JSON.stringify(r));
  const a = log.find((e) => e.op === 'upsert')!.payload.config.activities[0];
  assert.deepEqual([a.start, a.earliest, a.latest], ['15:00', '14:00', '17:00']);
});
test('C7 pushes_schedule:false clears a stored pushesSchedule:true', async () => {
  const cfg = { ...structuredClone(FULL) };
  (cfg.activities[0] as any).pushesSchedule = true;
  const { sb, log } = mockSb({ prefs: { config: cfg, timezone: 'America/New_York' } });
  const r = await M.updateActivity(sb, 'u1', { name: 'Gym', pushes_schedule: false });
  assert.equal(r.success, true, JSON.stringify(r));
  const a = log.find((e) => e.op === 'upsert')!.payload.config.activities[0];
  assert.notEqual(a.pushesSchedule, true);
});
test('C7 update unrelated field keeps a stored pushesSchedule:true', async () => {
  const cfg = { ...structuredClone(FULL) };
  (cfg.activities[0] as any).pushesSchedule = true;
  const { sb, log } = mockSb({ prefs: { config: cfg, timezone: 'America/New_York' } });
  const r = await M.updateActivity(sb, 'u1', { name: 'Gym', duration_min: 45 });
  assert.equal(r.success, true, JSON.stringify(r));
  const a = log.find((e) => e.op === 'upsert')!.payload.config.activities[0];
  assert.equal(a.pushesSchedule, true);
  assert.equal(a.durationMin, 45);
});

// ---- Claim 7: expandActivitiesForDate clamps a floating block into [earliest, latest-duration] ----
import { expandActivitiesForDate as expand, minutesToHHMM as mh } from '../../supabase/functions/_shared/activities.ts';
import { zonedTimeToUtc } from '../../supabase/functions/_shared/timezone.ts';
test('C7 expand: floating block never starts outside [lo, hi] (random sweep)', () => {
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const localMin = (iso: string, tz: string) => {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
    return Number(p.find((x) => x.type === 'hour')!.value) * 60 + Number(p.find((x) => x.type === 'minute')!.value);
  };
  let n = 0, conflicts = 0, outOfRangePrefs = 0;
  for (let i = 0; i < 3000; i++) {
    const tz = ['America/New_York', 'America/Los_Angeles', 'UTC'][i % 3];
    const date = ['2026-10-28', '2026-03-09', '2026-11-02'][i % 3];
    const dur = 15 * (1 + Math.floor(rnd() * 8));
    const lo = 15 * Math.floor(rnd() * 60) + 300;
    const hiEnd = Math.min(1439, lo + dur + 15 * Math.floor(rnd() * 12));
    const start = 15 * Math.floor(rnd() * 90);
    if (start < lo || start > hiEnd - dur) outOfRangePrefs++;
    const busy: any[] = [];
    for (let k = 0; k < Math.floor(rnd() * 4); k++) {
      const bs = lo + 15 * Math.floor(rnd() * 20) - 60; const be = bs + 15 * (1 + Math.floor(rnd() * 6));
      if (bs < 0 || be > 1439) continue;
      busy.push({ start_time: new Date(zonedTimeToUtc(date, mh(bs), tz)).toISOString(), end_time: new Date(zonedTimeToUtc(date, mh(be), tz)).toISOString() });
    }
    const a: any = { id: 'f', name: 'F', kind: 'recurring', mode: 'floating', start: mh(start), earliest: mh(lo), latest: mh(hiEnd), durationMin: dur, days: [0,1,2,3,4,5,6], enabled: true };
    const blocks = expand([a], date, tz, busy);
    assert.equal(blocks.length, 1);
    const s = localMin(blocks[0].start_time, tz);
    const hi = Math.max(lo, hiEnd - dur);
    assert.ok(s >= lo && s <= hi, `i=${i} start ${mh(s)} not in [${mh(lo)}, ${mh(hi)}] pref=${mh(start)} tz=${tz} date=${date}`);
    if (blocks[0].conflict) { conflicts++; assert.equal(s, Math.min(hi, Math.max(lo, start)), 'conflict sits at clamped pref'); }
    else assert.ok(!busy.some((b) => Date.parse(b.start_time) < Date.parse(blocks[0].end_time) && Date.parse(blocks[0].start_time) < Date.parse(b.end_time)), 'non-conflict block avoids busy');
    n++;
  }
  console.log(`# expand sweep n=${n} outOfRangePrefs=${outOfRangePrefs} conflicts=${conflicts}`);
});
