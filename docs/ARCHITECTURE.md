# System Architecture

**Last Updated**: 2026-03-06

---

## Overview

**Journey** is a voice-first task management platform built on React + Vite, backed by Supabase (auth, database, 30+ Edge Functions) and a Cloudflare Durable Objects worker for unlimited-duration phone calls. Users interact via three communication modes — **chat**, **browser voice (WebRTC)**, and **phone (Twilio)** — all unified through a single assistant persona ("Iris") with shared conversation memory.

---

## High-Level System Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React + Vite)                         │
│                                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────────┐   │
│  │  MainLayout   │  │  TasksPage   │  │  CommsConsole (Panel)      │   │
│  │  (Sidebar +   │  │  FocusView   │  │  ├─ VoiceOrb (WebRTC)     │   │
│  │   Router)     │  │  KanbanBoard │  │  ├─ ChatInterface (SSE)   │   │
│  │              │  │  GridView    │  │  ├─ PhoneDialer (Twilio)  │   │
│  └──────────────┘  └──────────────┘  │  └─ ModeToggle            │   │
│                                       └────────────────────────────┘   │
│  Contexts:                                                             │
│  ├─ AuthProvider (Supabase Auth)                                       │
│  ├─ VoiceAssistantProvider (WebRTC lifecycle)                          │
│  ├─ CommsConsoleProvider (unified message state + SSE streaming)       │
│  └─ AssignmentSelectionContext                                         │
│                                                                        │
│  Key Hooks:                                                            │
│  ├─ useUnifiedThread (1 thread per user+assistant, shared across modes)│
│  ├─ useChatAssistant (chat messages + interactive check-in flows)      │
│  ├─ usePresenceTracking (visibility API → push notification decisions) │
│  └─ useOAuthCallback (Google/Outlook calendar OAuth redirect handler)  │
└────────────┬───────────────────────┬───────────────────────┬───────────┘
             │                       │                       │
             │ HTTPS/SSE             │ WebRTC (SDP)          │ REST
             ▼                       ▼                       ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     SUPABASE (Backend-as-a-Service)                    │
