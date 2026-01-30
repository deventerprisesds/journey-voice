

## Fix AI Tool Status Mismatch

### Problem Summary

The AI assistant only knows about 4 task statuses (`BACKLOG`, `TODO`, `DOING`, `DONE`) because the tool definitions in `execute-tool/index.ts` have a limited enum. The actual database and app support 12 statuses including `UP_NEXT`, `READY`, `BLOCKED`, and `PLANNING`.

When you asked to change a task to "up next", the AI silently substituted `DOING` instead of telling you it didn't understand the request.

### Root Cause

Two issues:

1. **Incomplete Status Enum**: The `update_task` and `get_tasks` tools only list 4 workflow statuses
2. **No Validation Feedback**: The AI doesn't report when it can't match a user request to a valid option

### Solution

Update the tool definitions to include all valid workflow statuses and add clear descriptions so the AI understands when to use each.

---

### Technical Details

**File: `supabase/functions/execute-tool/index.ts`**

Update the status enums in three tool definitions:

| Tool | Current | Updated |
|------|---------|---------|
| `get_tasks` (line 28) | `["BACKLOG", "TODO", "DOING", "DONE"]` | `["BACKLOG", "TODO", "READY", "UP_NEXT", "DOING", "DONE", "BLOCKED", "PLANNING"]` |
| `update_task` (line 63) | `["BACKLOG", "TODO", "DOING", "DONE"]` | `["BACKLOG", "TODO", "READY", "UP_NEXT", "DOING", "DONE", "BLOCKED", "PLANNING"]` |
| `create_task` (line 41-51) | No status field | Add optional `status` with same enum |

Also add a description for the status field to help the AI understand the workflow:

```typescript
status: { 
  type: "string", 
  enum: ["BACKLOG", "TODO", "READY", "UP_NEXT", "DOING", "DONE", "BLOCKED", "PLANNING"],
  description: "Task workflow status. BACKLOG=not yet planned, TODO=planned but not started, READY=ready to work on, UP_NEXT=queued to start soon, DOING=in progress, DONE=completed, BLOCKED=waiting on something, PLANNING=needs more detail"
}
```

**Note**: The category-based statuses (`LIFE`, `CAREER`, `PROF_EDUCATION`, `VENTURES`) are being phased out in favor of the `category` field, so they should NOT be added to the workflow status enum.

---

### Why the AI Didn't Report the Error

The OpenAI function calling API tries to map user intent to available options. When "up next" didn't match any enum value, it used semantic similarity to pick `DOING` (the closest active status). This is expected AI behavior, but it's problematic when the enum is incomplete.

By adding `UP_NEXT` to the enum, the AI will correctly match "up next" to `UP_NEXT`.

---

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/execute-tool/index.ts` | Expand status enums in `get_tasks`, `update_task`, and optionally `create_task` to include all 8 workflow statuses with helpful descriptions |

