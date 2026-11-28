// WHAT:       Guards the strict output schema the AI task parser sends to OpenAI.
// WHY:        2026-11-26 the live parser put "BACKLOG" in priority for 26 of 30 replayed tasks; the schema is what
//             makes that impossible. See task-parse-schema.ts.
// SUPERSEDES: nothing.  SUPERSEDED-BY: nothing -- current.
// Run: node --experimental-strip-types --test supabase/functions/_shared/task-parse-schema.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { taskParseResponseFormat, PARSER_STATUSES } from './task-parse-schema.ts';

const types = readFileSync(new URL('../../../src/integrations/supabase/types.ts', import.meta.url), 'utf8');
function enumOf(name: string): string[] {
  const m = types.match(new RegExp(`\\b${name}:\\s*\\n?\\s*((?:\\|?\\s*"[A-Z_]+"\\s*)+)`));
  assert.ok(m, `${name} union not found in types.ts`);
  return [...m![1].matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]);
}
const fmt = taskParseResponseFormat();
const item = fmt.json_schema.schema.properties.tasks.items;

describe('task parse schema', () => {
  it('S-1 priority can only be a task_priority enum value (the 2026-11-19 BACKLOG failure)', () => {
    assert.deepEqual([...item.properties.priority.enum].sort(), enumOf('task_priority').sort());
    assert.ok(!(item.properties.priority.enum as readonly string[]).includes('BACKLOG'));
  });
  it('S-2 category can only be a task_category enum value', () => {
    assert.deepEqual([...item.properties.category.enum].sort(), enumOf('task_category').sort());
  });
  it('S-3 status values are all real task_status values', () => {
    const st = enumOf('task_status');
    for (const s of PARSER_STATUSES) assert.ok(st.includes(s), s);
  });
  it('S-4 strict-mode rules: strict, closed objects, every property required', () => {
    assert.equal(fmt.type, 'json_schema');
    assert.equal(fmt.json_schema.strict, true);
    const root = fmt.json_schema.schema;
    assert.equal(root.additionalProperties, false);
    assert.equal(item.additionalProperties, false);
    assert.deepEqual([...item.required].sort(), Object.keys(item.properties).sort());
    assert.deepEqual([...root.required], Object.keys(root.properties));
  });
  it('S-5 every field a task writer reads is in the schema', () => {
    for (const f of ['title', 'description', 'priority', 'category', 'due_date', 'start_time', 'end_time', 'estimate_minutes', 'status', 'intent']) {
      assert.ok(f in item.properties, f);
    }
  });
  it('S-6 ai-task-parser sends the schema with its OpenAI call', () => {
    const src = readFileSync(new URL('../ai-task-parser/index.ts', import.meta.url), 'utf8');
    assert.match(src, /response_format:\s*taskParseResponseFormat\(\)/);
  });
});