│                                                                        │
│  ┌─ Auth ─────────────────────────────────────────────────────────┐   │
│  │  Supabase Auth + Row-Level Security on all tables              │   │
│  │  Profiles table (phone, timezone, preferences)                 │   │
│  │  user_roles table (admin check via has_role() SECURITY DEFINER)│   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│  ┌─ Database (PostgreSQL) ────────────────────────────────────────┐   │
│  │  tasks, boards, columns (Kanban model)                         │   │
│  │  assignments, courses, programs (academic model)               │   │
│  │  assistants (persona config per user)                          │   │
│  │  ai_threads (unified thread per user+assistant+mode)           │   │
│  │  conversation_messages (all transcripts: voice/chat/phone)     │   │
│  │  call_sessions, call_messages (phone call audit trail)         │   │
│  │  activity_log, error_log (observability)                       │   │
│  │  calendar_connections, external_calendar_events (OAuth tokens) │   │
│  │  scheduled_notifications, delivery_logs (notification pipeline)│   │
│  │  pre_connect_sessions (phone call pre-warming)                 │   │
│  │  task_topic_index, task_topic_mappings (topic-based grouping)  │   │
│  │  user_scheduling_prefs (timezone, TTS, call mode config)       │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│  ┌─ Realtime ─────────────────────────────────────────────────────┐   │
│  │  postgres_changes on: tasks, conversation_messages             │   │
│  │  Used for instant task creation toasts + chat message delivery │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│  ┌─ Edge Functions (Deno) ────────────────────────────────────────┐   │
│  │                                                                 │   │
│  │  VOICE/PHONE:                                                   │   │
│  │  ├─ generate-realtime-token (ephemeral WebRTC key + TTS config)│   │
│  │  ├─ twilio-voice-handler (TwiML + call routing + pre-connect)  │   │
│  │  ├─ twilio-realtime-bridge (Twilio↔OpenAI WebSocket bridge)    │   │
│  │  ├─ conversation-relay-handler (Twilio ConversationRelay mode) │   │
│  │  ├─ elevenlabs-tts (text→μ-law audio for phone playback)      │   │
│  │  └─ twilio-scheduled-call (legacy, unused)                     │   │
│  │                                                                 │   │
│  │  CHAT:                                                          │   │
│  │  ├─ hybrid-assistant-api (OpenAI Assistants API + tool calls)  │   │
│  │  ├─ send-chat-message (persistence + push trigger)             │   │
│  │  └─ ai-task-parser (NLP → structured task extraction)          │   │
│  │                                                                 │   │
│  │  TOOLS (shared across all modes):                               │   │
│  │  ├─ execute-tool (centralized tool dispatcher + definitions)   │   │
│  │  ├─ web-search (Brave API)                                     │   │
│  │  └─ agenda-manager (conversation agenda tracking)              │   │
│  │                                                                 │   │
│  │  CALENDAR:                                                      │   │
│  │  ├─ calendar-integration-manager (Google/Outlook sync)         │   │
│  │  ├─ calendar-token-manager (OAuth token refresh)               │   │
│  │  ├─ calendar-delta-sync (incremental sync with syncToken)      │   │
│  │  ├─ batch-calendar-scheduler (bulk task→calendar push)         │   │
│  │  └─ smart-calendar-scheduler (AI-powered time slot selection)  │   │
│  │                                                                 │   │
│  │  NOTIFICATIONS:                                                 │   │
│  │  ├─ notification-scheduler (hourly cron → queue builder)       │   │
│  │  ├─ notification-delivery (60s cron → dispatch)                │   │
│  │  ├─ send-push-notification (Web Push via VAPID)                │   │
│  │  ├─ send-unified-notification (multi-channel dispatcher)       │   │
│  │  └─ generate-vapid-keys / get-vapid-key / manage-push-sub     │   │
│  │                                                                 │   │
│  │  DATA SYNC:                                                     │   │
│  │  ├─ sync-google-sheets / sync-mit-sheets (assignment import)  │   │
│  │  ├─ sync-assistant-tools / sync-assistant-knowledge            │   │
│  │  └─ external-db-query / test-external-db                       │   │
│  │                                                                 │   │
│  │  OTHER:                                                         │   │
│  │  ├─ classify-task-topic (auto-topic assignment)                │   │
│  │  ├─ generate-embeddings (vector embeddings for RAG)            │   │
│  │  ├─ rag-context-retrieval (semantic search for persona)        │   │
│  │  └─ ping (health check)                                        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│  ┌─ Cron Jobs ────────────────────────────────────────────────────┐   │
│  │  notification-scheduler: every hour                            │   │
│  │  notification-delivery: every 60 seconds                       │   │
│  └────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
             │
             │ WebSocket (for unlimited call duration)
             ▼
┌────────────────────────────────────────────────────────────────────────┐
│                CLOUDFLARE WORKER (Durable Objects)                     │
│                                                                        │
│  cloudflare/src/index.ts → routes /call WebSocket to Durable Object   │
│  cloudflare/src/TwilioCallSession.ts (2032 lines)                     │
│    ├─ Handles Twilio Media Streams ↔ OpenAI Realtime API bridging     │
│    ├─ Pre-connect session fetching from Supabase                      │
│    ├─ Echo fingerprinting barge-in logic                              │
│    ├─ ElevenLabs TTS with sentence buffering                          │
│    ├─ Smart filler phrases during tool execution                      │
│    ├─ Agenda manager integration                                       │
│    ├─ Transcript persistence to Supabase                              │
│    └─ Activity/error logging to Supabase                              │
│                                                                        │
│  Reason for Cloudflare: Supabase Edge Functions have a ~150s timeout  │
│  Durable Objects have no timeout → unlimited phone call duration       │
└────────────────────────────────────────────────────────────────────────┘
             │
             │
             ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     EXTERNAL SERVICES                                  │
