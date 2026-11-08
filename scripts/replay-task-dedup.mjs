#!/usr/bin/env node
// WHAT:          Replays the 2026-11-07 Iris duplicates (7 journey calls) through journey's task-dedup with REAL
//                embeddings and the owner's LIVE dedup config, against his open tasks that predate the incident.
//                Writes docs/qc-evidence/REPLAY-task-dedup-<label>.md.
// WHY:           The owner turned dedup ON on 2026-11-08. The offline test (task-dedup-replay.test.ts) pins the
//                signature layer; only real embeddings show what the semantic layer catches, and whether it would
//                merge any of the 23 distinct work items (a FALSE MERGE = a real task silently not created).
// SUPERSEDES:    nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:      supabase/functions/_shared/fixtures/iris-bulk-2026-11-07.json; docs/qc-evidence/FIX-parse-context-categories.md 5.
//
// READ-ONLY: two SELECTs (prefs, tasks) and one embeddings call. Calls buildDedupPlan directly -- the pure decision
// core runDedup uses -- so nothing is written to tasks, task_dedup_log or scheduled_notifications.
// Run (node 22+): OPENAI_API_KEY=… SB_SERVICE_KEY=… node --experimental-strip-types scripts/replay-task-dedup.mjs <label>

import { readFileSync, writeFileSync } from 'node:fs';

// embedTitlesOpenAI reads its key through Deno.env; give it node's environment so the PRODUCTION embedder runs.
globalThis.Deno ??= { env: { get: (k) => process.env[k] } };
const { buildDedupPlan, resolveDedupConfig, embedTitlesOpenAI } = await import('../supabase/functions/_shared/task-dedup.ts');

const SB = 'https://wwxgajrtmslzklnyplah.supabase.co';
const OWNER = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1';
const INCIDENT_START = '2026-11-07T14:38:00Z';
const KEY = process.env.SB_SERVICE_KEY;
if (!KEY || !process.env.OPENAI_API_KEY) { console.error('SB_SERVICE_KEY and OPENAI_API_KEY are required'); process.exit(1); }

const F = JSON.parse(readFileSync(new URL('../supabase/functions/_shared/fixtures/iris-bulk-2026-11-07.json', import.meta.url), 'utf8'));
const lineOf = (t) => { const i = F.lines.indexOf(t); return i >= 0 ? i : F.restates[t]; };

async function rest(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${await r.text()}`);
  return r.json();
}

const [prefs] = await rest(`user_scheduling_prefs?select=config&user_id=eq.${OWNER}`);
const liveCfg = resolveDedupConfig(prefs?.config);
const cfg = { ...liveCfg, enabled: true }; // replay as the guard runs when ON, with the live thresholds
// The owner's open tasks that existed before the incident (their CURRENT state -- some may have closed since).
const older = await rest(`tasks?select=id,title&user_id=eq.${OWNER}&created_at=lt.${INCIDENT_START}&status=neq.DONE&completed_at=is.null&limit=5000`);

// Embed once for the plan AND for the "similarity to the line it restates" column.
const allTitles = [...new Set([...older.map((t) => t.title), ...F.calls.flatMap((c) => c.parsed)])];
const vecs = await embedTitlesOpenAI(allTitles);
const vecOf = new Map(allTitles.map((t, i) => [t, vecs[i]]));
const embed = async (titles) => titles.map((t) => vecOf.get(t));
const cos = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / Math.sqrt(x * y); };

const open = [...older];
const rows = [];
const flags = [];
for (const [ci, c] of F.calls.entries()) {
  const plan = await buildDedupPlan({ candidates: c.parsed, openTasks: [...open], cfg, embed });
  for (const d of plan) {
    const call = ci + 1;
    const own = lineOf(d.title);
    const matchedOwn = d.matchedTitle !== undefined ? lineOf(d.matchedTitle) : undefined;
    let verdict;
    if (call === 1) {
      if (d.decision === 'unique') verdict = 'kept (correct)';
      else if (matchedOwn !== undefined) { verdict = `**FALSE MERGE** with another 11-07 item`; flags.push(`call 1 "${d.title}" ${d.decision} ~ "${d.matchedTitle}"`); }
      else { verdict = `${d.decision} vs an OLDER open task -- review`; flags.push(`call 1 "${d.title}" ${d.decision} ~ older task "${d.matchedTitle}"`); }
    } else {
      if (d.decision === 'duplicate') {
        if (matchedOwn === own) verdict = 'caught (correct)';
        else { verdict = `**WRONG-TARGET MERGE**`; flags.push(`call ${call} "${d.title}" skipped as "${d.matchedTitle}"`); }
      } else if (d.decision === 'possible') verdict = matchedOwn === own ? 'created + flagged possible-duplicate' : `flagged vs a different item`;
      else verdict = 'missed (created again)';
    }
    const simToOwn = call > 1 ? cos(vecOf.get(d.title), vecOf.get(F.lines[own])).toFixed(3) : '';
    rows.push(`| ${call} | ${d.title} | ${d.decision}${d.method ? ` (${d.method})` : ''} | ${d.matchedTitle ?? ''} | ${d.similarity ?? ''} | ${simToOwn} | ${verdict} |`);
    if (d.decision !== 'duplicate') open.push({ id: `c${call}-${d.index}`, title: d.title });
  }
}

const repeats = F.calls.slice(1).flatMap((c) => c.parsed).length;
const caught = rows.filter((r) => r.endsWith('caught (correct) |')).length;
const flagged = rows.filter((r) => r.includes('created + flagged')).length;
const label = process.argv[2] || 'run';
const out = `<!--
WHAT:          dedup replay of the 2026-11-07 duplicates, run "${label}".
WHY:           regression check on the owner's live dedup setting (ON since 2026-11-08): catches, and false merges.
SUPERSEDES:    nothing.  SUPERSEDED-BY: nothing -- current.
EVIDENCE:      produced by scripts/replay-task-dedup.mjs at ${new Date().toISOString()}.
-->

# Dedup replay of 11-07: ${label}

- Live config: \`${JSON.stringify(prefs?.config?.dedup ?? null)}\` -> enabled=${liveCfg.enabled}, high=${cfg.highThreshold}, possible=${cfg.possibleThreshold}, semantic=${cfg.semantic}
- Open tasks predating the incident (current state): ${older.length}
- **Repeats caught (skipped, correct target): ${caught} of ${repeats}**; created but flagged possible-duplicate: ${flagged}
- **False merges / wrong-target merges / call-1 matches to review: ${flags.length}**${flags.length ? `\n${flags.map((f) => `  - ${f}`).join('\n')}` : ''}

| call | candidate (parsed title) | decision | matched | sim | sim to the line it restates | verdict |
|---|---|---|---|---|---|---|
${rows.join('\n')}
`;
const path = `docs/qc-evidence/REPLAY-task-dedup-${label}.md`;
writeFileSync(path, out);
console.log(`caught ${caught}/${repeats}, flagged ${flagged}, flags ${flags.length} -> ${path}`);
for (const f of flags) console.log(`FLAG ${f}`);
