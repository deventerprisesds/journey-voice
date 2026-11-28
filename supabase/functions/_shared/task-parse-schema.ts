// WHAT:       The strict output shape the AI task parser (ai-task-parser) must return. Sent to OpenAI as
//             response_format {type:"json_schema", strict:true}, so the model can only produce a priority,
//             status, category and intent from the allowed lists.
// WHY:        2026-11-19 Iris's task creation failed (22P02, priority "BACKLOG"). On 2026-11-26 a replay of the
//             same two tasks through the live parser returned priority "BACKLOG" for 26 of 30 tasks: the prompt
//             only DESCRIBED the JSON shape, nothing enforced it, and the model copied the status word into the
//             priority field. task-priority.ts made the bad value harmless; this stops the model producing it.
// SUPERSEDES: the prose-only "Return JSON in this exact format" contract in ai-task-parser/index.ts.
// SUPERSEDED-BY: nothing -- current.
// EVIDENCE:   .claude/actions.md ACT:task-parser-strict (replay counts before and after).
import { CATEGORY_KEYS } from './categories.ts';
import { TASK_PRIORITIES } from './task-priority.ts';

/** The workflow states a NEW task may start in (a subset of the task_status enum). */
export const PARSER_STATUSES = ['BACKLOG', 'READY', 'UP_NEXT', 'DOING'] as const;
export const PARSER_INTENTS = ['task', 'priority'] as const;

const nullableString = { type: ['string', 'null'] };

/** The `response_format` value for the chat-completions call. Strict mode requires every property to be
 *  listed in `required` and `additionalProperties: false`; optional values are expressed as nullable. */
export function taskParseResponseFormat() {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'parsed_tasks',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['tasks'],
        properties: {
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: [
                'title', 'description', 'priority', 'category', 'due_date', 'start_time', 'end_time',
                'estimate_minutes', 'status', 'scheduling_context', 'intent',
              ],
              properties: {
                title: { type: 'string' },
                description: nullableString,
                priority: { type: 'string', enum: [...TASK_PRIORITIES] },
                category: { type: 'string', enum: [...CATEGORY_KEYS] },
                due_date: nullableString,
                start_time: nullableString,
                end_time: nullableString,
                estimate_minutes: { type: ['integer', 'null'] },
                status: { type: 'string', enum: [...PARSER_STATUSES] },
                scheduling_context: { type: 'array', items: { type: 'string' } },
                intent: { type: 'string', enum: [...PARSER_INTENTS] },
              },
            },
          },
        },
      },
    },
  } as const;
}
