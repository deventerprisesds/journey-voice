#!/usr/bin/env node
// WHAT:          The JOB-category scorecard: sends each sample task title to the LIVE ai-task-parser and checks
//                the category it picks. Writes docs/qc-evidence/EVAL-job-category-<label>.md.
// WHY:           Owner 2026-11-03: "it should be able to intelligently know a work hours or job task and
//                automatically push it to job even if trinnex isnt explicitly stated". Only running the real
//                model can show that; a prompt reading cannot.
// SUPERSEDES:    nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:      docs/qc-evidence/AC-job-category.md AC-D9/AC-D10 and section 4 (the eval set).
//
// WRITES NOTHING TO THE BOARD: it calls the parser with a userId but NO boardId, the parse-only path (the
// parser never inserts; task creation lives in execute-tool). The userId is passed so the parser loads the
// owner's employer (Profile > Company) and name hints (Settings > keyword rows), exactly as a real call does.
//
// Usage: node scripts/eval-job-category.mjs <label> [runs=3]
// Pass bar (AC-D9): rows marked R (owner rulings) must be right on every run; other rows on at least 2 of 3.

import { writeFileSync } from 'node:fs';

const URL = 'https://wwxgajrtmslzklnyplah.supabase.co/functions/v1/ai-task-parser';
// Public anon key (ships in the client app; see CLAUDE.md "The anon key and project URL are PUBLIC").
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3eGdhanJ0bXNsemtsbnlwbGFoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg0MDI3MzIsImV4cCI6MjA3Mzk3ODczMn0._M_B3093_wjfFe4vwXmKXVCcw-QG5UhRAT4-H-aGoHE';
const OWNER = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1';

// [id, title, expected, ruled]  -- section 4 of the AC file; E-22 is unscored until ruled, so it is omitted.
// E-22 ("Prepare slides for client meeting") was ruled JOB on 2026-11-03 (generic work with no owner signal).
// E-21 was re-ruled VENTURES on 2026-11-04: SDLC work that names an own product is that product's work.
const ROWS = [
  ['E-1', 'Complete benefits enrollment', 'JOB', true],
  ['E-2', "Prep for my team's standup", 'JOB', true],
  ['E-3', 'Create a visual for my SDLC workflow', 'JOB', true],
  ['E-4', 'Finalize ops deck', 'JOB', true],
  ['E-5', 'Finalize ops process diagrams', 'JOB', true],
  ['E-6', 'Build an Esri GIS layer for the water main inventory', 'JOB', true],
  ['E-7', 'Update the Power BI dashboard for the weekly ops review', 'JOB', true],
  ['E-8', 'Submit Trinnex timesheet', 'JOB', true],
  ['E-9', '1:1 with my manager', 'JOB', false],
  ['E-10', 'Reply to Trinnex client about the asset inventory', 'JOB', false],
  ['E-11', 'Document the release checklist for the SDLC pipeline at work', 'JOB', true],
  ['E-12', 'Update my LinkedIn headline', 'CAREER', true],
  ['E-13', 'Apply for the Director of Data role at Acme', 'CAREER', true],
  ['E-14', 'Session with my career coach', 'CAREER', true],
  ['E-15', 'Prep for interview with the Esri recruiter', 'CAREER', false],
  ['E-16', 'Ship Huddle push notifications', 'VENTURES', true],
  ['E-17', 'Fix the Nexus login bug', 'VENTURES', true],
  ['E-18', 'Send the Howard County proposal', 'VENTURES', true],
  ['E-19', 'Draft the Boost pitch deck', 'VENTURES', true],
  ['E-20', 'Email Prompto beta testers', 'VENTURES', true],
  ['E-21', 'Write the SDLC doc for Sidecar', 'VENTURES', true],   // owner 2026-11-04: a side project, not work
  ['E-22', 'Prepare slides for client meeting', 'JOB', false],
  ['E-23', 'Take a Power BI course on Coursera', 'EDUCATION', false],
  ['E-24', 'Complete MIT assignment 3', 'PROF_EDUCATION', false],
  ['E-25', 'Pick up groceries', 'LIFE', false],
  ['E-26', 'Pay the credit card bill', 'LIFE', false],
  ['E-27', 'Work on my SDLC app', 'JOB', true],
];

async function parse(text) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}`, apikey: ANON },
    body: JSON.stringify({ text, mode: 'single', timezone: 'America/New_York', userId: OWNER }),
  });
  const body = await res.text();
  if (!res.ok) return `HTTP ${res.status}`;
  try {
    const tasks = JSON.parse(body).tasks ?? [];
    return tasks[0]?.category ?? '(no task)';
  } catch {
    return '(bad json)';
  }
}

const label = process.argv[2] || 'run';
const runs = Number(process.argv[3] || 3);
const lines = [];
let passed = 0;
for (const [id, title, want, ruled] of ROWS) {
  const got = [];
  for (let i = 0; i < runs; i++) got.push(await parse(title));
  const right = got.filter((g) => g === want).length;
  const ok = ruled ? right === runs : right >= Math.ceil((runs * 2) / 3);
  if (ok) passed++;
  lines.push(`| ${id} | ${title} | ${want}${ruled ? ' (R)' : ''} | ${got.join(', ')} | ${right}/${runs} | ${ok ? 'PASS' : 'FAIL'} |`);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${title} -> ${got.join(',')} (want ${want})`);
}

const out = `<!--
WHAT:          JOB-category scorecard result, run "${label}".
WHY:           proves (or disproves) that the live category AI files employer work as JOB without the name.
SUPERSEDES:    nothing.  SUPERSEDED-BY: nothing -- current.
EVIDENCE:      produced by scripts/eval-job-category.mjs against ${URL} at ${new Date().toISOString()}.
-->

# JOB category scorecard: ${label}

**${passed} of ${ROWS.length} rows pass** (${runs} runs each; (R) rows must be right every run, others at least 2 of ${runs}).

| # | Title | Expected | Got (per run) | Right | Verdict |
|---|---|---|---|---|---|
${lines.join('\n')}
`;
const path = `docs/qc-evidence/EVAL-job-category-${label}.md`;
writeFileSync(path, out);
console.log(`\n${passed}/${ROWS.length} pass -> ${path}`);
