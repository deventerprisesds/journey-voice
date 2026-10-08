#!/usr/bin/env node
// WHAT:       Proves check-edge-deploy-drift.mjs actually DETECTS drift, by running it against a
//             local stand-in for the Supabase Management API.
// WHY:        A guard nobody has seen fire is a guard that is believed rather than known -- and the
//             defect this one exists to catch (committed != deployed) is precisely a case of
//             believing something was in place when it was not. Proving it with a mocked API keeps
//             the proof offline and repeatable; the real API needs a token this sandbox lacks.
// SUPERSEDES: nothing.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   .claude/accuracy-log.md entry 7.
//
// Run: node scripts/check-edge-deploy-drift.test.mjs
//
// Each case asserts the EXIT CODE, because that is what a CI job acts on. A script that prints
// "DRIFT" and exits 0 would be worse than none.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('./check-edge-deploy-drift.mjs', import.meta.url).pathname;
const LOCAL = 'export const x = 1;\n// the line that matters\n';

let failures = 0;
function check(name, actual, expected) {
  if (actual === expected) {
    console.log(`  ok       ${name} (exit ${actual})`);
  } else {
    failures++;
    console.log(`  FAILED:${name} — expected exit ${expected}, got ${actual}`);
  }
}

/** Run the checker in a throwaway tree whose one function has `localSource`, against `served`. */
async function run(localSource, served, status = 200) {
  const dir = mkdtempSync(join(tmpdir(), 'drift-'));
  mkdirSync(join(dir, 'supabase/functions/demo-fn'), { recursive: true });
  writeFileSync(join(dir, 'supabase/functions/demo-fn/index.ts'), localSource);

  const server = createServer((req, res) => {
    res.writeHead(status, { 'Content-Type': 'text/plain' });
    res.end(served ?? '');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  // Point the checker's API base at the stand-in. The script builds its URL from a const, so the
  // override is applied by rewriting that one line into a temp copy -- the alternative, adding a
  // configuration knob used only by tests, would change production behaviour to suit the test.
  const src = (await import('node:fs')).readFileSync(SCRIPT, 'utf8')
    .replace("https://api.supabase.com/v1/projects", `http://127.0.0.1:${port}/v1/projects`);
  const copy = join(dir, 'checker.mjs');
  writeFileSync(copy, src);

  const code = await new Promise((resolve) => {
    const p = spawn(process.execPath, [copy, 'demo-fn'], {
      cwd: dir,
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: 'test' },
      stdio: 'ignore',
    });
    p.on('exit', resolve);
  });
  server.close();
  rmSync(dir, { recursive: true, force: true });
  return code;
}

console.log('check-edge-deploy-drift guard:');

// THE HEADLINE: a deployed body that differs by ONE line must fail. This is the shape of the real
// defect -- `success: cr?.success ?? true` stale by a single statement while the file looked fresh.
check('D1 one-line difference is DRIFT',
  await run(LOCAL, 'export const x = 1;\n// a DIFFERENT line\n'), 1);

check('D2 identical source passes',
  await run(LOCAL, LOCAL), 0);

// Trailing whitespace is not drift: the deploy pipeline can normalise it, and a guard that cries
// wolf on it gets switched off.
check('D3 trailing-whitespace-only difference passes',
  await run(LOCAL, 'export const x = 1;   \n// the line that matters\t\n'), 0);

check('D4 a function missing from the project is DRIFT, not a pass',
  await run(LOCAL, '', 404), 1);

// An API error must NOT read as "checked and clean" -- absent evidence is never a pass.
check('D5 an unreachable API exits 2, never 0',
  await run(LOCAL, 'boom', 500), 2);

console.log('');
if (failures) {
  console.error(`${failures} guard case(s) failed.`);
  process.exit(1);
}
console.log('All guard cases passed — the checker detects drift and fails closed.');
