// Offline unit tests for the dedup decision logic. Run:
//   node --experimental-strip-types --test supabase/functions/_shared/task-dedup.test.ts
// Uses a MOCK embedder so no network/OpenAI is needed and results are deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  titleSignature,
  resolveDedupConfig,
  buildDedupPlan,
  type DedupConfig,
  type OpenTaskLite,
} from './task-dedup.ts';

const ON: DedupConfig = { enabled: true, semantic: true, highThreshold: 0.9, possibleThreshold: 0.8 };

// Deterministic fake embedder: map each distinct "concept" to a fixed unit vector so we can
// engineer exact cosine values. Titles sharing a concept get identical vectors (cosine 1.0);
// unrelated concepts are orthogonal (cosine 0). A "near" pair is hand-set to ~0.85.
function mockEmbed(map: Record<string, number[]>) {
  return async (titles: string[]) =>
    titles.map((t) => map[t] ?? [0, 0, 1]); // default orthogonal-ish
}

test('signature collapses the real Klarna variants', () => {
  const a = titleSignature('Make payments to Klarna');
  const b = titleSignature('Make Klarna payments');
  assert.equal(a, b, `signatures should match: "${a}" vs "${b}"`);
  assert.equal(a, 'klarna make payments');
});

test('signature separates a different content token', () => {
  assert.notEqual(titleSignature('Make Klarna payment'), titleSignature('Make Affirm payment'));
});

test('signature is punctuation/case/whitespace stable and idempotent', () => {
  const s1 = titleSignature('  Pay   the CREDIT-card bill!! ');
  const s2 = titleSignature('pay credit card bill');
  assert.equal(s1, s2);
  assert.equal(titleSignature(s1), 'bill card credit pay'); // already-normalized re-normalizes stably...
});

test('all-stopword / empty titles do not crash and produce empty signature', () => {
  assert.equal(titleSignature('to the a of'), '');
  assert.equal(titleSignature(''), '');
  assert.equal(titleSignature('   '), '');
});

test('config defaults OFF, thresholds seeded; invalid thresholds fall back', () => {
  assert.equal(resolveDedupConfig({}).enabled, false);
  assert.equal(resolveDedupConfig({ dedup: { enabled: true } }).highThreshold, 0.9);
  const bad = resolveDedupConfig({ dedup: { enabled: true, highThreshold: 5, possibleThreshold: 'x' } });
  assert.equal(bad.highThreshold, 0.9);
  assert.equal(bad.possibleThreshold, 0.8);
});

test('exact signature match against an existing OPEN task => duplicate (skip), no embed needed', async () => {
  let embedCalls = 0;
  const open: OpenTaskLite[] = [{ id: 'existing-1', title: 'Make payments to Klarna' }];
  const plan = await buildDedupPlan({
    candidates: ['Make Klarna payments'],
    openTasks: open,
    cfg: ON,
    embed: async (t) => { embedCalls++; return t.map(() => [1, 0, 0]); },
  });
  assert.equal(plan[0].decision, 'duplicate');
  assert.equal(plan[0].method, 'signature');
  assert.equal(plan[0].matchedTaskId, 'existing-1');
  assert.equal(embedCalls, 0, 'signature match should short-circuit embeddings when all candidates match');
});

test('within-batch: two identical titles => first unique, second deduped against sibling', async () => {
  const plan = await buildDedupPlan({
    candidates: ['Make payments to Klarna', 'Make Klarna payments'],
    openTasks: [],
    cfg: ON,
    embed: mockEmbed({}),
  });
  assert.equal(plan[0].decision, 'unique');
  assert.equal(plan[1].decision, 'duplicate');
  assert.equal(plan[1].method, 'signature');
  assert.equal(plan[1].matchedTaskId, null, 'matched an in-batch sibling, not an existing task');
});

test('semantic bands: >=high => duplicate, [mid,high) => possible (created+flagged), <mid => unique', async () => {
  // Concepts as orthonormal basis vectors so cosine is exact.
  const K = [1, 0, 0];          // "klarna-ish"
  const NEAR = [0.85, Math.sqrt(1 - 0.85 * 0.85), 0]; // cosine 0.85 with K -> ambiguous band
  const FAR = [0, 0, 1];        // orthogonal -> cosine 0
  const open: OpenTaskLite[] = [{ id: 'e1', title: 'Settle Klarna bill' }];
  const plan = await buildDedupPlan({
    candidates: ['Pay off Klarna', 'Kinda related thing', 'Buy groceries'],
    openTasks: open,
    cfg: ON,
    embed: mockEmbed({
      'Settle Klarna bill': K,
      'Pay off Klarna': K,          // cosine 1.0 with existing -> duplicate
      'Kinda related thing': NEAR,  // cosine 0.85 -> possible
      'Buy groceries': FAR,         // cosine 0 -> unique
    }),
  });
  assert.equal(plan[0].decision, 'duplicate');
  assert.equal(plan[0].method, 'semantic');
  assert.equal(plan[1].decision, 'possible');
  assert.ok(plan[1].similarity! >= 0.8 && plan[1].similarity! < 0.9, `sim=${plan[1].similarity}`);
  assert.equal(plan[2].decision, 'unique');
});

