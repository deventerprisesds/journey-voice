

# Fix: Add rag-context-retrieval to config.toml

## Problem Identified

The `rag-context-retrieval` edge function exists in `supabase/functions/rag-context-retrieval/` but is **missing from `supabase/config.toml`**. This causes deployment failures because Supabase can't properly configure the function.

## Root Cause

When edge functions are deployed, Supabase reads `config.toml` to determine function settings (like JWT verification). Functions not declared in the config may fail to deploy or behave unexpectedly.

## Missing Functions

Looking at the functions directory vs config.toml, these functions are missing from the config:

| Function | In Directory | In config.toml |
|----------|--------------|----------------|
| `rag-context-retrieval` | Yes | **No** |
| `generate-embeddings` | Yes | No |
| `hybrid-assistant-api` | Yes | No |
| `manage-push-subscription` | Yes | No |
| `notification-callback` | Yes | No |
| `send-unified-notification` | Yes | No |
| `sync-assistant-knowledge` | Yes | No |
| `web-search` | Yes | No |
| `elevenlabs-tts` | Yes | No |
| `assistant-actions-webhook` | Yes | No |

## Fix Required

Add all missing functions to `supabase/config.toml`:

```toml
[functions.rag-context-retrieval]
verify_jwt = false

[functions.generate-embeddings]
verify_jwt = false

[functions.hybrid-assistant-api]
verify_jwt = false

[functions.manage-push-subscription]
verify_jwt = false

[functions.notification-callback]
verify_jwt = false

[functions.send-unified-notification]
verify_jwt = false

[functions.sync-assistant-knowledge]
verify_jwt = false

[functions.web-search]
verify_jwt = false

[functions.elevenlabs-tts]
verify_jwt = false

[functions.assistant-actions-webhook]
verify_jwt = false
```

## File to Change

| File | Change |
|------|--------|
| `supabase/config.toml` | Add missing function declarations |

## Expected Outcome

After adding these declarations:
1. All edge functions will deploy successfully
2. `rag-context-retrieval` will be accessible
3. The calendar token manager changes from the previous fix will work properly

