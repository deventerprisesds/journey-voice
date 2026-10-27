#!/usr/bin/env node
// WHAT:       Compares the DEPLOYED source of each Supabase edge function against the source in
//             this working tree, and exits non-zero when they differ. Answers "is what I committed
//             actually running?" mechanically.
// WHY:        The "committed != deployed" defect has now occurred TWICE and both times it was
//             invisible from git:
//               2026-09-13a  execute-tool was deployed from a branch 4 commits behind main,
//                            silently REVERTING 2fb90ac (the explicit-time reschedule fix) in prod.
//               2026-09-13b  the success-flattening fix was committed and green, but the LIVE
//                            function still read `success: cr?.success ?? true` -- while a
//                            NEIGHBOURING commit's auth fix HAD deployed, so the function looked
//                            freshly updated while carrying a stale line a few statements away.
//             "Some of my changes are live" is indistinguishable from "my changes are live" by
//             inspection, which is exactly why a human-memory rule does not close this.
// SUPERSEDES: the prose guard in .claude/accuracy-log.md entry 7 ("read the deployed source and
//             grep for the changed line"). That is the form this repo has already shown to fail:
//             the rule existed, was written down, and the defect recurred anyway.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   accuracy-log.md entry 7; the live pg_net probe (715113) that returned
//             `{"success":true}` for a channel the Worker had reported `ok:false`.
//
// REVISED 2026-10-27 (docs/qc-evidence/RECORD-drift-check-eszip.md): the first version diffed the
//             API's `/body` as TEXT. That endpoint returns an ESZIP2.3 BUNDLE, and the stored
//             module source in it is TRANSPILED JS -- so run 40414573682 reported "checked 51,
//             drifted 51" while nothing had drifted. The check now parses the bundle
//             (scripts/eszip.mjs) and compares the ORIGINAL TypeScript, read from each module's
//             source-map `sourcesContent`, for the entry module AND every local import (`_shared/*`)
//             against the tree. Anything it cannot read that way is UNVERIFIABLE -- printed loudly,
//             exit 2, and never counted as a match.
//
// USAGE
//   SUPABASE_ACCESS_TOKEN=... node scripts/check-edge-deploy-drift.mjs [fn ...]
//   (no args = every function under supabase/functions that has an index.ts)
//
// Exit 0 = every checked function's deployed source matches the tree.
// Exit 1 = DRIFT: at least one differs (drift wins over everything else).
// Exit 2 = could not check at least one function (auth/network, or an UNVERIFIABLE bundle) and no
//          drift was found -- NOT a pass.
//
// The 2-vs-1 split is deliberate. A checker that cannot reach the API must never be mistaken for
// one that checked and found nothing, which is the "absent evidence is not a pass" rule applied to
// this script itself.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEszip, looksLikeEszip, EszipFormatError } from './eszip.mjs';

const PROJECT_REF = 'wwxgajrtmslzklnyplah';
const API = `https://api.supabase.com/v1/projects/${PROJECT_REF}/functions`;
const ROOT = 'supabase/functions';

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('SUPABASE_ACCESS_TOKEN is not set. Cannot check — this is NOT a pass.');
  process.exit(2);
}

/** Compare ignoring only trailing whitespace: any real character difference is drift. */
const normalise = (s) => String(s).replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trimEnd();

function localFunctions() {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name)
    .filter((n) => existsSync(join(ROOT, n, 'index.ts')));
}

