// WHAT:       Replays the 2026-11-07 Iris duplicates (7 journey calls, 23 originals + 37 repeats) through journey's
//             task-dedup -- the REAL runDedup entry point with the guard switched on -- offline, signature layer.
// WHY:        journey's dedup is OFF for the owner (config.dedup null). Before deciding to switch it on he needs to know
//             what it would have caught and whether it would have wrongly merged any of his 23 distinct work items.
//             The semantic layer needs real embeddings, so it is measured by scripts/replay-task-dedup.mjs on a runner
//             (eval-job-category.yml job=dedup-replay); this file pins the deterministic half so it cannot drift.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   fixtures/iris-bulk-2026-11-07.json (parsed titles per call from journey's edge log);
//             docs/qc-evidence/FIX-parse-context-categories.md section 5.
// Run: node --experimental-strip-types --test supabase/functions/_shared/task-dedup-replay.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runDedup, resolveDedupConfig, type OpenTaskLite } from './task-dedup.ts';

const F = JSON.parse(readFileSync(new URL('./fixtures/iris-bulk-2026-11-07.json', import.meta.url), 'utf8')) as {
  lines: string[];
  calls: Array<{ at: string; inserted: number; parsed: string[] }>;
  restates: Record<string, number>;
};

/** Which of the owner's 23 lines a title stands for: an original is itself, a repeat is what it restates. */
const lineOf = (title: string): number => {
  const i = F.lines.indexOf(title);
  return i >= 0 ? i : F.restates[title];
};

/** A supabase stand-in for runDedup: the dedup config read, and loadOpenTasks returning `open`. */
function fakeSupabase(open: OpenTaskLite[]) {
  const chain: any = {
    select: () => chain, eq: () => chain, neq: () => chain, is: () => Promise.resolve({ data: open, error: null }),
    maybeSingle: () => Promise.resolve({ data: { config: { dedup: { enabled: true } } }, error: null }),
  };
  return { from: () => chain };
}

/** Run the 7 calls in order. A candidate the guard keeps becomes an open task for the later calls. */
async function replay() {
  const open: OpenTaskLite[] = [];
  const rows: Array<{ call: number; title: string; decision: string; matched?: string }> = [];
  for (const [ci, c] of F.calls.entries()) {
    const run = await runDedup({
      supabase: fakeSupabase([...open]), userId: 'owner', candidates: c.parsed,
      embed: async () => { throw new Error('offline: no embeddings'); }, // semantic fails open -> signature only
    });
    assert.equal(run.enabled, true);
    for (const o of run.outcomes) {
      rows.push({ call: ci + 1, title: o.decision.title, decision: o.decision.decision, matched: o.decision.matchedTitle });
      if (o.create) open.push({ id: `c${ci + 1}-${o.index}`, title: o.decision.title });
    }
  }
  return rows;
}

describe('11-07 replay through runDedup, signature layer', () => {
  it('R-0 the fixture is the 11-07 incident: 7 calls, 23 originals, 37 repeats, 43 rows inserted', () => {
    assert.equal(F.calls.length, 7);
    assert.deepEqual(F.calls[0].parsed, F.lines);
    assert.equal(F.calls.slice(1).reduce((n, c) => n + c.parsed.length, 0), 37);
    assert.equal(F.calls.reduce((n, c) => n + c.inserted, 0), 43);
    for (const c of F.calls.slice(1)) for (const t of c.parsed) assert.ok(Number.isInteger(F.restates[t]), t);
  });

  it('R-1 the owner config today ({dedup: null}) leaves the guard OFF, which is why none of this ran', () => {
    assert.equal(resolveDedupConfig({ dedup: null }).enabled, false);
  });

  it('R-2 no false merge: all 23 distinct work items in call 1 survive', async () => {
    const rows = (await replay()).filter((r) => r.call === 1);
    assert.equal(rows.length, 23);
    assert.deepEqual(rows.filter((r) => r.decision !== 'unique'), []);
  });

  it('R-3 the signature layer catches 12 of the 37 repeats, each against the item it really restates', async () => {
    const repeats = (await replay()).filter((r) => r.call > 1);
    const caught = repeats.filter((r) => r.decision === 'duplicate');
    for (const r of caught) assert.equal(lineOf(r.matched!), lineOf(r.title), `${r.title} merged into ${r.matched}`);
    assert.deepEqual(caught.map((r) => `${r.call}:${r.title}`), [
      '2:Debug WIP in Huddle end to end',
      '3:Debug WIP in Huddle end to end',
      '4:Prepare intro script for meetings',
      '5:Research metrics to track through Jira for software engineering',
      '6:Measure my panel',
      '6:Create two Trinnex images for About page and profile',
      '6:Research using Copilot with email and calendar',
      '6:Integrate Huddle with diagram-builder app',
      '7:Create Trinnex image for About page',
      '7:Create Trinnex image for profile',
      '7:Research software-engineering metrics for Jira',
      '7:Prepare agendas for ally meetings',
    ]);
    // The other 25 are paraphrases with different content words; only the semantic layer can see them.
    assert.equal(repeats.filter((r) => r.decision === 'unique').length, 25);
  });
});
