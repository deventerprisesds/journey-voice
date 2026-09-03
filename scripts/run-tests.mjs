#!/usr/bin/env node
// WHAT:       The `npm test` collector. Discovers every *.test.ts / *.test.tsx under the
//             declared roots, ASSERTS a per-root minimum was found, then runs them all under
//             node's test runner and forwards the exit code.
// WHY:        Measured 2026-09-03: `npm test` was
//               node --experimental-strip-types --test src/utils/*.test.ts
//             which reaches only src/utils. supabase/functions/_shared/task-dedup.test.ts has
//             been committed since 2026-08-20 and had NEVER executed once (10 passing
//             assertions, invisible). Committing a test beside its module is therefore
//             necessary and INSUFFICIENT.
//
//             A plain glob is NOT an adequate fix. Measured, same session:
//               $ node --experimental-strip-types --test "nosuchdir/**/*.test.ts"; echo $?
//               0
//             A glob that matches ZERO files exits 0. So a future typo, directory rename or
//             well-meaning narrowing of the pattern turns `npm test` green while running
//             nothing — the identical false green as reporting `tsc` silence as "typecheck
//             clean" when it had compiled zero files. The per-root floors below are the
//             structural guard against that: they are a RATCHET, not decoration.
// SUPERSEDES: the inline `--test src/utils/*.test.ts` glob in package.json "scripts".
// SUPERSEDED-BY: nothing — current.
// EVIDENCE:   docs/impl/laneD-test-infra.md (before/after counts, canary FIRED/restored);
//             docs/ac/nudge-and-ordering-ACs.md AC-9b.

import { readdirSync, statSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));

// Each root declares the MINIMUM number of test files that must be discovered under it.
// Raise a floor when you add durable coverage; never lower one to make a red run go green.
// `supabase/functions` is deliberately its own root with its own floor: a single combined
// floor would stay satisfied by the src/ files alone, which is exactly how the edge-function
// suite went two weeks without running.
const ROOTS = [
  { dir: 'src', min: 2 },
  { dir: 'supabase/functions', min: 1 },
];

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.vite']);
const TEST_RE = /\.test\.tsx?$/;

function walk(abs, out) {
  let entries;
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.') continue;
    const full = join(abs, e.name);
    if (e.isDirectory()) {
      if (IGNORED_DIRS.has(e.name)) continue;
      walk(full, out);
    } else if (e.isFile() && TEST_RE.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

const collected = [];
const shortfalls = [];

for (const root of ROOTS) {
  const abs = join(REPO, root.dir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    shortfalls.push(`root "${root.dir}" does not exist`);
    continue;
  }
  const found = walk(abs, []).sort();
  if (found.length < root.min) {
    shortfalls.push(
      `root "${root.dir}" yielded ${found.length} test file(s), expected at least ${root.min}`,
    );
  }
  collected.push(...found);
}

const rel = collected.map((f) => relative(REPO, f));

console.log(`[run-tests] collected ${rel.length} test file(s):`);
for (const f of rel) console.log(`  - ${f}`);

if (shortfalls.length) {
  console.error('');
  console.error('[run-tests] COLLECTION FAILED — refusing to report a green run.');
  for (const s of shortfalls) console.error(`  ! ${s}`);
  console.error('');
  console.error('  A test runner that finds nothing exits 0 and looks identical to a passing');
  console.error('  suite. That false green is the defect this check exists to prevent. Fix the');
  console.error('  path or the floor in scripts/run-tests.mjs — do not silence this.');
  process.exit(2);
}

const args = ['--experimental-strip-types', '--test', ...rel, ...process.argv.slice(2)];
const res = spawnSync(process.execPath, args, { cwd: REPO, stdio: 'inherit' });

if (res.error) {
  console.error(`[run-tests] failed to start node: ${res.error.message}`);
  process.exit(1);
}
process.exit(res.status === null ? 1 : res.status);