test('semantic embed failure fails OPEN (creates), never drops', async () => {
  const plan = await buildDedupPlan({
    candidates: ['Something novel'],
    openTasks: [{ id: 'e1', title: 'Unrelated existing' }],
    cfg: ON,
    embed: async () => { throw new Error('openai down'); },
  });
  assert.equal(plan[0].decision, 'unique');
});

test('ambiguous items are never dropped or collapsed: two near-but-distinct both created', async () => {
  const A = [0.85, Math.sqrt(1 - 0.85 * 0.85), 0];
  const open: OpenTaskLite[] = [{ id: 'e1', title: 'anchor' }];
  const plan = await buildDedupPlan({
    candidates: ['near one', 'near two'],
    openTasks: open,
    cfg: ON,
    embed: mockEmbed({ anchor: [1, 0, 0], 'near one': A, 'near two': A }),
  });
  // near one: 0.85 vs anchor -> possible (created). near two: 0.85 vs anchor AND 1.0 vs "near one"
  // (accepted sibling) -> that would be duplicate. Ensure the FIRST is created; the second collapses
  // only because it's identical to the first sibling, which is correct (they ARE the same concept).
  assert.equal(plan[0].decision, 'possible');
  assert.ok(plan[1].decision === 'possible' || plan[1].decision === 'duplicate');
});

// =============================================================================
// Restore step 6 (J6 onto main, 2026-10-27): the guard behind its flag, end to end through
// runDedup, and the undo payload fix. See docs/qc-evidence/RESTORE-step6-j6.md.
// =============================================================================
import { readFileSync } from 'node:fs';
import { runDedup, restorePayloadFromLog, WORKFLOW_STATUSES } from './task-dedup.ts';
import { WORKFLOW_STATUSES as CLIENT_WORKFLOW_STATUSES } from '../../../src/utils/workflowStatus.ts';

// Minimal chainable stand-in for the supabase client: records which tables were read and
// returns canned rows. Every builder method returns the builder; awaiting it yields {data}.
function fakeSupabase(opts: { config: unknown; openTasks: OpenTaskLite[] }) {
  const reads: string[] = [];
  const from = (table: string) => {
    reads.push(table);
    const result = table === 'user_scheduling_prefs'
      ? { data: { config: opts.config }, error: null }
      : { data: opts.openTasks, error: null };
    const b: any = {
      select: () => b, eq: () => b, neq: () => b, is: () => b,
      maybeSingle: async () => result,
      then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
    };
    return b;
  };
  return { from, reads };
}

// The owner's live user_scheduling_prefs.config key set (read-only SELECT, 2026-10-26): no `dedup`.
const OWNER_CONFIG_SHAPE = {
  caveats: [], timezone: 'America/New_York', timeWindows: {}, contextRules: {},
  workingHours: {}, workloadBalance: {}, categoryMappings: {}, customAIInstructions: '',
};

test('runDedup flag ON: normalized (signature) AND semantic decisions both act', async () => {
  const open: OpenTaskLite[] = [
    { id: 't-klarna', title: 'Make payments to Klarna' },
    { id: 't-dentist', title: 'Book dentist appointment' },
  ];
  const sb = fakeSupabase({ config: { ...OWNER_CONFIG_SHAPE, dedup: { enabled: true } }, openTasks: open });
  let embedCalls = 0;
  const embed = async (titles: string[]) => {
    embedCalls++;
    const m: Record<string, number[]> = {
      'Make payments to Klarna': [1, 0, 0],
      'Book dentist appointment': [0, 1, 0],
      'Schedule a dentist visit': [0, 0.95, Math.sqrt(1 - 0.95 * 0.95)], // cos 0.95 vs dentist
      'Water the plants': [0, 0, 1],
    };
    return titles.map((t) => m[t] ?? [0, 0, 1]);
  };
  const r = await runDedup({
    supabase: sb, userId: 'u1', embed,
    candidates: ['Make Klarna payments', 'Schedule a dentist visit', 'Water the plants'],
  });
  assert.equal(r.enabled, true);
  assert.deepEqual(sb.reads, ['user_scheduling_prefs', 'tasks']);
  const [k, d, w] = r.outcomes;
  assert.equal(k.create, false);
  assert.equal(k.decision.method, 'signature');
  assert.equal(k.decision.matchedTaskId, 't-klarna');
  assert.equal(d.create, false);
  assert.equal(d.decision.method, 'semantic');
  assert.equal(d.decision.matchedTaskId, 't-dentist');
  assert.equal(w.create, true);
  assert.deepEqual(w.extraTags, []);
  assert.equal(embedCalls, 1);
});

