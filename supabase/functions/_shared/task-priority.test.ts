// WHAT:       Guards the priority check every task write uses.
// WHY:        2026-11-19 the AI task parser returned priority "BACKLOG" and the insert failed (22P02), so Iris
//             could not create the owner's tasks. See task-priority.ts.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// Run: node --experimental-strip-types --test supabase/functions/_shared/task-priority.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TASK_PRIORITIES, normalizePriority, recognizePriority } from './task-priority.ts';

describe('task priority', () => {
  it('P-1 the list matches the task_priority enum in the generated types', () => {
    const types = readFileSync(new URL('../../../src/integrations/supabase/types.ts', import.meta.url), 'utf8');
    const m = types.match(/task_priority:\s*\n?\s*((?:\|?\s*"[A-Z_]+"\s*)+)/);
    assert.ok(m, 'task_priority union not found in types.ts');
    const enumVals = [...m![1].matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]).sort();
    assert.deepEqual(enumVals, [...TASK_PRIORITIES].sort());
  });
  it('P-2 the 2026-11-19 failure: a status word becomes MEDIUM, never reaches the insert', () => {
    assert.equal(normalizePriority('BACKLOG'), 'MEDIUM');
    assert.equal(normalizePriority('UP_NEXT'), 'MEDIUM');
  });
  it('P-3 real priorities pass in any case and with spaces', () => {
    assert.equal(normalizePriority('high'), 'HIGH');
    assert.equal(normalizePriority(' Urgent '), 'URGENT');
    assert.equal(normalizePriority('LOW'), 'LOW');
  });
  it('P-4 missing or non-string values default to MEDIUM', () => {
    for (const v of [undefined, null, '', 5, {}]) assert.equal(normalizePriority(v), 'MEDIUM');
  });
  it('P-5 recognizePriority returns null for anything not in the enum (updates skip it)', () => {
    assert.equal(recognizePriority('BACKLOG'), null);
    assert.equal(recognizePriority('medium'), 'MEDIUM');
  });
  it('P-7 "CRITICAL" (offered by the phone-call tool) maps to URGENT', () => {
    assert.equal(normalizePriority('critical'), 'URGENT');
    assert.equal(recognizePriority('CRITICAL'), 'URGENT');
  });
  it('P-8 the phone-call tool and the MCP create_task write a valid, upper-case priority', () => {
    const tw = readFileSync(new URL('../twilio-voice-handler/index.ts', import.meta.url), 'utf8');
    assert.ok(/priority: normalizePriority\(args\.priority\)/.test(tw), 'twilio-voice-handler writes the raw priority');
    assert.ok(!/"CRITICAL"\]/.test(tw), 'twilio-voice-handler still offers CRITICAL in its tool schema');
    for (const rel of ['../mcp/index.ts', '../../../src/lib/mcp/tools/create-task.ts']) {
      const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
      assert.ok(/payload\.priority = priority\.toUpperCase\(\)/.test(src), `${rel} writes a lower-case priority`);
    }
  });
  it('P-6 every execute-tool priority write goes through the check', () => {
    const src = readFileSync(new URL('../execute-tool/index.ts', import.meta.url), 'utf8');
    assert.ok(!/priority:\s*\(task\.priority \|\| 'MEDIUM'\)\.toUpperCase\(\)/.test(src), 'parse_and_create still writes the raw parser priority');
    assert.ok(!/args\.priority\?\.toUpperCase\(\) \|\| 'MEDIUM'/.test(src), 'create_task still writes the raw priority');
    assert.ok(!/updateData\.priority = args\.priority\.toUpperCase\(\)/.test(src), 'update_task still writes the raw priority');
    assert.ok(!/data\.priority = String\(u\.priority\)\.toUpperCase\(\)/.test(src), 'bulk update still writes the raw priority');
  });
});
