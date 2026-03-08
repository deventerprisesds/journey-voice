# Comms Console

> Technical reference for the multi-modal communication interface (chat, voice, phone).

## Overview

The Comms Console is a unified communication hub supporting three modes: text chat (SSE streaming), voice (WebRTC via OpenAI Realtime API), and phone (Twilio). It's powered by `CommsConsoleContext`, a ~1140-line React context provider that manages all state, connections, and message flows.

## Architecture

```
CommsConsoleContext (state + orchestration)
  ├─ useUnifiedThread (thread management)
  ├─ useChatAssistant (SSE streaming)
  ├─ RealtimeVoiceAssistant (WebRTC)
  └─ PhoneDialer (Twilio outbound calls)

Rendering:
  ├─ CommsHome (/comms) — full-page embedded mode
  ├─ AssistantSidebar — right panel mode
  └─ ConversationPane — shared content area
```

## Rendering Modes

| Mode | Route/Trigger | Layout |
|------|---------------|--------|
| Embedded | `/comms` page | Full page with sidebar |
| Panel | Click assistant icon | Right sidebar overlay |
| Overlay | Legacy (deprecated) | Floating panel |

## Communication Modes

### Chat Mode

**Flow**:
```
User types message → TextInputBar
  → CommsConsoleContext.sendMessage()
  → Optimistic insert (temp ID: user-{timestamp})
  → POST to hybrid-assistant-api (SSE stream)
  → Delta events accumulate into assistant response
  → On stream end: temp assistant message replaced by DB record
  → Realtime subscription catches INSERT → deduplicates by content match
```

**SSE Streaming** (`hybrid-assistant-api`):
- Returns `text/event-stream` with delta events
- Event types: `delta` (text chunk), `tool_call` (function invocation indicator), `done`, `error`
- JSON fallback: if SSE fails, returns full response as JSON
- Latency tracked: `time-to-first-token` measured from request start to first delta

### Voice Mode

**Flow**:
```
User taps VoiceOrb → onVoiceToggle()
  → RealtimeVoiceAssistant.connect()
  → WebRTC session to OpenAI Realtime API
  → Bidirectional audio streaming
  → Transcripts saved to conversation_messages
  → VoiceOrb animates based on voiceState (idle/listening/processing/speaking)
```

- See [VOICE_SYSTEM.md](./VOICE_SYSTEM.md) for full WebRTC details
- Voice tools defined in `RealtimeVoiceAssistant.tools.backup.ts`
- Tool execution routed through `UnifiedVoiceToolHandler` → `execute-tool` edge function

### Phone Mode

**Flow**:
```
User enters number → PhoneDialer
  → Calls twilio-voice-handler edge function
  → Twilio initiates outbound call
  → Media stream connects to Cloudflare Worker (TwilioCallSession)
  → Real-time transcription + AI responses
  → Call state: idle → dialing → ringing → connected → ended
```

- See [CLOUDFLARE_WORKER.md](./CLOUDFLARE_WORKER.md) for Durable Object details

## Unified Thread System

### `useUnifiedThread` Hook

Manages the `ai_threads` table — one thread per user + assistant + mode combination:

```typescript
// Thread lookup/create
getOrCreateThread(userId, assistantId, mode) → threadId
```

- Thread ID stored in context state as `threadId`
- All messages reference `thread_id` for conversation continuity
- OpenAI thread ID (`openai_thread_id`) links to the Assistants API thread

### Message Storage

`conversation_messages` table:
- `role`: user | assistant | system
- `source`: chat | voice | phone
- `thread_id`: FK to `ai_threads`
- `assistant_id`: FK to `assistants`
- `metadata`: JSON with latency metrics, tool results, etc.

## Chat History

### Loading

```
On mount / assistant change:
  → Query conversation_messages WHERE thread_id = X
  → ORDER BY created_at DESC LIMIT 50
  → Reverse for chronological display
  → Subscribe to Realtime postgres_changes (INSERT on conversation_messages)
```

### Message Deduplication

Problem: Optimistic UI inserts temp messages, then Realtime delivers the same message from DB.

Solution:
1. Temp messages use IDs like `user-{timestamp}` or `assistant-{timestamp}`
2. On Realtime INSERT, match by `content` + `role` + time proximity
3. Replace temp message with DB record (preserving scroll position)
4. Unmatched Realtime messages are appended (e.g., system-initiated messages)

### Smart Visibility Reload

- `document.visibilitychange` listener
- On tab focus: fetch only messages newer than last known `created_at`
- Prevents stale state after backgrounding

## Assistant Management

### Data Flow

```
On context mount:
  → Fetch assistants WHERE user_id = currentUser AND is_active = true
  → If none found AND demo mode: fetch dev user's assistants (shared)
  → If none found: auto-create default "Iris" assistant
  → Set currentAssistant to is_default = true or first in list
```

### Assistant Fields

| Field | Usage |
|-------|-------|
| `openai_assistant_id` | Links to OpenAI Assistants API |
| `voice_id` | ElevenLabs voice for phone mode |
| `persona_prompt` | System prompt injected into all conversations |
| `orb_color` / `orb_animation` | VoiceOrb visual customization |
| `tools_enabled` | Array of tool names the assistant can invoke |

### `VoiceAssistantSettings` Component

UI for editing assistant configuration: name, persona, voice, tools, orb appearance.

## Retry & New Conversation

### Retry

- Available on failed messages (network error, API error)
- Re-sends the last user message to `hybrid-assistant-api`
- `onRetry` prop passed through `ConversationPane` → `TranscriptScroll`

### New Conversation

- Creates a new `ai_threads` record
- Clears message history in UI
- Previous thread remains in DB for history

## UI Components

| Component | Role |
|-----------|------|
| `CommsConsole` | Main wrapper, mode switching |
| `AssistantSidebar` | Panel mode container with header + nav |
| `AssistantHeader` | Shows current assistant name + avatar |
| `NavigationSection` | Assistant picker, huddle list |
| `ConversationPane` | Renders VoiceOrb, PhoneDialer, or TranscriptScroll based on mode |
| `TextInputBar` | Chat input with send button |
| `TranscriptScroll` | Scrollable message list with auto-scroll |
| `VoiceOrb` | Animated orb reflecting voice state |
| `ModeToggle` | Switch between chat/voice/phone |
| `LiveTranscriptPanel` | Real-time voice transcript overlay |

## Key Files

| File | Role |
|------|------|
| `src/contexts/CommsConsoleContext.tsx` | Central state provider (~1140 lines) |
| `src/hooks/useUnifiedThread.ts` | Thread CRUD |
| `src/hooks/useChatAssistant.ts` | SSE streaming logic |
| `src/utils/RealtimeVoiceAssistant.ts` | WebRTC voice client |
| `src/utils/UnifiedVoiceToolHandler.ts` | Voice tool execution |
| `src/components/CommsConsole/` | All UI components |
| `src/pages/CommsHome.tsx` | Full-page route |
| `supabase/functions/hybrid-assistant-api/` | Chat API with SSE |

---

*See also: [ARCHITECTURE.md](./ARCHITECTURE.md), [VOICE_SYSTEM.md](./VOICE_SYSTEM.md), [EDGE_FUNCTIONS.md](./EDGE_FUNCTIONS.md), [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)*
