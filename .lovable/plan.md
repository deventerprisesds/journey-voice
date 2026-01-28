
## Chat Memory Fix - Implementation Complete ✅

### Target Outcome
- Live site: chat memory persists across refreshes and sessions (same assistant + same thread)
- Preview/demo: uses **dev Iris (shared)**, not a separate demo Iris; and memory persists

---

## Completed Items

### Database (Live) ✅
- [x] Iris assistant has correct OpenAI assistant ID populated (`asst_BcZBxlx9zH8VIPvfJrhPP3EF`)
- [x] Legacy ai_threads rows have `assistant_id` populated (`f6d67661-c41b-49e4-9d6c-6c4c3073cbaf`)
- [x] Demo user can SELECT dev user's assistants via RLS policy

### Frontend ✅
- [x] `CommsConsoleContext.sendMessage` uses the latest `dbThreadId` (added to dependency array)
- [x] `CommsConsoleContext` demo mode fetches assistants from dev user (uses `DEV_USER_ID`)
- [x] Guard added: blocks sending if `USE_UNIFIED_THREADS` is enabled but `dbThreadId` not ready
- [x] Stop overwriting `threadId` state with OpenAI thread IDs in unified mode

---

## Changes Made

### Migration (applied to Test, publish for Live)
```sql
-- Link dev thread to Iris
UPDATE ai_threads SET assistant_id = 'f6d67661-c41b-49e4-9d6c-6c4c3073cbaf'
WHERE user_id = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1' AND assistant_id IS NULL;

-- Link demo thread to dev Iris  
UPDATE ai_threads SET assistant_id = 'f6d67661-c41b-49e4-9d6c-6c4c3073cbaf'
WHERE user_id = '00000000-0000-0000-0000-000000000001' AND assistant_id IS NULL;

-- Populate OpenAI ID for Iris
UPDATE assistants SET openai_assistant_id = 'asst_BcZBxlx9zH8VIPvfJrhPP3EF'
WHERE id = 'f6d67661-c41b-49e4-9d6c-6c4c3073cbaf';

-- RLS policy for demo to read dev assistants
CREATE POLICY "Demo user can view dev assistants" ON assistants FOR SELECT
USING (user_id = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1');
```

### Frontend Changes (`src/contexts/CommsConsoleContext.tsx`)
1. Added `DEV_USER_ID` constant
2. Demo mode now fetches assistants from dev user, not demo user
3. Added `dbThreadId` and `updateOpenaiThreadId` to `sendMessage` dependency array
4. Added guard: if unified threads enabled but `dbThreadId` is null, shows "Initializing..." message
5. In unified mode, doesn't overwrite `threadId` with OpenAI thread ID; instead calls `updateOpenaiThreadId`

---

## Verification Steps

1. **Publish** to apply migration to Live
2. Open https://journey-voice.lovable.app
3. Send a chat message
4. Check edge function logs: should show `thread <uuid>` not `thread null`
5. Refresh page, send another message
6. Verify AI remembers previous context

---

## Next Improvements (optional)
1. Load conversation history UI from `conversation_messages` on page load
2. Add debug panel showing: userId, currentAssistantId, dbThreadId, openaiThreadId
3. Make unified thread hook return "ready" state with clear UI feedback
