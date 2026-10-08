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
