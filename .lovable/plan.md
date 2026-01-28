

# Parallel Unified Memory Implementation

## Overview

Build the new unified memory system alongside the existing code so you can keep using what works until the new system is proven. Thread per assistant (like Iris), not per user - so future assistants each have their own conversation memory.

---

## Architecture: Thread Per Assistant

```text
User + Iris     → ai_threads (assistant_id=Iris.id)  → Thread A (all modes)
User + Max      → ai_threads (assistant_id=Max.id)   → Thread B (all modes)
User + Future   → ai_threads (assistant_id=Future.id)→ Thread C (all modes)

Each thread stores messages from Voice, Chat, AND Phone for that specific assistant.
```

This means:
- Switching modes (voice → chat) keeps context for the same assistant
- Switching assistants (Iris → Max) starts fresh context
- RAG queries are scoped to the current assistant's thread

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/utils/RealtimeVoiceAssistant.tools.backup.ts` | **Create** | Archive of all local tool methods (lines 1053-1867) |
| `src/hooks/useUnifiedThread.ts` | **Create** | New hook for thread-per-assistant management |
| `src/utils/UnifiedVoiceToolHandler.ts` | **Create** | New tool handler that uses execute-tool (parallel to existing) |
| `src/contexts/CommsConsoleContext.tsx` | Modify | Add unified thread initialization (optional flag) |
| `supabase/functions/rag-context-retrieval/index.ts` | Modify | Add `assistant_id` parameter for scoped queries |
| `supabase/functions/hybrid-assistant-api/index.ts` | Modify | Add RAG context injection + assistant-scoped threads |

---

## Implementation Steps

### Step 1: Create Backup File

Create `src/utils/RealtimeVoiceAssistant.tools.backup.ts` with all 815 lines of tool code from the original file (lines 1053-1867):

```typescript
/**
 * BACKUP: Local tool implementations from RealtimeVoiceAssistant.ts
 * 
 * Created: 2026-01-28
 * Reason: Migrating to centralized execute-tool edge function
 * 
 * This file preserves all the original tool methods in case rollback is needed.
 * DO NOT DELETE - reference for debugging or rollback.
 */

// Preserved methods:
// - normalizePriority (lines 1053-1060)
// - normalizeCategory (lines 1063-1086)
// - createTask (lines 1088-1293)
// - updateTask (lines 1296-1351)
// - getTasks (lines 1353-1398)
// - getTodayTasks (lines 1400-1452)
// - rescheduleTask (lines 1454-1548)
// - scheduleTask (lines 1550-1716)
// - unscheduleTask (lines 1718-1758)
// - handleDisconnectTool (lines 1760-1769)
// - initiatePhoneCall (lines 1771-1828)
// - webSearch (lines 1830-1867)

// [Full code copied verbatim from original file]
```

This ensures zero risk of losing your work.

---

### Step 2: Create Unified Thread Hook

Create `src/hooks/useUnifiedThread.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface UseUnifiedThreadOptions {
  userId: string | null;
  assistantId: string | null;
  enabled?: boolean;
}

export function useUnifiedThread({ userId, assistantId, enabled = true }: UseUnifiedThreadOptions) {
  const [dbThreadId, setDbThreadId] = useState<string | null>(null);
  const [openaiThreadId, setOpenaiThreadId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !userId || !assistantId) {
      setDbThreadId(null);
      return;
    }

    const initializeThread = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Find existing thread for this user + assistant combination
        const { data: existingThread, error: fetchError } = await supabase
          .from('ai_threads')
          .select('id, openai_thread_id')
          .eq('user_id', userId)
          .eq('assistant_id', assistantId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (fetchError) throw fetchError;

        if (existingThread) {
          setDbThreadId(existingThread.id);
          setOpenaiThreadId(existingThread.openai_thread_id || null);
          console.log('[UNIFIED_THREAD] Using existing thread:', existingThread.id, 'for assistant:', assistantId);
        } else {
          // Create new thread for this user + assistant
          const { data: newThread, error: createError } = await supabase
            .from('ai_threads')
            .insert({
              user_id: userId,
              assistant_id: assistantId,
              openai_thread_id: '',
              mode: 'unified'
            })
            .select('id')
            .single();

          if (createError) throw createError;

          setDbThreadId(newThread.id);
          setOpenaiThreadId(null);
          console.log('[UNIFIED_THREAD] Created new thread:', newThread.id, 'for assistant:', assistantId);
        }
      } catch (err) {
        console.error('[UNIFIED_THREAD] Error initializing thread:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    };

    initializeThread();
  }, [userId, assistantId, enabled]);

  // Update OpenAI thread ID when received from API
  const updateOpenaiThreadId = useCallback(async (newOpenaiThreadId: string) => {
    if (!dbThreadId) return;

    setOpenaiThreadId(newOpenaiThreadId);

    // Persist to database
    await supabase
      .from('ai_threads')
      .update({
        openai_thread_id: newOpenaiThreadId,
        updated_at: new Date().toISOString()
      })
      .eq('id', dbThreadId);
  }, [dbThreadId]);

  return {
    dbThreadId,
    openaiThreadId,
    isLoading,
    error,
    updateOpenaiThreadId
  };
}
```

---

### Step 3: Create Unified Tool Handler (Parallel Path)

Create `src/utils/UnifiedVoiceToolHandler.ts`:

```typescript
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '@/integrations/supabase/client';

