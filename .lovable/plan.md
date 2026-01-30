

## Fix Chat Thread Concurrency - Active Run Conflict

### Problem Identified

The error "Can't add messages to thread while a run is active" occurs due to a race condition:

1. **User sends a message** - streaming mode starts, creates a run on OpenAI thread
2. **Streaming returns no content** (AI wants to use tools, which streaming doesn't fully support)
3. **Frontend fallback triggers** - calls `hybrid-assistant-api` with `stream: false`
4. **Polling handler tries to add message to same thread** - but the streaming run is still active
5. **OpenAI rejects the request** - can't add messages while a run is in progress

### Root Cause

Neither `handleStreamingRequest` nor `handleAssistantRequest` in `hybrid-assistant-api` checks for or cancels existing active runs before adding a new message. The memory mentions this should exist, but it doesn't.

---

### Solution

#### Fix 1: Add Run Cancellation Before Message Addition

**File: `supabase/functions/hybrid-assistant-api/index.ts`**

Create a helper function to check for and cancel active runs on a thread before proceeding:

```typescript
async function cancelActiveRuns(openaiThreadId: string): Promise<void> {
  try {
    // List all runs on the thread
    const runsResponse = await fetch(
      `https://api.openai.com/v1/threads/${openaiThreadId}/runs`,
      {
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'OpenAI-Beta': 'assistants=v2'
        }
      }
    );
    
    if (!runsResponse.ok) {
      console.warn('[HYBRID] Failed to list runs:', await runsResponse.text());
      return;
    }
    
    const runsData = await runsResponse.json();
    const activeRuns = runsData.data?.filter(
      (run: any) => ['queued', 'in_progress', 'requires_action'].includes(run.status)
    ) || [];
    
    if (activeRuns.length > 0) {
      console.log(`[HYBRID] Found ${activeRuns.length} active run(s), cancelling...`);
      
      for (const run of activeRuns) {
        const cancelResponse = await fetch(
          `https://api.openai.com/v1/threads/${openaiThreadId}/runs/${run.id}/cancel`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openaiApiKey}`,
              'OpenAI-Beta': 'assistants=v2'
            }
          }
        );
        
        if (cancelResponse.ok) {
          console.log(`[HYBRID] Cancelled run ${run.id}`);
        } else {
          console.warn(`[HYBRID] Failed to cancel run ${run.id}`);
        }
      }
      
      // Wait briefly for cancellation to propagate
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (error) {
    console.warn('[HYBRID] Error checking/cancelling runs:', error);
  }
}
```

**Integrate into `handleAssistantRequest`** - Call `cancelActiveRuns` after getting the OpenAI thread ID but before adding the user message:

| Location | Change |
|----------|--------|
| After line 699 (thread creation/retrieval) | Add: `await cancelActiveRuns(openaiThreadId);` |

**Integrate into `handleStreamingRequest`** - Same pattern:

| Location | Change |
|----------|--------|
| After line 395 (thread update) | Add: `await cancelActiveRuns(openaiThreadId);` |

---

### Files Changed

| File | Changes |
|------|---------|
| `supabase/functions/hybrid-assistant-api/index.ts` | Add `cancelActiveRuns()` helper function; call it before adding messages in both streaming and polling handlers |

---

### Why This Fixes the Issue

1. **Before any message is added**, we check if there are active runs on the thread
2. **If active runs exist**, we cancel them and wait briefly for cancellation to complete
3. **Only then do we add the new message** - preventing the "thread has active run" error
4. This handles:
   - Streaming fallback to polling (same session)
   - User rapidly sending messages
   - Previous session that was interrupted/timed out

---

### Technical Notes

**OpenAI Run States:**
- `queued`, `in_progress`, `requires_action` = Active (must cancel)
- `completed`, `failed`, `cancelled`, `expired` = Inactive (safe to proceed)

**Cancellation Timing:**
The 500ms delay after cancellation is conservative to ensure OpenAI's backend has processed the state change. This adds minimal latency since it only triggers when there's actually an active run.

