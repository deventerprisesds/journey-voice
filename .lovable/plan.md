

# Create `sync-assistant-tools` Edge Function + Add Reminder Comments

## Overview

Create a simple standalone edge function that syncs all tool definitions from `tool-definitions.ts` to the OpenAI Assistant. Add reminder comments in `tool-definitions.ts` so anyone adding tools knows to run it.

## Changes

### 1. New file: `supabase/functions/sync-assistant-tools/index.ts`

A simple edge function that:
- Imports tool definitions from `_shared/tool-definitions.ts`
- Formats them for the OpenAI Assistants API
- PATCHes the Assistant using `OPENAI_ASSISTANT_ID` and `OPENAI_API_KEY` secrets (both already configured)
- Returns a summary of what was synced (tool count + names)

Can be called via curl, the Debug page, or Lovable's edge function test tool.

### 2. Update: `supabase/functions/_shared/tool-definitions.ts`

Add a comment to the header block (lines 1-9) reminding to run the sync:

```
 * To add a tool: add it here. It propagates everywhere automatically.
 * 
 * IMPORTANT: After adding a new tool, run the sync-assistant-tools
 * edge function to update the OpenAI Assistant's static tool list.
```

### 3. Update: `supabase/config.toml`

Add entry for the new function:
```toml
[functions.sync-assistant-tools]
verify_jwt = false
```

## No other changes needed

- No database tables
- No frontend changes
- No automatic triggers -- just a manual "run this when you add tools" function