interface ToolExecutionContext {
  userId: string;
  assistantId?: string;
  threadId?: string;
  timezone?: string;
  interface: 'voice' | 'chat' | 'phone';
}

/**
 * Unified tool handler that routes all tools through execute-tool edge function.
 * 
 * This replaces the inline switch/case in RealtimeVoiceAssistant.ts
 * while keeping the original code intact for fallback.
 */
export async function executeToolUnified(
  functionName: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<unknown> {
  console.log(`[UNIFIED_TOOL] Executing ${functionName} via execute-tool`);

  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/execute-tool`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_PUBLISHABLE_KEY,
          'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          toolName: functionName,
          args,
          userId: context.userId,
          context: {
            interface: context.interface,
            timezone: context.timezone || 'America/New_York',
            threadId: context.threadId,
            assistantId: context.assistantId
          }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[UNIFIED_TOOL] Error from execute-tool:`, errorText);
      return { error: `Tool execution failed: ${response.status}` };
    }

    const result = await response.json();
    console.log(`[UNIFIED_TOOL] Result from ${functionName}:`, result);
    return result;
  } catch (error) {
    console.error(`[UNIFIED_TOOL] Exception executing ${functionName}:`, error);
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Fetch RAG context for conversation continuity.
 * Scoped to user + assistant for consistent memory per assistant.
 */
export async function fetchRagContext(
  userInput: string,
  userId: string,
  assistantId?: string,
  threadId?: string
): Promise<string> {
  try {
    console.log('[UNIFIED_RAG] Fetching context for:', userInput.substring(0, 50));

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/rag-context-retrieval`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_PUBLISHABLE_KEY,
          'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          action: 'get_context',
          userInput,
          userId,
          threadId: threadId || null,
          assistantId: assistantId || null
        })
      }
    );

    if (!response.ok) {
      console.warn('[UNIFIED_RAG] Failed to fetch context:', response.status);
      return '';
    }

    const data = await response.json();
    const contextualInstructions = data.contextualInstructions || '';
    
    console.log(`[UNIFIED_RAG] Got context (${data.context?.conversationContext?.length || 0} matches)`);
    return contextualInstructions;
  } catch (error) {
    console.warn('[UNIFIED_RAG] Error fetching context:', error);
    return '';
  }
}
```

---

### Step 4: Update RAG to Support Assistant Scoping

Modify `supabase/functions/rag-context-retrieval/index.ts`:

```typescript
// Update the request body parsing (around line 171-178)
const { 
  userInput, 
  userId, 
  threadId, 
  assistantId,  // NEW: Optional assistant filter
  baseInstructions = 'You are a helpful voice assistant for task management.',
  action = 'get_context'
} = await req.json();

// Update getRelevantContext function signature
async function getRelevantContext(
  userInput: string,
  userId: string,
  threadId?: string,
  assistantId?: string  // NEW parameter
) {
  // ... existing code ...

  // When querying local conversation embeddings (around line 77-83)
  const { data: localConv } = await supabase.rpc('match_conversation_embeddings', {
    query_embedding: embedding,
    user_id_param: userId,
    // If assistantId provided, we'd ideally filter by it
    // For now, threadId is our primary filter
    thread_id_param: threadId || null,
    match_threshold: 0.7,
    match_count: 5
  });
  
  // ... rest of function
}
```

---

### Step 5: Update CommsConsoleContext (Parallel Path)

Modify `src/contexts/CommsConsoleContext.tsx` to use the new unified thread hook alongside existing code:

```typescript
// Add import at top
import { useUnifiedThread } from '@/hooks/useUnifiedThread';

// Inside CommsConsoleProvider, after existing state declarations (around line 75):

// NEW: Unified thread management (parallel to existing threadId state)
const USE_UNIFIED_THREADS = true; // Feature flag for gradual rollout

const { 
  dbThreadId, 
  openaiThreadId, 
  updateOpenaiThreadId 
} = useUnifiedThread({
  userId,
  assistantId: currentAssistant?.id || null,
  enabled: USE_UNIFIED_THREADS
});

// Update sendMessage to use unified thread when enabled (around line 243-249):
const { data, error } = await supabase.functions.invoke('hybrid-assistant-api', {
  body: {
    userInput: content,
    userId,
    // Use unified thread if enabled, otherwise fall back to existing behavior
    threadId: USE_UNIFIED_THREADS ? dbThreadId : threadId,
    assistantId: currentAssistant?.openai_assistant_id || undefined,
    // NEW: Pass database assistant ID for RAG scoping
    dbAssistantId: currentAssistant?.id || undefined,
  },
});

// Update response handling (around line 265-267):
if (data?.threadId) {
  if (USE_UNIFIED_THREADS && data.openaiThreadId) {
    updateOpenaiThreadId(data.openaiThreadId);
  } else {
    setThreadId(data.threadId);
  }
}
```

---

### Step 6: Add RAG to Chat (hybrid-assistant-api)

Modify `supabase/functions/hybrid-assistant-api/index.ts`:

Add RAG fetch before creating the OpenAI run (around line 267, before run creation):

```typescript
// Fetch RAG context for long-term memory
let ragInstructions = '';
try {
  const ragResponse = await fetch(`${supabaseUrl}/functions/v1/rag-context-retrieval`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      action: 'get_context',
      userInput: userInput,
      userId: userId,
      threadId: threadId,
      assistantId: dbAssistantId  // NEW: Scope to assistant
    })
  });

  if (ragResponse.ok) {
    const ragData = await ragResponse.json();
    if (ragData.contextualInstructions) {
      ragInstructions = ragData.contextualInstructions;
      console.log(`[HYBRID] Added RAG context (${ragData.context?.conversationContext?.length || 0} matches)`);
    }
  }
} catch (ragError) {
  console.warn('[HYBRID] Failed to fetch RAG context:', ragError);
}

// Include in additionalInstructions
additionalInstructions += ragInstructions ? `\n\n${ragInstructions}` : '';
```

---

## Migration Path

### Phase 1: Backup + New Files (No Risk)
1. Create `RealtimeVoiceAssistant.tools.backup.ts` - preserves all original code
2. Create `useUnifiedThread.ts` hook - new parallel code
3. Create `UnifiedVoiceToolHandler.ts` - new parallel code

**Existing system continues working unchanged.**

### Phase 2: Enable for Chat Only
1. Set `USE_UNIFIED_THREADS = true` in CommsConsoleContext
2. Test chat memory across messages
3. Test switching assistants creates separate threads

**Voice continues using original inline tools.**

### Phase 3: Migrate Voice (Optional)
1. Update `RealtimeVoiceAssistant.handleFunctionCall` to use `UnifiedVoiceToolHandler`
2. Test voice tools work correctly
3. If issues, revert to original switch/case (code is still there)

### Phase 4: Cleanup (After Verification)
1. Remove original tool methods from RealtimeVoiceAssistant (now in backup)
2. Keep backup file for historical reference

---

## Database Schema (Already Exists)

The `ai_threads` table already has the needed columns:

| Column | Type | Current State |
|--------|------|---------------|
| `id` | uuid | Primary key (database thread ID) |
| `user_id` | uuid | User reference |
| `assistant_id` | uuid (nullable) | **Currently NULL - will be populated** |
| `mode` | text (nullable) | Will use 'unified' for new threads |
| `openai_thread_id` | text | OpenAI's thread ID |

No database migration needed - just need to start populating `assistant_id`.

---

## Expected Outcome

| Scenario | Before | After |
|----------|--------|-------|
| **Chat → Chat (same assistant)** | New thread every message | Same thread, full context |
| **Voice → Chat (same assistant)** | Separate contexts | Shared context via RAG |
| **Iris → Max (different assistant)** | Same context (wrong!) | Separate threads (correct) |
| **Add tool in execute-tool** | Update 3 places | Update 1 place |

---

## Rollback Plan

If issues occur:
1. Set `USE_UNIFIED_THREADS = false` in CommsConsoleContext - instant rollback
2. Original `threadId` state still exists and works
3. Backup file contains all original tool methods
4. RealtimeVoiceAssistant still has all inline code until Phase 3

