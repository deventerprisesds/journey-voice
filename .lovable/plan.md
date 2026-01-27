
# Unified Transcript Tracking via Existing Edge Function

## Problem

Currently, transcript persistence is fragmented:
- **Twilio Bridge** (server-side): Saves transcripts to `conversation_messages` - **WORKS**
- **WebRTC Voice** (client-side): Does NOT save transcripts - **MISSING**
- **Chat**: Uses hybrid-assistant-api - **WORKS**

This creates two problems:
1. Voice orb sessions have no history/debugging visibility
2. We'd be creating duplicate code if we add inline saving to `RealtimeVoiceAssistant`

## Solution: Reuse `generate-embeddings` Edge Function

The `generate-embeddings` edge function already exists and handles both:
- Storing conversation messages
- Generating embeddings for RAG

Instead of duplicating the Twilio bridge's inline database code in the WebRTC client, we call this existing edge function from the browser.

## Architecture Comparison

```text
TWILIO BRIDGE (Server-side):
┌──────────────────────────┐
│  twilio-realtime-bridge  │
│  (Edge Function)         │
│                          │
│  transcript event ───────┼──► supabase.from('conversation_messages').insert()
│                          │    (direct DB call - same process)
└──────────────────────────┘

WEBRTC VOICE (Client-side - PROPOSED):
┌──────────────────────────┐     ┌────────────────────────┐
│  RealtimeVoiceAssistant  │     │  generate-embeddings   │
│  (Browser)               │     │  (Edge Function)       │
│                          │     │                        │
│  transcript event ───────┼────►│  store_conversation    │
│                          │HTTP │  action                │
└──────────────────────────┘     └────────────────────────┘
                                          │
                                          ▼
                                 ┌────────────────────┐
                                 │ conversation_messages │
                                 │ conversation_embeddings│
                                 └────────────────────┘
```

This approach:
- **Reuses existing code** (no duplication)
- **Single point of maintenance** for transcript storage logic
- **Includes embeddings** for RAG continuity automatically

---

## Implementation Details

### File: `src/utils/RealtimeVoiceAssistant.ts`

#### 1. Add Session Tracking Properties

```typescript
// New class properties
private sessionId: string | null = null;
private threadId: string | null = null;
private userId: string | null = null;
```

#### 2. Generate Session ID on Connect

In `connect()`, after getting the ephemeral token:

```typescript
// Generate WebRTC session ID (WR prefix for WebRTC)
this.sessionId = `WR${Date.now().toString(36)}${Math.random().toString(36).substring(2, 8)}`;

// Get user ID
const { data: { user } } = await supabase.auth.getUser();
this.userId = user?.id || null;

// Create or reuse thread for session
if (this.userId) {
  const { data: thread } = await supabase
    .from('ai_threads')
    .insert({ 
      user_id: this.userId, 
      mode: 'voice',
      metadata: { session_id: this.sessionId }
    })
    .select('id')
    .single();
  this.threadId = thread?.id || null;
}
```

#### 3. Add Transcript Event Handlers

In `handleMessage()` switch statement, add two new cases:

```typescript
case 'conversation.item.input_audio_transcription.completed':
  // User speech transcript
  console.log('📝 User transcript:', event.transcript);
  if (event.transcript?.trim()) {
    this.saveTranscript('user', event.transcript);
  }
  break;

case 'response.audio_transcript.done':
  // Assistant speech transcript
  console.log('📝 Assistant transcript:', event.transcript);
  if (event.transcript?.trim()) {
    this.saveTranscript('assistant', event.transcript);
  }
  break;
```

#### 4. Add Save Method (Calls Existing Edge Function)

```typescript
private async saveTranscript(role: 'user' | 'assistant', content: string): Promise<void> {
  if (!this.userId || !content?.trim()) return;

  try {
    // Call existing generate-embeddings function
    const { error } = await supabase.functions.invoke('generate-embeddings', {
      body: {
        action: 'store_conversation',
        userId: this.userId,
        threadId: this.threadId,
        role: role,
        content: content,
        audioTranscript: content,
        voiceSessionId: this.sessionId,
        messageType: role,
        metadata: { 
          source: 'voice',
          session_type: 'webrtc',
          tts_provider: this.ttsProvider
        }
      }
    });

    if (error) {
      console.warn('Failed to save transcript:', error);
    } else {
      console.log(`💾 Saved ${role} transcript via generate-embeddings`);
    }

    // Emit for UI updates
    this.onMessage({
      type: 'transcript.saved',
      role,
      content,
      sessionId: this.sessionId
    });
  } catch (error) {
    console.error('Error saving transcript:', error);
  }
}
```

---

### File: `src/contexts/VoiceAssistantContext.tsx`

#### 5. Capture Transcripts for UI

Add state and handler for transcript events:

```typescript
const [voiceTranscripts, setVoiceTranscripts] = useState<ConversationMessage[]>([]);

// In handleMessage callback:
if (message.type === 'transcript.saved') {
  const newMessage: ConversationMessage = {
    id: `${message.sessionId}-${Date.now()}`,
    role: message.role,
    content: message.content,
    source: 'voice',
    assistant_id: null,
    created_at: new Date().toISOString(),
  };
  setVoiceTranscripts(prev => [...prev, newMessage]);
}

// Clear on disconnect
const clearVoiceTranscripts = () => setVoiceTranscripts([]);
```

---

### File: `src/contexts/CommsConsoleContext.tsx`

#### 6. Merge Voice Transcripts with Messages

```typescript
const { voiceTranscripts } = useVoiceAssistant();

const allMessages = useMemo(() => {
  if (currentMode === 'voice') {
    return voiceTranscripts;
  }
  return messages; // Chat/phone messages from DB
}, [currentMode, messages, voiceTranscripts]);
```

---

## Why This Approach is Better

| Aspect | Inline DB Calls (Duplicate) | Edge Function (Reuse) |
|--------|----------------------------|----------------------|
| Code duplication | YES - copy paste from bridge | NO - single source |
| Embedding generation | Manual add later | Built-in automatically |
| Maintenance | Two places to update | One place |
| Error handling | Must duplicate | Already handled |
| Auth/security | Client needs service key | Edge function handles |
| RAG continuity | May miss embeddings | Guaranteed |

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/utils/RealtimeVoiceAssistant.ts` | Add session tracking, transcript handlers, save method |
| `src/contexts/VoiceAssistantContext.tsx` | Capture transcripts for UI display |
| `src/contexts/CommsConsoleContext.tsx` | Merge voice transcripts with other messages |

---

## Verification

After implementation, you can verify transcripts are being saved:

```sql
SELECT 
  created_at,
  role,
  content,
  voice_session_id,
  metadata->>'source' as source
FROM conversation_messages 
WHERE voice_session_id LIKE 'WR%'
ORDER BY created_at DESC
LIMIT 20;
```

---

## Expected Outcome

- Voice orb sessions now fully tracked in database
- Transcripts appear in `TranscriptScroll` UI during voice sessions
- RAG context retrieval includes voice conversation history
- Session IDs (`WR...`) allow debugging specific voice sessions
- Single codebase for transcript storage (no duplication with Twilio bridge)
