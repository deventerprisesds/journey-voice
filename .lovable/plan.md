
# Voicemail Fallback Fix: 45s Threshold + Stronger Instructions + Safety Net

## Changes

### 1. Restore 45-Second Threshold
**File: `supabase/functions/twilio-voice-handler/index.ts` (line 1487)**

```
callDuration < 10  -->  callDuration < 45
```

### 2. Strengthen Voicemail Instructions
**File: `supabase/functions/_shared/persona.ts` (lines 94-107)**

Replace with stricter wording that adds "mailbox is full" as a trigger phrase, uses "MUST do BOTH steps in this EXACT order", and adds "NEVER call hang_up without calling send_chat_message first."

### 3. Bridge Safety Net
**File: `supabase/functions/_shared/tool-executor.ts`**

Add session-level tool tracking. When `hang_up` is called and `send_chat_message` was never called during the session, automatically fire `send_chat_message` with the call context before disconnecting. Adds:
- `sessionToolHistory` Set to track tools called
- `resetToolHistory()` export for session start
- Safety net logic in `hang_up` handler
- Optional `callContext` field on the context parameter

### Deployment
Deploy `twilio-voice-handler` and `twilio-realtime-bridge`, then run `sync-assistant-tools`.
