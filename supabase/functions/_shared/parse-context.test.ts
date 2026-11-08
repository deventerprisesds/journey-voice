// WHAT:       Guards the 2026-11-08 fixes to the parse_and_create_tasks / get_tasks path: the request `context` reaching
//             the category prompt, the task_priority guard on insert, and get_tasks `created_since`.
// WHY:        11-07: 23 work lines were parsed as bare titles (the owner's "priorities I need to work on today" was
//             dropped) and filed across four categories; 11 inserts died on priority "BACKLOG" (22P02); and "what did
//             you add today" had no tool that could reach the 27 unscheduled rows created that morning.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   docs/qc-evidence/FIX-parse-context-categories.md; FINDINGS-iris-bulk-task-categories.md 1b, 2e, 3a.
// Run: node --experimental-strip-types --test supabase/functions/_shared/parse-context.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRequestContextBlock, REQUEST_CONTEXT_MAX_CHARS } from './category-guide.ts';
import { normalizePriority, TASK_PRIORITIES } from './categories.ts';
import { resolveCreatedSince } from './timezone.ts';
import { getToolDefinitions } from './tool-definitions.ts';

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const PARSER = src('../ai-task-parser/index.ts');
const EXEC = src('../execute-tool/index.ts');
const PREFACE = 'I have several priorities I need to work on today.';

/** The body of one top-level `async function <name>(` in execute-tool, up to the next top-level function. */
function fnBody(name: string): string {
  const start = EXEC.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `${name} not found in execute-tool`);
  const next = EXEC.indexOf('\nasync function ', start + 10);
  return EXEC.slice(start, next < 0 ? undefined : next);
}

describe('request context -> category prompt (fix step 1)', () => {
  it('PC-1 no context, no block (so a call without context sends the same prompt as before)', () => {
    for (const c of [undefined, null, '', '   \n ', 42, {}]) assert.equal(buildRequestContextBlock(c), '');
  });
  it('PC-2 the preface reaches the prompt verbatim, as guidance that applies to every task and is never a task', () => {
    const b = buildRequestContextBlock(PREFACE);
    assert.ok(b.includes(`"""${PREFACE}"""`), b);
    assert.match(b, /applies to EVERY task in this input unless a line clearly says otherwise/);
    assert.match(b, /explicit work framing means JOB for every such line -- even one that names one of the owner's own products/);
    assert.match(b, /"things I need to work on".* is NOT a work framing/);
    assert.match(b, /never create a task from it/);
    assert.match(b, /decide category/);
  });
  it('PC-3 a long message is cut at the cap (not dropped) and newlines are flattened', () => {
    const b = buildRequestContextBlock(`line one\nline two ${'x'.repeat(5000)}`);
    const inner = b.split('"""')[1];
    assert.ok(inner.startsWith('line one line two'), inner.slice(0, 30));
    assert.equal(inner.length, REQUEST_CONTEXT_MAX_CHARS + 1); // + the ellipsis
  });
  it('PC-4 ai-task-parser reads `context` from the request body and splices the block right after the category guide', () => {
    assert.match(PARSER, /const \{[^}]*\bcontext\b[^}]*\} = await req\.json\(\)/);
    assert.match(PARSER, /const requestContextBlock = buildRequestContextBlock\(context\)/);
    assert.ok(PARSER.includes("${categoryGuide}${requestContextBlock ? `\\n\\n${requestContextBlock}` : ''}"), 'block not spliced after categoryGuide');
  });
  it('PC-5 execute-tool parse_and_create_tasks forwards args.context to ai-task-parser', () => {
    const body = fnBody('parseAndCreateTasks');
    assert.match(body, /const requestContext = typeof args\.context === 'string'/);
    const call = body.slice(body.indexOf('/functions/v1/ai-task-parser'));
    assert.match(call.slice(0, 800), /context: requestContext,/);
  });
  it('PC-6 the tool schema offers `context` as optional on parse_and_create_tasks', () => {
    const t = getToolDefinitions().find((d) => d.name === 'parse_and_create_tasks')!;
    assert.equal(t.parameters.properties.context?.type, 'string');
    assert.deepEqual(t.parameters.required, ['text']);
  });
});

