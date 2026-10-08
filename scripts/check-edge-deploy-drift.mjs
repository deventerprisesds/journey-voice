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
// USAGE
//   SUPABASE_ACCESS_TOKEN=... node scripts/check-edge-deploy-drift.mjs [fn ...]
//   (no args = every function under supabase/functions that has an index.ts)
//
// Exit 0 = every checked function's deployed source matches the tree.
// Exit 1 = DRIFT: at least one differs. Exit 2 = could not check (auth/network) -- NOT a pass.
//
// The 2-vs-1 split is deliberate. A checker that cannot reach the API must never be mistaken for
// one that checked and found nothing, which is the "absent evidence is not a pass" rule applied to
// this script itself.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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

async function deployedSource(slug) {
  const res = await fetch(`${API}/${slug}/body`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return { missing: true };
  if (!res.ok) throw new Error(`${slug}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return { source: await res.text() };
}

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : localFunctions();
let drifted = 0;
let unreachable = 0;
let checked = 0;

for (const slug of wanted) {
  const path = join(ROOT, slug, 'index.ts');
  if (!existsSync(path)) {
    console.log(`  SKIP      ${slug} (no ${path} in this tree)`);
    continue;
  }
  let dep;
  try {
    dep = await deployedSource(slug);
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
  const local = normalise(readFileSync(path, 'utf8'));
  const live = normalise(dep.source);
  if (local === live) {
    console.log(`  ok        ${slug}`);
  } else {
    drifted++;
    const l = local.split('\n');
    const r = live.split('\n');
    let firstDiff = -1;
    for (let i = 0; i < Math.max(l.length, r.length); i++) {
      if (l[i] !== r[i]) { firstDiff = i; break; }
    }
    console.log(`  DRIFT     ${slug} — tree ${l.length} lines, deployed ${r.length} lines`);
    if (firstDiff >= 0) {
      // Print the first divergent line, which is usually the whole story: it names the statement
      // that is stale. Truncated because a long line is noise, not evidence.
      console.log(`            first difference at line ${firstDiff + 1}:`);
      console.log(`              tree:     ${(l[firstDiff] ?? '(absent)').trim().slice(0, 120)}`);
      console.log(`              deployed: ${(r[firstDiff] ?? '(absent)').trim().slice(0, 120)}`);
    }
  }
}

console.log('');
console.log(`checked ${checked}, drifted ${drifted}, unreachable ${unreachable}`);

if (unreachable > 0 && drifted === 0) {
  console.error('Some functions could not be checked. That is not a pass.');
  process.exit(2);
}
if (drifted > 0) {
  console.error(`DRIFT: ${drifted} function(s) differ from what is deployed. Deploy them or explain why.`);
  process.exit(1);
}
console.log('Every checked function matches its deployed source.');
