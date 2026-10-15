// =============================================================================
// WHAT:       structural guards over every "which board is this user's?" read in the repo.
// WHY:        dev@enterpriseds.io accumulated 145 boards, every one `is_default=true`, only 2
//             holding tasks (measured 2026-10-15). Cause: src/components/KanbanBoard.tsx looked
//             the board up with a bare `.maybeSingle()`, which THROWS once a user has 2+ default
//             boards, and its `catch` answered by creating ANOTHER default board -- so a single
//             duplicate became a permanent loop (49 same-second pairs on 2026-02-03 alone). The
//             same bare `.single()` shape made phone `create_task`, assignment sync and the
//             Calendar page fail or create boards for any user with two defaults.
//             The repo's own MCP create_task path already used the safe shape -- oldest board,
//             `.order('created_at', { ascending: true }).limit(1)` -- so that convention is now
//             enforced everywhere, client AND edge functions.
// EVIDENCE:   .claude/actions.md (ACT:empty-board-cleanup, ACT:board-default-lookup)
// Run: npm test
// =============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '../..');
const ROOTS = ['src', 'supabase/functions'];
const SKIP = new Set(['node_modules', 'dist', '.git', 'coverage', 'build']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(full);
  }
  return out;
}

const FILES = ROOTS.flatMap((r) => {
  const d = path.join(REPO, r);
  return existsSync(d) ? walk(d) : [];
});

/** Every `.from('boards')...;` chain that READS a single row. Mutations are not lookups. */
function singleRowBoardReads(): Array<{ where: string; chain: string }> {
  const out: Array<{ where: string; chain: string }> = [];
  for (const f of FILES) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/\.from\(\s*['"]boards['"]\s*\)/g)) {
      const end = s.indexOf(';', m.index!);
      const chain = s.slice(m.index!, end === -1 ? undefined : end);
      if (/\.(insert|update|delete|upsert)\(/.test(chain)) continue;
      if (!/\.(single|maybeSingle)\(\)/.test(chain) && !/\.limit\(\s*1\s*\)/.test(chain)) continue;
      const line = s.slice(0, m.index!).split('\n').length;
      out.push({ where: `${path.relative(REPO, f)}:${line}`, chain });
    }
  }
  return out;
}

describe('board lookups', () => {
  const reads = singleRowBoardReads();

  it('the scan found the board reads (a guard over nothing is not a guard)', () => {
    assert.ok(reads.length >= 15, `only ${reads.length} single-row board reads found — the scan is broken`);
  });

  it('every single-row board read takes the OLDEST board with limit(1), so duplicates can never make it throw', () => {
    const ORDER = /\.order\(\s*['"]created_at['"]\s*,\s*\{\s*ascending:\s*true\s*\}\s*\)/;
    const bad = reads
      .filter(({ chain }) => !ORDER.test(chain) || !/\.limit\(\s*1\s*\)/.test(chain))
      .map(({ where }) => where);
    assert.deepEqual(bad, [], `board reads missing .order('created_at', { ascending: true }).limit(1):\n${bad.join('\n')}`);
  });

  it("KanbanBoard never creates a board from inside a catch — a failed read is not a missing board", () => {
    const s = readFileSync(path.join(REPO, 'src/components/KanbanBoard.tsx'), 'utf8');
    const start = s.indexOf('const fetchBoardColumns');
    const stop = s.indexOf('const statusToCategory', start);
    assert.ok(start !== -1 && stop > start, 'could not locate fetchBoardColumns — update this guard');
    // Start at the DATABASE path. The demo-mode branch above it also catches and "creates", but
    // into localStorage only (createDefaultBoardAndColumns' isDemoMode branch) — no row is written.
    const dbPath = s.indexOf(".from('boards')", start);
    assert.ok(dbPath > start && dbPath < stop, 'could not locate the boards read in fetchBoardColumns — update this guard');
    const body = s.slice(dbPath, stop);
    const catches = [...body.matchAll(/\}\s*catch\s*\([^)]*\)\s*\{/g)];
    assert.ok(catches.length >= 1, 'no catch found in fetchBoardColumns — update this guard');
    for (const c of catches) {
      const from = c.index! + c[0].length;
      const next = body.slice(from).search(/\}\s*finally\s*\{|\}\s*catch\s*\(/);
      const block = body.slice(from, next === -1 ? undefined : from + next);
      assert.ok(!block.includes('createDefaultBoardAndColumns'),
        'fetchBoardColumns creates a board inside a catch — this is the loop that made 145 boards');
    }
  });
});