describe('priority guard on parse_and_create_tasks insert (fix step 3)', () => {
  it('PR-1 enum values pass through; anything else becomes MEDIUM', () => {
    for (const p of TASK_PRIORITIES) assert.equal(normalizePriority(p), p);
    assert.equal(normalizePriority(' high '), 'HIGH');
    assert.equal(normalizePriority('urgent'), 'URGENT');
    for (const bad of ['BACKLOG', 'UP_NEXT', 'P1', 'critical', '', undefined, null, 3]) {
      assert.equal(normalizePriority(bad), 'MEDIUM', String(bad));
    }
  });
  it('PR-2 TASK_PRIORITIES matches the generated task_priority enum', () => {
    const types = src('../../../src/integrations/supabase/types.ts');
    const m = types.match(/task_priority:\s*((?:\|?\s*"[A-Z_]+"\s*)+)/);
    assert.ok(m, 'task_priority union not found in types.ts');
    assert.deepEqual([...m![1].matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]).sort(), [...TASK_PRIORITIES].sort());
  });
  it('PR-3 the insert in parseAndCreateTasks uses normalizePriority, not a bare toUpperCase', () => {
    const body = fnBody('parseAndCreateTasks');
    assert.match(body, /priority: normalizePriority\(task\.priority\),/);
    assert.doesNotMatch(body, /priority: \(task\.priority \|\| 'MEDIUM'\)\.toUpperCase\(\)/);
  });
});

describe('get_tasks created_since (fix step 4)', () => {
  const NY = 'America/New_York';
  const at1523Z = new Date('2026-11-07T15:23:13Z'); // the owner's "confirm what tasks you added today"
  const iso = (r: ReturnType<typeof resolveCreatedSince>) => {
    assert.ok(r && 'iso' in r, JSON.stringify(r));
    return (r as { iso: string }).iso;
  };
  it('CS-1 today / yesterday are local midnight in the user timezone (EST on 11-07)', () => {
    assert.equal(iso(resolveCreatedSince('today', NY, at1523Z)), '2026-11-07T05:00:00.000Z');
    assert.equal(iso(resolveCreatedSince('Today', NY, at1523Z)), '2026-11-07T05:00:00.000Z');
    assert.equal(iso(resolveCreatedSince('yesterday', NY, at1523Z)), '2026-11-06T05:00:00.000Z'); // US DST ended 2026-11-01, so 11-06 is EST
  });
  it('CS-2 "today" at 10pm local is the LOCAL date, not the UTC date', () => {
    assert.equal(iso(resolveCreatedSince('today', NY, new Date('2026-11-08T03:00:00Z'))), '2026-11-07T05:00:00.000Z');
  });
  it('CS-3 a date is local midnight (DST-aware); an offset-less timestamp is local; an offset one is exact', () => {
    assert.equal(iso(resolveCreatedSince('2026-11-07', NY)), '2026-11-07T05:00:00.000Z');
    assert.equal(iso(resolveCreatedSince('2026-07-01', NY)), '2026-07-01T04:00:00.000Z');
    assert.equal(iso(resolveCreatedSince('2026-11-07T09:30', NY)), '2026-11-07T14:30:00.000Z');
    assert.equal(iso(resolveCreatedSince('2026-11-07T14:38:00Z', NY)), '2026-11-07T14:38:00.000Z');
    assert.equal(iso(resolveCreatedSince('2026-11-07T09:38:00-05:00', NY)), '2026-11-07T14:38:00.000Z');
  });
  it('CS-4 absent/blank is no filter; anything unreadable is an error, never a silent no-filter', () => {
    for (const v of [undefined, null, '', '  ']) assert.equal(resolveCreatedSince(v, NY), null);
    for (const v of ['last week', '2026-02-30', 'Nov 7', 123, '2026-11-07Tnoon']) {
      const r = resolveCreatedSince(v, NY);
      assert.ok(r && 'error' in r, `${String(v)} -> ${JSON.stringify(r)}`);
    }
  });
  it('CS-5 getTasks filters created_at >= the instant, returns the error, and orders newest first', () => {
    const body = fnBody('getTasks');
    assert.match(body, /const createdSince = resolveCreatedSince\(args\.created_since, timezone\)/);
    assert.match(body, /if \(createdSince && 'error' in createdSince\) \{\s*return \{ success: false, error: createdSince\.error \}/);
    assert.match(body, /if \(createdSinceIso\) query = query\.gte\('created_at', createdSinceIso\)/);
    assert.match(body, /\(isSearch \|\| createdSinceIso\)\s*\? query\.order\('created_at', \{ ascending: false \}\)/);
  });
  it('CS-6 the tool schema offers created_since on get_tasks', () => {
    const t = getToolDefinitions().find((d) => d.name === 'get_tasks')!;
    assert.equal(t.parameters.properties.created_since?.type, 'string');
  });
});
