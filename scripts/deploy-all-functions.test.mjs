#!/usr/bin/env node
// WHAT:       Runs the REAL "Deploy all functions" step of deploy-supabase-functions.yml under bash,
//             with a stub `supabase` binary first on PATH. Asserts that all-mode deploys each
//             function on its own, keeps going past a failure, names the failure in a summary, and
//             exits non-zero at the end.
// WHY:        The bulk `supabase functions deploy` stopped at mcp's 413 in runs 39159443758 and
//             40575132776, so every function after `mcp` alphabetically was silently never deployed.
//             Nothing tested the all-mode step at all.
// SUPERSEDES: nothing.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   docs/qc-evidence/FIX-deploy-all-per-function.md.
//
// Run: node scripts/deploy-all-functions.test.mjs
//
// Reads the step out of the workflow FILE (the same extraction as deploy-dispatch-mode.test.mjs),
// so it tests what GitHub runs, not a copy. The stub records each call and exits 1 (printing a
// 413-shaped line) for any slug listed in STUB_FAIL.
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, chmodSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = new URL('..', import.meta.url).pathname;
const WF = join(REPO, '.github/workflows/deploy-supabase-functions.yml');
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
    body.push(l.slice(indent + 2));
  }
  return body.join('\n');
}
const block = stepRunBlock('Deploy all functions');

const work = mkdtempSync(join(tmpdir(), 'deploy-all-'));
const bin = join(work, 'bin');
mkdirSync(bin);
writeFileSync(join(bin, 'supabase'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_CALLS"
for f in $STUB_FAIL; do
  if [ "$3" = "$f" ]; then
    echo "Deploying Function: $3 (script size: 27 MB)"
    echo 'unexpected update function status 413: {"message":"request entity too large"}'
    echo "Try rerunning the command with --debug to troubleshoot the error."
    exit 1
  fi
done
echo "Deployed Function $3"
`);
chmodSync(join(bin, 'supabase'), 0o755);

// Fixture: functions on both sides of `mcp` alphabetically, plus the folders the CLI never deploys.
function fixture(name, fns) {
  const dir = join(work, name);
  for (const f of fns) { mkdirSync(join(dir, f), { recursive: true }); writeFileSync(join(dir, f, 'index.ts'), '// fn\n'); }
  mkdirSync(join(dir, '_shared'), { recursive: true }); writeFileSync(join(dir, '_shared', 'index.ts'), '// shared\n');
  mkdirSync(join(dir, '.hidden'), { recursive: true }); writeFileSync(join(dir, '.hidden', 'index.ts'), '// dot\n');
  mkdirSync(join(dir, 'no-entry'), { recursive: true }); writeFileSync(join(dir, 'no-entry', 'other.ts'), '// no index\n');
  return dir;
}
const FNS = ['alpha', 'beta', 'mcp', 'nightly', 'zeta'];
const fx = fixture('fx', FNS);
const empty = join(work, 'empty'); mkdirSync(empty);

let n = 0;
function run({ functionsDir, fail = '', exclude }) {
  const calls = join(work, `calls-${++n}`);
  const summary = join(work, `summary-${n}`);
  writeFileSync(calls, ''); writeFileSync(summary, '');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_CALLS: calls, STUB_FAIL: fail,
    FUNCTIONS_DIR: functionsDir, GITHUB_STEP_SUMMARY: summary };
  delete env.DEPLOY_ALL_EXCLUDE;
  if (exclude !== undefined) env.DEPLOY_ALL_EXCLUDE = exclude;
  // GitHub runs `run:` with `bash -e {0}`; match it so a stray `set -e` interaction would show here.
  const r = spawnSync('bash', ['-e', '-c', block], { cwd: REPO, env, encoding: 'utf8' });
  const callLines = readFileSync(calls, 'utf8').split('\n').filter(Boolean);
  return { code: r.status, out: r.stdout + r.stderr, calls: callLines, deployedSlugs: callLines.map((c) => c.split(' ')[2]),
    summary: readFileSync(summary, 'utf8') };
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok       ${name}`);
  else { failures++; console.log(`  FAILED   ${name}\n           ${String(detail).slice(0, 1500)}`); }
}

