
# Live Transcription Display + Voice Memory Fix Plan

## Problem Summary

### Issue 1: Voice Messages Missing `assistant_id` and `source`
The `saveTranscript` method in `RealtimeVoiceAssistant.ts` (lines 726-742) calls `generate-embeddings` but:
- **`assistantId` is never passed** - it's fetched on line 487 but not stored as an instance variable
- **`source` is in metadata** but `generate-embeddings` doesn't extract it to the `source` column
- **Result**: `conversation_messages` rows have `assistant_id = NULL` and `source = 'chat'` (default) for voice transcripts

**Current `saveTranscript` call (line 726-742):**
```typescript
await supabase.functions.invoke('generate-embeddings', {
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
      source: 'voice',  // <-- IN METADATA, NOT PASSED TO DB COLUMN
      session_type: 'webrtc',
      tts_provider: this.ttsProvider
    }
    // <-- MISSING: assistantId
  }
});
```

**Current `generate-embeddings` (lines 65-84):**
```typescript
await supabase.from('conversation_messages').insert({
  user_id: userId,
  thread_id: threadId,
  role,
  content,
  audio_transcript: audioTranscript,
  voice_session_id: voiceSessionId,
  metadata
  // <-- MISSING: assistant_id, source
});
```

### Issue 2: No Live Transcription Visibility
When using Phone Dialer mode, transcription only appears after saved to DB. Users can't verify accuracy in real-time or catch misheard words like "bye".

### Issue 3: Wrong Timezone on Timestamps
Timestamps show incorrect times (e.g., ~8:14 PM when not NYC time). Display logic isn't converting UTC to user's timezone.

---

## Implementation Plan

### Part 1: Fix Voice Memory Persistence (Critical)

**Goal:** Ensure voice transcripts are stored with correct `assistant_id` and `source: 'voice'`.

#### 1.1 Store assistantId as Instance Variable

**File:** `src/utils/RealtimeVoiceAssistant.ts`

Add instance variable (around line 207):
```typescript
private threadId: string | null = null;
private assistantId: string | null = null;  // <-- NEW
private userId: string | null = null;
```

Update where assistantId is set (line 487, in the fallback branch):
```typescript
const assistantId = defaultAssistant?.id || null;
this.assistantId = assistantId;  // <-- Store for later use
```

Also store when unified thread is used (around line 472-474):
```typescript
if (unifiedThreadId) {
  this.threadId = unifiedThreadId;
  this.assistantId = unifiedAssistantId || null;  // <-- Accept and store
  console.log('[VOICE] Using unified thread:', unifiedThreadId);
}
```

Update `connect()` signature to accept assistantId:
```typescript
async connect(
  instructions: string = '', 
  ragContext: string = '',
  unifiedThreadId?: string,
  unifiedAssistantId?: string  // <-- NEW
): Promise<boolean>
```

#### 1.2 Pass assistantId to saveTranscript

**File:** `src/utils/RealtimeVoiceAssistant.ts`

Update `saveTranscript` call (lines 726-742):
```typescript
await supabase.functions.invoke('generate-embeddings', {
  body: {
    action: 'store_conversation',
    userId: this.userId,
    threadId: this.threadId,
    assistantId: this.assistantId,  // <-- NEW
    source: 'voice',                 // <-- NEW: top-level, not in metadata
    role: role,
    content: content,
    audioTranscript: content,
    voiceSessionId: this.sessionId,
    messageType: role,
    metadata: { 
      session_type: 'webrtc',
      tts_provider: this.ttsProvider
    }
  }
});
```

#### 1.3 Update generate-embeddings to Accept and Store Fields

**File:** `supabase/functions/generate-embeddings/index.ts`

Update request parsing (lines 98-108):
```typescript
const { 
  userId, 
  threadId, 
  assistantId,  // <-- NEW
  source,       // <-- NEW
  content, 
  messageType, 
  role, 
  audioTranscript, 
  voiceSessionId, 
  metadata,
  action = 'store_conversation'
} = await req.json();
```

Update `storeConversationMessage` function (lines 65-90):
```typescript
async function storeConversationMessage(
  userId: string,
  threadId: string,
  role: string,
  content: string,
  audioTranscript?: string,
  voiceSessionId?: string,
  assistantId?: string,  // <-- NEW
  source?: string,       // <-- NEW
  metadata: any = {}
) {
  const { error } = await supabase
    .from('conversation_messages')
    .insert({
      user_id: userId,
      thread_id: threadId,
      role,
      content,
      audio_transcript: audioTranscript,
      voice_session_id: voiceSessionId,
      assistant_id: assistantId || null,  // <-- NEW
      source: source || 'chat',           // <-- NEW with fallback
      metadata
    });
  // ...
}
```

Update the function call in serve handler:
```typescript
await Promise.all([
  storeConversationEmbedding(userId, threadId, content, messageType, voiceSessionId, metadata),
  storeConversationMessage(userId, threadId, role, content, audioTranscript, voiceSessionId, assistantId, source, metadata)
]);
```

#### 1.4 Update VoiceAssistantContext to Pass AssistantId

**File:** `src/contexts/VoiceAssistantContext.tsx`