│                                                                        │
│  OpenAI:                                                               │
│  ├─ Realtime API (WebRTC for browser voice, WebSocket for phone)      │
│  ├─ Assistants API v2 (chat mode with tool_calls + threads)           │
│  ├─ Chat Completions (ConversationRelay fallback)                     │
│  └─ Embeddings API (RAG context)                                      │
│                                                                        │
│  Twilio:                                                               │
│  ├─ Voice API (outbound/inbound calls)                                │
│  ├─ Media Streams (real-time audio WebSocket)                         │
│  └─ ConversationRelay (alternative STT+TTS pipeline)                  │
│                                                                        │
│  ElevenLabs:                                                           │
│  ├─ Text-to-Speech API (high-quality voice synthesis)                 │
│  └─ μ-law format output for Twilio compatibility                      │
│                                                                        │
│  Google/Microsoft:                                                     │
│  ├─ Google Calendar API (event sync, OAuth2)                          │
│  └─ Outlook Calendar API (event sync, OAuth2)                         │
│                                                                        │
│  Brave Search API (web search tool)                                    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Communication Modes

### 1. Chat Mode (SSE Streaming)

```
User types message
  → CommsConsoleContext.sendMessage()
    → POST to hybrid-assistant-api (SSE stream)
      → OpenAI Assistants API (with tool_calls)
        → execute-tool (centralized dispatcher)
      → SSE events streamed back to frontend
    → conversation_messages INSERT (persisted)
    → Realtime subscription delivers to all open tabs
```

**Key details:**
- Uses OpenAI Assistants API v2 with persistent threads
- SSE streaming for real-time token delivery
- Interactive check-in flows (topic selection → task selection → scheduling)
- Tool call results rendered as interactive UI cards

### 2. Browser Voice Mode (WebRTC)

```
User clicks VoiceOrb
  → VoiceAssistantContext.connectToAssistant()
    → generate-realtime-token (ephemeral key + TTS config)
    → WebRTC SDP negotiation with OpenAI Realtime API
    → RTCDataChannel for events, RTCTrack for audio
    → RealtimeVoiceAssistant handles all message types
      → Tool calls via data channel events
      → ElevenLabs TTS: mute WebRTC audio, use AudioQueue for MP3 playback
      → OpenAI TTS: use WebRTC audio track directly
    → Transcripts saved to conversation_messages with speech-start timestamps
```

**Key details:**
- Direct browser ↔ OpenAI WebRTC connection (no server relay for audio)
- Dual TTS pipeline: OpenAI native (via WebRTC track) or ElevenLabs (via AudioQueue)
- Unified thread ID shared with chat mode for conversation continuity
- Barge-in handling with audio queue clear

### 3. Phone Mode (Twilio + Bridge)

```
Outbound call triggered
  → twilio-voice-handler (pre-connect + TwiML generation)
    → Pre-connect: fetch user prefs, generate greeting, cache ElevenLabs audio
    → TwiML: <Connect><Stream> to bridge endpoint
  → Bridge endpoint (Supabase or Cloudflare):
    → twilio-realtime-bridge (Supabase, ~150s limit)
    → TwilioCallSession (Cloudflare Durable Object, unlimited)
  → Bridge orchestrates:
    → Twilio Media Streams (μ-law 8kHz) ↔ OpenAI Realtime API (PCM 24kHz)
    → Audio codec conversion (upsample/downsample, μ-law encode/decode)
    → Echo fingerprinting for smart barge-in classification
    → ElevenLabs TTS sentence buffering
    → Agenda tracking with tangent detection + resume
    → Transcript persistence to call_messages + conversation_messages
```

**Three phone bridge modes** (configured per user in `user_scheduling_prefs.phone_call_mode`):
1. **`media_streams`** — Supabase Edge Function bridge (default, ~150s timeout)
2. **`cloudflare`** — Cloudflare Durable Objects bridge (unlimited duration)
3. **`conversation_relay`** — Twilio ConversationRelay (Twilio-managed STT/TTS, simpler but less control)