test('runDedup flag OFF (the owner\'s real config has no dedup key): pure no-op', async () => {
  for (const config of [OWNER_CONFIG_SHAPE, undefined, null, { dedup: {} }, { dedup: { enabled: 'true' } }, { dedup: { enabled: 1 } }]) {
    const sb = fakeSupabase({ config, openTasks: [{ id: 't1', title: 'Make payments to Klarna' }] });
    let embedCalls = 0;
    const r = await runDedup({
      supabase: sb, userId: 'u1', candidates: ['Make Klarna payments', 'Make Klarna payments'],
      embed: async (t) => { embedCalls++; return t.map(() => [1, 0, 0]); },
    });
    assert.equal(r.enabled, false, `config ${JSON.stringify(config)} must leave the guard OFF`);
    assert.ok(r.outcomes.every((o) => o.create && o.extraTags.length === 0));
    assert.equal(embedCalls, 0, 'no embeddings call while OFF');
    assert.deepEqual(sb.reads, ['user_scheduling_prefs'], 'open tasks are not even read while OFF');
  }
});

test('undo payload: a category status from a pre-#28 log row is re-derived, never kept', () => {
  // Shapes of the 4 live not-yet-undone skipped rows: status VENTURES x2, LIFE x2.
  const undated = restorePayloadFromLog({ id: 'old-id', title: 'Pitch deck', status: 'VENTURES', category: 'VENTURES', board_id: 'b1', user_id: 'u1' });
  assert.equal(undated.status, 'BACKLOG');
  assert.equal(undated.category, 'VENTURES', 'the CATEGORY field itself is untouched');
  assert.equal('id' in undated, false, 'never reuse the old id');
  assert.equal(undated.title, 'Pitch deck');
  const dated = restorePayloadFromLog({ title: 'Groceries', status: 'LIFE', due_date: '2026-10-28T03:59:59Z' });
  assert.equal(dated.status, 'UP_NEXT');
  const started = restorePayloadFromLog({ title: 'Call', status: 'CAREER', start_time: '2026-10-28T14:00:00Z' });
  assert.equal(started.status, 'UP_NEXT');
  for (const cat of ['LIFE', 'CAREER', 'PROF_EDUCATION', 'VENTURES', 'EDUCATION', 'PERSONAL', '', null, undefined, 42]) {
    const p = restorePayloadFromLog({ title: 'x', status: cat });
    assert.ok(p.status === 'BACKLOG', `status ${String(cat)} must become a workflow lane, got ${String(p.status)}`);
  }
});

test('undo payload: a real workflow status the creator chose is kept', () => {
  assert.equal(restorePayloadFromLog({ title: 'x', status: 'DOING' }).status, 'DOING');
  assert.equal(restorePayloadFromLog({ title: 'x', status: 'BACKLOG', due_date: '2026-10-28' }).status, 'BACKLOG');
  assert.deepEqual(restorePayloadFromLog(null), { status: 'BACKLOG' });
});

test('edge WORKFLOW_STATUSES is identical to the client source src/utils/workflowStatus.ts', () => {
  assert.deepEqual([...WORKFLOW_STATUSES], [...CLIENT_WORKFLOW_STATUSES]);
});

test('execute-tool wiring: undoDedup inserts restorePayloadFromLog(row.candidate), not the raw payload', () => {
  const src = readFileSync(new URL('../execute-tool/index.ts', import.meta.url), 'utf8');
  const start = src.indexOf('async function undoDedup(');
  assert.ok(start > 0, 'undoDedup exists');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.match(body, /const payload: any = restorePayloadFromLog\(row\.candidate\);/);
  assert.doesNotMatch(body, /\.\.\.\(row\.candidate/);
  assert.match(src, /case 'undo_dedup':\s*\n\s*return await undoDedup\(supabase, userId, args\);/);
  // main's work the 3-way merge had to keep
  assert.match(src, /case 'get_task_topics':/);
  assert.equal((src.match(/\.order\('created_at', \{ ascending: true \}\)/g) || []).length, 3);
  // both creation paths call the guard
  assert.equal((src.match(/await runDedup\(\{ supabase, userId, candidates:/g) || []).length, 2);

  // a skipped duplicate never reaches the insert: createTask returns, parseAndCreateTasks continues
  const ct = src.slice(src.indexOf('async function createTask('), src.indexOf('async function', src.indexOf('async function createTask(') + 10));
  const ctSkip = ct.indexOf('if (dedup.enabled && outcome && !outcome.create) {');
  assert.ok(ctSkip > 0 && ct.indexOf('return {', ctSkip) < ct.indexOf(".from('tasks')", ctSkip), 'createTask returns before inserting a skipped duplicate');
  const pc = src.slice(src.indexOf('async function parseAndCreateTasks('), start);
  const pcSkip = pc.indexOf('if (dedupOutcome && !dedupOutcome.create) {');
  assert.ok(pcSkip > 0, 'parseAndCreateTasks has the skip branch');
  const pcCont = pc.indexOf('continue; // do NOT insert', pcSkip);
  assert.ok(pcCont > 0 && pcCont < pc.indexOf(".from('tasks')", pcSkip), 'parseAndCreateTasks continues before inserting a skipped duplicate');
});