async function deployedBody(slug) {
  const res = await fetch(`${API}/${slug}/body`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return { missing: true };
  if (!res.ok) throw new Error(`${slug}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  // BYTES, not text(): the body is a binary bundle, and a UTF-8 decode would corrupt its framing.
  return { body: Buffer.from(await res.arrayBuffer()) };
}

/** First divergent line, which is usually the whole story: it names the stale statement. */
function firstDifference(local, live) {
  const l = local.split('\n');
  const r = live.split('\n');
  for (let i = 0; i < Math.max(l.length, r.length); i++) {
    if (l[i] !== r[i]) {
      return [
        `first difference at line ${i + 1} (tree ${l.length} lines, deployed ${r.length} lines):`,
        `  tree:     ${(l[i] ?? '(absent)').trim().slice(0, 120)}`,
        `  deployed: ${(r[i] ?? '(absent)').trim().slice(0, 120)}`,
      ];
    }
  }
  return [];
}

/**
 * A bundle specifier that names a file shipped FROM THIS TREE, as a slash path; null for remote
 * deps (https:, npm:, jsr:, data:...) and for Supabase's own `---NAME---` metadata entries. Remote
 * deps are pinned by URL in the source, so a source match already covers which one is used.
 */
function localPath(specifier) {
  if (specifier.startsWith('---')) return null;
  if (specifier.startsWith('file:')) {
    try { return fileURLToPath(specifier).split(sep).join('/'); } catch { return null; }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(specifier)) return null;
  return specifier.replace(/\\/g, '/');
}

/**
 * The ORIGINAL source of a bundled module. The bundle's own `source` slot holds the TRANSPILED
 * output (measured on live `ping`: types stripped, a comment close and the next import joined onto one line), so comparing
 * it to .ts would report drift for every function forever. The bundler emits source maps with
 * `inline_sources`, so the untouched original is in `sourcesContent`. No map, no content -> null,
 * and the caller reports UNVERIFIABLE rather than guessing.
 */
function originalSource(mod, specifier) {
  if (!mod.sourceMap || mod.sourceMap.length === 0) return null;
  let map;
  try { map = JSON.parse(mod.sourceMap.toString('utf8')); } catch { return null; }
  const sources = Array.isArray(map.sources) ? map.sources : [];
  const contents = Array.isArray(map.sourcesContent) ? map.sourcesContent : [];
  let idx = sources.findIndex((s) => s === specifier || String(s).endsWith('/' + specifier));
  if (idx < 0 && sources.length === 1) idx = 0;
  return typeof contents[idx] === 'string' ? contents[idx] : null;
}

/** -> { status: 'ok' | 'drift' | 'unverifiable', lines: string[] } */
function compareBundle(slug, body) {
  let parsed;
  try {
    parsed = parseEszip(body);
  } catch (err) {
    if (!(err instanceof EszipFormatError)) throw err;
    return { status: 'unverifiable', lines: [`bundle did not parse: ${err.message}`] };
  }

  const local = [];
  for (const [specifier, mod] of parsed.modules) {
    if (mod.type !== 'module') continue;
    const path = localPath(specifier);
    if (path !== null) local.push({ specifier, path, mod });
  }

  const entrySuffix = `${slug}/index.ts`;
  const entries = local.filter((m) => m.path === entrySuffix || m.path.endsWith('/' + entrySuffix));
  if (entries.length !== 1) {
    return {
      status: 'unverifiable',
      lines: [
        `ESZIP${parsed.version}: ${entries.length === 0 ? 'no' : 'more than one'} local module ending in ${entrySuffix}`,
        `local modules in bundle: ${local.map((m) => m.specifier).join(', ') || '(none)'}`,
      ],
    };
  }
  const prefix = entries[0].path.slice(0, entries[0].path.length - entrySuffix.length);

  const drift = [];
  const unverifiable = [];
  let matched = 0;
  for (const m of local) {
    const rel = m.path.startsWith(prefix) ? m.path.slice(prefix.length) : null;
    if (rel === null || rel.split('/').includes('..')) {
      unverifiable.push(`${m.specifier}: outside the bundle's function root "${prefix}", cannot be mapped to the tree`);
      continue;
    }
    const original = originalSource(m.mod, m.specifier);
    if (original === null) {
      unverifiable.push(`${m.specifier}: no original source in the bundle (source map missing or has no sourcesContent)`);
      continue;
    }
    const treePath = normalize(join(ROOT, rel));
    if (!existsSync(treePath)) {
      drift.push(`${rel}: deployed, but ${treePath} is absent from the tree`);
      continue;
    }
    const a = normalise(readFileSync(treePath, 'utf8'));
    const b = normalise(original);
    if (a === b) matched++;
    else drift.push(`${rel}:`, ...firstDifference(a, b).map((x) => '  ' + x));
  }

  if (drift.length) return { status: 'drift', lines: [...drift, ...unverifiable] };
  if (unverifiable.length) return { status: 'unverifiable', lines: unverifiable };
  return { status: 'ok', lines: [`ESZIP${parsed.version}, ${matched} local module(s) compared`] };
}

/** A plain-text body (the API's older shape) is compared directly, as before. */
function compareBody(slug, path, body) {
  if (looksLikeEszip(body)) return compareBundle(slug, body);
  if (body.includes(0)) {
    return {
      status: 'unverifiable',
      lines: [`binary body in an unrecognised format (starts ${JSON.stringify(body.subarray(0, 8).toString('latin1'))})`],
    };
  }
  const a = normalise(readFileSync(path, 'utf8'));
  const b = normalise(body.toString('utf8'));
  return a === b ? { status: 'ok', lines: ['plain-text body'] } : { status: 'drift', lines: firstDifference(a, b) };
}

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : localFunctions();
let drifted = 0;
let unreachable = 0;
let unverifiable = 0;
let matched = 0;
let checked = 0;

for (const slug of wanted) {
  const path = join(ROOT, slug, 'index.ts');
  if (!existsSync(path)) {
    console.log(`  SKIP      ${slug} (no ${path} in this tree)`);
    continue;
  }
  let dep;
  try {
    dep = await deployedBody(slug);
  } catch (err) {
    // Reaching the API and failing is a DIFFERENT outcome from matching. Counted separately so a
    // run of errors can never read as a clean bill of health.
    console.log(`  UNKNOWN   ${slug} — ${err.message}`);
    unreachable++;
    continue;
  }
  if (dep.missing) {
    console.log(`  NOT-DEPLOYED  ${slug} — exists in the tree, absent from the project`);
    drifted++;
    continue;
  }
  checked++;
  const result = compareBody(slug, path, dep.body);
  const label = { ok: 'ok', drift: 'DRIFT', unverifiable: 'UNVERIFIABLE' }[result.status];
  if (result.status === 'ok') matched++;
  else if (result.status === 'drift') drifted++;
  else unverifiable++;
  console.log(`  ${label.padEnd(9)} ${slug}${result.status === 'ok' ? ` (${result.lines.join('; ')})` : ''}`);
  if (result.status !== 'ok') for (const line of result.lines) console.log(`            ${line}`);
}

console.log('');
console.log(`checked ${checked}, matched ${matched}, drifted ${drifted}, unverifiable ${unverifiable}, unreachable ${unreachable}`);

if (unverifiable > 0) {
  // Loud on purpose: an unverifiable function is a hole in the check, not a quiet success.
  console.error(`!!! ${unverifiable} function(s) are UNVERIFIABLE: their deployed bundle could not be read back to source. They were NOT compared and are NOT counted as matching.`);
}
if (drifted > 0) {
  console.error(`DRIFT: ${drifted} function(s) differ from what is deployed. Deploy them or explain why.`);
  process.exit(1);
}
if (unreachable > 0 || unverifiable > 0) {
  console.error('Some functions could not be checked. That is not a pass.');
  process.exit(2);
}
console.log('Every checked function matches its deployed source.');