---

## Unified Thread Architecture

All three modes share a single conversation thread per user+assistant:

```
ai_threads table:
  ├─ id (UUID, primary key)
  ├─ user_id
  ├─ assistant_id (FK → assistants)
  ├─ openai_thread_id (for Assistants API)
  └─ mode: 'unified'

conversation_messages table:
  ├─ thread_id (FK → ai_threads)
  ├─ source: 'voice' | 'chat' | 'phone' | 'cloudflare_phone'
  ├─ role: 'user' | 'assistant' | 'system'
  └─ content (transcript text)
```

The `useUnifiedThread` hook ensures one thread per user+assistant. When switching between chat and voice mode, the same `dbThreadId` is passed to both `hybrid-assistant-api` and `RealtimeVoiceAssistant.connect()`.

---

## Configuration Architecture

Voice timing constants are maintained in three synchronized locations:

| Location | File | Role |
|----------|------|------|
| Source of truth | `supabase/functions/_shared/config.ts` | Edge Functions |
| Frontend copy | `src/config/voiceConfig.ts` | WebRTC client |
| Cloudflare copy | `cloudflare/src/config.ts` | Durable Object |

Key constants: `OUTBOUND_HELLO_WAIT_MS` (2000), `FAREWELL_DELAY_MS` (5000), `SPEECH_DEBOUNCE_MS` (300), sample rates (8kHz Twilio, 24kHz OpenAI).

Global version string (`GLOBAL_VERSION`) in `_shared/config.ts` is appended to all edge function health checks for deployment verification.

---

## Notification Pipeline

```
notification-scheduler (hourly cron)
  └─ Scans user_scheduling_prefs for due notifications
  └─ Creates scheduled_notifications entries
      └─ notification-delivery (60s cron)
          └─ Processes due entries by channel:
              ├─ phone → twilio-voice-handler (pre-connect → call)
              ├─ chat → send-chat-message
              ├─ push → send-push-notification (VAPID Web Push)
              └─ slack/email → send-unified-notification
```

---

## Frontend Page Structure

| Route | Page | Description |
|-------|------|-------------|
| `/tasks?view=focus` | TasksPage → FocusView | Today's prioritized task list (default) |
| `/tasks?view=kanban` | TasksPage → TabbedKanbanBoard | Category-filtered Kanban boards |
| `/tasks?view=grid` | TasksPage → EnhancedTaskGridView | Sortable/filterable table view |
| `/calendar` | Calendar | Monthly calendar + external event sync |
| `/agenda` | DailyPriorities | Daily schedule timeline |
| `/priorities` | Priorities | Topic group management |
| `/settings` | Settings | Voice, calendar, notification config |
| `/admin` | Admin | Admin-only dashboard (role-gated) |
| `/auth` | Auth | Supabase auth (email/password) |

All authenticated routes are wrapped in `MainLayout` which provides:
- Left sidebar navigation (collapsible)
- Right panel for CommsConsole (togglable)
- Mobile responsive with Sheet-based sidebars

---

## Key Design Patterns

1. **Centralized tool dispatch**: All tool calls from all modes route through `execute-tool` edge function, ensuring feature parity.
2. **Pre-connect optimization**: Phone calls pre-warm by fetching user prefs, generating greeting audio, and caching in `pre_connect_sessions` before Twilio connects.
3. **Echo fingerprinting**: Smart barge-in on phone calls compares user transcript against recent AI output to classify as echo vs. real interruption.
4. **Activity logging**: Every connection stage logged to `activity_log` with session IDs for end-to-end debugging.
5. **Error logging**: Structured `error_log` entries from all layers (frontend, edge functions, Cloudflare worker).
6. **Presence-aware notifications**: `usePresenceTracking` uses Visibility API to decide whether to send push notifications (only when user is away).