Update `connectToAssistant` to pass both thread and assistant IDs:
```typescript
const connectToAssistant = useCallback(async (
  customInstructions?: string, 
  ragContext?: string,
  unifiedThreadId?: string,
  unifiedAssistantId?: string  // <-- NEW
) => {
  // ...
  const success = await voiceAssistant.current.connect(
    customInstructions, 
    ragContext,
    unifiedThreadId,
    unifiedAssistantId  // <-- Pass through
  );
}, []);
```

#### 1.5 Update CommsConsoleContext to Pass AssistantId

**File:** `src/contexts/CommsConsoleContext.tsx`

When connecting voice, pass both thread ID and assistant ID:
```typescript
// When switching to voice mode
await connectToAssistant(
  customInstructions,
  ragContext,
  dbThreadId,           // from useUnifiedThread
  currentAssistant?.id  // <-- NEW: pass assistant ID
);
```

---

### Part 2: Live Transcription Panel (Collapsible)

**Goal:** Add real-time transcription display below keypad to verify accuracy live.

#### 2.1 Emit Live Transcript Events

**File:** `src/utils/RealtimeVoiceAssistant.ts`

Add handling for speech start and partial transcripts:
```typescript
case 'input_audio_buffer.speech_started':
  this.onMessage({ 
    type: 'transcript.interim', 
    role: 'user', 
    content: '', 
    isListening: true 
  });
  break;

case 'response.audio_transcript.delta':
  this.onMessage({
    type: 'transcript.interim',
    role: 'assistant',
    content: event.delta,
    isPartial: true
  });
  break;
```

#### 2.2 Track Live Transcript State

**File:** `src/contexts/VoiceAssistantContext.tsx`

Add state and handler:
```typescript
const [liveTranscript, setLiveTranscript] = useState<{
  role: 'user' | 'assistant';
  content: string;
  isListening: boolean;
} | null>(null);

// In handleMessage:
if (message.type === 'transcript.interim') {
  setLiveTranscript({
    role: message.role,
    content: message.content || '',
    isListening: message.isListening || false
  });
  return;
}

// Clear on final save
if (message.type === 'transcript.saved') {
  setLiveTranscript(null);
}
```

#### 2.3 Create LiveTranscriptPanel Component

**New File:** `src/components/CommsConsole/LiveTranscriptPanel.tsx`

A collapsible panel showing:
- Current time in user's timezone
- "Listening..." indicator when speech detected
- Live user transcription as they speak
- Live assistant response as it generates

#### 2.4 Integrate into PhoneDialer

**File:** `src/components/CommsConsole/PhoneDialer.tsx`

Add `LiveTranscriptPanel` below the in-call controls, loading user's timezone from preferences.

---

### Part 3: Fix Timezone Display

**Goal:** Show all timestamps in user's local timezone.

#### 3.1 Create Timezone Formatter Utility

**File:** `src/lib/date.ts`

```typescript
export function formatTimeInTimezone(
  isoTimestamp: string, 
  timezone: string,
  options?: Intl.DateTimeFormatOptions
): string {
  try {
    const date = new Date(isoTimestamp);
    return date.toLocaleTimeString('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      ...options
    });
  } catch {
    return new Date(isoTimestamp).toLocaleTimeString();
  }
}
```

#### 3.2 Update Timestamp Displays

**File:** `src/components/CommsConsole/TranscriptScroll.tsx`

Use `formatTimeInTimezone` for all timestamp displays, passing the user's timezone from preferences.

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/utils/RealtimeVoiceAssistant.ts` | Store `assistantId` instance var, pass to saveTranscript, emit interim events |
| `src/contexts/VoiceAssistantContext.tsx` | Accept `assistantId` param, add `liveTranscript` state |
| `src/contexts/CommsConsoleContext.tsx` | Pass `currentAssistant.id` when connecting voice |
| `supabase/functions/generate-embeddings/index.ts` | Accept and store `assistantId` and `source` fields |
| `src/components/CommsConsole/LiveTranscriptPanel.tsx` | **NEW** - Collapsible live transcription UI |
| `src/components/CommsConsole/PhoneDialer.tsx` | Integrate LiveTranscriptPanel, load timezone |
| `src/lib/date.ts` | Add `formatTimeInTimezone` utility |
| `src/components/CommsConsole/TranscriptScroll.tsx` | Use timezone-aware formatting |

---

## Verification Checklist

After implementation, run these queries to confirm fixes:

```sql
-- Verify voice messages have assistant_id populated
SELECT id, role, source, assistant_id, created_at 
FROM conversation_messages 
WHERE voice_session_id IS NOT NULL
ORDER BY created_at DESC 
LIMIT 10;

-- Expected: source = 'voice', assistant_id = UUID (not null)
```

**Manual verification:**
- [ ] Voice transcripts show `source = 'voice'` in database
- [ ] Voice transcripts show `assistant_id = <uuid>` (not NULL)
- [ ] Live transcript panel appears below keypad in Phone mode
- [ ] Panel shows "Listening..." when detecting speech
- [ ] Shows interim transcription as you speak
- [ ] Current time in panel matches user's timezone (NYC)
- [ ] Saved transcript timestamps display in correct timezone
