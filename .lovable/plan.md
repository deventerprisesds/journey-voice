

# Fix Thread Creation - Add Assistant ID at Source

## Problem

Threads are being created in **4 locations** without the `assistant_id` field. Only `useUnifiedThread.ts` does it correctly. This causes the unified thread lookup to fail because it queries `WHERE assistant_id = X` but finds threads with `assistant_id = NULL`.

## Root Cause Files

| File | Line | Current Insert | Fix |
|------|------|----------------|-----|
| `src/utils/RealtimeVoiceAssistant.ts` | 472 | `{ user_id, openai_thread_id, mode }` | Add `assistant_id` |
| `src/hooks/useChatAssistant.ts` | 86 | `{ user_id, openai_thread_id }` | Add `assistant_id` |
| `supabase/functions/twilio-realtime-bridge/index.ts` | 1096 | `{ user_id, openai_thread_id }` | Add `assistant_id` |
| `supabase/functions/twilio-realtime-bridge/index.ts` | 2085 | `{ user_id, openai_thread_id }` | Add `assistant_id` |

## Solution

### Part 1: Fix All Thread Creation Points

Each location needs to include `assistant_id` when inserting. The Iris assistant DB ID is `f6d67661-c41b-49e4-9d6c-6c4c3073cbaf`.

**1. RealtimeVoiceAssistant.ts** - Pass assistant ID from context or fetch default:
```typescript
.insert({ 
  user_id: this.userId,
  assistant_id: this.assistantId, // Add property to class
  openai_thread_id: `webrtc_${this.sessionId}`,
  mode: 'voice'
})
```

**2. useChatAssistant.ts** - Add assistant parameter:
```typescript
.insert({
  user_id: user.id,
  assistant_id: assistantId, // Pass from hook params
  openai_thread_id: ''
})
```

**3. twilio-realtime-bridge (both locations)** - Fetch default assistant:
```typescript
// Get user's default assistant
const { data: assistant } = await supabase
  .from('assistants')
  .select('id')
  .eq('user_id', userId)
  .eq('is_default', true)
  .single();

.insert({ 
  user_id: userId,
  assistant_id: assistant?.id || null,
  openai_thread_id: `phone_${Date.now()}` 
})
```

### Part 2: One-Time Migration for Existing Threads

Run a database update to fix the 2 existing NULL threads:

```sql
-- Migrate demo user thread to demo Iris assistant
UPDATE ai_threads 
SET assistant_id = (
  SELECT id FROM assistants 
  WHERE user_id = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1' 
  AND is_default = true 
  LIMIT 1
)
WHERE id = '47252746-c432-4a6d-969d-8a069af1f7bc';

-- Migrate your thread to your Iris assistant
UPDATE ai_threads 
SET assistant_id = (
  SELECT id FROM assistants 
  WHERE user_id = 'a3378f93-d655-4913-b2fa-ca5b1d8020f1' 
  AND is_default = true 
  LIMIT 1
)
WHERE id = '6643d1fc-904e-4103-b143-e51f2f4b5015';
```

## Files to Modify

| File | Change |
|------|--------|
| `src/utils/RealtimeVoiceAssistant.ts` | Add `assistantId` property, include in thread insert |
| `src/hooks/useChatAssistant.ts` | Accept `assistantId` parameter, include in thread insert |
| `supabase/functions/twilio-realtime-bridge/index.ts` | Fetch default assistant, include in both thread inserts |

## Technical Details

### RealtimeVoiceAssistant Changes

1. Add property: `private assistantId: string | null = null;`
2. In `connect()`, fetch or receive assistantId:
   ```typescript
   // Fetch user's default assistant
   const { data: defaultAssistant } = await supabase
     .from('assistants')
     .select('id')
     .eq('user_id', this.userId)
     .eq('is_default', true)
     .maybeSingle();
   this.assistantId = defaultAssistant?.id || null;
   ```
3. Include in insert at line 472

### useChatAssistant Changes

1. Add to hook signature: `assistantId?: string`
2. Include in insert at line 86

### twilio-realtime-bridge Changes

1. In `preConnectOperations`, after getting userId, fetch default assistant
2. Include `assistant_id` in insert at line 1096
3. In the session.started handler, include `assistant_id` in insert at line 2085

## Expected Results

1. All new threads will have proper `assistant_id` set
2. Existing threads will be migrated via SQL
3. `useUnifiedThread` will find threads correctly
4. Chat memory will persist across sessions

