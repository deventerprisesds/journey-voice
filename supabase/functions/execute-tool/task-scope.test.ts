// WHAT:       Proves every single-task mutation tool in execute-tool is scoped to the CALLER: the
//             dispatch passes `userId`, and every `public.tasks` query inside the tool function
//             filters `.eq('user_id', userId)`, returning "Task not found" when nothing matched.
// WHY:        2026-11-04: `updateTask(supabase, args)` filtered only `.eq('id', task_id)` (as did
//             reschedule/schedule/unschedule/swap/set_priority_rank, and move_task_to_day through
//             reschedule). execute-tool runs on the SERVICE-ROLE client, so RLS does not apply and
//             an id alone reached any user's row. delete_task and batch_update_tasks were already
//             scoped; these were not.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   docs/qc-evidence/BUILD-planner-and-update-scope.md (gap survey + caller audit).
//
// execute-tool is a Deno `serve` handler that imports from deno.land URLs, so node cannot import
// it. Like send-push-notification/sticky.test.ts, this reads the source and checks the shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

// tool name -> implementing function. delete/batch were scoped before this change and stay listed
// as regression guards.
const SCOPED: Array<[tool: string, fn: string]> = [
  ['update_task', 'updateTask'],
  ['delete_task', 'deleteTask'],
  ['batch_update_tasks', 'batchUpdateTasks'],
  ['reschedule_task', 'rescheduleTask'],
  ['schedule_task', 'scheduleTask'],
  ['unschedule_task', 'unscheduleTask'],
  ['move_task_to_day', 'moveTaskToDay'],
  ['swap_task_order', 'swapTaskOrder'],
  ['set_priority_rank', 'setPriorityRank'],
];

/** Source of `async function <name>(` up to the next top-level function or section banner. */
function fnBody(name: string): string {
  const start = src.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found in execute-tool/index.ts`);
  const rest = src.slice(start + 1);
  const ends = [/\nasync function /, /\nfunction /, /\nexport /, /\n\/\/ ={5,}/]
    .map((re) => rest.search(re))
    .filter((i) => i >= 0);
  return src.slice(start, start + 1 + Math.min(...ends, rest.length));
}

/** Each `.from('tasks')` chain, cut at the statement end or the next `.from(`, whichever is first. */
function taskChains(body: string): string[] {
  const out: string[] = [];
  let i = body.indexOf(".from('tasks')");
  while (i >= 0) {
    const after = body.slice(i + 1);
    const cut = [after.indexOf(';'), after.indexOf('.from(')].filter((n) => n >= 0);
    out.push(body.slice(i, i + 1 + Math.min(...cut, after.length)));
    i = body.indexOf(".from('tasks')", i + 1);
  }
  return out;
}

for (const [tool, fn] of SCOPED) {
  test(`${tool}: dispatch passes the caller's userId to ${fn}`, () => {
    const re = new RegExp(`case '${tool}':\\s*return await ${fn}\\(supabase, userId,`);
    assert.match(src, re);
  });

  test(`${fn}: takes userId`, () => {
    assert.match(fnBody(fn), new RegExp(`^async function ${fn}\\(supabase: any, userId: string,`));
  });
}

for (const [, fn] of SCOPED.filter(([t]) => t !== 'move_task_to_day')) {
  test(`${fn}: every public.tasks query is filtered to the caller`, () => {
    const chains = taskChains(fnBody(fn));
    assert.ok(chains.length > 0, `${fn} has no .from('tasks') query -- the check would be vacuous`);
    for (const chain of chains) {
      assert.ok(chain.includes(".eq('user_id', userId)"), `${fn}: unscoped tasks query:\n${chain}`);
    }
  });
}

for (const fn of ['updateTask', 'deleteTask', 'rescheduleTask', 'scheduleTask', 'unscheduleTask', 'swapTaskOrder', 'setPriorityRank']) {
  test(`${fn}: a non-matching id returns "Task not found"`, () => {
    assert.ok(fnBody(fn).includes('Task not found'), `${fn} has no "Task not found" branch`);
  });
}

test('moveTaskToDay reaches rescheduleTask with the caller, never without it', () => {
  const body = fnBody('moveTaskToDay');
  const calls = body.match(/rescheduleTask\([^,]+,\s*[^,{]+/g) ?? [];
  assert.equal(calls.length, 2, `expected 2 rescheduleTask calls, got ${calls.length}`);
  for (const c of calls) assert.match(c, /rescheduleTask\(supabase, userId/);
  assert.ok(!/rescheduleTask\(supabase, \{/.test(src), 'an unscoped rescheduleTask(supabase, {...}) call remains');
});

test('updateTask returns not-found instead of a coerce error when the scoped update matches 0 rows', () => {
  const body = fnBody('updateTask');
  assert.match(body, /\.eq\('id', args\.task_id\)\s*\.eq\('user_id', userId\)\s*\.select\(\)\s*\.maybeSingle\(\)/);
  assert.match(body, /if \(!data\)[\s\S]{0,800}Task not found/);
});
