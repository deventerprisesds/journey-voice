

# Fix: QuickTaskInput Property Name Mismatch

## Root Cause (Confirmed via Logs)

The edge function logs reveal the exact issue:

```
[EXECUTE-TOOL] Executing: parse_and_create_tasks {
  args: {},           ← EMPTY!
  userId: "a3378f93-d655-4913-b2fa-ca5b1d8020f1",
  interface: undefined
}
[PARSE_AND_CREATE] Input: "undefined", target_date: undefined, auto_schedule: true
```

**The `args` object arrives empty because `QuickTaskInput.tsx` sends the wrong property name.**

### QuickTaskInput.tsx (Current - INCORRECT)
```typescript
const { data, error } = await supabase.functions.invoke('execute-tool', {
  body: {
    toolName: 'parse_and_create_tasks',
    toolArgs: {           // ← WRONG: sends "toolArgs"
      text: input.trim(),
      target_date: 'today',
      auto_schedule: true
    },
    userId: user.id,
    context: { timezone: userTimezone }
  }
});
```

### execute-tool/index.ts (Expected)
```typescript
const { toolName, args, userId, context } = body;  // ← Expects "args"
```

## The Fix

Change `toolArgs` → `args` in `src/components/QuickTaskInput.tsx` (line 34):

```typescript
const { data, error } = await supabase.functions.invoke('execute-tool', {
  body: {
    toolName: 'parse_and_create_tasks',
    args: {                 // ← CORRECT: send "args"
      text: input.trim(),
      target_date: 'today',
      auto_schedule: true
    },
    userId: user.id,
    context: { timezone: userTimezone }
  }
});
```

## Files to Modify

| File | Change |
|------|--------|
| `src/components/QuickTaskInput.tsx` | Line 34: rename `toolArgs` to `args` |

## Why This Happened

The `QuickTaskInput` component was likely copied from or modeled after a different code pattern that used `toolArgs`. The `execute-tool` edge function interface expects `args` as defined in its `ExecuteToolRequest` type (line 531-532):

```typescript
interface ExecuteToolRequest {
  toolName: string;
  args: Record<string, any>;  // ← This is the expected key
  userId: string;
  context?: { ... };
}
```

## Verification

After the fix:
1. Type "i need to eat an apple in an hour" in the Focus view input
2. Submit the form
3. Edge function logs should show:
   ```
   [PARSE_AND_CREATE] Input: "i need to eat an apple in an hour", target_date: today, ...
   ```
4. Task should be created successfully

