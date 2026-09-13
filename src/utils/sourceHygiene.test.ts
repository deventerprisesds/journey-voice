// =============================================================================
// WHAT:       two structural guards over the repo's own source files — no control bytes, and no
//             provenance header citing a file that does not exist.
// WHY:        both defects shipped in this work and BOTH reached a pushed commit unnoticed.
//             (1) A raw NUL byte landed at `send-digests/index.ts:81` as a template-literal
//                 separator. `file` reported the module as `data`, `grep` refused it as binary, and
//                 the test suite was green the whole time — because no test imports an edge
//                 function's `index.ts`, so nothing ever read the bytes. Deno would have had to
//                 find it in production.
//             (2) `digest-source.ts`'s EVIDENCE header cited a test file one character off from
//                 the real one (dropping the "Standup" suffix), which has never existed. Found by
//                 an independent verifier, not by anything here. A provenance trail that names a
//                 missing file is worse than none: the next reader concludes the evidence was
//                 deleted rather than misnamed.
//                 (The offending path is described rather than spelled, because spelling it here
//                 would make THIS file trip the very guard below -- which it did, on the first
//                 run. That is the guard working, not a false positive to exempt.)
//             Per the org rule, a recurring miss becomes a deterministic check, not another
//             paragraph telling someone to be careful.
// EVIDENCE:   .claude/VERIFY-digest-delivery-loop1.md (the EVIDENCE-path finding); the NUL was
//             found by `file` reporting the module as `data` during that same pass.
// Run: npm test   (node --experimental-strip-types --test src/utils/*.test.ts)
// =============================================================================
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '../..');
const ROOTS = ['src', 'supabase/functions'];
const EXT = new Set(['.ts', '.tsx', '.mjs', '.js', '.sql', '.toml']);
const SKIP = new Set(['node_modules', 'dist', '.git', 'coverage', 'build']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXT.has(path.extname(name))) out.push(full);
  }
  return out;
}

const FILES = ROOTS.flatMap((r) => {
  const d = path.join(REPO, r);
  return existsSync(d) ? walk(d) : [];
});

describe('source hygiene', () => {
  it('the scan actually found files (a guard over nothing is not a guard)', () => {
    assert.ok(FILES.length > 50, `only ${FILES.length} files scanned — the walk is broken`);
  });

  it('no source file contains a NUL or other stray control byte', () => {
    const bad: string[] = [];
    for (const f of FILES) {
      const buf = readFileSync(f);
      for (let i = 0; i < buf.length; i++) {
        const b = buf[i];
        // Everything below 0x20 except tab (9), LF (10) and CR (13) is a control byte that has no
        // business in source. NUL is the one that actually happened.
        if (b < 0x20 && b !== 9 && b !== 10 && b !== 13) {
          bad.push(`${path.relative(REPO, f)}: byte 0x${b.toString(16).padStart(2, '0')} at offset ${i}`);
          break;
        }
      }
    }
    assert.deepEqual(bad, [], `control bytes in source:\n${bad.join('\n')}`);
  });

  it('every repo-relative path a provenance header cites actually exists', () => {
    // Scoped to the WHAT/WHY/SUPERSEDES/SUPERSEDED-BY/EVIDENCE block, which by the org convention
    // sits in the first 30 lines. A path named further down is ordinary prose, not a provenance
    // claim, and is not this guard's business.
    const PATH_RE = /(?:^|[\s(`'"])((?:src|supabase|scripts|docs|\.claude)\/[A-Za-z0-9_.\/-]+\.(?:ts|tsx|mjs|js|sql|md|toml|yml))/g;
    const bad: string[] = [];
    for (const f of FILES) {
      const header = readFileSync(f, 'utf8').split('\n').slice(0, 30).join('\n');
      if (!/^\/\/ WHAT:|^# WHAT:|^-- WHAT:/m.test(header)) continue;
      for (const m of header.matchAll(PATH_RE)) {
        const cited = m[1];
        // A citation explicitly prefixed with another repo's name is out of this tree's reach.
        const idx = m.index ?? 0;
        if (/huddle-extension-app\s*$|journey-voice\s*$/.test(header.slice(Math.max(0, idx - 30), idx))) continue;
        if (!existsSync(path.join(REPO, cited))) {
          bad.push(`${path.relative(REPO, f)} cites ${cited}, which does not exist`);
        }
      }
    }
    assert.deepEqual(bad, [], `provenance headers naming missing files:\n${bad.join('\n')}`);
  });

  it('the provenance scan actually inspected some headers', () => {
    const withHeader = FILES.filter((f) =>
      /^\/\/ WHAT:|^# WHAT:|^-- WHAT:/m.test(readFileSync(f, 'utf8').split('\n').slice(0, 30).join('\n')),
    );
    assert.ok(withHeader.length >= 5, `only ${withHeader.length} provenance headers found — scan is vacuous`);
  });
});
