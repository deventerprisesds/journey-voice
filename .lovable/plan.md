
# Fix: Chat Persistence, History, and Reconnection

## Problem Summary

The user reported three distinct issues with the chat functionality:

1. **Connection Interrupted Message** - When returning to the chat page, they see "_Using tools..._" followed by "Connection interrupted. Please try again." - the chat doesn't gracefully recover.

2. **Transcript Tab Shows Empty History** - The "Transcript" tab in phone mode shows "No conversation history" even though conversations have occurred over the past few days.

3. **Chat Clears on Every Refresh** - Unlike SMS, the chat doesn't persist as a running thread. Each page refresh/navigation clears the conversation.

---

## Root Cause Analysis

### Issue 1: Connection Interrupted (No Reconnection)

**Location**: `src/contexts/CommsConsoleContext.tsx`

When a streaming request fails mid-flight (e.g., user navigates away, network blip, or timeout), the error handler shows "Connection interrupted" but:
- There's no mechanism to **retry** the failed request
- There's no **refresh button** to reload the chat
- The SSE stream cannot be resumed once broken

### Issue 2: Transcript Tab Empty

**Location**: `src/components/CommsConsole/PhoneDialer.tsx` (Lines 549-555)

The Transcript tab displays `voiceTranscripts` from `VoiceAssistantContext`:

```typescript
<TabsContent value="transcript" className="flex-1 overflow-hidden p-4 m-0">
  {voiceTranscripts.length === 0 ? (
    <div>No conversation history</div>
  ) : (
    // Show transcripts
  )}
</TabsContent>
```

**Problem**: `voiceTranscripts` is an **in-memory array** that:
1. Gets **cleared on every page refresh** (React state resets)
2. Gets **cleared when connecting** (`setVoiceTranscripts([])` in `handleConnectionChange`)
3. Is never **loaded from the database** on mount

The conversation_messages table HAS the history - the query confirms messages exist - but they're never fetched and displayed.

### Issue 3: Chat Clears on Refresh

**Location**: `src/contexts/CommsConsoleContext.tsx` (Line 110)

```typescript
const [messages, setMessages] = useState<ConversationMessage[]>([]);
```

Chat messages are stored as **React state only**. On page refresh:
1. Component unmounts
2. State is lost
3. Component remounts with empty `[]` array
4. No code loads previous messages from `conversation_messages` table

The system correctly **persists** messages to the database (via `persistMessagesWithMetrics`), but never **loads** them back on mount.

---

## Solution

### Part 1: Load Chat History on Mount

**File**: `src/contexts/CommsConsoleContext.tsx`

Add a new effect that fetches previous chat messages when the thread is initialized:

```typescript
// Load chat history when thread is ready
useEffect(() => {
  if (!dbThreadId || !userId) return;
  
  const loadChatHistory = async () => {
    try {
      const { data, error } = await supabase
        .from('conversation_messages')
        .select('id, role, content, source, created_at, assistant_id')
        .eq('thread_id', dbThreadId)
        .eq('user_id', userId)
        .eq('source', 'chat')
        .order('created_at', { ascending: true })
        .limit(50);  // Last 50 messages
      
      if (error) throw error;
      
      if (data && data.length > 0) {
        setMessages(data.map(msg => ({
          id: msg.id,
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content,
          source: msg.source as CommunicationMode,
          assistant_id: msg.assistant_id,
          created_at: msg.created_at,
        })));
      }
    } catch (err) {
      console.error('[CommsConsole] Failed to load chat history:', err);
    }
  };
  
  loadChatHistory();
}, [dbThreadId, userId]);
```

### Part 2: Load Voice Transcript History

**File**: `src/contexts/VoiceAssistantContext.tsx`

Modify the `handleConnectionChange` to NOT clear transcripts, and add a new function to load voice history:

```typescript
// Don't clear transcripts on connect - they represent session history
const handleConnectionChange = (connected: boolean) => {
  setIsConnected(connected);
  if (connected) {
    setConnectionError(null);
    setRetryAttempts(0);
    // REMOVED: setVoiceTranscripts([]);
  } else {
    setIsListening(false);
    setIsSpeaking(false);
  }
};
```

