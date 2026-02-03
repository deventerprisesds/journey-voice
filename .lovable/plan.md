

# Plan: Comment Out create_task Tool for Debugging

## Overview

Temporarily disable the `create_task` tool across all interfaces (chat, voice, Twilio) to force the AI to use `parse_and_create_tasks` instead, which properly handles time parsing and scheduling.

## Changes

### File: `supabase/functions/execute-tool/index.ts`

**Change 1: Comment out the tool definition (lines 59-77)**

This prevents all AI interfaces from seeing the tool as an option.

```typescript
// TEMPORARILY DISABLED FOR DEBUGGING - Forces AI to use parse_and_create_tasks
// which properly handles time parsing and auto-scheduling
// {
//   type: "function",
//   name: "create_task",
//   description: "Create a new task. Use UPPERCASE for priority.",
//   parameters: {
//     type: "object",
//     properties: {
//       title: { type: "string", description: "Task title" },
//       description: { type: "string", description: "Task description" },
//       priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
//       category: { type: "string", enum: ["LIFE", "CAREER", "VENTURES", "EDUCATION"] },
//       status: { 
//         type: "string", 
//         enum: ["BACKLOG", "TODO", "READY", "UP_NEXT", "DOING", "DONE", "BLOCKED", "PLANNING"],
//         description: "Task workflow status. ..."
//       }
//     },
//     required: ["title"]
//   }
// },
```

**Change 2: Redirect handler to parse_and_create_tasks (lines 612-613)**

Just in case any old sessions or cached tools still call `create_task`, redirect it through the parser:

```typescript
case 'create_task':
  // TEMPORARILY REDIRECTED FOR DEBUGGING
  // Route through parse_and_create_tasks for proper time extraction and scheduling
  console.log('[EXECUTE-TOOL] create_task redirected to parse_and_create_tasks');
  return await parseAndCreateTasks(supabase, userId, {
    text: args.title + (args.description ? '. ' + args.description : ''),
    auto_schedule: true
  }, context?.timezone);
```

## Why Both Changes

1. **Comment out definition** → AI won't see `create_task` as an available tool
2. **Redirect handler** → If any stale call comes through, it still works correctly

## Impact

| Interface | Before | After |
|-----------|--------|-------|
| Chat | Might use `create_task` (no scheduling) | Only sees `parse_and_create_tasks` |
| Voice | Might use `create_task` (no scheduling) | Only sees `parse_and_create_tasks` |
| Twilio | Might use `create_task` (no scheduling) | Only sees `parse_and_create_tasks` |

## Reverting

When debugging is complete, simply uncomment the tool definition and restore the original handler.

