#!/usr/bin/env node
// WHAT:       Runs the REAL "Determine functions to deploy" step of deploy-supabase-functions.yml
//             under bash for the manual-dispatch inputs, and asserts what each one decides.
// WHY:        A blank `function_name` on a manual dispatch used to fall through to mode=all and
//             redeploy EVERY edge function (a dispatch has no github.event.before), while the input's
//             help text said "changed". The refusal that fixes it had no test: deleting it left the
//             whole suite green (VERIFY-restore-j12-deploy-guard-1.md, C6 / F2, INERT). A refusal
//             nobody has seen fire is believed rather than known.
// SUPERSEDES: nothing.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   docs/qc-evidence/VERIFY-restore-j12-deploy-guard-1.md (C5, C6).
//
// Run: node scripts/deploy-dispatch-mode.test.mjs
//
// Reads the step out of the workflow FILE rather than copying it, so the test cannot drift from
// what GitHub actually runs. Only the dispatch branches are exercised: they come before any git
// call, so no repository state is needed.
import { readFileSync, mkdtempSync, readFileSync as rf, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WF = new URL('../.github/workflows/deploy-supabase-functions.yml', import.meta.url).pathname;
const lines = readFileSync(WF, 'utf8').split('\n');

function stepRunBlock(stepName) {
  const at = lines.findIndex((l) => l.includes(`name: ${stepName}`));
  if (at < 0) throw new Error(`step "${stepName}" not found in ${WF}`);
  const runAt = lines.findIndex((l, i) => i > at && /^\s*run:\s*\|\s*$/.test(l));
  if (runAt < 0) throw new Error(`no "run: |" block after step "${stepName}"`);
  const indent = lines[runAt].search(/\S/);
  const body = [];
  for (let i = runAt + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() !== '' && l.search(/\S/) <= indent) break;
    body.push(l);
  }
  return body.join('\n');
}

const block = stepRunBlock('Determine functions to deploy');

let failures = 0;
function runDispatch(input) {
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-'));
  const out = join(dir, 'out');
  writeFileSync(out, '');
  const script = block
    .replaceAll('${{ github.event_name }}', 'workflow_dispatch')
    .replaceAll('${{ github.event.inputs.function_name }}', input)
    .replaceAll('${{ github.event.before }}', '')
    .replaceAll('${{ github.sha }}', 'HEAD');
  const r = spawnSync('bash', ['-e', '-c', script], { env: { ...process.env, GITHUB_OUTPUT: out }, encoding: 'utf8' });
  const output = rf(out, 'utf8');
  rmSync(dir, { recursive: true, force: true });
  return { code: r.status, output, stdout: r.stdout };
}
function check(name, cond, detail) {
  if (cond) console.log(`  ok       ${name}`);
  else { failures++; console.log(`  FAILED   ${name}\n           ${detail}`); }
}

const blank = runDispatch('');
check('D1 a blank manual dispatch refuses (non-zero exit) instead of deploying everything',
  blank.code !== 0 && !/mode=all/.test(blank.output), JSON.stringify(blank));
check('D1b and says what to do instead', /name a function or pass all/.test(blank.stdout), blank.stdout);
const all = runDispatch('all');
check('D2 "all" still deploys everything', all.code === 0 && /mode=all/.test(all.output), JSON.stringify(all));
const one = runDispatch('execute-tool');
check('D3 a named function deploys only that function',
  one.code === 0 && /mode=single/.test(one.output) && /fn=execute-tool/.test(one.output), JSON.stringify(one));

console.log(failures ? `\n${failures} FAILED` : '\nall dispatch-mode checks passed');
process.exit(failures ? 1 : 0);