Add a new effect to load voice history from database:

```typescript
// Load voice transcript history on mount
useEffect(() => {
  if (!user?.id) return;
  
  const loadVoiceHistory = async () => {
    const { data, error } = await supabase
      .from('conversation_messages')
      .select('id, role, content, source, created_at')
      .eq('user_id', user.id)
      .eq('source', 'voice')
      .order('created_at', { ascending: false })
      .limit(50);
    
    if (!error && data) {
      setVoiceTranscripts(data.reverse().map(msg => ({
        id: msg.id,
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
        source: 'voice',
        assistant_id: null,
        created_at: msg.created_at,
      })));
    }
  };
  
  loadVoiceHistory();
}, [user?.id]);
```

### Part 3: Add Refresh/Retry Button for Interrupted Connections

**File**: `src/components/CommsConsole/TranscriptScroll.tsx`

Add a retry button when showing connection error messages:

```typescript
{message.content === 'Connection interrupted. Please try again.' && (
  <Button 
    size="sm" 
    variant="outline" 
    onClick={() => window.location.reload()}
    className="mt-2"
  >
    Retry
  </Button>
)}
```

**File**: `src/contexts/CommsConsoleContext.tsx`

Add a `retryLastMessage` function that can be called to resend the last user message after connection failure.

### Part 4: Add Clear Chat / New Conversation Option

Allow users to start fresh while keeping history accessible:

**File**: `src/components/CommsConsole/AssistantHeader.tsx`

Add a menu option to clear current conversation or start new thread.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/contexts/CommsConsoleContext.tsx` | Load chat history on mount; add retry mechanism |
| `src/contexts/VoiceAssistantContext.tsx` | Load voice history on mount; don't clear on connect |
| `src/components/CommsConsole/TranscriptScroll.tsx` | Add retry button for connection errors |
| `src/components/CommsConsole/AssistantHeader.tsx` | Add "New Conversation" option |

---

## Technical Flow After Fix

### On Page Load / Return:
```text
1. User navigates to chat page
2. CommsConsoleContext initializes
3. useUnifiedThread fetches/creates dbThreadId
4. useEffect triggers loadChatHistory()
5. Previous messages populate UI immediately
6. User sees their conversation right where they left off
```

### On Voice Tab:
```text
1. User switches to Phone mode → Transcript tab
2. VoiceAssistantContext loads voice history from DB
3. Previous voice transcripts displayed
4. New transcripts during session added to existing history
```

### On Connection Error:
```text
1. Streaming request fails
2. Error message shown with "Retry" button
3. User clicks retry → resends last message
4. Conversation continues
```

---

## Database Queries

**Load Chat History**:
```sql
SELECT id, role, content, source, created_at, assistant_id
FROM conversation_messages
WHERE thread_id = $1 AND user_id = $2 AND source = 'chat'
ORDER BY created_at ASC
LIMIT 50
```

**Load Voice History**:
```sql
SELECT id, role, content, source, created_at
FROM conversation_messages
WHERE user_id = $1 AND source = 'voice'
ORDER BY created_at DESC
LIMIT 50
```

---

## Expected Behavior After Fix

1. **Chat History Persists**: Navigate away and back - previous messages still visible
2. **Transcript Tab Shows History**: Voice transcripts from past sessions load on mount
3. **Connection Errors Recoverable**: "Retry" button allows quick recovery from interruptions
4. **SMS-like Experience**: Running thread continues across sessions, just like iMessage or WhatsApp

---

## Technical Summary

| Issue | Root Cause | Fix |
|-------|------------|-----|
| Chat clears on refresh | Messages only in React state | Load from `conversation_messages` on mount |
| Transcript tab empty | `voiceTranscripts` cleared on connect | Load history from DB; don't clear on connect |
| Connection interrupted | No retry mechanism | Add retry button and `retryLastMessage()` function |
