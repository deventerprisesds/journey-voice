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
// REVISED 2026-10-27: adds the E-cases for ESZIP bundles (docs/qc-evidence/RECORD-drift-check-eszip.md).
// E1-E3 use a REAL bundle, scripts/fixtures/eszip/ping.eszip, the raw `/body` of the live `ping`
// function captured by run 40432331168 (17110 bytes, sha256 aa292a1e...). Its tree copies are the
// ping.*.ts.txt files beside it. The other E-cases use bundles built by eszip.mjs's buildEszip.
//
// Run: node scripts/check-edge-deploy-drift.test.mjs
//
// Each case asserts the EXIT CODE, because that is what a CI job acts on. A script that prints
// "DRIFT" and exits 0 would be worse than none.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { buildEszip } from './eszip.mjs';

const SCRIPT = new URL('./check-edge-deploy-drift.mjs', import.meta.url).pathname;
const PARSER = new URL('./eszip.mjs', import.meta.url).pathname;
const FIX = new URL('./fixtures/eszip/', import.meta.url).pathname;
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
/** Assert something about the checker's OUTPUT, for the cases where the exit code alone is not enough. */
function checkOut(name, ok, detail) {
  if (ok) console.log(`  ok       ${name}`);
  else {
    failures++;
    console.log(`  FAILED:${name} — ${detail}`);
  }
}

/**
 * Run the checker in a throwaway tree, against a stand-in API serving `served` for every request.
 * `tree` is either one string (demo-fn/index.ts) or a map of path-under-supabase/functions -> source.
 */
