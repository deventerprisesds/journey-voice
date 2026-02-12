

# Fix Once, Apply Everywhere: Unified Tool Definitions + Dynamic Persona

## The Core Problem

There are **4 separate places** that define what tools the AI can use, and they have all drifted apart:

| Location | Tools | Used By |
|----------|-------|---------|
| `execute-tool/index.ts` | 17 tools (source of truth) | Chat, tool execution |
| `_shared/tool-definitions.ts` | 12 tools (missing 5) | Phone calls (twilio-realtime-bridge) |
| `generate-realtime-token/index.ts` | 16 tools hardcoded inline | In-app voice (WebRTC) |
| `persona.ts` "Available functions" | Hardcoded text list (stale) | System prompt for all modes |

Every time a tool is added or changed, it needs to be updated in 4 places. This is why improvements for one mode never reach the others.

Additionally, `generateGreetingForCallType()` matches hardcoded strings like "Morning Stand-up" and "Midday Check-in" -- if you add a custom recurring call, it falls through to a generic greeting.

## Solution: Single Source, Consumed Everywhere

### Step 1: Make `_shared/tool-definitions.ts` the single source of truth

Replace the 12-tool list in `getToolDefinitions()` with the full set from `execute-tool/index.ts` (17 tools + the new `get_tasks_by_topic`). This file is already imported by `twilio-realtime-bridge`, so phone calls get the fix automatically.

Add a new export `getToolDefinitionsForRealtime()` that formats tools for the OpenAI Realtime API session config (the format `generate-realtime-token` needs). This replaces the inline 270-line hardcoded block.

Remove `getPhoneToolDefinitions()` (the second divergent list in the same file that nobody should be using).

### Step 2: Make `generate-realtime-token` import from the shared file

Replace the ~270 lines of hardcoded tool definitions (lines 179-451) with a single import from `_shared/tool-definitions.ts`. The in-app voice assistant will then always have the same tools as phone calls.

Note: `generate-realtime-token` uses the format `{ type: "function", name: "...", ... }` (flat), same as `getToolDefinitions()` already returns. So the import is direct.

### Step 3: Make `execute-tool/index.ts` import from the shared file too

The `/definitions` GET endpoint (line 2040) currently returns the local `toolDefinitions` array. Change it to import from `_shared/tool-definitions.ts` so `hybrid-assistant-api` (chat) also gets the same list. The local `toolDefinitions` const can be replaced with the import.

This means all 3 consumers (phone, in-app voice, chat) now read from one file.

### Step 4: Make `persona.ts` generate the "Available functions" list dynamically

Instead of a hardcoded text list in `DEFAULT_IRIS_PERSONA`, import `getToolDefinitions()` and generate the list at runtime:

```text
Available functions:
${tools.map(t => `- ${t.name}: ${t.description}`).join('\n')}
```

This means adding a new tool to `tool-definitions.ts` automatically appears in the persona prompt across all modes. No manual updates.

### Step 5: Make `generateGreetingForCallType()` dynamic

Instead of matching hardcoded call names, derive the greeting from the context and time of day:

- Extract the call name from the context string (look for "CALL: ..." pattern that `buildWindowContext` already injects)
- Use `getTimeBasedGreeting()` (already exists) for tone
- Generate a natural greeting that works for ANY call name, not just the 3 hardcoded ones
- Keep a simple fallback for calls without context

This way, if you add a "Weekly Review" or "Friday Planning" recurring call, the greeting adapts automatically.

### Step 6: Add `get_tasks_by_topic` tool

Add it to `_shared/tool-definitions.ts` (one place) and add the handler in `execute-tool/index.ts`. Because of Steps 1-3, it automatically becomes available across phone, in-app voice, and chat.

Update `AGENDA_HEADER` in `call-context-builder.ts` to reference `get_tasks_by_topic` instead of the generic `get_tasks` for topic drill-downs.

### Step 7: Drop the VAD delay fix

Per your feedback, the VAD clipping fix (adding a 300ms delay) is speculative and could compound into a poor experience. It will not be implemented. If VAD issues persist, they should be diagnosed with proper logging before attempting timing-based fixes.

## Files Changed

| File | Change |
|------|--------|
| `_shared/tool-definitions.ts` | Becomes THE single source: full 18-tool list (17 existing + get_tasks_by_topic). Remove `getPhoneToolDefinitions()`. |
| `generate-realtime-token/index.ts` | Remove ~270 lines of inline tools. Import from `_shared/tool-definitions.ts`. |
| `execute-tool/index.ts` | Import tool definitions from shared file. Add `get_tasks_by_topic` handler. Keep all execution logic. |
| `_shared/persona.ts` | Remove hardcoded "Available functions" text. Import tool names dynamically from `_shared/tool-definitions.ts`. Make `generateGreetingForCallType()` derive greetings dynamically from context instead of matching hardcoded strings. |
| `_shared/call-context-builder.ts` | Update `AGENDA_HEADER` to reference `get_tasks_by_topic` for topic drill-downs. |

## What This Guarantees

After this change, adding a new tool or a new recurring call type requires editing exactly **one file** (`_shared/tool-definitions.ts` for tools, or `user_scheduling_prefs.scheduled_calls` for call types). The change propagates to phone, in-app voice, and chat automatically. No more drift.

