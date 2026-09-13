// WHAT:       Regression tests for scripts/undef-check.mjs's TYPE-BODY blind spot.
// WHY:        A TypeScript method SIGNATURE is spelled exactly like a call, so the checker's call
//             regex reported `interface Deps { loadThing(id: string): Promise<X> }` as an
//             undefined symbol. Measured 2026-09-13: 12 such false positives appeared the moment
//             origin/main's digest files (DigestRunDeps, DigestQuery) met this branch's checker,
//             turning `npm run check` red on code that was correct. The same blind spot had
//             already fired once that day on a single `waitUntil(p): void` member.
// SUPERSEDES: nothing -- undef-check.mjs had no test of its own.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   .claude/actions.md ACT:undef-check-type-position; merge commit 514ec55, whose
//             `npm run check:symbols` reported "12 NEW undefined symbol(s)" before this fix.
//
// THE SECOND TEST IS THE ONE THAT MATTERS. Teaching a checker to ignore something is easy to
// overdo, and an over-corrected guard fails SILENTLY -- it goes green and protects nothing, which
// is worse than the false positive it replaced because nobody investigates a pass. So U2 proves a
// genuine undefined call is STILL caught, and U3 proves the reported LINE NUMBER survives the
// blanking (blanking that collapsed newlines would misreport every finding below a type).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHECKER = new URL('./undef-check.mjs', import.meta.url).pathname;

/** Run the checker over one throwaway file and return its combined output. */
function check(source) {
  const dir = mkdtempSync(join(tmpdir(), 'undef-check-'));
  const file = join(dir, 'subject.ts');
  writeFileSync(file, source, 'utf8');
  try {
    return execFileSync('node', [CHECKER, file], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    // The checker exits non-zero when it finds something; the report is still what we assert on.
    return `${err.stdout ?? ''}${err.stderr ?? ''}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('U1 an interface method signature is NOT reported as an undefined call', () => {
  const out = check(
    'export interface Deps {\n' +
      '  loadThing(id: string): Promise<string | null>;\n' +
      '  select(columns: string): Deps;\n' +
      '}\n',
  );
  assert.ok(!out.includes('loadThing'), `signature flagged as a call:\n${out}`);
  assert.ok(!out.includes('select'), `signature flagged as a call:\n${out}`);
  assert.match(out, /0 NEW undefined symbol/);
});

test('U2 a GENUINE undefined call is still reported when a type body is present', () => {
  // Over-correction guard. If blanking ever widens past the type body, this goes quiet and the
  // checker protects nothing.
  const out = check(
    'export interface Deps {\n' +
      '  loadThing(id: string): Promise<string | null>;\n' +
      '}\n' +
      'export function go() {\n' +
      '  return definitelyNotDefined(1);\n' +
      '}\n',
  );
  assert.ok(out.includes('definitelyNotDefined'), `real defect went unreported:\n${out}`);
  assert.match(out, /1 NEW undefined symbol/);
});

test('U3 the reported line number survives type-body blanking', () => {
  // Blanking replaces body characters with spaces and PRESERVES newlines. If it collapsed them,
  // every finding under a type would cite the wrong line and be untraceable.
  const out = check(
    'export interface Deps {\n' + // 1
      '  a(x: string): void;\n' + //   2
      '  b(y: string): void;\n' + //   3
      '}\n' + //                       4
      'export function go() {\n' + //  5
      '  return missingSymbol(1);\n' + // 6
      '}\n',
  );
  assert.match(out, /subject\.ts:6\s+missingSymbol/, `wrong line number:\n${out}`);
});

test('U4 a type ALIAS with no body is untouched and its call still checked', () => {
  // `type X = A | B;` has no `{`, so the scanner must bail without consuming anything after it.
  const out = check('type Id = string | number;\nexport const v = alsoNotDefined(1 as Id);\n');
  assert.ok(out.includes('alsoNotDefined'), `alias swallowed the following code:\n${out}`);
});