async function runFull(tree, served, status = 200, slug = 'demo-fn') {
  const dir = mkdtempSync(join(tmpdir(), 'drift-'));
  const files = typeof tree === 'string' ? { [`${slug}/index.ts`]: tree } : tree;
  for (const [rel, src] of Object.entries(files)) {
    const p = join(dir, 'supabase/functions', rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, src);
  }

  const server = createServer((req, res) => {
    res.writeHead(status, { 'Content-Type': Buffer.isBuffer(served) ? 'application/octet-stream' : 'text/plain' });
    res.end(served ?? '');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  // Point the checker's API base at the stand-in. The script builds its URL from a const, so the
  // override is applied by rewriting that one line into a temp copy -- the alternative, adding a
  // configuration knob used only by tests, would change production behaviour to suit the test.
  // The parser module is copied beside it so the copy's relative import resolves.
  const src = readFileSync(SCRIPT, 'utf8')
    .replace("https://api.supabase.com/v1/projects", `http://127.0.0.1:${port}/v1/projects`);
  writeFileSync(join(dir, 'checker.mjs'), src);
  writeFileSync(join(dir, 'eszip.mjs'), readFileSync(PARSER));

  const result = await new Promise((resolve) => {
    let out = '';
    const p = spawn(process.execPath, [join(dir, 'checker.mjs'), slug], {
      cwd: dir,
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('exit', (code) => resolve({ code, out }));
  });
  server.close();
  rmSync(dir, { recursive: true, force: true });
  return result;
}
const run = async (...a) => (await runFull(...a)).code;

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

// ---- ESZIP bundles (what the API actually returns since at least 2026-10-26) ----------------------

const REAL = readFileSync(join(FIX, 'ping.eszip'));
const PING_INDEX = readFileSync(join(FIX, 'ping.index.ts.txt'), 'utf8');
const PING_CONFIG = readFileSync(join(FIX, 'ping._shared.config.ts.txt'), 'utf8');
const pingTree = (index = PING_INDEX, config = PING_CONFIG) => ({ 'ping/index.ts': index, '_shared/config.ts': config });

// The false alarm this revision exists to fix: the live bundle of an UNCHANGED function must pass.
// Its module `source` is transpiled JS, so this passes only if the original TS is read from the map.
{
  const r = await runFull(pingTree(), REAL, 200, 'ping');
  check('E1 real live ESZIP2.3 bundle matching the tree passes', r.code, 0);
  checkOut('E1b the match covered the _shared import, not only the entry',
    /2 local module\(s\) compared/.test(r.out), `output was: ${r.out.trim().slice(0, 300)}`);
}

check('E2 real bundle with one line changed in the ENTRY module is DRIFT',
  await run(pingTree(PING_INDEX.replace("status: 'healthy'", "status: 'unhealthy'")), REAL, 200, 'ping'), 1);

// The shared module is where a stale deploy hides: index.ts can be current while _shared is not.
check('E3 real bundle with one line changed in a _shared IMPORT is DRIFT',
  await run(pingTree(PING_INDEX, PING_CONFIG.replace('"2026-02-04-v23"', '"2026-02-04-v24"')), REAL, 200, 'ping'), 1);

// A bundle that will not parse must be UNVERIFIABLE: exit 2, said out loud, and NEVER a match.
{
  const r = await runFull(pingTree(), REAL.subarray(0, 200), 200, 'ping');
  check('E4 a truncated (unparseable) bundle exits 2, never 0', r.code, 2);
  checkOut('E4b the unparseable bundle is reported UNVERIFIABLE and not counted as matched',
    /UNVERIFIABLE\s+ping/.test(r.out) && /matched 0, drifted 0, unverifiable 1/.test(r.out) &&
      !/Every checked function matches/.test(r.out),
    `output was: ${r.out.trim().slice(0, 400)}`);
}

// No source map = no original source. The transpiled `source` is never compared to .ts in its place,
// even when it happens to be byte-identical: that would be a match the format cannot vouch for.
{
  const b = buildEszip([{ specifier: 'demo-fn/index.ts', source: LOCAL }]);
  const r = await runFull(LOCAL, b);
  check('E5 a module with no source map is UNVERIFIABLE (exit 2), not matched', r.code, 2);
  checkOut('E5b ...and says why', /no original source in the bundle/.test(r.out), `output was: ${r.out.trim().slice(0, 300)}`);
}

const map = (spec, content) => JSON.stringify({ version: 3, sources: [spec], sourcesContent: [content], mappings: '' });

check('E6 a bundle with no entry module for this slug is UNVERIFIABLE (exit 2)',
  await run(LOCAL, buildEszip([{ specifier: 'other-fn/index.ts', source: 'x', sourceMap: map('other-fn/index.ts', LOCAL) }])), 2);

check('E7 an unrecognised binary body is UNVERIFIABLE (exit 2), not text-diffed',
  await run(LOCAL, Buffer.from('ZIPPED\0\0\x01\x02 not a bundle')), 2);

// Older framing: ESZIP2.1 has no options header and SHA-256 hashes after every section.
const v21 = buildEszip([
  { specifier: 'functions/demo-fn/index.ts', source: 'transpiled', sourceMap: map('functions/demo-fn/index.ts', LOCAL) },
  { specifier: 'https://deno.land/std@0.190.0/http/server.ts', source: 'remote', sourceMap: '' },
], { version: '2.1', checksum: 'sha256' });
check('E8 an ESZIP2.1 (sha256) bundle matching the tree passes; remote deps are skipped',
  await run(LOCAL, v21), 0);

{
  const bad = Buffer.from(v21);
  bad[bad.indexOf('transpiled')] ^= 0x20; // flip one byte inside a hashed source
  check('E9 a sha256 mismatch is UNVERIFIABLE (exit 2), never a match', await run(LOCAL, bad), 2);
}

check('E10 a deployed local module absent from the tree is DRIFT',
  await run(LOCAL, buildEszip([
    { specifier: 'demo-fn/index.ts', source: 'x', sourceMap: map('demo-fn/index.ts', LOCAL) },
    { specifier: '_shared/gone.ts', source: 'y', sourceMap: map('_shared/gone.ts', 'export const gone = 1;\n') },
  ])), 1);

console.log('');
if (failures) {
  console.error(`${failures} guard case(s) failed.`);
  process.exit(1);
}
console.log('All guard cases passed — the checker detects drift and fails closed.');