console.log('deploy-all-functions (mode=all):');

// The scenario from the brief: no exclusion, and the stub rejects mcp exactly as Supabase does.
const f = run({ functionsDir: fx, fail: 'mcp', exclude: '' });
check('A1 each function is deployed by its OWN call (one slug per `functions deploy`)',
  f.calls.length === FNS.length && f.calls.every((c, i) => c === `functions deploy ${FNS[i]} --project-ref wwxgajrtmslzklnyplah`),
  JSON.stringify(f.calls));
check('A2 a failure does not stop the functions after it (nightly, zeta still deployed after mcp failed)',
  f.deployedSlugs.includes('nightly') && f.deployedSlugs.includes('zeta')
    && f.deployedSlugs.indexOf('zeta') > f.deployedSlugs.indexOf('mcp'),
  JSON.stringify(f.calls));
check('A3 the summary names the failed function and its reason',
  /\|\s*mcp\s*\|\s*\*\*FAILED\*\*\s*\|[^\n]*413/.test(f.out) && /failed: 1/.test(f.out), f.out);
check('A4 the step exits NON-ZERO when any function failed', f.code !== 0, `exit ${f.code}`);
check('A5 the summary is also written to GITHUB_STEP_SUMMARY', /\|\s*mcp\s*\|\s*\*\*FAILED\*\*/.test(f.summary), f.summary);

const ok = run({ functionsDir: fx, exclude: '' });
check('A6 all succeed -> exit 0 and every function counted as deployed',
  ok.code === 0 && /deployed: 5\s+failed: 0/.test(ok.out), `exit ${ok.code}\n${ok.out}`);
check('A7 _shared, dot-dirs and folders without index.ts are never deployed',
  !ok.deployedSlugs.some((s) => ['_shared', '.hidden', 'no-entry'].includes(s)), JSON.stringify(ok.calls));

// The step's REAL default exclusion (DEPLOY_ALL_EXCLUDE unset, as on GitHub).
const ex = run({ functionsDir: fx, fail: 'mcp' });
check('A8 by default mcp is excluded: never attempted, step still green',
  ex.code === 0 && !ex.deployedSlugs.includes('mcp') && ex.deployedSlugs.length === FNS.length - 1,
  `exit ${ex.code} ${JSON.stringify(ex.calls)}`);
check('A9 the exclusion is printed with its reason, never silent',
  /SKIPPED mcp \(excluded from all-mode\): [^\n]*413/.test(ex.out) && /\|\s*mcp\s*\|\s*excluded\s*\|/.test(ex.out), ex.out);

// Against the repo's REAL supabase/functions: the same set the CLI's bulk deploy would glob.
const realDir = join(REPO, 'supabase/functions');
const expected = readdirSync(realDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^[A-Za-z][A-Za-z0-9_-]*$/.test(d.name) && existsSync(join(realDir, d.name, 'index.ts')))
  .map((d) => d.name).sort();
const real = run({ functionsDir: realDir });
check('A10 on the real tree every function folder except mcp is deployed, one call each',
  real.code === 0 && expected.length > 10
    && JSON.stringify(real.deployedSlugs) === JSON.stringify(expected.filter((s) => s !== 'mcp')),
  `exit ${real.code} expected ${expected.length - 1}, got ${real.deployedSlugs.length}`);

const none = run({ functionsDir: empty, exclude: '' });
check('A11 finding zero functions is a failure, not a silent green', none.code !== 0 && none.calls.length === 0,
  `exit ${none.code}\n${none.out}`);

rmSync(work, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : '\nall deploy-all checks passed');
process.exit(failures ? 1 : 0);
